import type { Role } from './role';

/**
 * The resolved identity of whoever is making a request, once an active
 * session has been proven to belong to them (design.md's "Autorización",
 * capa 2 — "fina": `ActorContext { userId, role, barberId? }` feeding the
 * repository-level narrowing). `barberId` is present only when `role` is
 * `'barber'` — see access-control spec, "El barbero queda acotado a sus
 * propios datos". Deliberately does NOT carry a resolved `permissions`
 * list: `PermissionsGuard` already re-reads `RolePermissionRepository`
 * fresh on every request (access-control spec, "Permisos de secretaria
 * ajustables sin cambio de código"), so caching a permission snapshot here
 * would either go stale or duplicate that same read for no benefit.
 */
export interface ActorContext {
  readonly userId: string;
  readonly role: Role;
  readonly barberId?: string;
}
