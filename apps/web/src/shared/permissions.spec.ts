import { describe, expect, it } from 'vitest';

import { hasAnyPermission, hasPermission } from './permissions';

// D.3 RED — access-control spec's "Matriz de permisos por rol" mirrored for
// the frontend nav (migration 0006's seed is the source of truth; see
// permissions.ts's own doc comment for why this is a mirror, not a fetch).
// One assertion per matrix cell that actually differentiates a role, plus
// the ANY-of-several-permissions case `@RequiresPermission` itself uses.

describe('hasPermission (D.3)', () => {
  it('el dueno tiene la matriz completa, incluida la facturacion del local', () => {
    expect(hasPermission('owner', 'finance:read:shop')).toBe(true);
    expect(hasPermission('owner', 'barber:manage')).toBe(true);
    expect(hasPermission('owner', 'schedule:configure')).toBe(true);
    expect(hasPermission('owner', 'pricing:configure')).toBe(true);
    expect(hasPermission('owner', 'client:manage')).toBe(true);
    expect(hasPermission('owner', 'agenda:read:any')).toBe(true);
  });

  it('la secretaria opera el dia a dia pero no la configuracion de fondo', () => {
    expect(hasPermission('secretary', 'client:manage')).toBe(true);
    expect(hasPermission('secretary', 'appointment:create')).toBe(true);
    expect(hasPermission('secretary', 'walkin:create')).toBe(true);
    expect(hasPermission('secretary', 'barber:mark-absent')).toBe(true);
    expect(hasPermission('secretary', 'agenda:read:any')).toBe(true);
  });

  it('la secretaria nunca tiene plata, alta de barberos, precios ni horarios', () => {
    expect(hasPermission('secretary', 'finance:read:shop')).toBe(false);
    expect(hasPermission('secretary', 'barber:manage')).toBe(false);
    expect(hasPermission('secretary', 'schedule:configure')).toBe(false);
    expect(hasPermission('secretary', 'pricing:configure')).toBe(false);
  });

  it('el barbero queda acotado a lo propio, nunca a otro barbero ni al local', () => {
    expect(hasPermission('barber', 'agenda:read:own')).toBe(true);
    expect(hasPermission('barber', 'appointment:mark-completed:own')).toBe(true);
    expect(hasPermission('barber', 'finance:read:own')).toBe(true);

    expect(hasPermission('barber', 'agenda:read:any')).toBe(false);
    expect(hasPermission('barber', 'finance:read:shop')).toBe(false);
    expect(hasPermission('barber', 'appointment:create')).toBe(false);
    expect(hasPermission('barber', 'client:manage')).toBe(false);
  });
});

describe('hasAnyPermission (ANY-of semantics, same as @RequiresPermission)', () => {
  it('alcanza con tener uno solo de los permisos listados', () => {
    expect(hasAnyPermission('owner', ['agenda:read:any', 'agenda:read:own'])).toBe(true);
    expect(hasAnyPermission('barber', ['agenda:read:any', 'agenda:read:own'])).toBe(true);
  });

  it('si no tiene ninguno de los permisos listados, no alcanza', () => {
    expect(hasAnyPermission('barber', ['barber:manage', 'schedule:configure'])).toBe(false);
  });
});
