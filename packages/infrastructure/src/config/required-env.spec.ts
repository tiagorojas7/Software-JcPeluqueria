import { describe, expect, it } from 'vitest';

import { missingRequiredEnv } from './required-env';

// `MERCADOPAGO_ACCESS_TOKEN ?? ''` appears in six composition roots: an
// empty token boots cleanly and only fails on the first REAL customer
// payment, as `403 PA_UNAUTHORIZED_RESULT_FROM_POLICIES`. That already
// happened once in this project. Boot-time is the only moment where the
// failure is cheap.
describe('missingRequiredEnv', () => {
  it('no reporta nada cuando todas las variables tienen valor', () => {
    expect(missingRequiredEnv(['A', 'B'], { A: 'uno', B: 'dos' })).toEqual([]);
  });

  it('reporta las variables ausentes', () => {
    expect(missingRequiredEnv(['A', 'B'], { A: 'uno' })).toEqual(['B']);
  });

  it('trata una cadena vacia como ausente — es exactamente el bug del token', () => {
    expect(missingRequiredEnv(['MERCADOPAGO_ACCESS_TOKEN'], { MERCADOPAGO_ACCESS_TOKEN: '' })).toEqual([
      'MERCADOPAGO_ACCESS_TOKEN',
    ]);
  });

  it('trata una cadena de solo espacios como ausente', () => {
    expect(missingRequiredEnv(['TOKEN'], { TOKEN: '   ' })).toEqual(['TOKEN']);
  });

  it('devuelve todas las faltantes, no solo la primera', () => {
    expect(missingRequiredEnv(['A', 'B', 'C'], { B: 'dos' })).toEqual(['A', 'C']);
  });
});
