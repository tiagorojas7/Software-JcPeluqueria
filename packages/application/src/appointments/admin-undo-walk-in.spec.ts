import {
  AppointmentNotFoundError,
  FakeAppointmentRepository,
  FakeClock,
  NotAWalkInError,
  type Appointment,
} from '@jc-barberia/domain';
import { describe, expect, it } from 'vitest';

import { AdminUndoWalkInUseCase } from './admin-undo-walk-in';

const dateBuilder = new FakeClock();
const at = (time: string) => dateBuilder.localTimeToUtc('2026-09-01', time);

function buildWalkIn(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: 'walk-in-1',
    barberId: 'barber-1',
    serviceId: 'service-1',
    clientId: null,
    channel: 'walk_in',
    timeRange: { start: at('10:00'), end: at('10:30') },
    status: 'realizado',
    deposit: { kind: 'not_applicable' },
    ...overrides,
  };
}

describe('AdminUndoWalkInUseCase', () => {
  // The actual bug this closes: a walk-in loaded by mistake occupied the
  // slot forever, because `realizado` had no outgoing edge. Undoing it must
  // free the slot — proven here through the same `updateStatusCalls` shape
  // AdminCancelAppointmentUseCase's own spec already asserts on.
  it('undoes a walk-in and frees the slot it was occupying', async () => {
    const appointments = new FakeAppointmentRepository();
    appointments.seed(buildWalkIn());
    const useCase = new AdminUndoWalkInUseCase(appointments);

    const result = await useCase.execute('walk-in-1');

    expect(result.status).toBe('cancelado');
    expect(appointments.updateStatusCalls).toEqual([{ id: 'walk-in-1', status: 'cancelado' }]);
  });

  it('undoes a walk-in with no client identified — clientId null is not a reason to refuse it', async () => {
    const appointments = new FakeAppointmentRepository();
    appointments.seed(buildWalkIn({ clientId: null }));
    const useCase = new AdminUndoWalkInUseCase(appointments);

    const result = await useCase.execute('walk-in-1');

    expect(result.status).toBe('cancelado');
    expect(result.clientId).toBeNull();
  });

  it('rejects undoing an appointment that does not exist', async () => {
    const appointments = new FakeAppointmentRepository();
    const useCase = new AdminUndoWalkInUseCase(appointments);

    await expect(useCase.execute('missing')).rejects.toBeInstanceOf(AppointmentNotFoundError);
  });

  // The other half of the scope: a normal, legitimately completed
  // appointment (channel telefonico/web, status realizado through the
  // ordinary reservado -> realizado path) must NOT be swept into this path.
  it('rejects undoing a normal telefonico appointment that is realizado — that is finished business, not a mistake', async () => {
    const appointments = new FakeAppointmentRepository();
    appointments.seed(buildWalkIn({ channel: 'telefonico', clientId: 'client-1' }));
    const useCase = new AdminUndoWalkInUseCase(appointments);

    await expect(useCase.execute('walk-in-1')).rejects.toBeInstanceOf(NotAWalkInError);
    expect(appointments.updateStatusCalls).toEqual([]);
  });

  it('rejects undoing a walk-in that was already undone', async () => {
    const appointments = new FakeAppointmentRepository();
    appointments.seed(buildWalkIn({ status: 'cancelado' }));
    const useCase = new AdminUndoWalkInUseCase(appointments);

    await expect(useCase.execute('walk-in-1')).rejects.toThrow();
    expect(appointments.updateStatusCalls).toEqual([]);
  });
});
