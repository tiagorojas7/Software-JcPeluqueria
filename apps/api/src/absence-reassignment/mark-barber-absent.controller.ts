import { BadRequestException, Body, Controller, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { MarkBarberAbsentUseCase } from '@jc-barberia/application';
import { MarkBarberAbsentRequestSchema, type MarkBarberAbsentResponse } from '@jc-barberia/contracts';
import type { Clock } from '@jc-barberia/domain';

import { RequiresPermission } from '../access-control/decorators/requires-permission.decorator';
import { CLOCK } from './tokens';

/**
 * barber-absence-reassignment spec, "Detección de turnos afectados": the
 * ONLY entry point of this whole feature — nothing else can trigger a
 * reassignment flow without first marking a barber absent here. Gated on
 * `barber:mark-absent` (task 12.2, "reutiliza 3b" — Phase 3b's
 * `PermissionsGuard`/`@RequiresPermission`), already seeded to owner and
 * secretary by migration 0006.
 *
 * Deliberately wires ONLY `MarkBarberAbsentUseCase` (detection) for a real
 * endpoint, not `GenerateAbsenceReassignmentOffers` in the same request:
 * this codebase has no production `NotificationOutboxRepository`
 * implementation yet (Phase 6 deferred it to Phase 7, "hasta Fase 7";
 * Phase 7 never built it — see apply-progress). Composing the offer step
 * here today would either silently drop the "MUST notificar al cliente"
 * requirement or fabricate a fake adapter — this response's
 * `affectedAppointmentIds` is already actionable on its own (staff can work
 * the list by phone) while that gap is closed for real, the same
 * "wiring is a direct next step" deferral Phase 11 already used for
 * `BarberMarkCompletedUseCase`/`BarberConfirmAbsenceUseCase`.
 */
@Controller('barbers')
export class MarkBarberAbsentController {
  constructor(
    // NEVER name this constructor property the same as the route handler
    // method below (`markAbsent`): a same-named instance property SHADOWS
    // the prototype method Nest's router captured during route scanning —
    // `context.getHandler()` then resolves to this injected use case
    // instance instead of the actual handler function, so
    // `PermissionsGuard` reads no metadata off it at all and denies with
    // "no access-control decorator" even though the decorator is right
    // there. Cost real debugging time once; named `markBarberAbsent` here
    // specifically so it can never collide with a method again.
    private readonly markBarberAbsent: MarkBarberAbsentUseCase,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @RequiresPermission('barber:mark-absent')
  @Post(':barberId/mark-absent')
  @HttpCode(200)
  async markAbsent(
    @Param('barberId') barberId: string,
    @Body() body: unknown,
  ): Promise<MarkBarberAbsentResponse> {
    const parsed = MarkBarberAbsentRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }
    const { calendarDate, startTime, endTime } = parsed.data;

    const affected = await this.markBarberAbsent.execute({
      barberId,
      timeRange: {
        start: this.clock.localTimeToUtc(calendarDate, startTime),
        end: this.clock.localTimeToUtc(calendarDate, endTime),
      },
    });

    return { affectedAppointmentIds: affected.map((appointment) => appointment.id) };
  }
}
