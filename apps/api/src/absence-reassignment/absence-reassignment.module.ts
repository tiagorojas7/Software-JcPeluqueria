import { Module } from '@nestjs/common';
import { MarkBarberAbsentUseCase } from '@jc-barberia/application';
import { db, DrizzleAppointmentRepository, ShopClock } from '@jc-barberia/infrastructure';
import type { AppointmentRepository } from '@jc-barberia/domain';

import { AccessControlModule } from '../access-control/access-control.module';
import { MarkBarberAbsentController } from './mark-barber-absent.controller';
import { APPOINTMENT_REPOSITORY, CLOCK } from './tokens';

/** Wires task 12.1/12.2's real endpoint. `AppointmentRepository` bound to
 *  its own token here rather than reused across modules — same
 *  one-token-per-module pattern `AppointmentsModule`/`AgendaModule` already
 *  follow. No `HOLD_EXPIRE_SCHEDULER`/pg-boss provider needed: detection
 *  alone never enqueues a job. */
@Module({
  imports: [AccessControlModule],
  controllers: [MarkBarberAbsentController],
  providers: [
    { provide: CLOCK, useFactory: () => new ShopClock() },
    { provide: APPOINTMENT_REPOSITORY, useFactory: () => new DrizzleAppointmentRepository(db) },
    {
      provide: MarkBarberAbsentUseCase,
      inject: [APPOINTMENT_REPOSITORY],
      useFactory: (appointments: AppointmentRepository) => new MarkBarberAbsentUseCase(appointments),
    },
  ],
})
export class AbsenceReassignmentModule {}
