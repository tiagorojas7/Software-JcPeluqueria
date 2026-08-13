import { Module } from '@nestjs/common';

import { AccessControlModule } from './access-control/access-control.module';

/**
 * Composition root. `PermissionsGuard` is registered globally here via
 * `AccessControlModule` — every controller this application gains starting
 * Phase 8 is denied by default from the moment it is added, unless it
 * explicitly opts in with `@RequiresPermission(...)` or `@Public()`.
 *
 * Deliberately no `main.ts` yet: this phase builds the module graph and the
 * guard, not a listening HTTP server (no real endpoint exists to serve —
 * those start Phase 8/9/10).
 */
@Module({
  imports: [AccessControlModule],
})
export class AppModule {}
