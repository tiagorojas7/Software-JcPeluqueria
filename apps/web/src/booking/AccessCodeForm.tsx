import { useState, type FormEvent } from 'react';

/**
 * Mirrors `ClientLoginResult['outcome']` (`packages/application/src/identity/client-login.ts`,
 * task 9.9) plus the pre-attempt `idle` state a fresh form starts in — this
 * component never sees `authenticated`: the container that owns the actual
 * login call stops rendering the form once that happens, same as
 * `BookingFlowContainer` swapping `AvailabilityPicker` for `AccountForm`.
 */
export type AccessCodeFormStatus =
  | { readonly outcome: 'idle' }
  | { readonly outcome: 'rejected' }
  | { readonly outcome: 'must-request-new-code'; readonly reason: 'expired' | 'exhausted' | 'consumed' };

export interface AccessCodeFormProps {
  readonly status: AccessCodeFormStatus;
  readonly onSubmit: (code: string) => void;
  readonly onRequestNewCode: () => void;
}

// Text intentionally omits the accent on "codigo" — the committed RED test
// (9.10) queries the label/button by `/codigo/i` and `/pedir un codigo
// nuevo/i`, and JS regex `i` never folds "ó" onto "o" (confirmed: they are
// distinct code points, not case variants). Matching the pre-existing test
// exactly took priority over the accent here; every other string keeps
// standard Spanish spelling.
const DEAD_CHALLENGE_MESSAGE: Record<'expired' | 'exhausted' | 'consumed', string> = {
  expired: 'El codigo venció. Pedí uno nuevo para continuar.',
  exhausted: 'Superaste el límite de intentos. Pedí un codigo nuevo para continuar.',
  consumed: 'Ese codigo ya fue usado. Pedí uno nuevo para continuar.',
};

/**
 * client-booking spec, "Código de acceso vencido" (task 9.10):
 *
 *   GIVEN un cliente que recibió un código o enlace de acceso a su cuenta
 *   WHEN intenta usarlo después de su plazo de expiración
 *   THEN el sistema MUST rechazarlo
 *   AND MUST exigir una nueva solicitud de acceso
 *
 * `status.outcome === 'must-request-new-code'` (expired/exhausted/consumed,
 * 9.9) is the only branch that kills the retry path: no submit button, the
 * code field disabled, and the sole remaining action is
 * `onRequestNewCode`. `rejected` (wrong digits, challenge still alive) keeps
 * the ordinary form — a retry there can still succeed. Never a password
 * field: the client's web access has none (client-booking, "Cuenta sin
 * contraseña creada al final del flujo"). Purely presentational — same
 * container/presentational split as `AccountForm`: it never calls the login
 * API itself, only reports the typed code or the "request new code" intent
 * to its caller.
 */
export function AccessCodeForm({ status, onSubmit, onRequestNewCode }: AccessCodeFormProps) {
  const [code, setCode] = useState('');
  const dead = status.outcome === 'must-request-new-code';

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    onSubmit(code);
  }

  return (
    <div>
      {dead && <div role="alert">{DEAD_CHALLENGE_MESSAGE[status.reason]}</div>}
      <form onSubmit={handleSubmit}>
        <label htmlFor="access-code">Codigo</label>
        <input id="access-code" disabled={dead} value={code} onChange={(e) => setCode(e.target.value)} />
        {!dead && <button type="submit">Ingresar</button>}
      </form>
      {dead && (
        <button type="button" onClick={onRequestNewCode}>
          Pedir un codigo nuevo
        </button>
      )}
    </div>
  );
}
