import { randomInt } from 'node:crypto';

/**
 * Alphabet without characters that are easy to confuse when a password is read
 * aloud or copied by hand: 0/O, 1/l/I.
 */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

/** Length of the temporary password an administrator hands to a new user. */
export const TEMPORARY_PASSWORD_LENGTH = 12;

/** A random temporary password, drawn from a uniform CSPRNG. */
export function generateTemporaryPassword(
  length = TEMPORARY_PASSWORD_LENGTH,
): string {
  let password = '';
  for (let i = 0; i < length; i++) {
    password += ALPHABET[randomInt(ALPHABET.length)];
  }
  return password;
}
