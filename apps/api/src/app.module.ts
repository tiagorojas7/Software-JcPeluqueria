import { Module } from '@nestjs/common';

import { AbsenceReassignmentModule } from './absence-reassignment/absence-reassignment.module';
import { AccessControlModule } from './access-control/access-control.module';
import { AgendaModule } from './agenda/agenda.module';
import { AppointmentsModule } from './appointments/appointments.module';
import { BarbersModule } from './barbers/barbers.module';
import { BookingModule } from './booking/booking.module';
import { PanelModule } from './panel/panel.module';
import { PaymentsModule } from './payments/payments.module';

/**
 * Composition root. `PermissionsGuard` is registered globally here via
 * `AccessControlModule` — every controller this application gains is denied
 * by default from the moment it is added, unless it explicitly opts in with
 * `@RequiresPermission(...)` or `@Public()`. `AgendaModule` (Phase 8) is the
 * first real, production controller this application ships;
 * `AppointmentsModule` (Phase 10, pulled forward for the panel's phone
 * booking) is the second; `BookingModule` (Phase 9, the public web booking
 * flow) is the third — its controllers are `@Public()` by requirement
 * (client-booking: "Exploración sin cuenta"), not by omission; `BarbersModule`
 * (Phase 11, the barber's own profile) is the fourth; `PaymentsModule`
 * (task 9.11/9.12, the MercadoPago webhook) is the fifth — deliberately not
 * imported here until now ("real business endpoints start Phase 8/9/10", its
 * own doc comment said), because until `PgBossPaymentJobQueue` existed there
 * was no real `PAYMENT_JOB_QUEUE` to give it; `PanelModule` (task 10.14/10.15,
 * client/barber management) is the sixth; and `AbsenceReassignmentModule`
 * (Phase 12, barber-absence-reassignment's detection entry point) is the
 * seventh and last of the tracker.
 *
 * Deliberately no `main.ts` yet: this app is still only a module graph, not
 * a listening HTTP server — that starts whichever later phase needs one
 * first.
 */
@Module({
  imports: [
    AccessControlModule,
    AgendaModule,
    AppointmentsModule,
    BookingModule,
    BarbersModule,
    PaymentsModule,
    PanelModule,
    AbsenceReassignmentModule,
  ],
})
export class AppModule {}
