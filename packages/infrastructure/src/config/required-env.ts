/**
 * Boot-time check for the environment variables whose absence is otherwise
 * invisible until a customer is already mid-transaction.
 *
 * `MERCADOPAGO_ACCESS_TOKEN ?? ''` is spread across six composition roots
 * (`apps/api`'s four modules, `apps/worker`, and the payment adapter's own
 * default). With an empty token the process boots perfectly and every
 * deposit comes back `403 PA_UNAUTHORIZED_RESULT_FROM_POLICIES` — this
 * project already lost a session to exactly that. A deploy that relies on
 * real environment variables instead of `.env` and forgets one deserves to
 * find out at startup, not from the first person trying to pay.
 *
 * Split into a pure `missingRequiredEnv` (testable, no process state) and
 * the `assertRequiredEnv` wrapper the entrypoints actually call.
 */
export function missingRequiredEnv(
  names: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): string[] {
  return names.filter((name) => (env[name] ?? '').trim() === '');
}

/** Throws listing EVERY missing variable at once — a deploy fixing them one
 *  restart at a time is its own kind of outage. */
export function assertRequiredEnv(
  names: readonly string[],
  env: Readonly<Record<string, string | undefined>> = process.env,
): void {
  const missing = missingRequiredEnv(names, env);
  if (missing.length > 0) {
    throw new Error(
      `Faltan variables de entorno obligatorias: ${missing.join(', ')}. ` +
        'Revisá el .env de la raíz del repositorio o el entorno del proceso.',
    );
  }
}
