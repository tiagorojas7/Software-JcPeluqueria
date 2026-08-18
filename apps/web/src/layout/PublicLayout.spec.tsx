import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { RouterProvider } from '../shared/router';
import { PublicLayout } from './PublicLayout';

function renderPublic(pathname = '/') {
  window.history.pushState({}, '', pathname);
  return render(
    <RouterProvider>
      <PublicLayout>
        <p>contenido publico</p>
      </PublicLayout>
    </RouterProvider>,
  );
}

// D.4 RED — "sacar del sitio publico todo rastro del panel: enlaces, rutas
// y textos". A visitor of `/` must never be able to discover `/panel`
// exists from this layout: no link pointing there, no visible text
// mentioning it.

describe('PublicLayout (D.2/D.4)', () => {
  it('muestra el nombre de la barberia y navegacion publica', () => {
    renderPublic();

    expect(screen.getAllByText(/jc barber/i).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: /inicio/i })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: /reservar/i })).toHaveAttribute('href', '/reservar');
  });

  it('no expone ningun enlace hacia el panel', () => {
    renderPublic();

    const links = screen.getAllByRole('link');
    for (const link of links) {
      expect(link.getAttribute('href')).not.toMatch(/^\/panel/);
    }
  });

  it('no menciona la palabra "panel" en ningun texto visible', () => {
    const { container } = renderPublic();

    expect(container.textContent?.toLowerCase()).not.toContain('panel');
  });

  it('muestra el contenido de la pantalla actual', () => {
    renderPublic();

    expect(screen.getByText('contenido publico')).toBeInTheDocument();
  });

  it('marca la ruta activa con aria-current', () => {
    renderPublic('/reservar');

    expect(screen.getByRole('link', { name: /reservar/i })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /inicio/i })).not.toHaveAttribute('aria-current');
  });
});
