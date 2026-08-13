import {
  FakeDayBoardRepository,
  FakeRolePermissionRepository,
  type ActorContext,
  type Permission,
} from '@jc-barberia/domain';
import { describe, expect, it } from 'vitest';

import { GetDayBoardUseCase } from './get-day-board';

const OWNER: ActorContext = { userId: 'owner-1', role: 'owner' };
const BARBER_A: ActorContext = { userId: 'barber-a-user', role: 'barber', barberId: 'barber-a' };

/** The real seed matrix from migration 0006 (role-permission.repository.spec.ts),
 *  reduced to only the permissions this use case reads. */
function realisticRolePermissions(): FakeRolePermissionRepository {
  return new FakeRolePermissionRepository(
    new Map([
      [
        'owner',
        new Set<Permission>(['appointment:update', 'appointment:cancel', 'appointment:mark-completed:any']),
      ],
      ['barber', new Set<Permission>(['appointment:mark-completed:own'])],
    ]),
  );
}

function seedOneSlot(repository: FakeDayBoardRepository): void {
  repository.seed('2026-08-20', {
    columns: [{ barberId: 'barber-a', barberName: 'Juan' }],
    slots: [
      {
        id: 'slot-1',
        barberId: 'barber-a',
        serviceId: 'service-1',
        clientId: null,
        status: 'reservado',
        startsAt: new Date('2026-08-20T12:00:00.000Z'),
        endsAt: new Date('2026-08-20T12:30:00.000Z'),
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
    expect(result.columns).toEqual([{ barberId: 'barber-a', barberName: 'Juan' }]);
    expect(result.date).toBe('2026-08-20');
  });
});
