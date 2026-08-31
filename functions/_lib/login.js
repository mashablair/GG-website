// Issuing and checking sign-in codes.
//
// There are no passwords. Her email address is her identity: if she can read
// mail sent to it, she's her. That removes a whole category of problems —
// nothing to remember, nothing to reset, no password hashes to leak.
//
// Three things stop that being weak:
//
//   Codes are short-lived     10 minutes, then useless
//   Guesses are capped        5 attempts, then the code dies
//   Codes are peppered        a stolen database can't be brute-forced offline
//
// That last one matters more than it looks. A 6-digit code has a million
// possibilities, which a laptop chews through instantly — so hashing the code
// alone would be almost pointless. Mixing in a server-side secret means an
// attacker with the database still has nothing to attack.

import { sha256Hex, randomDigits, timingSafeEqual } from './crypto.js';
import { normalizeEmail } from './access.js';

const CODE_TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const MAX_CODES_PER_HOUR = 5;

async function hashCode(secret, email, code) {
  // Email included so a code issued for one person can't be replayed for
  // another; secret included so the hash can't be attacked offline.
  return sha256Hex(`${secret}:${email}:${code}`);
}

/**
 * Issue a code for an email address, if it belongs to someone.
 *
 * Returns { student, code } when a code was created, or { student: null } when
 * the address is unknown or has asked too often. The caller must respond
 * identically either way — otherwise anyone could probe the site to discover
 * who bought the course.
 */
export async function issueCode(db, secret, rawEmail) {
  const email = normalizeEmail(rawEmail);
  if (!email) return { student: null };

  const student = await db
    .prepare('SELECT id, email, first_name FROM students WHERE email = ?1')
    .bind(email)
    .first();

  if (!student) return { student: null };

  // Don't let someone mail-bomb a student by hammering the form.
  const recent = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM login_codes
        WHERE email = ?1 AND created_at > datetime('now','-1 hour')`
    )
    .bind(email)
    .first();

  if ((recent?.n ?? 0) >= MAX_CODES_PER_HOUR) {
    console.warn(`login: rate limit hit for ${email}`);
    return { student: null, rateLimited: true };
  }

  // Only the newest code should work. Retire any outstanding ones, so an old
  // email lying in an inbox can't be used later.
  await db
    .prepare(`UPDATE login_codes SET used_at = datetime('now') WHERE email = ?1 AND used_at IS NULL`)
    .bind(email)
    .run();

  const code = randomDigits(6);

  await db
    .prepare(
      `INSERT INTO login_codes (email, code_hash, expires_at)
       VALUES (?1, ?2, datetime('now', '+${CODE_TTL_MINUTES} minutes'))`
    )
    .bind(email, await hashCode(secret, email, code))
    .run();

  return { student, code };
}

/**
 * Check a code. Returns the student id on success, or null.
 *
 * Every failure looks the same to the caller — no distinction between "wrong
 * code", "expired", "too many tries" and "no such account", so nothing can be
 * learned by guessing.
 */
export async function verifyCode(db, secret, rawEmail, rawCode) {
  const email = normalizeEmail(rawEmail);
  const code = String(rawCode || '').replace(/\D/g, '');
  if (!email || code.length !== 6) return null;

  const row = await db
    .prepare(
      `SELECT id, code_hash, attempts FROM login_codes
        WHERE email = ?1 AND used_at IS NULL AND expires_at > datetime('now')
        ORDER BY id DESC LIMIT 1`
    )
    .bind(email)
    .first();

  if (!row) return null;

  if (row.attempts >= MAX_ATTEMPTS) {
    // Burn it rather than leaving it guessable.
    await db
      .prepare(`UPDATE login_codes SET used_at = datetime('now') WHERE id = ?1`)
      .bind(row.id)
      .run();
    console.warn(`login: too many attempts for ${email}`);
    return null;
  }

  // Count the attempt before checking it, so a crash mid-verify can't hand
  // someone unlimited guesses.
  await db
    .prepare('UPDATE login_codes SET attempts = attempts + 1 WHERE id = ?1')
    .bind(row.id)
    .run();

  const expected = await hashCode(secret, email, code);
  if (!timingSafeEqual(row.code_hash, expected)) return null;

  await db
    .prepare(`UPDATE login_codes SET used_at = datetime('now') WHERE id = ?1`)
    .bind(row.id)
    .run();

  const student = await db
    .prepare('SELECT id FROM students WHERE email = ?1')
    .bind(email)
    .first();

  return student?.id ?? null;
}

export const LOGIN_LIMITS = { CODE_TTL_MINUTES, MAX_ATTEMPTS, MAX_CODES_PER_HOUR };
