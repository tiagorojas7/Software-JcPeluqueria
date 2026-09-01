import {
  FakeClock,
  FakeDayBoardRepository,
  FakeRolePermissionRepository,
  type ActorContext,
  type Permission,
} from '@jc-barberia/domain';
import { describe, expect, it } from 'vitest';

import { GetDayBoardUseCase } from './get-day-board';

/** Builds fixed instants from shop wall-clock time — `Date` may not be constructed directly. */
const clock = new FakeClock();

const OWNER: ActorContext = { userId: 'owner-1', role: 'owner' };
const BARBER_A: ActorContext = { userId: 'barber-a-user', role: 'barber', barberId: 'barber-a' };

/** The real seed matrix from migration 0006 (role-permission.repository.spec.ts),
 *  reduced to only the permissions this use case reads. */
function realisticRolePermissions(): FakeRolePermissionRepository {
  return new FakeRolePermissionRepository(
    new Map([
      [
        'owner',
        new Set<Permission>([
          'appointment:update',
          'appointment:cancel',
          'appointment:mark-completed:any',
          'client:manage',
        ]),
      ],
      ['barber', new Set<Permission>(['appointment:mark-completed:own'])],
    ]),
  );
}

function seedOneSlot(
  repository: FakeDayBoardRepository,
  status = 'reservado',
  overrides: { clientName?: string | null; clientAge?: number | null; clientPhone?: string | null } = {},
): void {
  repository.seed('2026-08-20', {
    columns: [{ barberId: 'barber-a', barberName: 'Juan', opensAt: '09:00', closesAt: '18:00' }],
    slots: [
      {
        id: 'slot-1',
        barberId: 'barber-a',
        serviceId: 'service-1',
        serviceName: 'Corte clasico',
        clientId: overrides.clientName === undefined ? null : 'client-1',
        clientName: overrides.clientName ?? null,
        clientAge: overrides.clientAge ?? null,
        clientPhone: overrides.clientPhone ?? null,
        status,
        channel: 'web',
        startsAt: clock.localTimeToUtc('2026-08-20', '09:00'),
        endsAt: clock.localTimeToUtc('2026-08-20', '09:30'),
      },
    ],
  });
}

// admin-operations: "Vista del día por columnas de barbero"; access-control:
// "Matriz de permisos por rol" — allowedActions is the server-side
// translation of that matrix onto one slot, per task 8.3/8.4. Never
// hardcoded per role: always read fresh from RolePermissionRepository, the
// same port PermissionsGuard uses (3b.13's "no cachear" rule applies here
// too).
// El dueño toco "Cancelar" sobre un turno ya realizado y la API respondio 500.
// La causa: `allowedActions` traducia SOLO la matriz de permisos del rol e
// ignoraba por completo el estado del turno, asi que el panel ofrecia botones
// que ninguna transicion valida podia satisfacer. `AppointmentStateMachine`
// ya es la unica fuente de verdad de que transiciones existen (realizado,
// cancelado y ausente son terminales); estos casos exigen que las acciones
// se deriven de ahi en vez de repetir las reglas por segunda vez.
describe('GetDayBoardUseCase — las acciones respetan el estado del turno', () => {
  it('no ofrece ninguna accion sobre un turno realizado, aunque el rol tenga todos los permisos', async () => {
    const repository = new FakeDayBoardRepository();
    seedOneSlot(repository, 'realizado');
    const useCase = new GetDayBoardUseCase(repository, realisticRolePermissions());

    const board = await useCase.execute('2026-08-20', OWNER);

    expect(board.slots[0]?.allowedActions).toEqual([]);
  });

  it('tampoco sobre uno cancelado ni sobre uno ausente — los tres son estados terminales', async () => {
    for (const terminal of ['cancelado', 'ausente']) {
      const repository = new FakeDayBoardRepository();
      seedOneSlot(repository, terminal);
      const useCase = new GetDayBoardUseCase(repository, realisticRolePermissions());

      const board = await useCase.execute('2026-08-20', OWNER);

      expect(board.slots[0]?.allowedActions).toEqual([]);
    }
  });

  it('sobre un turno reservado ofrece editar, cancelar y marcar realizado, pero nunca confirmar ausencia', async () => {
    const repository = new FakeDayBoardRepository();
    seedOneSlot(repository, 'reservado');
    const useCase = new GetDayBoardUseCase(repository, realisticRolePermissions());

    const board = await useCase.execute('2026-08-20', OWNER);

    // `ausente` tiene una unica arista de entrada, desde `sin_registrado`:
    // el sistema nunca marca una ausencia por su cuenta.
    expect(board.slots[0]?.allowedActions).toEqual(['edit', 'cancel', 'mark-completed']);
  });

  it('sobre uno sin registrar ofrece resolverlo en cualquiera de sus dos salidas, pero ya no cancelarlo', async () => {
    const repository = new FakeDayBoardRepository();
    seedOneSlot(repository, 'sin_registrado');
    const useCase = new GetDayBoardUseCase(repository, realisticRolePermissions());

    const board = await useCase.execute('2026-08-20', OWNER);

    const actions = board.slots[0]?.allowedActions ?? [];
    expect(actions).toContain('mark-completed');
    expect(actions).toContain('confirm-absence');
    // `sin_registrado` solo transiciona a `realizado` o `ausente`.
    expect(actions).not.toContain('cancel');
  });
});

// cablear-el-mvp follow-up: a walk-in loaded by mistake reaches `realizado`
// straight away (no reservado/sin_registrado step) and used to have no way
// back — `AppointmentStateMachine.isTerminal('realizado')` is true, so the
// general early-return above swallowed every action for it. `undo-walk-in`
// is the one exception, gated on `channel === 'walk_in'` AND the SAME
// `walkin:create` permission that could have loaded it in the first place —
// never a new permission, and never offered to a normal realizado turno.
describe('GetDayBoardUseCase — deshacer un walk-in', () => {
  function rolePermissionsWithWalkInCreate(): FakeRolePermissionRepository {
    return new FakeRolePermissionRepository(
      new Map([
        ['owner', new Set<Permission>(['walkin:create'])],
        ['barber', new Set<Permission>(['appointment:mark-completed:own'])],
      ]),
    );
  }

  it('ofrece undo-walk-in sobre un walk-in en realizado cuando el actor tiene walkin:create', async () => {
    const repository = new FakeDayBoardRepository();
    seedOneSlot(repository, 'realizado');
    repository.seed('2026-08-20', {
      columns: [{ barberId: 'barber-a', barberName: 'Juan', opensAt: '09:00', closesAt: '18:00' }],
      slots: [
        {
          id: 'slot-1',
          barberId: 'barber-a',
          serviceId: 'service-1',
          serviceName: 'Corte clasico',
          clientId: null,
          clientName: null,
          clientAge: null,
          clientPhone: null,
          status: 'realizado',
          channel: 'walk_in',
          startsAt: clock.localTimeToUtc('2026-08-20', '09:00'),
          endsAt: clock.localTimeToUtc('2026-08-20', '09:30'),
        },
      ],
    });
    const useCase = new GetDayBoardUseCase(repository, rolePermissionsWithWalkInCreate());

    const board = await useCase.execute('2026-08-20', OWNER);

    expect(board.slots[0]?.allowedActions).toEqual(['undo-walk-in']);
  });

  it('NO ofrece undo-walk-in sobre un turno realizado normal (channel telefonico), aunque el actor tenga walkin:create', async () => {
    const repository = new FakeDayBoardRepository();
    repository.seed('2026-08-20', {
      columns: [{ barberId: 'barber-a', barberName: 'Juan', opensAt: '09:00', closesAt: '18:00' }],
      slots: [
        {
          id: 'slot-1',
          barberId: 'barber-a',
          serviceId: 'service-1',
          serviceName: 'Corte clasico',
          clientId: 'client-1',
          clientName: 'Marcos',
          clientAge: 34,
          clientPhone: null,
          status: 'realizado',
          channel: 'telefonico',
          startsAt: clock.localTimeToUtc('2026-08-20', '09:00'),
          endsAt: clock.localTimeToUtc('2026-08-20', '09:30'),
        },
      ],
    });
    const useCase = new GetDayBoardUseCase(repository, rolePermissionsWithWalkInCreate());

    const board = await useCase.execute('2026-08-20', OWNER);

    expect(board.slots[0]?.allowedActions).toEqual([]);
  });

  it('NO ofrece undo-walk-in a un actor sin walkin:create, aunque el slot sea un walk-in en realizado', async () => {
    const repository = new FakeDayBoardRepository();
    repository.seed('2026-08-20', {
      columns: [{ barberId: 'barber-a', barberName: 'Juan', opensAt: '09:00', closesAt: '18:00' }],
      slots: [
        {
          id: 'slot-1',
          barberId: 'barber-a',
          serviceId: 'service-1',
          serviceName: 'Corte clasico',
          clientId: null,
          clientName: null,
          clientAge: null,
          clientPhone: null,
          status: 'realizado',
          channel: 'walk_in',
          startsAt: clock.localTimeToUtc('2026-08-20', '09:00'),
          endsAt: clock.localTimeToUtc('2026-08-20', '09:30'),
        },
      ],
    });
    const useCase = new GetDayBoardUseCase(repository, rolePermissionsWithWalkInCreate());

    const board = await useCase.execute('2026-08-20', BARBER_A);

    expect(board.slots[0]?.allowedActions).toEqual([]);
  });
});

describe('GetDayBoardUseCase', () => {
  it('grants edit, cancel and mark-completed on every slot for an owner (holds appointment:update/cancel/mark-completed:any)', async () => {
    const repository = new FakeDayBoardRepository();
    seedOneSlot(repository);
    const useCase = new GetDayBoardUseCase(repository, realisticRolePermissions());

    const result = await useCase.execute('2026-08-20', OWNER);

    expect(result.slots).toEqual([
      expect.objectContaining({ id: 'slot-1', allowedActions: ['edit', 'cancel', 'mark-completed'] }),
    ]);
  });

  it('grants only mark-completed to a barber on their own slot (holds only appointment:mark-completed:own)', async () => {
    const repository = new FakeDayBoardRepository();
    seedOneSlot(repository);
    const useCase = new GetDayBoardUseCase(repository, realisticRolePermissions());

    const result = await useCase.execute('2026-08-20', BARBER_A);

    expect(result.slots).toEqual([expect.objectContaining({ id: 'slot-1', allowedActions: ['mark-completed'] })]);
  });

  it('passes the actor straight to the repository and returns exactly what it responded with — no extra filtering of its own (8.8)', async () => {
    const repository = new FakeDayBoardRepository();
    seedOneSlot(repository);
    const useCase = new GetDayBoardUseCase(repository, realisticRolePermissions());

    const result = await useCase.execute('2026-08-20', BARBER_A);

    expect(repository.calls).toEqual([{ calendarDate: '2026-08-20', actor: BARBER_A }]);
    expect(result.columns).toEqual([
      { barberId: 'barber-a', barberName: 'Juan', opensAt: '09:00', closesAt: '18:00' },
    ]);
    expect(result.date).toBe('2026-08-20');
  });

  // Slice B (cablear-el-mvp, B.1/B.2/B.6): admin-operations spec, "Marcado de
  // realizados y resolución de pendientes" — a `sin_registrado` turno resolves
  // to EITHER `realizado` OR `ausente`, so the day board MUST offer both
  // actions there, gated by the exact same `appointment:mark-completed:*`
  // permission (there is no separate confirm-absence permission — see
  // packages/domain's 15-entry Permission catalog). `AppointmentStateMachine`
  // only allows the `ausente` edge FROM `sin_registrado` (never `reservado`),
  // so this stays a status-gated action, not an unconditional one.
  it('grants confirm-absence alongside mark-completed on a sin_registrado slot for an owner', async () => {
    const repository = new FakeDayBoardRepository();
    seedOneSlot(repository, 'sin_registrado');
    const useCase = new GetDayBoardUseCase(repository, realisticRolePermissions());

    const result = await useCase.execute('2026-08-20', OWNER);

    expect(result.slots).toEqual([
      expect.objectContaining({
        id: 'slot-1',
        // Sin `cancel`: `sin_registrado` solo transiciona a `realizado` o a
        // `ausente`, asi que cancelarlo nunca fue una operacion posible. La
        // version anterior de este caso lo listaba porque las acciones se
        // derivaban solo del rol; ofrecer un boton que la maquina de estados
        // va a rechazar es justamente el defecto que se corrigio.
        allowedActions: ['edit', 'mark-completed', 'confirm-absence'],
      }),
    ]);
  });

  it('grants confirm-absence to a barber on their own sin_registrado slot', async () => {
    const repository = new FakeDayBoardRepository();
    seedOneSlot(repository, 'sin_registrado');
    const useCase = new GetDayBoardUseCase(repository, realisticRolePermissions());

    const result = await useCase.execute('2026-08-20', BARBER_A);

    expect(result.slots).toEqual([
      expect.objectContaining({ id: 'slot-1', allowedActions: ['mark-completed', 'confirm-absence'] }),
    ]);
  });

  it('does NOT grant confirm-absence on a reservado slot — the state machine has no reservado-to-ausente edge', async () => {
    const repository = new FakeDayBoardRepository();
    seedOneSlot(repository, 'reservado');
    const useCase = new GetDayBoardUseCase(repository, realisticRolePermissions());

    const result = await useCase.execute('2026-08-20', OWNER);

    expect(result.slots).toEqual([
      expect.objectContaining({ id: 'slot-1', allowedActions: ['edit', 'cancel', 'mark-completed'] }),
    ]);
  });

  // The day board's actual product gap the owner reported while testing the
  // live app: a slot rendered as little more than "reservado". serviceName
  // travels the same way DayBoardColumn.barberName already does — a
  // server-computed name, never a browser-side lookup.
  it('includes the service name on every slot, server-computed like barberName', async () => {
    const repository = new FakeDayBoardRepository();
    seedOneSlot(repository);
    const useCase = new GetDayBoardUseCase(repository, realisticRolePermissions());

    const result = await useCase.execute('2026-08-20', OWNER);

    expect(result.slots).toEqual([expect.objectContaining({ id: 'slot-1', serviceName: 'Corte clasico' })]);
  });

  it('passes clientName and clientAge straight through once the slot is linked to a client', async () => {
    const repository = new FakeDayBoardRepository();
    seedOneSlot(repository, 'reservado', { clientName: 'Marcos', clientAge: 34 });
    const useCase = new GetDayBoardUseCase(repository, realisticRolePermissions());

    const result = await useCase.execute('2026-08-20', OWNER);

    expect(result.slots).toEqual([
      expect.objectContaining({ id: 'slot-1', clientName: 'Marcos', clientAge: 34 }),
    ]);
  });

  it('leaves clientName and clientAge undefined when no client is linked to the slot', async () => {
    const repository = new FakeDayBoardRepository();
    seedOneSlot(repository);
    const useCase = new GetDayBoardUseCase(repository, realisticRolePermissions());

    const result = await useCase.execute('2026-08-20', OWNER);

    expect(result.slots[0]?.clientName).toBeUndefined();
    expect(result.slots[0]?.clientAge).toBeUndefined();
  });

  // access-control's rule applied to a new field: the server decides who
  // receives clientPhone, never the browser. Only an actor holding
  // client:manage (owner/secretary) gets it; a barber never does, even
  // though he does see clientName/clientAge on the very same slot.
  it('includes clientPhone for an actor holding client:manage', async () => {
    const repository = new FakeDayBoardRepository();
    seedOneSlot(repository, 'reservado', { clientName: 'Marcos', clientAge: 34, clientPhone: '3511234567' });
    const useCase = new GetDayBoardUseCase(repository, realisticRolePermissions());

    const result = await useCase.execute('2026-08-20', OWNER);

    expect(result.slots).toEqual([expect.objectContaining({ id: 'slot-1', clientPhone: '3511234567' })]);
  });

  it('omits clientPhone for a barber, who never holds client:manage, even though he sees the client name', async () => {
    const repository = new FakeDayBoardRepository();
    seedOneSlot(repository, 'reservado', { clientName: 'Marcos', clientAge: 34, clientPhone: '3511234567' });
    const useCase = new GetDayBoardUseCase(repository, realisticRolePermissions());

    const result = await useCase.execute('2026-08-20', BARBER_A);

    expect(result.slots[0]?.clientName).toBe('Marcos');
    expect(result.slots[0]?.clientPhone).toBeUndefined();
  });
});
