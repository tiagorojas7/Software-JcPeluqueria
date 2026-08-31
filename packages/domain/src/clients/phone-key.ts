/**
 * The comparable form of a phone number: what makes "351 506-9498",
 * "+54 351 5069498" and "0351 15 5069498" the same person.
 *
 * Clients are deduplicated by phone, and every different way of typing the
 * same number used to produce a NEW client. That is not only clutter: the
 * account is created keyed by email, which is UNIQUE, so the duplicate
 * client's account insert collided and the whole booking died with a 500.
 *
 * Argentine specifics, in the order they are stripped:
 *  - `+54` / `54` country code,
 *  - the long-distance `0` that precedes the area code,
 *  - the `15` mobile prefix that follows it.
 *
 * Deliberately NOT validation: this only decides whether two strings mean
 * the same number. The number the client typed is what gets stored and
 * shown — nobody should see their phone rewritten by us.
 */
export function phoneKey(phone: string): string {
  let digits = phone.replace(/\D/g, '');
  if (digits.startsWith('54')) {
    digits = digits.slice(2);
  }
  if (digits.startsWith('0')) {
    digits = digits.slice(1);
  }
  // The `15` is only a mobile prefix when removing it leaves a complete
  // 10-digit national number. Without that check the rule eats a legitimate
  // "15" out of the middle: 3515069498 (área 351 + 5069498) would collapse
  // to 35069498 and stop matching itself.
  if (digits.length === 12) {
    const mobilePrefix = /^(\d{2,4})15(\d+)$/.exec(digits);
    if (mobilePrefix) {
      digits = `${mobilePrefix[1]}${mobilePrefix[2]}`;
    }
  }
  return digits;
}
