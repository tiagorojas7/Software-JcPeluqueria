import { describe, expect, it } from 'vitest';

import { phoneKey } from './phone-key';

// Una persona que vuelve a reservar escribe su teléfono como se le ocurre.
// Antes, cada forma distinta creaba un cliente nuevo — y como la cuenta se
// crea con el email (UNIQUE), el segundo intento moría con un 500.
describe('phoneKey', () => {
  it('reduce a dígitos las formas en que la gente escribe el mismo número', () => {
    const esperado = phoneKey('3515069498');
    expect(phoneKey('351 506-9498')).toBe(esperado);
    expect(phoneKey('351 5069498')).toBe(esperado);
    expect(phoneKey('(351) 5069498')).toBe(esperado);
    expect(phoneKey('351.506.9498')).toBe(esperado);
  });

  it('ignora el prefijo internacional argentino y el 0 de larga distancia', () => {
    const esperado = phoneKey('3515069498');
    expect(phoneKey('+54 351 506 9498')).toBe(esperado);
    expect(phoneKey('0351 5069498')).toBe(esperado);
    expect(phoneKey('+5403515069498')).toBe(esperado);
  });

  it('ignora el 15 de celular que se usa después de la característica', () => {
    expect(phoneKey('351 15 5069498')).toBe(phoneKey('3515069498'));
  });

  it('NO junta dos números que son realmente distintos', () => {
    expect(phoneKey('3515069498')).not.toBe(phoneKey('3515069499'));
    expect(phoneKey('3510000001')).not.toBe(phoneKey('3510000002'));
  });

  it('devuelve cadena vacía cuando no hay ningún dígito', () => {
    expect(phoneKey('')).toBe('');
    expect(phoneKey('   ')).toBe('');
    expect(phoneKey('sin numero')).toBe('');
  });
});
