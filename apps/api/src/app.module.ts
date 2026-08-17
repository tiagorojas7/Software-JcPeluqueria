import { Module } from '@nestjs/common';

import { AccessControlModule } from './access-control/access-control.module';
import { AgendaModule } from './agenda/agenda.module';
import { AppointmentsModule } from './appointments/appointments.module';
import { BarbersModule } from './barbers/barbers.module';

/**
 * Composition root. `PermissionsGuard` is registered globally here via
 * `AccessControlModule` — every controller this application gains is denied
 * by default from the moment it is added, unless it explicitly opts in with
 * `@RequiresPermission(...)` or `@Public()`. `AgendaModule` (Phase 8) is the
 * first real, production controller this application ships;
 * `AppointmentsModule` (Phase 10) is the second; `BarbersModule` (Phase 11)
 * is the third.
 *
 * Deliberately no `main.ts` yet: this app is still only a module graph, not
 * a listening HTTP server — that starts whichever later phase needs one
 * first.
 */
@Module({
  imports: [AccessControlModule, AgendaModule, AppointmentsModule, BarbersModule],
})
export class AppModule {}
