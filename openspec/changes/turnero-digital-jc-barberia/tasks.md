# Tasks: Turnero Digital — MVP de JC Barbería

> Fuente: `design.md` (secuencia de 14 fases), `specs/*/spec.md` (40 requirements), `README.md`.
> `strict_tdd` pasa a `true` en la Fase 0 (tarea 0.6). Desde la Fase 1, cada tarea de implementación va precedida de su RED.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~5,050 (según estimación del diseño; Fases 2, 5, 8, 9 y 10 ya rozan el techo de 400) |
| 400-line budget risk | **High** |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 → PR 2 → … → PR 14 (una PR por fase, ver tabla de unidades) |
| Delivery strategy | ask-on-risk |
| Chain strategy | feature-branch-chain |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High

**Nota honesta**: las Fases 2 (concurrencia con Testcontainers), 5 (adaptador MercadoPago + 20 tareas) y 8/9/10 (UI + endpoints) están estimadas por el diseño casi exactas a 400 líneas; el setup de infraestructura de test (Testcontainers, fixtures de concurrencia) puede empujarlas por encima. No se comprimen las estimaciones para forzar que entren.

### Suggested Work Units (una unidad = una PR, en orden de la cadena)

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|---|---|---|---|---|---|
| 0 | Monorepo, Vitest, Docker Compose, Drizzle, CI, dependency-cruiser, ShopClock, `strict_tdd: true` | PR 1 (base: tracker) | `pnpm test` | N/A — sin app aún, solo runner | Revertir PR 1 completo, nadie más depende todavía |
| 1 | Modelo de disponibilidad (solo lectura) | PR 2 (base: PR 1) | `pnpm vitest run packages/domain/availability packages/infrastructure/availability` | Testcontainers PostgreSQL | Revertir PR 2; PR 3 aún no existe |
| 2 | Ocupación + `EXCLUDE` + hold (núcleo de concurrencia) | PR 3 (base: PR 2) | `pnpm vitest run packages/infrastructure/slot-occupancy --reporter=verbose` | Testcontainers PostgreSQL + 20 promesas paralelas | Revertir PR 3; ningún UI depende aún |
| 3a | Identidad: challenge cliente + contraseña staff + sesiones | PR 4 (base: PR 2 — puede correr en paralelo a Fase 1/2 si hay dos personas; se encadena tras PR 2 para mantener el orden de revisión) | `pnpm vitest run packages/application/identity` | Testcontainers PostgreSQL | Revertir PR 4; nada más lo consume aún |
| 3b | Autorización: guard deny-by-default + contrato ruta×rol | PR 5 (base: PR 4) | `pnpm vitest run apps/api/test/authorization.contract.spec.ts` | App Nest levantada en memoria | Revertir PR 5; PR 6 aún no existe |
| 4 | Ciclo de vida del turno: estados + `DepositState` | PR 6 (base: PR 5) | `pnpm vitest run packages/domain/appointments` | Vitest puro (sin I/O) | Revertir PR 6; sin pagos reales conectados |
| 5 | Pagos: MercadoPago, webhook, reembolsos | PR 7 (base: PR 6) | `pnpm vitest run packages/infrastructure/payments` | Testcontainers + sandbox MercadoPago (webhook simulado) | Revertir PR 7; flag de checkout apagable |
| 6 | Procesos de fondo: pg-boss, barrido, recordatorio, outbox | PR 8 (base: PR 7) | `pnpm vitest run apps/worker` | Testcontainers PostgreSQL + pg-boss real | Revertir PR 8; worker puede quedar detenido sin romper reservas |
| 7 | Notificaciones: puerto + adaptador Gmail + plantillas | PR 9 (base: PR 8) | `pnpm vitest run packages/infrastructure/notifications` | `FakeNotificationPort` en tests; Gmail real solo en staging | Revertir PR 9; outbox sigue en cola sin entregar |
| 8 | `DayBoard` + `allowedActions` del servidor | PR 10 (base: PR 9) | `pnpm vitest run apps/web/src/agenda` | Vitest + Testing Library | Revertir PR 10; sin panel ni agenda de barbero aún |
| 9 | Web pública: hueco, hold, checkout, cuenta, cancelación | PR 11 (base: PR 10) | `pnpm vitest run apps/web/src/booking` | Playwright (sandbox MercadoPago) | Flag de reserva online apagable, vuelve a teléfono |
| 10 | Panel: telefónicos, walk-ins, edición, clientes, config | PR 12 (base: PR 11) | `pnpm vitest run apps/web/src/appointments apps/web/src/barbers` | Playwright | Revertir PR 12; reserva web y agenda no dependen |
| 11 | Perfil del barbero | PR 13 (base: PR 12) | `pnpm vitest run apps/web/src/barbers/profile` | Playwright | Revertir PR 13; independiente del resto de la UI |
| 12 | Reasignación por ausencia | PR 14 (base: PR 13, última del tracker) | `pnpm vitest run packages/application/absence-reassignment` | Testcontainers + pg-boss real | Revertir PR 14; el resto del sistema opera sin esta fase |

---

## Phase 0: Fundación (~350 líneas) — PR 1 (base: tracker)

- [x] 0.1 Inicializar monorepo pnpm workspaces: `apps/api`, `apps/worker`, `apps/web`, `packages/domain`, `packages/application`, `packages/infrastructure`, `packages/contracts`.
- [x] 0.2 Configurar TypeScript base + paths compartidos, ESLint y Prettier en la raíz.
- [x] 0.3 Instalar Vitest + `unplugin-swc`; crear `vitest.config.ts` por paquete.
- [x] 0.4 RED: `sanity.spec.ts` en `packages/domain` con aserción falsa, para probar que el runner corre.
- [x] 0.5 GREEN: corregir el test trivial; confirmar `pnpm test` en verde.
- [x] 0.6 Actualizar `openspec/config.yaml`: `strict_tdd: true`, `apply.tdd: true`, `apply.test_command: "pnpm test"`, `verify.test_command`/`build_command`.
- [x] 0.7 `docker-compose.yml` con PostgreSQL 16 + `SHOP_UTC_OFFSET=-03:00`.
- [x] 0.8 Instalar Drizzle ORM + drizzle-kit en `packages/infrastructure`; configurar conexión y carpeta de migraciones.
- [x] 0.9 Configurar `dependency-cruiser`: falla el build si `domain` importa `infrastructure`/`application`/terceros no-tipos; agregar a CI.
- [x] 0.10 Workflow CI (GitHub Actions): lint + dependency-cruiser + `pnpm test` en cada PR.
- [x] 0.11 Puerto `Clock` en `packages/domain`; adaptador `ShopClock` en `packages/infrastructure` leyendo `SHOP_UTC_OFFSET`; regla lint que prohíbe `Date.now()`/`new Date()`/`toLocaleString` fuera de `ShopClock`.
- [x] 0.12 RED: test de `ShopClock.businessDayBounds` en bordes de día/mes.
- [x] 0.13 GREEN: implementar `businessDayBounds`.

Requisitos que cierra: ninguno (fundación pura).

## Phase 1: Modelo de disponibilidad (~400 líneas) — PR 2 (base: PR 1) — depende de 0

- [x] 1.1 RED: tests de dominio para `Barber`, `Service`, `ShopHours`, `BarberSchedule`, `BarberTimeOff`.
- [x] 1.2 GREEN: implementar entidades/value objects en `packages/domain/availability`.
- [x] 1.3 Migración Drizzle: tablas `barbers`, `services`, `shop_hours`, `barber_schedules`, `barber_time_off`. Generada con `drizzle-kit generate` y **aplicada y verificada contra Postgres real** (docker-compose, ver 1.4/1.5).
- [x] 1.4 RED (Testcontainers): CRUD básico de repositorios de disponibilidad. Docker ya disponible; `repositories.spec.ts` escrito primero y confirmado fallando por módulo inexistente antes de implementar.
- [x] 1.5 GREEN: implementados `DrizzleBarberRepository`, `DrizzleServiceRepository`, `DrizzleScheduleRepository` en `packages/infrastructure/src/availability`, contra los puertos `BarberRepository`/`ServiceRepository`/`ScheduleRepository` de `packages/domain`. 14/14 tests en verde contra un Postgres real vía Testcontainers.
- [x] 1.4b (agregado durante la fase) Constraints `UNIQUE` en `shop_hours (day_of_week)` y `barber_schedules (barber_id, day_of_week)` — horario corrido es regla de negocio confirmada; sin esto `workingWindows()` elegía una fila arbitraria entre duplicados. Migración generada, aplicada contra Postgres real, y verificada rechazando una fila duplicada real con `psql`.
- [x] 1.6 RED: `AvailabilityService.freeSlots(barberId, date)` combinando horario del local + del barbero + días libres (sin ocupación, eso es Fase 2). Renombrado a `workingWindows` durante la fase — el nombre `freeSlots` sugería que la ocupación ya estaba excluida, y nunca fue así.
- [x] 1.7 GREEN: implementar generación de huecos read-only.
- [x] 1.8 RED: bordes de huso horario en la generación de huecos (vía `ShopClock`, nunca `Date` directo).
- [x] 1.9 GREEN: ajustar generación para usar `ShopClock` exclusivamente.

Requisitos que cierra: fundación para admin-operations (Vista del día), client-booking (Exploración sin cuenta), barber-profile — se materializan en Fases 8/9/11.

**9/9 tareas completas.** Presupuesto de revisión (solo código de producción, ver regla en `openspec/config.yaml`): **615 líneas** — supera el techo de 400 en 215 líneas (~1.5x). Detalle en `sdd/turnero-digital-jc-barberia/apply-progress`.

## Phase 2: Ocupación + EXCLUDE + hold (~400 líneas) — PR 3 (base: PR 2) — depende de 1

- [x] 2.1 Migración: tabla `slot_occupancies` (`time_range tstzrange`, `status`, `hold_expires_at`, `payment_pending`, `origin_occupancy_id`, `deposit_id`). Migración `0002`, generada con `drizzle-kit` y aplicada contra Postgres real. `created_by_user_id`/`marked_by_user_id` quedan para la Fase 3a, cuando exista `users` y la FK se pueda crear de una sola vez.
- [x] 2.2 Migración manual SQL: `EXCLUDE USING gist (barber_id WITH =, time_range WITH &&) WHERE status IN ('held','reservado','realizado')`. Migración `0003`, escrita a mano (Drizzle no expresa `EXCLUDE`), con `CREATE EXTENSION IF NOT EXISTS btree_gist`.
- [x] 2.3 RED (Testcontainers): dos INSERT concurrentes mismo barbero+rango → uno falla `23P01`. → *slot-hold: Exclusividad del horario retenido*
- [x] 2.4 GREEN: `HoldRepository.create()` traduce `23P01` a rechazo de dominio con huecos alternativos. Puerto `HoldRepository` + `SlotUnavailableError` en `packages/domain/src/booking`; adaptador `DrizzleHoldRepository` en `packages/infrastructure/src/booking`.
- [x] 2.5 RED **(obligatorio, diseño)**: 20 transacciones concurrentes sobre el mismo hueco → exactamente una gana. → *slot-hold: Exclusividad del horario retenido* Verificado que el test discrimina: sin el constraint ganan las 20.
- [x] 2.6 GREEN: ajustar pool de conexión/`HoldRepository` hasta que 2.5 sea estable. Pool de 25 conexiones (por encima de los 20 competidores); estable en 4 corridas consecutivas. El `HoldRepository` no necesitó reintentos ni `SERIALIZABLE`.
- [x] 2.7 RED: creación de hold al seleccionar un horario disponible. → *slot-hold: Creación del hold*
- [x] 2.8 GREEN: implementar `CreateHold`. Caso de uso en `packages/application/src/booking/create-hold.ts`: calcula `holdExpiresAt = clock.addMinutes(clock.now(), HOLD_DURATION_MINUTES)` vía el puerto `Clock` (nunca `new Date()`) y delega en `HoldRepository.create()`. Agregado `Clock.addMinutes` (ShopClock + FakeClock) como única aritmética de instantes del puerto.
- [x] 2.9 RED: liberación perezosa de holds vencidos antes de ocupar (`UPDATE ... status='liberado' WHERE hold_expires_at <= now()`). → *slot-hold: Expiración automática*
- [x] 2.10 GREEN: integrar la liberación perezosa en creación de hold y lectura de disponibilidad. `DrizzleHoldRepository.releaseExpiredHolds()` corre antes del `INSERT` en `create()`, sobre la misma `searchWindow` que después alimenta el cálculo de alternativas (`SlotUnavailableError.alternatives`) — una sola llamada cubre ambos usos.
- [x] 2.11 RED: confirmación atómica `UPDATE ... status='reservado' WHERE status='held' AND hold_expires_at > now() RETURNING *`; cero filas → hold vencido/perdido. → *slot-hold: Re-validación inmediatamente antes de confirmar*
- [x] 2.12 GREEN: `ConfirmHold` como transición de estado, nunca INSERT. `HoldRepository.confirm()` (Drizzle) hace el UPDATE condicional descripto arriba (`RETURNING id`, no `*` — no hace falta más para decidir éxito/fracaso); `ConfirmHold` (aplicación) delega y devuelve `confirmed` o (en 2.12) `expired`.
- [x] 2.13 RED: re-validación fallida en reserva ordinaria ofrece el hueco más cercano sin restricción de día. → *slot-hold: Re-validación — sin restricción de día*
- [x] 2.14 RED: re-validación fallida en oferta de ausencia se limita al mismo día calendario. → *slot-hold: Re-validación — mismo día*
- [x] 2.15 GREEN: `findNearestAvailable(scope: 'any-day' | 'same-day')` conectado a 2.13/2.14. Función pura en `packages/domain/src/booking/nearest-available.ts`, sin I/O: recibe una lista de `AvailableCandidate` ya computados (fecha + ventana libre) y elige el más cercano al instante original, descartando los de otro día calendario cuando `scope='same-day'`. `ConfirmHold` la conecta a su rama de fallo y crea un nuevo hold de 15 min sobre el candidato elegido vía `CreateHold` (2.8) — nunca un INSERT ad hoc.
- [x] 2.16 RED: sin huecos disponibles tras fallo de re-validación → no crea hold automático, devuelve disponibilidad actualizada. → *slot-hold: Re-validación — sin huecos*
- [x] 2.17 GREEN: implementar la rama sin resultados. `ConfirmHold` devuelve `outcome: 'no-slots-available'` con los candidatos recibidos (sin filtrar por scope, para que el cliente pueda elegir manualmente incluso otro día) y no invoca `CreateHold`. Cubre tanto lista vacía como lista no vacía completamente filtrada por `scope='same-day'`.

Requisitos que cierra: **slot-hold** (4/4: Creación del hold · Exclusividad · Expiración automática · Re-validación). **17/17 tareas de la fase completas.**

**Nota de diseño (2.13-2.17)**: la generación de `AvailableCandidate[]` a través de varios días calendario (para `scope='any-day'` cuando el mismo día no alcanza) queda deliberadamente fuera de esta fase — `ConfirmHold` recibe los candidatos ya calculados por quien la invoque. Combinar `AvailabilityService.workingWindows()` (Fase 1) con la ocupación real día por día para un horizonte de búsqueda de varios días es trabajo de integración de una fase con endpoint real (Fase 9), no de esta pieza del núcleo de concurrencia; construirlo ahora sin un consumidor real habría sido abstracción especulativa.

## Phase 3a: Identidad (~400 líneas) — PR 4 (base: PR 2, puede desarrollarse en paralelo a Fase 1) — depende de 0

- [x] 3a.1 Migración: tablas `users`, `auth_challenges`, `sessions`. Migración `0004`, generada con `drizzle-kit` y aplicada/verificada contra Postgres real (Testcontainers). `role_id`/`client_id` quedan sin FK todavía (`roles`/`clients` no existen aún), mismo patrón que `slot_occupancies.client_id`/`deposit_id`. `created_by_user_id`/`marked_by_user_id` de `slot_occupancies` (deferidos desde la Fase 2) se agregan en este mismo shot con su FK a `users`.
- [x] 3a.2 RED: código de 6 dígitos y magic link derivan de la misma fila `auth_challenges`; solo se guarda el hash SHA-256.
- [x] 3a.3 GREEN: `ChallengeService.issue()`. `packages/application/src/identity/challenge-service.ts`: genera código (6 dígitos, `crypto.randomInt`) y token (32 bytes, `crypto.randomBytes`), hashea ambos con SHA-256 antes de llamar a `AuthChallengeRepository.create()` — el repositorio nunca ve el texto plano. `expiresAt` vía `Clock.addMinutes`, nunca `new Date()`.
- [x] 3a.4 RED: consumo de challenge atómico y de un solo uso bajo concurrencia (dos consumos simultáneos → uno gana). Testcontainers, mismo patrón que el test de 20 transacciones de la Fase 2.
- [x] 3a.5 GREEN: `ChallengeService.consume()`. `DrizzleAuthChallengeRepository.consume()` replica la forma de `HoldRepository.confirm()`: `UPDATE ... WHERE id AND purpose AND consumed_at IS NULL AND (code_hash=:h OR token_hash=:h) RETURNING user_id` — una sola sentencia condicional, nunca lectura seguida de escritura. El `purpose` en el WHERE evita que un challenge de otro propósito (activación/reset de staff) se pueda canjear por este camino.
- [x] 3a.6 RED: 5 intentos fallidos invalidan el challenge; expira a los 10 minutos.
- [x] 3a.7 GREEN: implementar límites de intentos y expiración. El WHERE gana `expires_at > now()` y `attempts < 5`; el SET pasa a un `CASE` que marca `consumed_at` si el hash coincide o incrementa `attempts` si no — la fila se toca en ambos casos, nunca se ignora silenciosamente un intento fallido.
- [x] 3a.8 RED: login de cliente sin contraseña autentica y no persiste ninguna contraseña. → *access-control: Autenticación diferenciada según tipo de usuario*
- [x] 3a.9 GREEN: `ClientLoginUseCase`. Canjea un challenge de `purpose='client_login'` vía `ChallengeService.consume()`; `{outcome:'authenticated', userId}` o `{outcome:'rejected'}`. Ningún campo de entrada/salida ni de lo que se persiste representa una contraseña.
- [x] 3a.10 RED: hash argon2id (parámetros OWASP), verificación en tiempo constante, usuario inexistente paga costo de hash falso. → *access-control: Autenticación diferenciada · Contraseñas del personal almacenadas de forma segura*
- [x] 3a.11 GREEN: `PasswordService` (argon2) + `StaffLoginUseCase`. Migración `0005`: `users.password_hash`/`password_changed_at`. `Argon2PasswordHasher` (`@node-rs/argon2`, prebuilt — sin paso de build) a los parámetros OWASP (19 MiB, t=2, p=1). `verifyDummy()` paga el mismo costo que `verify()` real contra un hash fijo precomputado, para email inexistente o cuenta desactivada.
- [x] 3a.12 RED: alta de staff genera link de activación de un solo uso; nunca contraseña en texto plano.
- [x] 3a.13 GREEN: `ActivateStaffUseCase`. `.invite()` reusa `ChallengeService.issue({purpose:'staff_activation'})`; `.activate()` valida la fortaleza de la contraseña ANTES de consumir el challenge (para no quemar el link de un solo uso con una contraseña débil) y luego consume + `PasswordService.setPassword`.
- [x] 3a.14 RED: reset con token de 32 bytes, hash en base, 30 min, un solo uso; no revela la contraseña anterior. → *access-control: Contraseñas del personal almacenadas de forma segura*
- [x] 3a.15 GREEN: `ResetPasswordUseCase` (usa `NotificationPort`, fake hasta Fase 7). `EXPIRY_MINUTES_BY_PURPOSE` en el dominio: `staff_password_reset` vive 30 min (los otros dos propósitos, 10). `.request(email)` responde exactamente igual exista o no la cuenta (nunca filtra qué emails tienen alta); `.complete()` valida la contraseña antes de consumir, mismo motivo que `ActivateStaffUseCase`. Puerto `NotificationPort` nuevo en `packages/domain/src/notifications` — Fase 7 construye el adaptador real, acá solo `FakeNotificationPort`.
- [x] 3a.16 RED: cambiar/resetear contraseña revoca todas las sesiones activas del usuario.
- [x] 3a.17 GREEN: revocación de sesiones en `sessions`. Puerto `SessionRepository` (dominio) + `DrizzleSessionRepository.revokeAllForUser()` — un solo `UPDATE ... WHERE user_id AND revoked_at IS NULL`, nunca un loop por sesión. `ResetPasswordUseCase.complete()` la invoca después de `PasswordService.setPassword`. Probado con Testcontainers: revoca todas las sesiones del usuario y ninguna de otro usuario.
- [x] 3a.18 RED: TTL de sesión — cliente 30 días, staff 12h, dueño 8h.
- [x] 3a.19 GREEN: `SessionService` con TTLs diferenciados por rol. `SessionSubjectKind` (`'client' | 'staff' | 'owner'`) es un tipo del dominio deliberadamente independiente de `roles`/`role_permissions` (Fase 3b) — 3b depende de 3a, nunca al revés, así que quien ya sabe qué tipo de login acaba de suceder (cliente/staff/dueño específicamente) se lo pasa directo a `SessionService.create()`, sin resolución por tabla de roles. `expiresAt` se computa una sola vez, al crear, vía el puerto `Clock`.

**19/19 tareas completas.** Requisitos que cierra: **access-control: Autenticación diferenciada según tipo de usuario** (2/2 escenarios — cliente y personal) y **Contraseñas del personal almacenadas de forma segura** (ambos escenarios: hash seguro + restablecimiento vía `notification-port`). Migración `0005`: `users.password_hash`/`password_changed_at`.

## Phase 3b: Autorización (~350 líneas) — PR 5 (base: PR 4) — depende de 3a

- [x] 3b.1 Migración: `roles`, `role_permissions`; seed con la matriz de permisos del README. → *access-control: Matriz de permisos por rol* Migración `0006_access_control.sql`: DDL generada con `drizzle-kit` + seed hand-escrito al final (Drizzle no genera datos, mismo patrón que la 0003). `users.role_id` (nullable desde la 0004) gana su FK a `roles` en este mismo shot. Catálogo completo de 15 permisos en `packages/domain/src/access-control/permission.ts` (design.md es la fuente de los códigos exactos; README 3.8 es la fuente de qué rol tiene qué). `agenda:read:any` no tiene fila propia en la tabla de 8 filas del README pero se siembra para dueño/secretaria como prerrequisito operativo de las filas 1/3/4 (ver comentario en la migración) — decisión interpretativa, marcada explícitamente ahí y en apply-progress.
- [x] 3b.2 RED: `role_permissions` sembrado refleja exactamente la matriz especificada. `role-permission.repository.spec.ts` (Testcontainers) escrito primero y confirmado fallando por módulo inexistente (`DrizzleRolePermissionRepository`) antes de implementar el adaptador.
- [x] 3b.3 GREEN: seed script + verificación. `DrizzleRolePermissionRepository.hasPermission()` en `packages/infrastructure/src/access-control`; el test verifica la matriz sembrada fila por fila (23 filas, 3 roles, ninguna de más) más `hasPermission()` concedido/denegado — 5/5 contra Postgres real.
- [x] 3b.4 RED **(matriz de amenazas — endpoints autenticados)**: handler sin `@RequiresPermission` ni `@Public()` → `403`. → *access-control: Tres roles con aplicación en el backend* `apps/api/test/authorization.contract.spec.ts` — primer código de `apps/api` más allá de `package.json`: bootstrap NestJS mínimo (`AppModule`/`AccessControlModule`, deliberadamente sin `main.ts` ni servidor escuchando un puerto) creado en memoria vía `Test.createTestingModule(...).createNestApplication()`, con un controller de prueba cuyo handler no lleva ningún decorador.
- [x] 3b.5 GREEN: `PermissionsGuard` global + decoradores `@RequiresPermission`/`@Public`. Guard registrado como `APP_GUARD`; ausencia de metadata → `403` (deny-by-default, el caso que prueba 3b.4); `@Public()` → bypass explícito; `@RequiresPermission` → consulta `RolePermissionRepository` (puerto de dominio) en cada llamada, nunca un mapa hardcodeado — implementación ya lista para que 3b.13 solo tenga que confirmarlo. `permissions.guard.spec.ts` (unit, `FakeRolePermissionRepository`) cubre la rama de permiso concedido/denegado/sin actor; `authorization.contract.spec.ts` cubre el deny-by-default y `@Public()` a través de la app Nest real.
- [x] 3b.6 RED **(matriz de amenazas)**: barbero pidiendo la agenda de un compañero por id → `403`. → *access-control: El barbero queda acotado a sus propios datos* `packages/infrastructure/src/access-control/agenda.repository.spec.ts` (Testcontainers) escrito primero y confirmado fallando por módulo inexistente (`DrizzleAgendaRepository`); luego `apps/api/test/authorization.contract.spec.ts` extendido con la ruta `GET /threat-matrix/barbers/:barberId/schedule` y confirmado fallando de verdad (módulos inexistentes: `current-actor.decorator`, `session-cookie`, `ACTOR_CONTEXT_REPOSITORY`).
- [x] 3b.7 GREEN: `ActorContext` + estrechamiento `WHERE barber_id = :actorBarberId` en el repositorio. Prerrequisito propio (\"wire the dormant seam first\"): `ActorContext { userId, role, barberId? }` en el dominio, puerto `ActorContextRepository.resolveBySessionId()` + `DrizzleActorContextRepository` (JOIN `sessions`→`users`→`roles`, una sola consulta atómica: sesión revocada/vencida/usuario sin rol → `null`, igual que sesión inexistente). `apps/api`: `ActorContextMiddleware` (Nest middleware, corre antes que cualquier guard) resuelve la cookie `session_id` a `request.actor`; `PermissionsGuard` migrado de `request.actorRole` a `request.actor: ActorContext`; decorador `@CurrentActor()`. Puerto `AgendaRepository.findScheduleFor(requestedBarberId, actor)` + `DrizzleAgendaRepository`: decide `forbidden` comparando IDs *antes* de tocar la base — la query nunca corre `WHERE barber_id` con el id de un colega, nunca \"trae todo y filtra después\". `@RequiresPermission` ahora acepta N permisos (semántica ANY) para expresar `agenda:read:any`/`agenda:read:own` sobre la misma ruta.
- [x] 3b.8 RED **(matriz de amenazas)**: barbero pidiendo facturación del local → `403`. → *access-control: El barbero queda acotado a sus propios datos* Ruta `GET /threat-matrix/finance/shop` retirada temporalmente del controlador de prueba para confirmar `404` genuino (no `200`/`403`) antes de implementarla.
- [x] 3b.9 GREEN: aplicar el mismo guard/estrechamiento a los endpoints de facturación. `finance:read:shop` no tiene estrechamiento por fila — es facturación del local completa, no parametrizada por id (design.md: "dos read models distintos, no el mismo filtrado") — así que la capa gruesa del guard es toda la decisión; sin datos reales de facturación aún (Fase 5), el handler es un seam deliberadamente delgado.
- [x] 3b.10 RED: test de contrato ruta × rol — matriz completa permitido/denegado por cada ruta declarada y cada rol. → *access-control: Matriz de permisos por rol* `ROUTE_ID_TO_HANDLER_NAME` (catálogo de rutas declaradas) + chequeo de completitud vía `Object.getOwnPropertyNames(ThreatMatrixController.prototype)` — confirmado fallando de verdad: las rutas `schedule`/`shopBilling` agregadas en 3b.6-3b.9 aún no estaban catalogadas, y el chequeo las detectó sin necesitar ningún cambio de código productivo.
- [x] 3b.11 GREEN: completar decoradores faltantes hasta que 3b.10 esté en verde. Ningún decorador faltaba realmente (ambas rutas ya estaban correctamente decoradas desde 3b.7/3b.9) — lo que faltaba era la propia cobertura del catálogo/matriz, que es exactamente el vacío que 3b.10 existe para detectar. Matriz final: 4 rutas × 3 roles (+ anónimo) = 16 aserciones HTTP reales sobre la app Nest.
- [x] 3b.12 RED: permisos de secretaria se amplían por fila de `role_permissions`, sin cambio de código. → *access-control: Permisos de secretaria ajustables sin cambio de código* Dos pruebas complementarias. Capa repositorio (`role-permission.repository.spec.ts`, Testcontainers): `INSERT` real en `role_permissions` a mitad de test, misma instancia de `DrizzleRolePermissionRepository` sin reconstruir — pasó en verde al primer intento (comportamiento ya correcto desde 3b.3, sin caché); documentado honestamente como prueba de caracterización, no como ciclo RED→GREEN clásico. Capa guard (`permissions.guard.spec.ts`): `FakeRolePermissionRepository.grant()` retirado temporalmente para confirmar RED genuino (`repo.grant is not a function`) antes de agregarlo.
- [x] 3b.13 GREEN: confirmar que el guard lee `role_permissions` en cada request, no un mapa hardcodeado. `FakeRolePermissionRepository.grant()` agregado (test double, fuera de presupuesto); cero cambios en `PermissionsGuard` ni en `DrizzleRolePermissionRepository` — ambos ya leían en cada llamada desde 3b.5/3b.3. Las dos pruebas juntas cierran el círculo: el repositorio no cachea (capa datos) y el guard no cachea encima (capa aplicación).

Requisitos que cierra: **access-control** (4/6 restantes, TODOS cerrados: Tres roles con aplicación en el backend · Matriz de permisos por rol · El barbero queda acotado a sus propios datos · Permisos de secretaria ajustables). **Fase 3b completa, 13/13.**

## Phase 4: Ciclo de vida del turno (~350 líneas) — PR 6 (base: PR 5) — depende de 2, 3b

- [x] 4.1 RED: máquina de estados — cinco transiciones válidas y las inválidas rechazadas. → *appointment-lifecycle: Cinco estados explícitos y no colapsables* `appointment-state-machine.spec.ts` escrito primero y confirmado fallando por módulo inexistente antes de implementar.
- [x] 4.2 GREEN: `AppointmentStateMachine` en `packages/domain/src/appointments`. Tabla de transiciones explícita (`Record<AppointmentStatus, readonly AppointmentStatus[]>`); `ausente` tiene una única arista entrante, desde `sin_registrado` — nunca desde `reservado` — que es la garantía estructural detrás de "el sistema nunca marca ausencias por su cuenta" (4.7/4.8). Métodos estáticos: sin dependencias, no hay razón para instanciar.
- [x] 4.3 RED: `DepositState` exhaustivo (`not_applicable` · `pending` · `settled` · `refunded` · `forfeited`). `deposit-transitions.spec.ts` escrito primero y confirmado fallando por módulo inexistente antes de implementar.
- [x] 4.4 GREEN: implementar `DepositState` y los switches de cancelación/ausencia/realizado con `FakePaymentPort`. `resolveDepositForCompletion` no recibe `PaymentPort` — la firma es la prueba de que no puede cobrar ni reembolsar, para ningún kind. `resolveDepositForAbsence` nunca llama al puerto (perder la seña no requiere pasarela). `resolveDepositForCancellation` sí llama `PaymentPort.refund()` para `settled`; no está conectado a ningún `CancelUseCase` todavía (eso es de las Fases 9/10) — esta fase solo prueba la mitad de resolución de dinero en aislamiento. Los tres switches rechazan `pending`/`refunded`/`forfeited` con `UnexpectedDepositStateError`: esos kinds nunca deberían llegar a un turno `reservado`/`sin_registrado`, así que aparecer ahí es un bug corriente arriba, no un caso de negocio.
- [x] 4.5 RED: marcar `realizado` sin seña previa no ejecuta cobro ni reembolso. → *appointment-lifecycle: Turno realizado sin seña previa* `mark-completed.spec.ts` escrito primero y confirmado fallando por módulo inexistente (`./appointment`, `./mark-completed`) antes de implementar.
- [x] 4.6 GREEN: `MarkCompletedUseCase`. Entidad `Appointment` agregada (mismo concepto físico que `Hold`, ahora con `status`/`deposit`; `clientId` no-nulable a diferencia de `Hold.clientId` porque todo turno que llega a `reservado` ya identificó al cliente). Válido desde `reservado` o `sin_registrado` (resolución del día siguiente); rechaza estados terminales vía `AppointmentStateMachine.transition`.
- [x] 4.7 RED: el sistema nunca transiciona automáticamente a `ausente`; solo confirmación humana explícita. → *appointment-lifecycle: El sistema nunca marca ausencias por su cuenta* `confirm-absence.spec.ts` escrito primero (junto con 4.9, mismo archivo de producción) y confirmado fallando por módulo inexistente (`./confirm-absence`) antes de implementar. Cubre: actor ausente/vacío → rechazado; `reservado -> ausente` rechazado aun con actor válido (la máquina de estados ya lo prueba a nivel de tabla — esto prueba que el use case realmente la respeta).
- [x] 4.8 GREEN: `ConfirmAbsenceUseCase` (requiere `ActorContext` humano; el guardado del actor es un chequeo de runtime además de tipo — un caller que evada TypeScript tampoco puede colarlo). El "endpoint autenticado" que garantiza un actor real es trabajo de fases posteriores (HTTP/sesión→`ActorContext`, ya resuelto en 3b.7 como patrón); esta fase deja el requisito estructuralmente imposible de saltear desde el dominio.
- [x] 4.9 RED: ausencia con seña la pierde sin reembolso; sin seña, no hay movimiento de dinero pero se registra en el historial de ausencias. Mismo archivo/RED que 4.7.
- [x] 4.10 GREEN: completar `ConfirmAbsenceUseCase` con el registro en historial de ausencias. `AbsenceRecord` (appointmentId/clientId/confirmedByUserId/confirmedAt vía `Clock`/depositForfeited) se produce siempre, con o sin seña — la prueba de que el evento queda registrado incluso cuando no hay plata de por medio.

Requisitos que cierra: **appointment-lifecycle** (2/4: Cinco estados explícitos y no colapsables · El sistema nunca marca ausencias por su cuenta). Los otros dos (barrido, walk-ins) cierran en Fases 6 y 10. **Fase 4 completa, 10/10.**

## Phase 5: Pagos (~400 líneas) — PR 7 (base: PR 6) — depende de 4

- [x] 5.1 **Primero**: verificar contra documentación oficial de MercadoPago — formato exacto de `x-signature`, ventana de reembolso, comportamiento de reembolso parcial. Registrar hallazgos antes de escribir código de esta fase. Hallazgos en `research/mercadopago-api.md`. Resultado: manifiesto exacto `id:{data.id};request-id:{x-request-id};ts:{ts};` con `data.id` en minúsculas y comparación de tiempo constante · ventana de reembolso **irrelevante** para este negocio (nuestros plazos son de horas, el límite es de 180 a 360 días) · reembolso parcial **probablemente innecesario** porque la seña es indivisible · **dos hallazgos nuevos**: `X-Idempotency-Key` es obligatorio y falta en el diseño, y `428 insufficient_money_for_refund` es un escenario de negocio real sin contemplar. Queda **una decisión bloqueante**: si Checkout Pro usa `/v1/payments/{id}/refunds` o `/v1/orders/{order_id}/refund`, a verificar contra cuenta de prueba.
- [x] 5.2 Migración: tablas `deposits`, `payment_events`; `CHECK` de invariante del canal (`channel <> 'web' OR status IN ('held','liberado') OR deposit_id IS NOT NULL`; `channel = 'web' OR deposit_id IS NULL`). Migración `0007_payments.sql`, hand-written igual que la 0003 (Drizzle no expresa `CHECK`); `slot_occupancies.deposit_id` gana su FK a `deposits` en el mismo shot (diferida desde la Fase 2).
- [x] 5.3 RED: INSERT que viola cualquiera de los dos `CHECK` falla en base. `deposit-channel-invariant.spec.ts` (Testcontainers), confirmado fallando primero sin los CHECK (insert exitoso), luego en verde con ellos restaurados.
- [x] 5.4 GREEN: confirmar migración aplicada. El CHECK expuso una regresión real en el test genérico de `confirm()` de la Fase 2 (usaba canal `web` para probar `held->reservado`, ahora prohibido sin seña) — corregido a canal `telefonico`, sin tocar el repositorio.
- [x] 5.5 RED: checkout crea preference de MercadoPago por el 50% del precio de lista. → *client-booking: Reserva web con seña obligatoria del 50%* `checkout.spec.ts` (Fakes) + `deposit-amount.spec.ts` (función pura), ambos confirmados fallando por módulo inexistente antes de implementar.
- [x] 5.6 GREEN: `MercadoPagoPaymentAdapter.createPreference()` + `CheckoutUseCase`. `CheckoutUseCase` re-valida el hold vía `HoldRepository.beginCheckout()` (nuevo método, mismo patrón atómico `UPDATE...RETURNING` que `confirm()`) antes de crear la preference. `depositAmountCents()` aísla la regla del 50%. El adaptador concentra cada llamada HTTP en un único `request()` con un único `baseUrl` — la decisión pendiente de refunds (5.1) queda aislada a una sola constante.
- [x] 5.7 RED **(matriz de amenazas)**: webhook con firma HMAC inválida → `401`, cero efectos en el dominio. `mercadopago-signature.spec.ts` (7 casos) + `mercadopago-webhook.spec.ts` (Nest en memoria), ambos confirmados fallando por módulo inexistente antes de implementar.
- [x] 5.8 GREEN: verificar `x-signature` según lo confirmado en 5.1. `verifyMercadoPagoSignature()`: manifiesto exacto con `data.id` en minúsculas, segmento `request-id` omitido (nunca vacío) sin ese header, comparación de tiempo constante vía `crypto.timingSafeEqual`.
- [x] 5.9 RED: webhook responde `200` de inmediato y encola `payment.process`; el worker consulta `GET /v1/payments/:id` como fuente de verdad, no el redirect. Mismo archivo que 5.7.
- [x] 5.10 GREEN: handler del webhook + job `payment.process`. `MercadoPagoWebhookController` (`@Public()`, `apps/api/src/payments`) solo verifica firma y encola vía el puerto `PaymentJobQueue` (nuevo; pg-boss lo implementa recién en la Fase 6) — nunca procesa el pago en el handler. `ProcessPaymentUseCase` es "el worker" que design.md describe: nunca confía en el payload ni en el redirect, solo en `PaymentPort.getPayment()`.
- [x] 5.11 RED **(matriz de amenazas)**: reintento del mismo `payment_id` afecta cero filas. `process-payment.spec.ts` (aplicación, Fakes) + `deposit.repository.spec.ts` (Testcontainers, prueba real de base) confirmados fallando por módulo inexistente antes de implementar.
- [x] 5.12 GREEN: confirmar idempotencia en `ConfirmHoldOnPayment`. `DrizzleDepositRepository.recordSettledPayment()`: `INSERT ... ON CONFLICT (payment_id) DO NOTHING RETURNING id` — mismo patrón "cero filas afectadas" que `HoldRepository.confirm()` (Fase 2); solo quien gana el INSERT pasa a actualizar `slot_occupancies`. Probado con Testcontainers: un `payment_id` reintentado no duplica el depósito ni re-toca el turno.
- [x] 5.13 RED **(matriz de amenazas)**: payload `approved` falsificado sin firma válida es rechazado. Caso dedicado en `mercadopago-webhook.spec.ts`: payload realista con `status: 'approved'` y firma inválida → `401`, cola vacía.
- [x] 5.14 GREEN: endurecer verificación de firma hasta que 5.13 pase. Ya cubierto por 5.8 — la verificación de firma ocurre antes de que el handler interprete el body, así que un payload falsificado nunca llega a importar su contenido.
- [x] 5.15 RED: pago rechazado/no completado no crea el turno en `reservado`. → *client-booking: Falla el cobro de la seña*
- [x] 5.16 GREEN: implementar la rama de rechazo/pago no completado.
- [x] 5.17 RED: hold con pago en curso (`payment_pending=true`) nunca lo libera el temporizador; solo al llegar a estado terminal.
- [x] 5.18 GREEN: excepción de `payment_pending` en la liberación perezosa (ajusta 2.9).
- [x] 5.19 RED: reembolso automático al cancelar dentro de la ventana y al vencer un hold con cobro asociado. → *client-booking: Cancelación del cliente con reembolso automático · slot-hold: Hold vencido con cobro asociado*
- [x] 5.20 GREEN: `RefundUseCase` sobre `MercadoPagoPaymentAdapter.refund()`.

Requisitos que cierra: mecanismo de pago para **client-booking** (Reserva web con seña · Falla del cobro · Cancelación con reembolso — se completan en Fase 9) y **slot-hold** (Hold vencido con cobro asociado). Cubre ambas filas aplicables de la matriz de amenazas del webhook.

## Phase 6: Procesos de fondo (~300 líneas) — PR 8 (base: PR 7) — depende de 5

- [x] 6.1 Instalar pg-boss; entrypoint de worker en `apps/worker`.
- [x] 6.2 RED: `hold.expire` se encola con `startAfter` 15 min en la misma transacción que crea el hold.
- [x] 6.3 GREEN: implementar el encolado en `CreateHold` (ajusta 2.8).
- [x] 6.4 RED: `hold.expire` dispara reembolso y notificación cuando corresponde, idempotente ante reintento.
- [x] 6.5 GREEN: handler `hold.expire`.
- [x] 6.6 RED: cron `59 2 * * *` (UTC) transiciona a `sin registrar` los `reservado` del día no marcados, con y sin seña. → *appointment-lifecycle: Barrido diario de las 23:59*
- [x] 6.7 GREEN: job de barrido usando `ShopClock.businessDayBounds`.
- [x] 6.8 RED: turnos de un día futuro no son tocados por el barrido. → *appointment-lifecycle: Turnos futuros no son afectados por el barrido*
- [x] 6.9 GREEN: confirmar el filtro de rango en la query del barrido.
- [x] 6.10 RED: recordatorio se dispara 2h antes, web y telefónico, solo si hay email. → *notification-port: Eventos mínimos que deben notificarse*
- [x] 6.11 GREEN: job `appointment.reminder` (schedule dinámico por turno).
- [x] 6.12 RED: consumidor de `notification_outbox` entrega con reintentos y backoff; entrega exitosa marca la fila.
- [x] 6.13 GREEN: consumidor del outbox (usa `FakeNotificationPort` hasta Fase 7).

Requisitos que cierra: **appointment-lifecycle** (2/4 restantes: Barrido diario de las 23:59 · Turnos futuros no son afectados). Dispara el recordatorio de **notification-port** (contenido en Fase 7).

## Phase 7: Notificaciones (~250 líneas) — PR 9 (base: PR 8) — depende de 6

- [x] 7.1 RED: el dominio invoca `NotificationPort` sin ningún detalle de transporte. → *notification-port: Puerto de notificación desacoplado del canal*
- [x] 7.2 GREEN: interfaz `NotificationPort` en `packages/domain/notifications`.
- [x] 7.3 RED: `GmailNotificationAdapter` envía por SMTP con App Password, único adaptador del MVP. → *notification-port: Adaptador de Gmail como único canal implementado en el MVP*
- [x] 7.4 GREEN: `GmailNotificationAdapter` en `packages/infrastructure`.
- [x] 7.5 RED: sustituir el adaptador por uno alternativo no requiere cambios en el dominio. → *notification-port: Intercambiar el canal no toca el dominio*
- [x] 7.6 GREEN: confirmar vía inyección de dependencias (token de puerto, no import directo).
- [x] 7.7 RED: plantillas — código/enlace de acceso, cancelación con reembolso, oferta de reasignación, recordatorio. → *notification-port: Eventos mínimos que deben notificarse*
- [x] 7.8 GREEN: implementar las cuatro plantillas, conectadas a los outbox-writers de 3a/5/6/9/10/12.
- [x] 7.9 RED: recordatorio con seña incluye "última oportunidad" y la hora exacta de corte (hora del turno − 1h). → *notification-port: El recordatorio informa la última oportunidad de cancelar*
- [x] 7.10 RED: recordatorio sin seña no menciona ninguna seña. → *notification-port: mismo requirement, rama sin seña*
- [x] 7.11 GREEN: plantilla condicional de recordatorio según `DepositState`.

Requisitos que cierra: **notification-port** (5/5: Puerto desacoplado · Adaptador de Gmail · Intercambiar el canal no toca el dominio · Eventos mínimos · El recordatorio informa la última oportunidad).

## Phase 8: Vista del día (~400 líneas) — PR 10 (base: PR 9) — depende de 1, 3b

- [ ] 8.1 RED: `DayBoard` organism recibe `columns`, `slots`, `onSlotAction` y renderiza sin conocer el rol.
- [ ] 8.2 GREEN: implementar `DayBoard` (`apps/web/src/agenda`) puramente presentacional.
- [ ] 8.3 RED: endpoint del día devuelve `allowedActions` por slot, calculado en el servidor según `ActorContext`.
- [ ] 8.4 GREEN: `GetDayBoardUseCase` con cálculo de `allowedActions`.
- [ ] 8.5 RED: vista admin muestra una columna por barbero, con turnos, nombre y edad del cliente si está cargada. → *admin-operations: Vista del día por columnas de barbero*
- [ ] 8.6 GREEN: `AdminDayBoardContainer` (todas las columnas).
- [ ] 8.7 RED: endpoint del día respeta el estrechamiento por `barber_id` para el actor barbero (reutiliza 3b.7).
- [ ] 8.8 GREEN: confirmar que `GetDayBoardUseCase` delega el filtro al repositorio.

Requisitos que cierra: **admin-operations** (1/7: Vista del día por columnas de barbero). Componente base para Fases 9 y 11.

## Phase 9: Web pública (~400 líneas) — PR 11 (base: PR 10) — depende de 5, 8

- [ ] 9.1 RED: visitante consulta horarios disponibles sin autenticarse. → *client-booking: Exploración sin cuenta*
- [ ] 9.2 GREEN: endpoint público de disponibilidad + página de selección de servicio/barbero/horario.
- [ ] 9.3 RED: seleccionar un horario crea un hold (reutiliza 2.8) y lo muestra con cuenta regresiva.
- [ ] 9.4 GREEN: flujo de selección en `apps/web/src/booking`.
- [ ] 9.5 RED: confirmación sin nombre, teléfono o email es rechazada, no crea turno ni cobra la seña. → *client-booking: Intento de confirmar sin los datos obligatorios*
- [ ] 9.6 GREEN: formulario de cuenta al final del flujo con validación zod compartida (`packages/contracts`).
- [ ] 9.7 RED: confirmar la reserva crea la cuenta sin contraseña, sin solicitar/almacenar contraseña. → *client-booking: Cuenta sin contraseña creada al final del flujo*
- [ ] 9.8 GREEN: `RegisterClientUseCase` (usa 3a.8).
- [ ] 9.9 RED: código de acceso vencido es rechazado, exige nueva solicitud. → *client-booking: Código de acceso vencido*
- [ ] 9.10 GREEN: flujo de reintento en el frontend.
- [ ] 9.11 RED: checkout cobra el 50% y el turno pasa a `reservado` solo si el cobro fue exitoso. → *client-booking: Reserva web con seña obligatoria del 50%*
- [ ] 9.12 GREEN: conectar el frontend a `CheckoutUseCase` (5.6) y a la confirmación por webhook.
- [ ] 9.13 RED: cancelación propia con más de 1h de anticipación → `cancelado` + reembolso automático. → *client-booking: Cancelación del cliente con reembolso automático*
- [ ] 9.14 RED: cancelación con menos de 1h de anticipación → rechazada. → *client-booking: Intento de cancelación fuera de la ventana permitida*
- [ ] 9.15 GREEN: `SelfCancelUseCase` con ventana de 1h vía `ShopClock`.
- [ ] 9.16 RED: cliente autenticado no puede cancelar el turno de otra cuenta. → *client-booking: El cliente solo actúa sobre sus propios datos*
- [ ] 9.17 GREEN: aplicar `ActorContext` (clientId) al `SelfCancelUseCase` reutilizando el guard de 3b.

Requisitos que cierra: **client-booking** (5/5: Exploración sin cuenta · Cuenta sin contraseña creada al final del flujo · Reserva web con seña obligatoria del 50% · Cancelación del cliente con reembolso automático · El cliente solo actúa sobre sus propios datos).

## Phase 10: Operación del panel (~400 líneas) — PR 12 (base: PR 11) — depende de 8

- [ ] 10.1 RED: personal autorizado crea turno telefónico en `reservado` sin seña; nombre+teléfono obligatorios, email/edad opcionales. → *admin-operations: Creación de turnos telefónicos sin seña*
- [ ] 10.2 GREEN: `CreatePhoneAppointmentUseCase` + formulario del panel.
- [ ] 10.3 RED: turno telefónico sin email se crea igual, sin bloqueo. → *admin-operations: Turno telefónico creado sin email*
- [ ] 10.4 RED: cliente sin email no recibe recordatorio ni puede pedir acceso web. → *admin-operations: Consecuencias de un turno telefónico sin email*
- [ ] 10.5 GREEN: confirmar ambas ramas contra 6.11 (recordatorio) y 3a.8/9.7 (acceso).
- [ ] 10.6 RED: edición de servicio/barbero/horario de cualquier turno por personal autorizado. → *admin-operations: Edición y cancelación administrativa*
- [ ] 10.7 RED: cancelación administrativa reembolsa si hay seña, no hace nada si no la hay.
- [ ] 10.8 GREEN: `EditAppointmentUseCase` + `AdminCancelUseCase`.
- [ ] 10.9 RED: marcar `realizado` cualquier turno, independientemente del barbero asignado. → *admin-operations: Marcado de realizados y resolución de pendientes*
- [ ] 10.10 RED: resolver `sin registrar` a `realizado`/`ausente`, con y sin seña, registrando el historial de ausencias.
- [ ] 10.11 GREEN: conectar el panel a `MarkCompletedUseCase`/`ConfirmAbsenceUseCase` (4.6/4.8) sin restricción de barbero.
- [ ] 10.12 RED: walk-in se crea directamente en `realizado`, sin seña, y el horario deja de figurar disponible. → *admin-operations: Carga de walk-ins · appointment-lifecycle: Los walk-ins ingresan directamente como realizado*
- [ ] 10.13 GREEN: `CreateWalkInUseCase` ocupa el hueco vía `slot_occupancies` con `status='realizado'`.
- [ ] 10.14 RED: alta de un barbero con horario base lo deja disponible para asignación. → *admin-operations: Gestión de clientes y de barberos*
- [ ] 10.15 GREEN: `ManageClientsAndBarbersUseCase` (CRUD clientes, alta/baja barberos, configuración de horarios/precios), acotado por permisos de 3b.

Requisitos que cierra: **admin-operations** (6/7 restantes) + **appointment-lifecycle** (1/4 restante: Los walk-ins ingresan directamente como realizado). Todos los 40 requirements quedan mapeados con esta fase.

## Phase 11: Perfil del barbero (~300 líneas) — PR 13 (base: PR 12) — depende de 8, 10

- [ ] 11.1 RED: `BarberDayBoardContainer` filtra `DayBoard` a la columna del barbero autenticado. → *barber-profile: Agenda propia filtrada*
- [ ] 11.2 GREEN: implementar `BarberDayBoardContainer` reutilizando `DayBoard` (8.2) y el endpoint estrechado (8.7).
- [ ] 11.3 RED: barbero consultando la agenda de un colega es rechazado. → *barber-profile: Barbero no accede a la agenda de un colega*
- [ ] 11.4 GREEN: confirmar el rechazo vía guard de 3b (reutiliza 3b.6).
- [ ] 11.5 RED: conteo de `realizado` propios por día/mes/período, sin otros barberos. → *barber-profile: Estadísticas de cortes propios*
- [ ] 11.6 GREEN: `GetOwnStatsUseCase`.
- [ ] 11.7 RED: facturación propia por precio de lista, etiquetada explícitamente (no ganancia ni cobro efectivo), sin acceso a la del local ni de otros. → *barber-profile: Facturación teórica por precio de lista*
- [ ] 11.8 GREEN: `GetOwnRevenueUseCase` + etiqueta en la UI.
- [ ] 11.9 RED: barbero viendo facturación del local o de otro barbero es rechazado. → *barber-profile: Barbero no accede a la facturación del local*
- [ ] 11.10 GREEN: confirmar el guard de permiso `finance:read:own` vs `finance:read:shop`.
- [ ] 11.11 RED: barbero marca su propio turno `realizado` y resuelve su propio `sin registrar`. → *barber-profile: Resolución de los turnos propios*
- [ ] 11.12 RED: barbero intentando resolver el turno de un colega es rechazado. → *barber-profile: Barbero intenta resolver el turno de un colega*
- [ ] 11.13 GREEN: acotar `MarkCompletedUseCase`/`ConfirmAbsenceUseCase` con `barberId = actor.barberId` cuando el rol es barbero.

Requisitos que cierra: **barber-profile** (4/4: Agenda propia filtrada · Estadísticas de cortes propios · Facturación teórica por precio de lista · Resolución de los turnos propios).

## Phase 12: Reasignación por ausencia (~350 líneas) — PR 14 (base: PR 13, última del tracker) — depende de 2, 6, 7, 10

- [ ] 12.1 RED: marcar un barbero no disponible identifica todos sus turnos `reservado` de la franja. → *barber-absence-reassignment: Detección de turnos afectados*
- [ ] 12.2 GREEN: `MarkBarberAbsentUseCase` (permiso `barber:mark-absent`, reutiliza 3b).
- [ ] 12.3 RED: por cada turno afectado se buscan huecos libres del mismo día de cualquier barbero y se crea un hold con `origin_occupancy_id`. → *barber-absence-reassignment: Ofertas del mismo día, de cualquier barbero*
- [ ] 12.4 GREEN: generación de ofertas reutilizando `CreateHold` (2.8) con scope `same-day`.
- [ ] 12.5 RED: se despacha notificación con las opciones del día vía `notification_outbox`.
- [ ] 12.6 GREEN: conectar la generación de ofertas al outbox (7.7 plantilla de oferta).
- [ ] 12.7 RED: aceptar una oferta con hold activo re-valida y reasigna el turno original (mueve `barber_id`/`time_range`), conserva `deposit_id`, sin cobro ni reembolso nuevo. → *barber-absence-reassignment: Aceptación reagenda sin mover dinero*
- [ ] 12.8 GREEN: `AcceptOfferUseCase` como `UPDATE` del turno original, no INSERT/DELETE.
- [ ] 12.9 RED: rechazo explícito con seña cancela el turno original y dispara reembolso automático. → *barber-absence-reassignment: Rechazo o falta de respuesta cancela el turno original*
- [ ] 12.10 RED: no responder en 15 min (vía `hold.expire` con `origin_occupancy_id`) cancela sin seña, sin reembolso.
- [ ] 12.11 GREEN: `RejectOfferUseCase` + extender el handler `hold.expire` (6.5) para la rama con `origin_occupancy_id`.
- [ ] 12.12 RED: turnos `reservado` de otros clientes en la misma franja, con barberos no afectados, permanecen intactos. → *barber-absence-reassignment: No interferencia con otros turnos*
- [ ] 12.13 GREEN: confirmar el alcance de la query de detección (12.1) y de la generación de ofertas (12.3) contra 12.12.

Requisitos que cierra: **barber-absence-reassignment** (5/5: Detección de turnos afectados · Ofertas del mismo día, de cualquier barbero · Aceptación reagenda sin mover dinero · Rechazo o falta de respuesta cancela el turno original · No interferencia con otros turnos).

---

## Traceability Summary — 40/40 requirements mapeados

| Domain | Requirement | Phase |
|---|---|---|
| appointment-lifecycle | Cinco estados explícitos y no colapsables | 4 |
| appointment-lifecycle | El sistema nunca marca ausencias por su cuenta | 4 |
| appointment-lifecycle | Barrido diario de las 23:59 en horario fijo de Argentina | 6 |
| appointment-lifecycle | Los walk-ins ingresan directamente como realizado | 10 |
| barber-absence-reassignment | Detección de turnos afectados | 12 |
| barber-absence-reassignment | Ofertas del mismo día, de cualquier barbero | 12 |
| barber-absence-reassignment | Aceptación reagenda sin mover dinero | 12 |
| barber-absence-reassignment | Rechazo o falta de respuesta cancela el turno original | 12 |
| barber-absence-reassignment | No interferencia con otros turnos | 12 |
| barber-profile | Agenda propia filtrada | 11 |
| barber-profile | Estadísticas de cortes propios | 11 |
| barber-profile | Facturación teórica por precio de lista | 11 |
| barber-profile | Resolución de los turnos propios | 11 |
| access-control | Autenticación diferenciada según tipo de usuario | 3a |
| access-control | Contraseñas del personal almacenadas de forma segura | 3a |
| access-control | Tres roles con aplicación en el backend | 3b |
| access-control | Matriz de permisos por rol | 3b |
| access-control | El barbero queda acotado a sus propios datos | 3b |
| access-control | Permisos de secretaria ajustables sin cambio de código | 3b |
| notification-port | Puerto de notificación desacoplado del canal | 7 |
| notification-port | Adaptador de Gmail como único canal implementado en el MVP | 7 |
| notification-port | Intercambiar el canal no toca el dominio | 7 |
| notification-port | Eventos mínimos que deben notificarse | 7 |
| notification-port | El recordatorio informa la última oportunidad de cancelar | 7 |
| admin-operations | Creación de turnos telefónicos sin seña | 10 |
| admin-operations | Consecuencias de un turno telefónico sin email | 10 |
| admin-operations | Edición y cancelación administrativa | 10 |
| admin-operations | Marcado de realizados y resolución de pendientes | 10 |
| admin-operations | Carga de walk-ins | 10 |
| admin-operations | Gestión de clientes y de barberos | 10 |
| admin-operations | Vista del día por columnas de barbero | 8 |
| slot-hold | Creación del hold al ofrecer o seleccionar un horario | 2 |
| slot-hold | Exclusividad del horario retenido | 2 |
| slot-hold | Expiración automática y liberación del horario | 2 (perezoso) + 6 (job) |
| slot-hold | Re-validación inmediatamente antes de confirmar | 2 |
| client-booking | Exploración sin cuenta | 9 |
| client-booking | Cuenta sin contraseña creada al final del flujo | 9 (mecanismo en 3a) |
| client-booking | Reserva web con seña obligatoria del 50% | 9 (pagos en 5) |
| client-booking | Cancelación del cliente con reembolso automático | 9 (pagos en 5) |
| client-booking | El cliente solo actúa sobre sus propios datos | 9 |

**Requirements sin ubicación**: ninguno. Los 40 quedan cubiertos por al menos una tarea explícita.

---

## Matriz de amenazas — cobertura de RED tests

| Frontera aplicable | RED tests planificados | Tareas |
|---|---|---|
| Webhook público de MercadoPago | Firma inválida → 401, cero efectos · reintento del mismo `payment_id` → cero filas · payload `approved` falsificado sin firma → rechazado | 5.7, 5.11, 5.13 |
| Endpoints autenticados | Handler sin decorador → 403 · barbero pidiendo agenda de un compañero → 403 · barbero pidiendo facturación del local → 403 | 3b.4, 3b.6, 3b.8 |

Las demás filas de la matriz del diseño están marcadas `N/A` y no generan tareas.
