// Small crypto helpers built on Web Crypto — the same API Cloudflare, Deno and
// modern Node all provide, so none of this is Cloudflare-specific.
//
// No libraries. Stripe's own SDK reaches for Node's crypto module, which does
// not exist on Workers, so hand-rolling the two primitives we need is both
// simpler and more portable than shimming it.

const encoder = new TextEncoder();

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

/** HMAC-SHA256 of `message` under `secret`, as lowercase hex. */
export async function hmacHex(secret, message) {
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** HMAC-SHA256 of `message` under `secret`, as base64url (for cookies). */
export async function hmacBase64Url(secret, message) {
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(message));
  return base64UrlEncode(new Uint8Array(sig));
}

/** SHA-256 of a string, as lowercase hex. Used to store login codes hashed. */
export async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Compare two strings without leaking, through timing, how much of the prefix
 * matched. A naive === returns early on the first wrong character, which is
 * enough for an attacker to guess a signature one character at a time.
 */
export function timingSafeEqual(a, b) {
  const x = String(a);
  const y = String(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

export function base64UrlEncode(input) {
  const bytes = typeof input === 'string' ? encoder.encode(input) : input;
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlDecode(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  return atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
}

/** A cryptographically random numeric code, e.g. '418305'. */
export function randomDigits(length = 6) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return [...bytes].map((b) => (b % 10).toString()).join('');
}
