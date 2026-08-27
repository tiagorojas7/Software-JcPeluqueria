import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ErrorBoundary } from './ErrorBoundary';

function Bomb(): never {
  throw new Error('render explotó');
}

// La SPA no tenia NINGUN error boundary: cualquier throw durante un render
// (un dato con forma inesperada, un bug nuestro) desmontaba el arbol entero
// y dejaba la pantalla en blanco, sin mensaje y sin salida. El boundary es
// la red de contencion global: ofrece recargar en vez de un vacio mudo.
describe('ErrorBoundary', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renderiza a sus hijos cuando nada falla', () => {
    render(
      <ErrorBoundary>
        <p>contenido sano</p>
      </ErrorBoundary>,
    );

    expect(screen.getByText('contenido sano')).toBeInTheDocument();
  });

  it('muestra la pantalla de error con salida en vez de un blanco mudo', () => {
    // React igualmente loguea el throw en consola; silenciado para que el
    // output del test no parezca un fallo.
    vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(/algo salió mal/i);
    expect(screen.getByRole('button', { name: /recargar/i })).toBeInTheDocument();
  });
});
