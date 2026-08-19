import { BadRequestException, Body, Controller, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { GenerateAbsenceReassignmentOffers, MarkBarberAbsentUseCase } from '@jc-barberia/application';
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
 * E.1 (cablear-el-mvp Slice E): now composes `GenerateAbsenceReassignmentOffers`
 * right after detection, in the SAME request — the historical reason this
 * used to stop at detection only (no production `NotificationOutboxRepository`,
 * so composing the offer step would have silently dropped the "MUST
 * notificar al cliente" requirement) is gone: Slice A shipped
 * `DrizzleNotificationOutboxRepository`. `affectedAppointmentIds` on the
 * response is unchanged — every affected turno, whether or not an offer
 * could be generated for it (`GenerateAbsenceReassignmentOffers`'s own
 * `'no-availability'` outcome is a legitimate result, not an error: staff
 * still has the actionable list to work by phone).
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
    private readonly generateAbsenceOffers: GenerateAbsenceReassignmentOffers,
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

    // Sequential inside the use case itself (its own doc comment explains
    // why: each offer's hold must be visible to the NEXT affected
    // appointment's own availability search) — this handler just awaits the
    // whole batch before responding, same "the write finishes before the
    // response does" posture every other mutating endpoint in this app takes.
    await this.generateAbsenceOffers.execute(affected);

    return { affectedAppointmentIds: affected.map((appointment) => appointment.id) };
  }
}
