/**
 * Frontend mirror of the role -> permission matrix migration 0006 seeds
 * (`packages/infrastructure/src/db/migrations/0006_access_control.sql`) and
 * the complete catalog `packages/domain/src/access-control/permission.ts`
 * declares. Duplicated on purpose, not imported: `apps/web` never imports
 * `@jc-barberia/domain` (see `shared/now.ts`'s doc comment for the
 * established precedent — this SPA has no Clock port to inject either), and
 * there is no HTTP endpoint yet that returns "my permissions" for this SPA
 * to fetch instead. Building one would mean touching `apps/api`, which this
 * slice (D) does not own — flagged in apply-progress as a recommended
 * follow-up once ownership allows it.
 *
 * This map is UI-ONLY. The access-control spec is explicit that
 * "La autorización es una frontera de backend, no una cuestión de ocultar
 * botones en la interfaz" — `PermissionsGuard` re-checks `role_permissions`
 * on every request regardless of what this file decides to render. If a
 * permission row ever changes without a matching edit here, the failure
 * mode is a nav item that is wrong (shown when it should hide, or vice
 * versa), never a security hole.
 */
export type Role = 'owner' | 'secretary' | 'barber';

export type Permission =
  | 'appointment:create'
  | 'appointment:update'
  | 'appointment:cancel'
  | 'appointment:mark-completed:any'
  | 'appointment:mark-completed:own'
  | 'walkin:create'
  | 'barber:mark-absent'
  | 'client:manage'
  | 'barber:manage'
  | 'schedule:configure'
  | 'pricing:configure'
  | 'finance:read:shop'
  | 'finance:read:own'
  | 'agenda:read:any'
  | 'agenda:read:own';

const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  owner: new Set<Permission>([
    'appointment:create',
    'appointment:update',
    'appointment:cancel',
    'appointment:mark-completed:any',
    'walkin:create',
    'barber:mark-absent',
    'client:manage',
    'barber:manage',
    'schedule:configure',
    'pricing:configure',
    'finance:read:shop',
    'agenda:read:any',
  ]),
  secretary: new Set<Permission>([
    'appointment:create',
    'appointment:update',
    'appointment:cancel',
    'appointment:mark-completed:any',
    'walkin:create',
    'barber:mark-absent',
    'client:manage',
    'agenda:read:any',
  ]),
  barber: new Set<Permission>(['appointment:mark-completed:own', 'finance:read:own', 'agenda:read:own']),
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

/** Same ANY-of-several semantics as the backend's `@RequiresPermission(...)` —
 *  a nav item (or route guard) reachable through more than one permission
 *  needs only one of them, never all. */
export function hasAnyPermission(role: Role, permissions: readonly Permission[]): boolean {
  return permissions.some((permission) => hasPermission(role, permission));
}
