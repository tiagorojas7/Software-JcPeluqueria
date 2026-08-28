import { describe, expect, it } from 'vitest';

import { ApiError } from './api-client';
import { isSessionExpired } from './session-expiry';

// La cookie de sesion vence sola, pero el panel guarda el actor en
// localStorage para sobrevivir a un refresh — asi que la pantalla seguia
// diciendo que estabas adentro mientras cada llamada moria con
// "No authenticated actor for this request". El duenio lo vio en Gestion.
describe('isSessionExpired', () => {
  it('reconoce el 403 sin actor que devuelve el guard', () => {
    const error = new ApiError(403, {
      message: 'No authenticated actor for this request.',
      error: 'Forbidden',
      statusCode: 403,
    });

    expect(isSessionExpired(error)).toBe(true);
  });

  it('reconoce un 401', () => {
    expect(isSessionExpired(new ApiError(401, { message: 'Unauthorized' }))).toBe(true);
  });

  it('NO confunde un 403 por falta de permisos con una sesion vencida', () => {
    // La secretaria pidiendo algo del duenio: su sesion es perfectamente
    // valida. Desloguearla ahi seria expulsarla por hacer algo que no puede.
    const error = new ApiError(403, {
      message: 'Role "secretary" lacks permission "barber:manage".',
      error: 'Forbidden',
      statusCode: 403,
    });

    expect(isSessionExpired(error)).toBe(false);
  });

  it('ignora cualquier otro error', () => {
    expect(isSessionExpired(new ApiError(500, { message: 'boom' }))).toBe(false);
    expect(isSessionExpired(new ApiError(404, { message: 'no existe' }))).toBe(false);
    expect(isSessionExpired(new Error('sin red'))).toBe(false);
    expect(isSessionExpired('un string suelto')).toBe(false);
    expect(isSessionExpired(null)).toBe(false);
  });

  it('tolera un cuerpo que no es el objeto esperado', () => {
    expect(isSessionExpired(new ApiError(403, 'texto plano'))).toBe(false);
    expect(isSessionExpired(new ApiError(403, undefined))).toBe(false);
  });
});
