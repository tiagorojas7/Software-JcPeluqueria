/**
 * The four stretches of the public booking flow, in order. Named after the
 * state `BookingPage` is actually in rather than after screens, because
 * they all happen on the same URL — the page swaps what it shows as the
 * reservation advances, and without this a visitor has no way to tell how
 * much is left or why the screen changed on its own.
 */
export const BOOKING_STEPS = [
  { id: 'buscar', label: 'Servicio, barbero y fecha' },
  { id: 'horario', label: 'Horario' },
  { id: 'datos', label: 'Tus datos' },
  { id: 'pagar', label: 'Confirmar y pagar' },
] as const;

export type BookingStepId = (typeof BOOKING_STEPS)[number]['id'];

export interface BookingStepsProps {
  readonly current: BookingStepId;
}

/**
 * Pure presentational progress indicator — it never decides which step the
 * flow is on, it only draws the one it is handed, the same
 * container/presentational split every other booking component follows.
 *
 * `data-state` carries done/current/todo as data rather than only as a
 * colour, so the three are distinguishable without colour vision and the
 * distinction is assertable in a test. `aria-current="step"` is what
 * announces the position to a screen reader.
 */
export function BookingSteps({ current }: BookingStepsProps) {
  const currentIndex = BOOKING_STEPS.findIndex((step) => step.id === current);

  return (
    <ol className="booking-steps" aria-label="Progreso de la reserva">
      {BOOKING_STEPS.map((step, index) => {
        const state = index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'todo';

        return (
          <li
            key={step.id}
            className="booking-steps__step"
            data-state={state}
            aria-current={state === 'current' ? 'step' : undefined}
          >
            <span className="booking-steps__marker" aria-hidden="true">
              {state === 'done' ? (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                index + 1
              )}
            </span>
            <span className="booking-steps__label">{step.label}</span>
          </li>
        );
      })}
    </ol>
  );
}
