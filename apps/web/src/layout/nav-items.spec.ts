import { describe, expect, it } from 'vitest';

import { PANEL_NAV_ITEMS, visiblePanelNavItems } from './nav-items';

// D.3 RED — "cada item aparece solo si el actor tiene el permiso que la
// ruta exige" (tasks.md, D.3), verified against the exact matrix D's own
// section derives from migration 0006 — NOT a per-item role switch: every
// case below goes through the same `visiblePanelNavItems`, which does
// nothing but filter `PANEL_NAV_ITEMS` by `hasAnyPermission`.

describe('PANEL_NAV_ITEMS (D.3)', () => {
  it('cada item declara al menos un permiso que lo habilita', () => {
    for (const item of PANEL_NAV_ITEMS) {
      expect(item.anyOf.length).toBeGreaterThan(0);
    }
  });
});

describe('visiblePanelNavItems (D.3)', () => {
  it('el dueno ve la navegacion completa, incluida la facturacion del local', () => {
    const paths = visiblePanelNavItems('owner').map((item) => item.path);

    expect(paths).toEqual(
      expect.arrayContaining(['/panel', '/panel/turno-telefonico', '/panel/gestion', '/panel/facturacion-local']),
    );
  });

  it('la secretaria ve agenda, turno telefonico y gestion, nunca plata', () => {
    const paths = visiblePanelNavItems('secretary').map((item) => item.path);

    expect(paths).toEqual(expect.arrayContaining(['/panel', '/panel/turno-telefonico', '/panel/gestion']));
    expect(paths).not.toContain('/panel/facturacion-local');
    expect(paths).not.toContain('/panel/facturacion');
  });

  it('el barbero solo ve su agenda y su propia facturacion', () => {
    const paths = visiblePanelNavItems('barber').map((item) => item.path);

    expect(paths).toEqual(['/panel', '/panel/facturacion']);
  });

  it('el barbero nunca ve el item de facturacion del local ni el de gestion', () => {
    const paths = visiblePanelNavItems('barber').map((item) => item.path);

    expect(paths).not.toContain('/panel/facturacion-local');
    expect(paths).not.toContain('/panel/gestion');
    expect(paths).not.toContain('/panel/turno-telefonico');
  });
});
