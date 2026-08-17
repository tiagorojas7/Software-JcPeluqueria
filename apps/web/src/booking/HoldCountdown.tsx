export interface HoldCountdownProps {
  /** ISO instant the hold expires at — `HoldResponse.expiresAt`, verbatim. */
  readonly expiresAt: string;
  /**
   * The current instant, in epoch milliseconds, supplied by the caller.
   * Deliberately a prop, never computed in here: the `no-restricted-syntax`
   * ESLint rule confines `Date.now()`/`new Date()` to `ShopClock`/`FakeClock`
   * repo-wide, and nothing about a ticking display needs to violate that —
   * whichever page composes this component is the one place expected to
   * re-render it periodically with a fresh `nowMs`.
   */
  readonly nowMs: number;
}

function formatRemaining(remainingMs: number): string {
  const totalSeconds = Math.floor(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * slot-hold spec, "Creación del hold" (task 9.3/9.4): displays the hold's
 * remaining time. `Date.parse` (unlike `new Date(...)`) is not restricted by
 * the shared Clock-only rule — it returns a plain number, never a `Date`
 * instance — so converting the wire-format ISO `expiresAt` into a comparable
 * instant here does not need the `Clock` port.
 */
export function HoldCountdown({ expiresAt, nowMs }: HoldCountdownProps) {
  const remainingMs = Date.parse(expiresAt) - nowMs;

  if (remainingMs <= 0) {
    return <p role="status">El horario retenido está vencido — elegí otro horario.</p>;
  }

  return (
    <p role="timer" aria-label="Tiempo restante para completar la reserva">
      {formatRemaining(remainingMs)}
    </p>
  );
}
