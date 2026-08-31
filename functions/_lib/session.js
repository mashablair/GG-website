// Who is logged in.
//
// The session is a signed cookie, not a database row: `<payload>.<signature>`,
// where the payload is base64url JSON and the signature is HMAC-SHA256 under
// SESSION_SECRET. Nobody can forge or edit one without the secret.
//
// There's no sessions table because we look the student up on each request
// anyway, to confirm the enrollment is still active. That means a refund takes
// effect on her very next page load rather than whenever a session expires.

import { hmacBase64Url, base64UrlEncode, base64UrlDecode, timingSafeEqual } from './crypto.js';

const COOKIE_NAME = 'idm_session';
const DEVICE_COOKIE = 'idm_device';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 90; // 90 days
const DEVICE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365; // a year

/**
 * A signed value: `<payload>.<signature>`, base64url JSON with an HMAC.
 *
 * `purpose` is baked into the payload so one kind of token can't be presented
 * as another — a session cookie can't be replayed as a trusted-device cookie,
 * even though both are signed with the same secret.
 */
async function sign(secret, purpose, studentId, maxAgeSeconds) {
  const payload = base64UrlEncode(
    JSON.stringify({
      p: purpose,
      sid: studentId,
      exp: Math.floor(Date.now() / 1000) + maxAgeSeconds,
    })
  );
  return `${payload}.${await hmacBase64Url(secret, payload)}`;
}

async function read(secret, purpose, token) {
  if (!token) return null;

  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;

  const expected = await hmacBase64Url(secret, payload);
  if (!timingSafeEqual(signature, expected)) return null;

  let data;
  try {
    data = JSON.parse(base64UrlDecode(payload));
  } catch {
    return null;
  }

  if (!data || typeof data.sid !== 'number') return null;
  if (data.p !== purpose) return null;
  if (!data.exp || data.exp < Math.floor(Date.now() / 1000)) return null;

  return data.sid;
}

/** Build a signed session value for a student. */
export async function createSession(secret, studentId, maxAgeSeconds = MAX_AGE_SECONDS) {
  return sign(secret, 'session', studentId, maxAgeSeconds);
}

/** Returns the student id from a valid, unexpired cookie, or null. */
export async function readSession(secret, request) {
  return read(secret, 'session', getCookie(request, COOKIE_NAME));
}

export function sessionCookie(value, url, maxAgeSeconds = MAX_AGE_SECONDS) {
  return buildCookie(COOKIE_NAME, value, url, maxAgeSeconds);
}

/**
 * All our cookies share the same protections.
 *
 * HttpOnly    JavaScript can't read it, so an injected script can't steal it
 * Secure      never sent over plain http (skipped on localhost so dev works)
 * SameSite    Lax — not sent on cross-site POSTs, which is what stops another
 *             site from silently signing someone in with the device token
 */
function buildCookie(name, value, url, maxAgeSeconds) {
  const isLocal = ['localhost', '127.0.0.1'].includes(new URL(url).hostname);
  return [
    `${name}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    isLocal ? null : 'Secure',
    `Max-Age=${maxAgeSeconds}`,
  ]
    .filter(Boolean)
    .join('; ');
}

export function clearSessionCookie(url) {
  return sessionCookie('', url, 0);
}

// ---------- A purchase in flight ----------
//
// Lava wants the return URLs when the invoice is created, which is before it
// tells us the contract id — so the id can't travel in the URL the way Stripe's
// session id does.
//
// It rides in a signed, short-lived cookie instead. SameSite=Lax means it comes
// back with the top-level navigation from Lava's widget, and unlike a URL it
// can't be copied out of browser history or a screenshot.

const PENDING_COOKIE = 'idm_pending';
const PENDING_MAX_AGE = 60 * 60; // an hour is plenty to finish paying

export async function pendingPurchaseCookie(secret, contractId, url) {
  const payload = base64UrlEncode(JSON.stringify({ p: 'pending', c: contractId }));
  const value = `${payload}.${await hmacBase64Url(secret, payload)}`;
  return buildCookie(PENDING_COOKIE, value, url, PENDING_MAX_AGE);
}

export async function readPendingPurchase(secret, request) {
  const token = getCookie(request, PENDING_COOKIE);
  if (!token) return null;

  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  if (!timingSafeEqual(signature, await hmacBase64Url(secret, payload))) return null;

  try {
    const data = JSON.parse(base64UrlDecode(payload));
    return data?.p === 'pending' && data.c ? String(data.c) : null;
  } catch {
    return null;
  }
}

export function clearPendingPurchaseCookie(url) {
  return buildCookie(PENDING_COOKIE, '', url, 0);
}

// ---------- Trusting a browser ----------
//
// Signing out ends the session but leaves this behind, so coming back is one
// tap instead of an email round-trip. It's the same trust a 90-day session
// already carries, just surviving an explicit sign-out.
//
// Which is exactly why "sign out everywhere" exists alongside it: on a shared
// or borrowed computer, that one clears this too and the next person needs a
// code. Anyone who might be handing their laptop to someone else should use it.

export async function createDeviceToken(secret, studentId) {
  return sign(secret, 'device', studentId, DEVICE_MAX_AGE_SECONDS);
}

export async function readDeviceToken(secret, request) {
  return read(secret, 'device', getCookie(request, DEVICE_COOKIE));
}

export function deviceCookie(value, url, maxAgeSeconds = DEVICE_MAX_AGE_SECONDS) {
  return buildCookie(DEVICE_COOKIE, value, url, maxAgeSeconds);
}

export function clearDeviceCookie(url) {
  return deviceCookie('', url, 0);
}

function getCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}
