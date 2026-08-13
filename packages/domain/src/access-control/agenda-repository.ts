import type { BarberSchedule } from '../availability';
import type { ActorContext } from './actor-context';

/**
 * `findScheduleFor` never simply throws or bare-returns `null` on a denied
 * request: a barber asking for a colleague's schedule by id is a *denied*
 * request, not an *empty* one (access-control spec, "El barbero queda
 * acotado a sus propios datos") — collapsing the two would let a caller
 * mistake "nothing to show" for "not allowed to look", which a handler must
 * translate to very different HTTP outcomes (a genuinely-empty schedule is
 * 200 with `[]`; a denied request is 403).
 */
export type AgendaAccessResult =
  | { readonly outcome: 'allowed'; readonly schedule: readonly BarberSchedule[] }
  | { readonly outcome: 'forbidden' };

/**
 * The access-controlled read path for a single barber's own working
 * schedule (`agenda:read:own`/`agenda:read:any`). Deliberately separate
 * from `ScheduleRepository` (Phase 1's plain CRUD port the configuration
 * screens use): this port's entire reason to exist is enforcing the
 * narrowing, so the narrowing lives here once, not re-implemented at every
 * call site (design.md's "el repositorio estrecha la consulta ... no como
 * filtro posterior").
 *
 * Implementations MUST narrow the query itself when `actor.barberId` is
 * set: the WHERE clause binds to the actor's own barber id, and a request
 * for a different `requestedBarberId` must never reach for that other
 * barber's row at all — never "fetch everything, then decide what to hand
 * back".
 */
export interface AgendaRepository {
  findScheduleFor(requestedBarberId: string, actor: ActorContext): Promise<AgendaAccessResult>;
}
