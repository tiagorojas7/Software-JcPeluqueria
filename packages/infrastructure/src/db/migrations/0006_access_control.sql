CREATE TABLE "role_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role_id" uuid NOT NULL,
	"permission" varchar(60) NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_unique" UNIQUE("role_id","permission")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(30) NOT NULL,
	CONSTRAINT "roles_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- Hand-written seed, appended after the generated DDL above (Drizzle only
-- generates schema, never data): README.md section 3.8 "Roles y permisos"
-- is the source of truth for which of the 8 business rows apply to which
-- role; design.md's "Autorización: permiso como unidad, rol como
-- configuración" is the source for the exact permission strings those rows
-- translate to. See packages/domain/src/access-control/permission.ts for
-- the complete 15-entry catalog this seed draws from.
--
-- `agenda:read:any` has no literal row of its own in the README's 8-row
-- table, but is granted to owner and secretary here: it is the read-side
-- companion design.md pairs explicitly with `agenda:read:own` ("finance:read:shop
-- · finance:read:own · agenda:read:any · agenda:read:own"), and it is the
-- unavoidable prerequisite of every capability the README DOES grant them in
-- rows 1/3/4 (creating/editing/cancelling turnos, walk-ins, marking a
-- barber's absence all require seeing the day's schedule across barbers).
-- Flagged here, in tasks.md and in apply-progress as an interpretive
-- decision rather than a literal README row.
INSERT INTO "roles" ("name") VALUES ('owner'), ('secretary'), ('barber');
--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT r.id, p.permission
FROM "roles" r
CROSS JOIN (VALUES
  ('appointment:create'),
  ('appointment:update'),
  ('appointment:cancel'),
  ('appointment:mark-completed:any'),
  ('walkin:create'),
  ('barber:mark-absent'),
  ('client:manage'),
  ('barber:manage'),
  ('schedule:configure'),
  ('pricing:configure'),
  ('finance:read:shop'),
  ('agenda:read:any')
) AS p(permission)
WHERE r.name = 'owner';
--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT r.id, p.permission
FROM "roles" r
CROSS JOIN (VALUES
  ('appointment:create'),
  ('appointment:update'),
  ('appointment:cancel'),
  ('appointment:mark-completed:any'),
  ('walkin:create'),
  ('barber:mark-absent'),
  ('client:manage'),
  ('agenda:read:any')
) AS p(permission)
WHERE r.name = 'secretary';
--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT r.id, p.permission
FROM "roles" r
CROSS JOIN (VALUES
  ('appointment:mark-completed:own'),
  ('finance:read:own'),
  ('agenda:read:own')
) AS p(permission)
WHERE r.name = 'barber';