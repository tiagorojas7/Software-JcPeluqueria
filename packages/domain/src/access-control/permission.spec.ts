import { describe, expect, it } from 'vitest';

import { PERMISSIONS } from './permission';
import { ROLES } from './role';

// Purely structural constants (no branching, one possible output) — see
// design.md's "Autorización: permiso como unidad, rol como configuración"
// for the exact 15-entry catalog this locks in place. Guards against a
// silent future edit narrowing or widening the vocabulary by accident.
describe('access-control catalog', () => {
  it('declares exactly the 15 permission codes from design.md', () => {
    expect(PERMISSIONS).toEqual([
      'appointment:create',
      'appointment:update',
      'appointment:cancel',
      'appointment:mark-completed:any',
      'appointment:mark-completed:own',
      'walkin:create',
      'barber:mark-absent',
      'client:manage',
      'barber:manage',
      'schedule:configure',
      'pricing:configure',
      'finance:read:shop',
      'finance:read:own',
      'agenda:read:any',
      'agenda:read:own',
    ]);
  });

  it('declares exactly the three roles access-control recognizes', () => {
    expect(ROLES).toEqual(['owner', 'secretary', 'barber']);
  });
});
