/**
 * Common-password blocklist for registration and password reset.
 *
 * WHY A BLOCKLIST AND NOT COMPLEXITY RULES
 * ----------------------------------------
 * Password validation here was length-only (8–72 chars), which accepted
 * `"password"` — eight characters, and the single most-guessed string there is.
 *
 * The instinctive fix is composition rules (one uppercase, one digit, one
 * symbol...). NIST SP 800-63B explicitly recommends AGAINST them: they push users
 * toward predictable mutations (`Password1!`) that guessing tools try first, while
 * blocking genuinely strong passphrases. What NIST recommends instead is exactly
 * this — refuse passwords that appear on known-compromised/common lists.
 *
 * This list is deliberately small and high-value: the passwords that dominate
 * credential-stuffing attempts. It is NOT a substitute for rate limiting on the
 * auth routes (which already exists) or for breach monitoring.
 *
 * Comparison is case-insensitive and ignores surrounding whitespace, because
 * `Password`, `PASSWORD` and `password ` are the same guess to an attacker.
 */

const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', 'passw0rd', 'p@ssword', 'p@ssw0rd',
  '12345678', '123456789', '1234567890', '123123123', '111111111', '000000000',
  'qwertyui', 'qwerty123', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm1',
  'iloveyou', 'princess', 'sunshine', 'football', 'baseball', 'superman',
  'welcome1', 'welcome123', 'admin123', 'administrator', 'letmein1', 'letmein123',
  'trustno1', 'starwars', 'whatever', 'freedom1', 'computer', 'monkey12',
  'abc12345', 'abcd1234', 'a1b2c3d4', '1q2w3e4r', '1qaz2wsx', 'qazwsxedc',
  'changeme', 'secret123', 'temp1234', 'test1234', 'user1234', 'login123',
  // India-specific high-frequency choices seen in credential dumps.
  'india123', 'bharat123', 'krishna123', 'ganesh123', 'mumbai123', 'delhi123',
  'cricket1', 'cricket123', 'sachin123',
]);

/**
 * Is this password on the blocklist?
 * @param {unknown} password
 * @returns {boolean}
 */
export function isCommonPassword(password) {
  if (typeof password !== 'string') return false;
  return COMMON_PASSWORDS.has(password.trim().toLowerCase());
}

export const COMMON_PASSWORD_MESSAGE =
  'This password is too common and appears in known breach lists. Please choose a different one.';

export { COMMON_PASSWORDS };
