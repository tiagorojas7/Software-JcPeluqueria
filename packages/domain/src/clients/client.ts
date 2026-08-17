/**
 * A client record — first created either at the end of the web booking flow
 * (Phase 9, not yet built) or by staff loading a phone appointment (Phase
 * 10, admin-operations spec "Creación de turnos telefónicos sin seña").
 * `phone` and `name` are the only two REQUIRED fields for a phone-originated
 * client: `email`/`age` are OPTIONAL, expressed here as nullable rather than
 * defaulted, so "no email" is a real, first-class value a caller states
 * explicitly instead of a validation failure (admin-operations spec,
 * "Consecuencias de un turno telefónico sin email" — the system MUST keep
 * working for this client, forever, not just at creation time).
 */
export interface Client {
  readonly id: string;
  readonly name: string;
  readonly phone: string;
  readonly email: string | null;
  readonly age: number | null;
}

export interface CreateClientInput {
  readonly name: string;
  readonly phone: string;
  readonly email: string | null;
  readonly age: number | null;
}

/**
 * Persistence for clients. `findByPhone` backs "nuevo o existente" (a
 * repeat caller is reused, never duplicated) — the phone number is the only
 * natural key a phone booking reliably has. `findById` backs any flow that
 * already holds a `clientId` off an appointment/hold row and needs the
 * client's own data — first consumer is `GenerateAbsenceReassignmentOffers`
 * (barber-absence-reassignment), which needs the affected client's email to
 * dispatch the reassignment-offer notification.
 */
export interface ClientRepository {
  findByPhone(phone: string): Promise<Client | null>;
  findById(id: string): Promise<Client | null>;
  create(input: CreateClientInput): Promise<Client>;
  /**
   * admin-operations spec, "Gestión de clientes y de barberos": "El sistema
   * MUST poder ver... los registros de clientes." No filtering/pagination
   * yet — nothing beyond "view the client list" is asked for.
   */
  list(): Promise<Client[]>;
}
