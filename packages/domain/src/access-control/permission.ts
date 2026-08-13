/**
 * The full permission catalog — the unit of authorization (see design.md's
 * "Autorización: permiso como unidad, rol como configuración"). The role is
 * never hardcoded into the guard or the domain; only these permission
 * strings are. Which role gets which permission lives entirely in the
 * seeded, editable `role_permissions` table, never in application code —
 * see `RolePermissionRepository`.
 *
 * This is the COMPLETE vocabulary design.md declares, spanning every phase
 * that will eventually decorate a handler with `@RequiresPermission(...)`
 * (3b through 11) — not only the permissions this phase's migration seeds.
 * Declaring the full set now keeps the type honest and lets later phases add
 * `role_permissions` rows without ever inventing a new permission string.
 */
export const PERMISSIONS = [
  'appointment:create',
  'appointment:update',
  'appointment:cancel',
  'appointment:mark-completed:any',
  'appointment:mark-completed:own',
  'walkin:create',
  'barber:mark-absent',
  'client:manage',
  'barber:manage',
  'schedule:configure',
  'pricing:configure',
  'finance:read:shop',
  'finance:read:own',
  'agenda:read:any',
  'agenda:read:own',
] as const;

export type Permission = (typeof PERMISSIONS)[number];
