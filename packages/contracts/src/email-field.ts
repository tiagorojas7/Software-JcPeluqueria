import { z } from 'zod';

/**
 * Every email field in every request schema MUST come from here. The account
 * key is `users.email` compared byte-for-byte (`findByEmail` uses `eq`), so
 * the address captured at booking (where the account is created) and the one
 * typed later at the access screen only ever meet if both crossed the wire
 * already trimmed and lowercased. A schema that validated without
 * normalizing let "Salvasoss@ICloud.com " match nothing — and the
 * outcome-invariant access endpoint hid that as a silent success.
 */
export function emailField(invalidMessage: string, requiredMessage?: string): z.ZodString {
  const base = z.string().trim().toLowerCase();
  const required = requiredMessage ? base.min(1, requiredMessage) : base;
  return required.email(invalidMessage);
}
