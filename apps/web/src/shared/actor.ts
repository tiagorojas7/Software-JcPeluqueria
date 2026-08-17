/** Mirrors `StaffLoginResponseBody`'s `authenticated` branch — kept as its
 *  own tiny type so every page that needs "who is logged in" imports one
 *  shape, never a page-local reinterpretation of the login response. */
export interface Actor {
  readonly userId: string;
  readonly role: 'owner' | 'secretary' | 'barber';
  readonly barberId: string | null;
}
