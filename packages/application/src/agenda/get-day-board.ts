import type {
  ActorContext,
  DayBoardRepository,
  DayBoardSlotRecord,
  RolePermissionRepository,
} from '@jc-barberia/domain';
import type { DayBoardResponse, DayBoardSlot, SlotAction } from '@jc-barberia/contracts';

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

  /** Direct translation of access-control's permission matrix onto one
   *  slot: `edit`/`cancel` are all-or-nothing per role (`appointment:update`
   *  /`appointment:cancel`); `mark-completed` additionally opens through
   *  `:own` when the slot belongs to the acting barber, matching "Marcar
   *  realizado / resolver pendientes ... Solo los propios" for the barber
   *  row of that matrix. `confirm-absence` reuses the exact same
   *  `mark-completed:any`/`:own` grant (no separate permission exists for
   *  it) but additionally requires `status === 'sin_registrado'` —
   *  `AppointmentStateMachine` only allows the `ausente` edge from there,
   *  never from `reservado` (packages/domain's five-state lifecycle). */
  private async allowedActionsFor(slot: DayBoardSlotRecord, actor: ActorContext): Promise<SlotAction[]> {
    const actions: SlotAction[] = [];

    if (await this.rolePermissions.hasPermission(actor.role, 'appointment:update')) {
      actions.push('edit');
    }
    if (await this.rolePermissions.hasPermission(actor.role, 'appointment:cancel')) {
      actions.push('cancel');
    }

    const canMarkAny = await this.rolePermissions.hasPermission(actor.role, 'appointment:mark-completed:any');
    const canMarkOwn =
      !canMarkAny &&
      actor.barberId !== undefined &&
      actor.barberId === slot.barberId &&
      (await this.rolePermissions.hasPermission(actor.role, 'appointment:mark-completed:own'));
    if (canMarkAny || canMarkOwn) {
      actions.push('mark-completed');
      if (slot.status === 'sin_registrado') {
        actions.push('confirm-absence');
      }
    }

    return actions;
  }
}
