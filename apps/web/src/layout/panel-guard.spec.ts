import { describe, expect, it } from 'vitest';

import { resolvePanelRedirect } from './panel-guard';

const OWNER = { userId: 'u1', role: 'owner' as const, barberId: null };

// D.1 RED — "el panel exige sesion; sin ella redirige al login, nunca
// muestra la pantalla vacia" (tasks.md, D.1). Pure function on purpose: the
// exact same decision `App.tsx` and its tests both need, with no DOM/router
// involved — a redirect target, or `null` meaning "render here as normal".

describe('resolvePanelRedirect (D.1)', () => {
  it('el sitio publico nunca es tocado por el guard del panel', () => {
    expect(resolvePanelRedirect('/', null)).toBeNull();
    expect(resolvePanelRedirect('/reservar', null)).toBeNull();
    expect(resolvePanelRedirect('/acceder', OWNER)).toBeNull();
  });

  it('sin actor, cualquier ruta de panel redirige al login del panel', () => {
    expect(resolvePanelRedirect('/panel', null)).toBe('/panel/login');
    expect(resolvePanelRedirect('/panel/turno-telefonico', null)).toBe('/panel/login');
    expect(resolvePanelRedirect('/panel/gestion', null)).toBe('/panel/login');
  });

  it('sin actor, la propia pantalla de login no redirige a si misma', () => {
    expect(resolvePanelRedirect('/panel/login', null)).toBeNull();
  });

  it('con actor, cualquier ruta de panel (menos login) se queda donde esta', () => {
    expect(resolvePanelRedirect('/panel', OWNER)).toBeNull();
    expect(resolvePanelRedirect('/panel/turno-telefonico', OWNER)).toBeNull();
  });

  it('con actor, entrar a /panel/login redirige a la home del panel', () => {
    expect(resolvePanelRedirect('/panel/login', OWNER)).toBe('/panel');
  });
});
