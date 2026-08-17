import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { HoldCountdown } from './HoldCountdown';

// slot-hold spec, "Creación del hold al ofrecer o seleccionar un horario"
// (task 9.3/9.4): once a schedule is picked, the client sees the hold with a
// countdown to its expiry — this is that display. `nowMs` is a prop, not
// read internally, so the component stays free of `Date.now()` (the
// `no-restricted-syntax` rule confines that to `ShopClock`/`FakeClock`) and
// fully deterministic under test.
describe('HoldCountdown', () => {
  it('shows the remaining minutes and seconds until the hold expires', () => {
    const nowMs = Date.parse('2026-09-07T12:00:00.000Z');
    const expiresAt = '2026-09-07T12:15:00.000Z';

    render(<HoldCountdown expiresAt={expiresAt} nowMs={nowMs} />);

    expect(screen.getByText('15:00')).toBeInTheDocument();
  });

  it('pads seconds under 10 with a leading zero', () => {
    const nowMs = Date.parse('2026-09-07T12:14:05.000Z');
    const expiresAt = '2026-09-07T12:15:00.000Z';

    render(<HoldCountdown expiresAt={expiresAt} nowMs={nowMs} />);

    expect(screen.getByText('00:55')).toBeInTheDocument();
  });

  it('shows an expired state instead of a negative countdown once time runs out', () => {
    const nowMs = Date.parse('2026-09-07T12:15:01.000Z');
    const expiresAt = '2026-09-07T12:15:00.000Z';

    render(<HoldCountdown expiresAt={expiresAt} nowMs={nowMs} />);

    expect(screen.getByText(/vencido/i)).toBeInTheDocument();
  });
});
