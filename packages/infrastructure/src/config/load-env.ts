import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from 'dotenv';

/**
 * Loads the repository-root `.env` into `process.env`.
 *
 * Every process is started through pnpm's per-package scripts, so `cwd` is
 * the package directory (`apps/api`, `packages/infrastructure`, ...), never
 * the repository root. `dotenv`'s default lookup — relative to `cwd` — finds
 * nothing in that layout, which is why `MERCADOPAGO_ACCESS_TOKEN` reached
 * the MercadoPago adapter as an empty string and every deposit came back as
 * `403 PA_UNAUTHORIZED_RESULT_FROM_POLICIES`.
 *
 * The root is found by walking up from THIS file rather than from `cwd`, so
 * the answer does not depend on who started the process or from where.
 *
 * Import this module for its side effect, and import it FIRST: several
 * modules (`db/connection.ts`, `booking/job-producer.ts`, the Nest modules
 * that build the payment adapter) read `process.env` while they are being
 * evaluated, and ES modules are evaluated in import order.
 */
function findRepoRoot(): string | null {
  let directory = dirname(fileURLToPath(import.meta.url));

  for (let depth = 0; depth < 10; depth += 1) {
    if (existsSync(join(directory, 'pnpm-workspace.yaml'))) {
      return directory;
    }
    const parent = dirname(directory);
    if (parent === directory) {
      return null;
    }
    directory = parent;
  }

  return null;
}

const repoRoot = findRepoRoot();

if (repoRoot) {
  // `override: false` (the default) keeps real environment variables ahead of
  // the file, so `DATABASE_URL=...:5442 pnpm db:migrate` still points where
  // the caller said — the way every agent-isolated Postgres has been driven.
  config({ path: join(repoRoot, '.env'), quiet: true });
}

/** The resolved repository root, or `null` when this runs from somewhere the
 *  workspace marker is not reachable (a published bundle, for instance). */
export const REPO_ROOT = repoRoot;
