import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { RouterProvider } from '../shared/router';
import { HomePage } from './HomePage';

function renderHome() {
  return render(
    <RouterProvider>
      <HomePage />
    </RouterProvider>,
  );
}

// D.2 — the landing page a visitor actually sees at `/`: a clear call to
// action into the booking flow, and enough real shop content (services,
// team, hours) that it reads as an actual business, not a debug page.

describe('HomePage (D.2)', () => {
  it('tiene un titulo principal y una llamada a la accion hacia reservar', () => {
    renderHome();

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/jc barber/i);
    expect(screen.getByRole('link', { name: /reservar/i })).toHaveAttribute('href', '/reservar');
  });

  it('muestra los servicios del local', () => {
    renderHome();

    expect(screen.getByText(/corte cl.sico/i)).toBeInTheDocument();
    expect(screen.getByText(/corte \+ barba/i)).toBeInTheDocument();
  });

  it('muestra el equipo de barberos', () => {
    renderHome();

    expect(screen.getByText(/cristian g.mez/i)).toBeInTheDocument();
  });

  it('no menciona la palabra "panel" en ningun texto visible', () => {
    const { container } = renderHome();

    expect(container.textContent?.toLowerCase()).not.toContain('panel');
  });
});
