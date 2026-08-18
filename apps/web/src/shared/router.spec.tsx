import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { Link, RouterProvider, useRouter } from './router';

// D.1 RED — the hand-rolled router every screen after this depends on: real
// paths (`/`, `/panel`, ...) via the History API, no router library added
// (this SPA had none before Slice D — see App.tsx's prior hash-based nav).
// Covers exactly what `PanelLayout`'s login-gate and every nav item need:
// reading the current path, navigating without a full reload, and reacting
// to the browser's own back/forward buttons.

function CurrentPath() {
  const { pathname } = useRouter();
  return <p>ruta: {pathname}</p>;
}

function NavigateButton({ to }: { readonly to: string }) {
  const { navigate } = useRouter();
  return (
    <button type="button" onClick={() => navigate(to)}>
      ir
    </button>
  );
}

describe('RouterProvider/useRouter (D.1)', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/');
  });

  it('arranca con el pathname real del navegador', () => {
    window.history.pushState({}, '', '/panel');

    render(
      <RouterProvider>
        <CurrentPath />
      </RouterProvider>,
    );

    expect(screen.getByText('ruta: /panel')).toBeInTheDocument();
  });

  it('navigate cambia el pathname sin recargar la pagina', () => {
    render(
      <RouterProvider>
        <CurrentPath />
        <NavigateButton to="/panel/turnos" />
      </RouterProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'ir' }));

    expect(screen.getByText('ruta: /panel/turnos')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/panel/turnos');
  });

  it('reacciona a los botones de atras/adelante del navegador (popstate)', () => {
    render(
      <RouterProvider>
        <CurrentPath />
      </RouterProvider>,
    );

    window.history.pushState({}, '', '/otra-ruta');
    // `fireEvent` (not a raw `window.dispatchEvent`) so React's batched
    // state update from the listener is flushed inside `act()` before the
    // assertion below runs — this event has no real user gesture to attach
    // it to, so the generic `fireEvent(target, event)` form is the correct
    // one here, not `fireEvent.<eventName>`.
    fireEvent(window, new PopStateEvent('popstate'));

    expect(screen.getByText('ruta: /otra-ruta')).toBeInTheDocument();
  });

  it('useRouter fuera de RouterProvider explota en vez de fallar en silencio', () => {
    function Broken() {
      useRouter();
      return null;
    }
    expect(() => render(<Broken />)).toThrow();
  });
});

describe('Link (D.1)', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/');
  });

  it('renderiza un <a> real, navegable y con href correcto', () => {
    render(
      <RouterProvider>
        <Link to="/panel">Panel</Link>
      </RouterProvider>,
    );

    const link = screen.getByRole('link', { name: 'Panel' });
    expect(link).toHaveAttribute('href', '/panel');
  });

  it('un click comun navega client-side, sin recargar la pagina', () => {
    render(
      <RouterProvider>
        <CurrentPath />
        <Link to="/panel">Panel</Link>
      </RouterProvider>,
    );

    fireEvent.click(screen.getByRole('link', { name: 'Panel' }));

    expect(screen.getByText('ruta: /panel')).toBeInTheDocument();
  });

  it('un click con ctrl/meta (abrir en pestana nueva) no lo intercepta', () => {
    render(
      <RouterProvider>
        <CurrentPath />
        <Link to="/panel">Panel</Link>
      </RouterProvider>,
    );

    fireEvent.click(screen.getByRole('link', { name: 'Panel' }), { metaKey: true });

    expect(screen.getByText('ruta: /')).toBeInTheDocument();
  });
});
