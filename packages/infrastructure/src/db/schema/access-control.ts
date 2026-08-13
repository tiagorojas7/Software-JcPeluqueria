import { pgTable, unique, uuid, varchar } from 'drizzle-orm/pg-core';

/**
 * The three roles the system recognizes (see access-control spec, "Tres
 * roles con aplicación en el backend"). `name` is the stable, English
 * identifier `PermissionsGuard` and the seed data key off — never the
 * Spanish business label (Dueño/Secretaria/Barbero), which stays a
 * README/UI concern. `users.role_id` (added in migration 0004) references
 * this table starting now that it exists.
 */
export const roles = pgTable('roles', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 30 }).notNull().unique(),
});

/**
 * The seeded, editable role → permission map — the actual runtime authority
 * `PermissionsGuard` reads on every request (see design.md's "Autorización:
 * permiso como unidad, rol como configuración"). Widening a role's
 * permissions is a row insert here, never a code change (access-control
 * spec, "Permisos de secretaria ajustables sin cambio de código").
 */
export const rolePermissions = pgTable(
  'role_permissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id),
    permission: varchar('permission', { length: 60 }).notNull(),
  },
  (table) => [
    unique('role_permissions_role_id_permission_unique').on(table.roleId, table.permission),
  ],
);
