import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { RouterProvider } from '../shared/router';
import { PanelLayout } from './PanelLayout';

const OWNER = { userId: 'u1', role: 'owner' as const, barberId: null };
const SECRETARY = { userId: 'u2', role: 'secretary' as const, barberId: null };
const BARBER = { userId: 'u3', role: 'barber' as const, barberId: 'b1' };

function renderPanel(actor: typeof OWNER | typeof SECRETARY | typeof BARBER, pathname = '/panel') {
  window.history.pushState({}, '', pathname);
  const onLogout = vi.fn();
  render(
    <RouterProvider>
      <PanelLayout actor={actor} onLogout={onLogout}>
        <p>contenido de la pantalla</p>
      </PanelLayout>
    </RouterProvider>,
  );
  return { onLogout };
}

// D.3 RED — the nav a human actually sees, built ONLY from
// `visiblePanelNavItems` (already unit-tested on its own): this spec is the
// integration proof that PanelLayout does not reintroduce a per-role branch
// on top of it.

describe('PanelLayout (D.3)', () => {
  it('el dueno ve la navegacion completa, incluida facturacion del local y gestion', () => {
    renderPanel(OWNER);

    expect(screen.getByRole('link', { name: 'Agenda del día' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Turno telefónico' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Gestión' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Facturación del local' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Mi facturación' })).toBeNull();
  });

  it('la secretaria no ve plata ni facturacion del local en su navegacion', () => {
    renderPanel(SECRETARY);

    expect(screen.getByRole('link', { name: 'Agenda del día' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Turno telefónico' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Gestión' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Facturación del local' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Mi facturación' })).toBeNull();
  });

  it('el barbero solo ve su agenda y su propia facturacion, nunca gestion ni la del local', () => {
    renderPanel(BARBER);

    expect(screen.getByRole('link', { name: 'Agenda del día' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Mi facturación' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Turno telefónico' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Gestión' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Facturación del local' })).toBeNull();
  });

  it('marca la ruta activa con aria-current', () => {
    renderPanel(OWNER, '/panel/gestion');

    expect(screen.getByRole('link', { name: 'Gestión' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Agenda del día' })).not.toHaveAttribute('aria-current');
  });

  it('el boton de salir dispara el logout que le paso la pagina', () => {
    const { onLogout } = renderPanel(OWNER);

    fireEvent.click(screen.getByRole('button', { name: /salir/i }));

    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it('muestra el contenido de la pantalla actual', () => {
    renderPanel(BARBER);

    expect(screen.getByText('contenido de la pantalla')).toBeInTheDocument();
  });
});
