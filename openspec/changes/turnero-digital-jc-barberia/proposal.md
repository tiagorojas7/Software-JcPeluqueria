# Proposal: Turnero Digital — JC Barbería MVP

## Intent

Replace phone-only, paper-ledger booking with a digital system covering client self-service booking (with deposit) and staff-facing barber-absence handling. Today there is no queryable source of truth for "who is booked when," forcing O(n) manual phone calls per barber absence, capping booking volume to secretary phone hours, and leaving no-shows undeterred. This MVP will be demoed to the owner as a working solution. WhatsApp Business API is the target notification channel; Gmail email is the provisional MVP stand-in.

## Scope

### In Scope
- Client account + self-service booking (barber or "any available", service, slot) with mandatory 50% deposit via MercadoPago at booking time.
- Explicit appointment lifecycle: **booked/confirmed → completed ("realizado") | cancelled | absent ("ausente")** — states are never collapsed.
- 15-minute HOLD on any offered/selected slot (shared infra for both ordinary double-booking races and absence reassignment): auto-release + automatic refund on expiry; immediate re-validation before confirm, auto-offer next closest same-day slot if taken.
- Client self-service cancel (up to 1h before appointment) → automatic MercadoPago refund.
- Daily 23:59 America/Argentina (UTC-3, no DST, fixed offset) sweep: any deposit-paid appointment not marked "completed" → "ausente" → deposit **forfeited, not refunded**.
- Barber absence/lateness flow: secretary marks a barber unavailable for a window → system offers affected clients ALL free same-day slots across **any barber** (all barbers perform all services) → each offer governed by the 15-min HOLD → no acceptance ⇒ automatic refund, client rebooks manually later. Reassignment NEVER touches other clients' existing appointments.
- Admin panel: create/edit/cancel appointments (covers phone-in bookings), mark appointments completed, configure shop hours + per-barber hours + service prices, mark walk-in occupancy.
- Per-barber availability model (own schedule/days off).
- Notification port/interface (adapter pattern): domain emits "notify client of X," transport-agnostic. Adapter #1 (MVP): Gmail email. Adapter #2 (future): WhatsApp Business API.

### Out of Scope (this MVP)
- Inventory/stock, payroll/commissions, full in-person POS, loyalty programs, bulk marketing, multi-location, analytics dashboards, reviews/ratings.
- Client self-service reschedule-in-place — client's only self-service actions are cancel + rebook (future work).
- WhatsApp Business API integration itself — Meta verification + paid BSP onboarding is off the critical path for this MVP (future work).
- Automated resolution of the phone-in-booking/account/deposit tension (see Risks) — flagged as a recommendation, not built now.

## Capabilities

### New Capabilities
- `client-booking`: account, slot search/selection, deposit payment, cancellation.
- `appointment-lifecycle`: state machine (booked, completed, cancelled, absent) + 23:59 sweep job.
- `slot-hold`: 15-minute provisional hold, expiry, auto-refund, re-validation.
- `barber-absence-reassignment`: same-day, any-barber offer flow built on `slot-hold`.
- `admin-operations`: phone-in booking creation, edit/cancel, mark-completed, walk-in occupancy, shop/barber/service configuration.
- `notification-port`: adapter interface + Gmail adapter (MVP) + WhatsApp adapter (future).

### Modified Capabilities
None — greenfield project, no existing specs.

## Approach

Build the booking/slot-availability data model first (barbers, services, per-barber schedules, slots) — a hard prerequisite for absence-reassignment, since there is no "available slot" concept to offer into without it. Layer the 15-min HOLD as shared booking infrastructure, then the lifecycle/state machine, then two scheduled jobs (hold-expiry, 23:59 sweep) plus reminders, then the notification port with Gmail as adapter #1. Tech stack is intentionally NOT selected here (belongs to `sdd-design`); this proposal fixes constraints the stack must satisfy: real payment gateway integration (MercadoPago, deposits + automatic refunds), reliable scheduled/background execution (≥2 independent time-driven jobs + reminders — first-class, not incidental), and authentication (mandatory accounts).

## Affected Areas
| Area | Impact | Description |
|------|--------|-------------|
| N/A | New | Greenfield project — no existing code or specs to modify. |

## Risks
| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Staff forgets to mark "completed" → genuine attendee wrongly swept to "ausente," loses deposit | Medium | Recommendation for future consideration (not built now): admin can retroactively correct state; visible end-of-day list of unmarked appointments before 23:59. |
| Phone-in booking conflicts with mandatory-account + online-deposit rules (phone client can't pay online mid-call) | Medium | Recommendation requiring owner confirmation: secretary creates/looks up a minimal client record; deposit for phone bookings collected in person or marked manually. Not yet a closed decision. |
| Gmail as MVP channel: ~500 sends/day cap, requires App Password, weak deliverability from a personal mailbox, worst open rate for same-day time-sensitive changes | High (accepted) | Behind notification port from day one; WhatsApp migration is an adapter swap, not a domain rewrite (documented future work). |
| 23:59 sweep boundary miscomputed on server-local/UTC time instead of fixed Argentina UTC-3 | Medium | Design constraint for `sdd-design`: sweep must use explicit fixed offset. |
| Two independent scheduled jobs (hold-expiry, daily sweep) plus reminders need reliable execution | Medium | Treat scheduled/background execution as a first-class stack requirement in `sdd-design`. |

## Rollback Plan
Pre-launch: no production data exists yet — reverting discards the branch/artifacts, no migration needed. Post-launch: disable the online booking entry point, revert to phone/paper intake temporarily while preserving appointment history and account data for reconciliation; MercadoPago transactions remain independently auditable via the gateway's own records.

## Dependencies
- MercadoPago merchant account and API credentials.
- Gmail account with App Password for MVP notifications.
- Stack + test-runner selection (`sdd-design`) — project has no git repo and no test runner yet; `strict_tdd: false` was recorded by `sdd-init` only for that reason and should flip on once a stack/runner exists (follow-up, not this proposal's job).

## Success Criteria
- [ ] Client can create an account, book a slot, pay 50% deposit via MercadoPago, and cancel up to 1h before with automatic refund.
- [ ] Barber absence triggers same-day, any-barber reassignment offers governed by the 15-min HOLD, with automatic refund on no acceptance.
- [ ] Appointment lifecycle correctly distinguishes completed/cancelled/absent; the 23:59 sweep forfeits deposits only for unmarked "ausente" appointments.
- [ ] Secretary can create, edit, cancel, and mark-complete appointments from the admin panel, and configure hours/prices.
- [ ] Notifications dispatch through the port/adapter with Gmail as the only implemented adapter; swapping to WhatsApp requires no domain changes.

## Future Work (explicitly deferred, not lost)
- WhatsApp Business API adapter + migration off Gmail (Meta Business verification + paid BSP onboarding).
- Client self-service reschedule-in-place (currently: cancel + rebook only).
- Phone-in booking / minimal-account / in-person-deposit handling — needs explicit owner confirmation beyond the MVP recommendation above.
- End-of-day "unmarked appointments" reminder + admin state-correction UI for the no-show sweep.
- Flip `strict_tdd: true` in `openspec/config.yaml` once a stack and test runner are chosen.
