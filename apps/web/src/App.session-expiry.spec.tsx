import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';
import { savePersistedActor } from './shared/session';

// El duenio se encontro esto en Gestion: la pantalla lo mostraba adentro del
// panel y cada seccion respondia "No authenticated actor for this request".
// La cookie ya habia vencido; el actor seguia en localStorage, que es solo
// una cache de conveniencia y nunca fue autoridad. Vencerse es normal — lo
// que no puede pasar es que el panel finja que no.
//
// Se mockea `fetch`, no `api-client`: asi el error viaja por el camino real
// (request -> ApiError -> listeners), que es justamente lo que se prueba.
function respondWith(status: number, body: unknown) {
  const mock = vi.fn(
    async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  );
  vi.stubGlobal('fetch', mock);
  return mock;
}

describe('App — sesion vencida', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.pushState({}, '', '/panel/gestion');
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('ante una llamada sin actor, saca al staff del panel y explica por que', async () => {
    savePersistedActor({ userId: 'u1', role: 'owner', barberId: null });
    respondWith(403, { message: 'No authenticated actor for this request.', statusCode: 403 });

    render(<App />);

    await waitFor(() => expect(window.location.pathname).toBe('/panel/login'));
    expect(await screen.findByText(/sesi.n.*venci|volv. a entrar/i)).toBeInTheDocument();
    // Y el actor persistido se limpia: sin eso, un refresh volveria a entrar
    // al panel roto.
    expect(window.localStorage.getItem('jc-barberia:staff-actor')).toBeNull();
  });

  // Un 403 de permisos y uno de sesion vencida llegan por el mismo status:
  // solo los distingue el mensaje. Confundirlos significa expulsar a alguien
  // con sesion perfectamente valida por hacer un click que no le tocaba.
  it('un 403 por permisos NO desloguea: la sesion es valida', async () => {
    savePersistedActor({ userId: 'u1', role: 'owner', barberId: null });
    const fetchMock = respondWith(403, {
      message: 'Role "secretary" lacks permission "barber:manage".',
      statusCode: 403,
    });

    render(<App />);

    // Le da tiempo a equivocarse antes de afirmar que no lo hizo: la llamada
    // fallida ya viajo por el canal de errores para cuando esto resuelve.
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    expect(window.localStorage.getItem('jc-barberia:staff-actor')).not.toBeNull();
    expect(window.location.pathname).not.toBe('/panel/login');
  });
});
