// FIRST import, deliberately: `AppModule` reads `process.env` while its own
// providers are being constructed (the MercadoPago adapter, the db pool), and
// ES modules evaluate in import order.
import '@jc-barberia/infrastructure/env';
import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';

import { AppModule } from './app.module';

/**
 * The API's real, listening entrypoint — the piece `app.module.ts`'s own
 * doc comment said a later phase would add ("Deliberately no `main.ts`
 * yet"). Everything wired below already existed and was already tested;
 * this function is composition, not new business logic.
 *
 * `cookie-parser` is mounted globally rather than per-route:
 * `ActorContextMiddleware` reads `req.headers.cookie` directly today and
 * does not need it, but `AuthController`'s `res.cookie(...)` call (and any
 * future handler wanting `req.cookies`) needs the platform's cookie
 * machinery actually installed — Express does not parse cookies on its own.
 *
 * `enableShutdownHooks()` is not optional. `BookingModule`,
 * `AppointmentsModule` and `PaymentsModule` all implement
 * `OnApplicationShutdown` to close the shared pg-boss connection pool
 * (`stopJobSender()`, idempotent across the three). Without this call Nest
 * never invokes those hooks and the process hangs on SIGTERM/SIGINT forever
 * — this is the exact trap already hit twice with `HOLD_EXPIRE_SCHEDULER`'s
 * eager-vs-lazy factory, just at shutdown instead of at boot.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  app.use(cookieParser());

  // The web dev server (Vite, default port 5173) proxies `/auth`,
  // `/availability`, etc. to this API (see `apps/web/vite.config.ts`), so
  // the browser only ever talks to ONE origin and CORS never actually
  // engages for the demo. CORS is still enabled — explicit origin, never
  // `*`, plus `credentials: true` so the session cookie can travel — for
  // anyone hitting the API directly from a page served on a different
  // origin/port than the proxy.
  // Every API route lives under `/api`. Without a prefix the API's own
  // `@Controller('panel')` collides with the web app's `/panel` SPA route:
  // the dev proxy forwarded the page request to Nest and the browser got a
  // 404 JSON body instead of the panel. A prefix makes that class of
  // collision impossible rather than requiring the two route tables to stay
  // manually disjoint forever.
  app.setGlobalPrefix('api');

  app.enableCors({
    origin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
    credentials: true,
  });

  app.enableShutdownHooks();

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.log(`[api] listening on http://localhost:${port}`);
}

bootstrap().catch((error: unknown) => {
  console.error('[api] failed to start', error);
  process.exit(1);
});
