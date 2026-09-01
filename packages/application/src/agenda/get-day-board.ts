import { APPOINTMENT_STATUSES, AppointmentStateMachine } from '@jc-barberia/domain';
import type {
  ActorContext,
  AppointmentStatus,
  DayBoardRepository,
  DayBoardSlotRecord,
  RolePermissionRepository,
} from '@jc-barberia/domain';
import type { DayBoardResponse, DayBoardSlot, SlotAction } from '@jc-barberia/contracts';

/** `DayBoardSlotRecord.status` is the raw `slot_occupancies.status` string,
 *  which also carries the hold states (`held`/`liberado`) that are not part
 *  of the appointment lifecycle. Returns `null` for those rather than
 *  pretending every row is an appointment. */
function toAppointmentStatus(status: string): AppointmentStatus | null {
  return (APPOINTMENT_STATUSES as readonly string[]).includes(status) ? (status as AppointmentStatus) : null;
}

/**
 * "El servidor devuelve `allowedActions` por slot" (design.md, Frontend) —
 * this is that server. `DayBoardRepository` already narrowed
 * columns/slots to what `actor` may see at all (task 8.7/8.8: this class
 * adds nothing on top of that narrowing, it only augments each slot with
 * the actions `actor` may take). Every permission check reads
 * `RolePermissionRepository` fresh, never a hardcoded per-role map — the
 * same rule `PermissionsGuard` follows (access-control spec, "Permisos de
 * secretaria ajustables sin cambio de código").
 */
export class GetDayBoardUseCase {
  constructor(
    private readonly dayBoardRepository: DayBoardRepository,
    private readonly rolePermissions: RolePermissionRepository,
  ) {}

  async execute(calendarDate: string, actor: ActorContext): Promise<DayBoardResponse> {
    const { columns, slots } = await this.dayBoardRepository.findDayBoard(calendarDate, actor);

    const slotsWithActions = await Promise.all(
      slots.map((slot) => this.toContractSlot(slot, actor)),
    );

    return { date: calendarDate, columns, slots: slotsWithActions };
  }

  private async toContractSlot(slot: DayBoardSlotRecord, actor: ActorContext): Promise<DayBoardSlot> {
    const canManageClients = await this.rolePermissions.hasPermission(actor.role, 'client:manage');
    return {
      id: slot.id,
      barberId: slot.barberId,
      serviceId: slot.serviceId,
      serviceName: slot.serviceName,
      status: slot.status,
      channel: slot.channel,
      startsAt: slot.startsAt.toISOString(),
      endsAt: slot.endsAt.toISOString(),
      clientName: slot.clientName ?? undefined,
      clientAge: slot.clientAge ?? undefined,
      // access-control's rule applied to a new field: the server decides
      // who receives clientPhone (admin-operations, "gestión de clientes" —
      // client:manage reaches owner and secretary, never barber), so this
      // is never included for an actor without that permission, no matter
      // what DayBoardRepository returned.
      clientPhone: canManageClients ? (slot.clientPhone ?? undefined) : undefined,
      allowedActions: await this.allowedActionsFor(slot, actor),
    };
  }

  /**
   * An action is offered only when BOTH gates open: the actor's role grants
   * it, AND the appointment's current state still admits it.
   *
   * The second gate was missing, and the panel paid for it: a `realizado`
   * turno still advertised "Cancelar", the client clicked it, and the API
   * answered `500` because no valid transition could satisfy the request.
   * Offering an action that cannot succeed is a defect in this read model,
   * not in the button.
   *
   * The state half is asked of `AppointmentStateMachine`, never restated
   * here — it already owns the five-state lifecycle, so `cancel` is exactly
   * "may become `cancelado`" and `mark-completed` is exactly "may become
   * `realizado`". That also derives, rather than hardcodes, the rule that
   * `confirm-absence` only appears on a `sin_registrado` turno: `ausente`
   * has a single incoming edge, which is what makes "the system never marks
   * an absence on its own" structural.
   *
   * Permission side (access-control's matrix): `edit`/`cancel` are
   * all-or-nothing per role; `mark-completed` and `confirm-absence` also
   * open through `:own` when the slot belongs to the acting barber ("Marcar
   * realizado / resolver pendientes ... Solo los propios").
   */
  private async allowedActionsFor(slot: DayBoardSlotRecord, actor: ActorContext): Promise<SlotAction[]> {
    const status = toAppointmentStatus(slot.status);
    // A hold (`held`/`liberado`) is not an appointment at all — nothing to
    // offer.
    if (!status) {
      return [];
    }

    // `undo-walk-in` is the one action a terminal `realizado` still offers —
    // and only when `channel === 'walk_in'` (see `UndoWalkInUseCase` in
    // @jc-barberia/domain for why channel, not status, is the gate: a normal
    // appointment that ran its course through `reservado`/`sin_registrado`
    // is finished business, not a mistake to undo). Checked BEFORE the
    // general `isTerminal` early-return below, which would otherwise swallow
    // it the same way it correctly swallows every other terminal status.
    // Gated on `walkin:create` — the SAME permission that loads a walk-in in
    // the first place, never a new one: only whoever could have created the
    // mistake may undo it.
    if (status === 'realizado' && slot.channel === 'walk_in') {
      const canUndoWalkIn = await this.rolePermissions.hasPermission(actor.role, 'walkin:create');
      return canUndoWalkIn ? ['undo-walk-in'] : [];
    }

    // A terminal status (realizado, cancelado, ausente) is finished: nothing
    // more to do — except the walk-in case handled above.
    if (AppointmentStateMachine.isTerminal(status)) {
      return [];
    }

    const actions: SlotAction[] = [];

    if (await this.rolePermissions.hasPermission(actor.role, 'appointment:update')) {
      actions.push('edit');
    }
    if (
      AppointmentStateMachine.canTransition(status, 'cancelado') &&
      (await this.rolePermissions.hasPermission(actor.role, 'appointment:cancel'))
    ) {
      actions.push('cancel');
    }

    const canMarkAny = await this.rolePermissions.hasPermission(actor.role, 'appointment:mark-completed:any');
    const canMarkOwn =
      !canMarkAny &&
      actor.barberId !== undefined &&
      actor.barberId === slot.barberId &&
      (await this.rolePermissions.hasPermission(actor.role, 'appointment:mark-completed:own'));
    if (canMarkAny || canMarkOwn) {
      if (AppointmentStateMachine.canTransition(status, 'realizado')) {
        actions.push('mark-completed');
      }
      if (AppointmentStateMachine.canTransition(status, 'ausente')) {
        actions.push('confirm-absence');
      }
    }

    return actions;
  }
}
