/**
 * Wire contract for the Phase 8 day board — the server-computed read model
 * `GetDayBoardUseCase` (packages/application) produces and `DayBoard`
 * (apps/web) renders. `allowedActions` is the entire point (design.md,
 * "Frontend"): the server decides what a slot's viewer may do with it, from
 * `ActorContext` and `role_permissions`; the client only ever draws that
 * decision, it never computes one of its own.
 */

/**
 * The only actions a day-board slot currently exposes, each tied to one
 * appointment permission from packages/domain's access-control catalog:
 * `edit` → `appointment:update`, `cancel` → `appointment:cancel`,
 * `mark-completed` / `confirm-absence` → `appointment:mark-completed:any` /
 * `:own` (there is no separate confirm-absence permission — admin-operations
 * spec, "Marcado de realizados y resolución de pendientes" ties both
 * resolutions of a `sin_registrado` turno to the SAME permission).
 */
export const SLOT_ACTIONS = ['edit', 'cancel', 'mark-completed', 'confirm-absence'] as const;
export type SlotAction = (typeof SLOT_ACTIONS)[number];

export interface DayBoardColumn {
  readonly barberId: string;
  readonly barberName: string;
}

export interface DayBoardSlot {
  readonly id: string;
  readonly barberId: string;
  readonly serviceId: string;
  /**
   * Server-computed name of `serviceId`, the same way `DayBoardColumn.barberName`
   * already travels alongside `barberId` — the panel names the service
   * without inventing its own lookup in the browser.
   */
  readonly serviceName: string;
  /**
   * Raw `slot_occupancies.status` passthrough. `packages/domain/appointments`
   * (built in a parallel phase) owns the closed appointment-status
   * vocabulary — this stays a plain string here rather than duplicating or
   * pre-empting that type.
   */
  readonly status: string;
  /** ISO instants. */
  readonly startsAt: string;
  readonly endsAt: string;
  /**
   * Present once this row is linked to a `clients` row — "cuando esté
   * cargada" per admin-operations' "Vista del día por columnas de barbero".
   * `GetDayBoardUseCase` populates both from the real `clients` join now
   * that the table exists and every turno is linked to one.
   */
  readonly clientName?: string;
  readonly clientAge?: number;
  /**
   * Present only when the viewer holds `client:manage` (owner/secretary) —
   * `GetDayBoardUseCase` decides this from `ActorContext` and
   * `role_permissions`, never the browser. A barber's role never has
   * `client:manage`, so this field never reaches a barber's screen.
   */
  readonly clientPhone?: string;
  /** Computed server-side by `GetDayBoardUseCase` from `ActorContext` and
   *  `role_permissions` — never derived in the browser. */
  readonly allowedActions: readonly SlotAction[];
}

export interface DayBoardResponse {
  /** ISO calendar date, `YYYY-MM-DD`. */
  readonly date: string;
  readonly columns: readonly DayBoardColumn[];
  readonly slots: readonly DayBoardSlot[];
}
