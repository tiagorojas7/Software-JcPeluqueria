import { afterEach, describe, expect, it, vi } from 'vitest';

import { clearPersistedActor, loadPersistedActor, savePersistedActor } from './session';

// D.1 RED — the panel's login-gate needs to survive a page refresh: the
// httpOnly session cookie (`apps/api`'s `AuthController`) already survives
// one, but this SPA's in-memory `actor` state (role/barberId, needed to pick
// which screen/nav to render) does not. Persists only the same
// non-sensitive fields `StaffLoginResponseBody`'s `authenticated` branch
// already sends the browser in plain JSON — never a credential, never the
// session cookie itself (that stays httpOnly, invisible to this code on
// purpose). If the cookie is gone or expired, the first API call still
// fails with 401/403 exactly as today — this is a UX convenience, not a
// second source of authority.

describe('session (D.1)', () => {
  afterEach(() => {
    clearPersistedActor();
  });

  it('no hay actor persistido antes del primer login', () => {
    expect(loadPersistedActor()).toBeNull();
  });

  it('guarda y recupera exactamente el actor logueado', () => {
    savePersistedActor({ userId: 'u1', role: 'owner', barberId: null });

    expect(loadPersistedActor()).toEqual({ userId: 'u1', role: 'owner', barberId: null });
  });

  it('clearPersistedActor borra la sesion (logout)', () => {
    savePersistedActor({ userId: 'u1', role: 'barber', barberId: 'b1' });

    clearPersistedActor();

    expect(loadPersistedActor()).toBeNull();
  });

  it('un valor corrupto en localStorage no rompe la app, solo se ignora', () => {
    window.localStorage.setItem('jc-barberia:staff-actor', '{esto no es json valido');

    expect(loadPersistedActor()).toBeNull();
  });

  it('un objeto con forma incorrecta tambien se ignora', () => {
    window.localStorage.setItem('jc-barberia:staff-actor', JSON.stringify({ hello: 'world' }));

    expect(loadPersistedActor()).toBeNull();
  });
});

// Safari en modo privado (y cualquier navegador con storage bloqueado por
// politica) hace que TOCAR window.localStorage tire. `loadPersistedActor`
// corre sincronico dentro del `useState` inicial de App.tsx: si tira ahi, la
// SPA entera muere en blanco antes del primer render. Mismo patron defensivo
// que AccessCodePage ya aplica a su propia clave.
describe('session con localStorage bloqueado', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loadPersistedActor devuelve null si el storage tira', () => {
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('storage blocked');
    });

    expect(loadPersistedActor()).toBeNull();
  });

  it('savePersistedActor no explota si el storage tira', () => {
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('storage blocked');
    });

    expect(() => savePersistedActor({ userId: 'u1', role: 'owner', barberId: null })).not.toThrow();
  });

  it('clearPersistedActor no explota si el storage tira', () => {
    vi.spyOn(window.localStorage, 'removeItem').mockImplementation(() => {
      throw new Error('storage blocked');
    });

    expect(() => clearPersistedActor()).not.toThrow();
  });
});
