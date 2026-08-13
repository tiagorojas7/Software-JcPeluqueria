/**
 * The exactly three roles the system recognizes (see access-control spec,
 * "Tres roles con aplicación en el backend"). English identifiers, matching
 * the existing `SessionSubjectKind`'s `'owner'` convention
 * (`packages/domain/src/identity/session.ts`) — the Spanish business labels
 * (Dueño/Secretaria/Barbero) stay a README/UI concern, never a code value.
 */
export const ROLES = ['owner', 'secretary', 'barber'] as const;

export type Role = (typeof ROLES)[number];
