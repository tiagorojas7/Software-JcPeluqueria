import { describe, expect, it } from 'vitest';

import { ConfirmReservationRequestSchema } from './booking';
import {
  ClientLoginByEmailRequestSchema,
  RequestClientAccessRequestSchema,
  StaffLoginRequestSchema,
} from './identity';

// Regression for the "solo llegan mails a gmail" report: the account lookup
// (`ClientAccountRepository.findByEmail`) compares byte-for-byte, so an email
// typed as "Salvasoss@ICloud.com " at the access screen silently matched
// nothing — the endpoint answered its outcome-invariant `requested` and no
// code was ever enqueued. The wire contract is the single normalization
// authority: every email crosses it already trimmed and lowercased, on the
// way IN (booking, where the account is created) and on the way BACK
// (access request / login), so both sides always meet in the same form.
describe('normalización de email en los contratos', () => {
  it('RequestClientAccessRequestSchema recorta espacios y baja a minúsculas', () => {
    const parsed = RequestClientAccessRequestSchema.parse({ email: '  Salvasoss@ICloud.com  ' });
    expect(parsed.email).toBe('salvasoss@icloud.com');
  });

  it('ClientLoginByEmailRequestSchema normaliza igual que el pedido del código', () => {
    const parsed = ClientLoginByEmailRequestSchema.parse({
      email: 'Sofia@Example.COM',
      secret: '123456',
    });
    expect(parsed.email).toBe('sofia@example.com');
  });

  it('StaffLoginRequestSchema normaliza el email del staff', () => {
    const parsed = StaffLoginRequestSchema.parse({
      email: ' Dueno@JCBarberia.test',
      password: 'secreta',
    });
    expect(parsed.email).toBe('dueno@jcbarberia.test');
  });

  it('ConfirmReservationRequestSchema normaliza el email con el que se crea la cuenta', () => {
    const parsed = ConfirmReservationRequestSchema.parse({
      holdId: 'f6839be3-110c-4305-8a77-4a21e2c5cb41',
      client: {
        name: 'Sofía',
        phone: '3510000000',
        email: ' Sofia@ICloud.com ',
      },
    });
    expect(parsed.client.email).toBe('sofia@icloud.com');
  });

  it('sigue rechazando un email inválido después de normalizar', () => {
    const result = RequestClientAccessRequestSchema.safeParse({ email: '  no-es-un-email  ' });
    expect(result.success).toBe(false);
  });
});
