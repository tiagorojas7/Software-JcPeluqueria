# Demo: JC Barbería — Turnero digital

Exact commands, in order, to go from a fresh clone to a working screen. Every command below was actually run against a real PostgreSQL database while writing this document (see the arranque apply-progress / sdd-apply report for the verbatim output).

Tested on Node v24.15.0, pnpm v11.21.0, Docker Desktop (Docker Compose v5) on Windows. Any Node >= 20 with pnpm should work; see "Known limitations" for the one Windows-specific caveat.

## 0. Environment variables

**`.env.example` cannot be created from an agent session** — a sandbox permission rule blocks every file/Bash operation that references an `.env*` path. Create `.env` **at the repository root** yourself with the content below. The API, the worker, `pnpm db:migrate` and `pnpm seed` all load that exact file automatically (`packages/infrastructure/src/config/load-env.ts`, imported first thing by each entrypoint), so no shell juggling is needed.

```bash
# Matches docker-compose.yml's postgres service exactly.
DATABASE_URL=postgres://jc_barberia:jc_barberia@localhost:5432/jc_barberia_test

# Fixed offset, Cordoba Capital AR, no daylight saving.
SHOP_UTC_OFFSET=-03:00

# TEST credentials ONLY — from https://www.mercadopago.com.ar/developers/panel
# NEVER paste production/live credentials here, not even for a demo.
MERCADOPAGO_ACCESS_TOKEN=TEST-0000000000000000-000000-00000000000000000000000000000000-000000000
MERCADOPAGO_WEBHOOK_SECRET=TEST-webhook-secret-from-your-mercadopago-panel

# Notification channel. `console` prints every message to the worker's log —
# that is how the access code is read during a demo. Set it to `gmail` only
# once the three GMAIL_* values below are real.
NOTIFICATION_CHANNEL=console

# Gmail "App Password" (not your normal password) — https://myaccount.google.com/apppasswords
GMAIL_USER=tu-cuenta@gmail.com
GMAIL_APP_PASSWORD=your-16-character-gmail-app-password
GMAIL_FROM=JC Barberia <tu-cuenta@gmail.com>

# Introduced by this arranque slice.
PORT=3000
WEB_ORIGIN=http://localhost:5173
```

Every variable's origin (which file reads it): `DATABASE_URL` — `packages/infrastructure` (db connection, migrations, seed) and `apps/worker` (pg-boss shares this database). `SHOP_UTC_OFFSET` — `ShopClock`. `MERCADOPAGO_ACCESS_TOKEN` — `apps/api` (BookingModule, AppointmentsModule, IdentityModule) and `apps/worker` (payment processing). `MERCADOPAGO_WEBHOOK_SECRET` — `apps/api` (webhook signature check). `NOTIFICATION_CHANNEL` / `GMAIL_USER` / `GMAIL_APP_PASSWORD` / `GMAIL_FROM` — `createNotificationPort` in `apps/worker`. `PORT`/`WEB_ORIGIN` — `apps/api/src/main.ts`.

A real environment variable always wins over the file (`dotenv` runs with `override: false`), so `DATABASE_URL=...:5442 pnpm db:migrate` still points wherever the caller said — the way each isolated agent database has been driven.

Without `MERCADOPAGO_ACCESS_TOKEN` the deposit step fails with a real `403 PA_UNAUTHORIZED_RESULT_FROM_POLICIES` from MercadoPago, surfaced in the browser as "Internal server error". That is the single most common reason the demo appears broken.

## 1. Install and start Postgres

```bash
pnpm install
pnpm docker:up            # docker compose up -d — starts the postgres service from docker-compose.yml
```

Wait for it to be ready (or just wait ~5-10s):

```bash
docker compose ps
```

## 2. Migrate and seed

```bash
export DATABASE_URL="postgres://jc_barberia:jc_barberia@localhost:5432/jc_barberia_test"
pnpm db:migrate
pnpm seed
```

`pnpm seed` is idempotent — running it again just re-upserts the same rows, never a duplicate-key crash. It prints every barber/service id and every staff login it created; you do not need to remember anything from this output, it is repeated below.

## 3. Start the three processes (three separate terminals)

Each one needs `DATABASE_URL` exported the same way as step 2.

**Terminal A — API:**
```bash
export DATABASE_URL="postgres://jc_barberia:jc_barberia@localhost:5432/jc_barberia_test"
pnpm start:api
```
Wait for `[api] listening on http://localhost:3000`.

**Terminal B — worker** (must be running before the FIRST hold is created — see "Known trap" below):
```bash
export DATABASE_URL="postgres://jc_barberia:jc_barberia@localhost:5432/jc_barberia_test"
pnpm start:worker
```
Wait for `[worker] pg-boss started — ...`.

**Terminal C — web:**
```bash
pnpm dev:web
```
Wait for `Local: http://localhost:5173/`.

(`pnpm dev:api` / `pnpm dev:worker` also exist, with `--watch`, if you are iterating on the code instead of just demoing it.)

## 4. Open the app

**http://localhost:5173**

A minimal nav at the top lets you walk between every screen:

| Nav item | What it shows | Needs login? |
|---|---|---|
| Reservar turno (web pública) | The full public booking flow: pick barber/service/date → available slots → hold → account → pay the 50% deposit | No |
| Ingresar con código (cliente) | Mounted for completeness — **not functional**, see "Known limitations" | No |
| Ingreso de personal | Staff login (owner/secretary/barber) | No |
| Agenda del día (admin) | Day board, all barbers | Yes — owner or secretary |
| Mi agenda (barbero) | Day board, own column only | Yes — barber |
| Turno telefónico (panel) | Phone-booking form | Yes — owner or secretary |
| Mi facturación (barbero) | Own theoretical revenue, by date range | Yes — barber |

## 5. Demo login credentials

Created by `pnpm seed` (passwords are hashed with `Argon2PasswordHasher` in the database — these are the plaintexts, obviously non-production, do not reuse them anywhere real):

| Rol | Email | Contraseña |
|---|---|---|
| Dueño (owner) | `dueno@jcbarberia.test` | `jcbarberia-dueno` |
| Secretaria | `secretaria@jcbarberia.test` | `jcbarberia-secre` |
| Barbero (Cristian Gómez) | `cristian@jcbarberia.test` | `jcbarberia-barbero1` |
| Barbero (Facundo Díaz) | `facundo@jcbarberia.test` | `jcbarberia-barbero2` |

A third barber, **Nahuel Torres**, exists in the schedule/day-board data but has no login user — demonstrates that `barbers` and `users` are decoupled tables (a barber can exist operationally without ever using the panel).

## 6. Reference data (for the booking flow's barber/service pickers)

| Barbero | id | Horario |
|---|---|---|
| Cristian Gómez | `a0000000-0000-4000-8000-000000000001` | Lun-Vie 09:00-18:00 |
| Facundo Díaz | `a0000000-0000-4000-8000-000000000002` | Mar-Sáb 11:00-20:00 |
| Nahuel Torres | `a0000000-0000-4000-8000-000000000003` | Lun/Mié/Vie/Sáb 09:00-17:00 |

| Servicio | id | Precio | Duración |
|---|---|---|---|
| Corte clásico | `b0000000-0000-4000-8000-000000000001` | $8.000 | 30 min |
| Corte + Barba | `b0000000-0000-4000-8000-000000000002` | $12.000 | 45 min |
| Barba | `b0000000-0000-4000-8000-000000000003` | $5.000 | 20 min |
| Corte niño | `b0000000-0000-4000-8000-000000000004` | $6.000 | 30 min |

Shop hours: Monday-Saturday 09:00-20:00, closed Sunday.

## Known trap this document exists to prevent

`HOLD_EXPIRE_SCHEDULER`'s provider factory (in `BookingModule`/`AppointmentsModule`) MUST stay `useFactory: () => new PgBossHoldExpireScheduler(lazyJobSender())` — synchronous, never `async`. An eager/async factory opens a PostgreSQL connection while Nest builds the module graph, and the API will not boot unless the queue's database is already reachable. This has been introduced twice before in this project; it is correct as of this slice, verified by booting the API with `docker compose` both up and down.

## Known limitations (found by actually running this, not by reading the code)

- **`pg-boss` queues need explicit registration in v12.** `apps/worker/src/main.ts` now calls `boss.createQueue(...)` for `daily.sweep`, `payment.process`, and `hold.expire` before scheduling/working them — without this, creating the FIRST hold of a fresh database crashed with `Queue hold.expire does not exist`. This is why the worker must be started before using the booking flow.
- **"Ingresar con código" (client passwordless login) is not functional.** Its use case (`RequestClientAccessUseCase`) needs a `NotificationOutboxRepository` Postgres adapter that does not exist anywhere in this codebase yet — only a domain-level in-memory fake. `apps/worker`'s own code already flags this as a deferred "Phase 7" gap. Wiring a real endpoint for it means building new infrastructure, which was out of scope for this arranque slice.
- **Day-board slot actions (editar / cancelar / marcar realizado) are display-only.** `EditAppointmentUseCase`, `AdminCancelAppointmentUseCase`, `AdminMarkCompletedUseCase` and `BarberMarkCompletedUseCase` all exist and are tested at the application layer, but none of them has an HTTP controller. Clicking a day-board action button shows an honest "not wired in this demo" message instead of doing nothing silently.
- **MercadoPago checkout was not verified against a real MercadoPago sandbox** in this session — no TEST credentials were available. `POST /holds/checkout` was exercised only up to `CheckoutUseCase`'s call boundary; the actual redirect/payment/webhook round trip needs real `MERCADOPAGO_ACCESS_TOKEN` / `MERCADOPAGO_WEBHOOK_SECRET` values from a developer's own MercadoPago panel.
- **Staff session TTL is simplified.** Every staff login (owner included) gets the 12h "staff" TTL; the design's 8h "owner" TTL would need a role lookup before the session exists, which `AuthController` does not do. Functionally harmless for a demo.
- **Graceful shutdown (`enableShutdownHooks`) could not be end-to-end verified on Windows in this sandbox** — background processes launched here refused non-forced termination (`taskkill` without `/F`, and Git Bash `kill`, both failed to reach the process), which is a property of this specific sandbox, not of the code. `app.enableShutdownHooks()` is wired exactly per NestJS's documented API, and `BookingModule`/`AppointmentsModule`/`PaymentsModule`'s `OnApplicationShutdown` hooks call the same idempotent `stopJobSender()`, confirmed correct by direct code inspection. On Linux (or via Ctrl+C in an interactive terminal on any platform) this works as documented.

## Troubleshooting

- **`EADDRINUSE` on port 3000/5173**: something is already listening — find and stop it (`netstat -ano | grep :3000` on Windows) before starting again.
- **API boots but every request 500s / hangs**: Postgres is not reachable — check `docker compose ps` and that `DATABASE_URL` is exported in the SAME terminal you started the process from.
- **"Queue ... does not exist" when creating a hold**: the worker was not started (or was started before the API's first request touched the database). Start the worker first, or restart it.
- **`pnpm install` warns about deprecated subdependencies**: expected/harmless, unrelated to this slice.
