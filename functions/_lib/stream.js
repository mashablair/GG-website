// Signed video URLs.
//
// Gating the *pages* isn't enough on its own. Without this, a video's plain
// delivery URL plays for anyone who copies it out of a lesson — no sign-in, no
// purchase, and it can be pasted into a group chat and shared forever.
//
// With signing on, a video refuses to play unless the URL carries a token that
// proves this server issued it, minutes ago, for that one video. Tokens are
// generated per request and expire, so a copied link stops working shortly
// after it's taken.
//
// Two halves, and both are needed:
//   1. `requireSignedURLs` switched on for each video, in Stream
//   2. this code, putting a valid token in the player URL
//
// Without (1) the token is decoration — the plain URL still works. Without (2)
// nothing plays at all. See the README.

const TOKEN_LIFETIME_SECONDS = 60 * 60 * 2; // two hours

export function signingIsConfigured(env) {
  return Boolean(env.STREAM_JWK && env.STREAM_KEY_ID);
}

// Importing the key costs a few milliseconds, and a Worker isolate serves many
// requests, so do it once and keep the promise.
let keyPromise = null;

function signingKey(jwkBase64) {
  if (!keyPromise) {
    keyPromise = crypto.subtle.importKey(
      'jwk',
      JSON.parse(atob(jwkBase64)),
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign']
    );
  }
  return keyPromise;
}

/**
 * A token that plays one video, for a couple of hours.
 *
 * Returns null when signing isn't configured, so lesson pages keep working
 * with plain video ids until the keys are in place.
 */
export async function signedToken(env, videoId) {
  if (!signingIsConfigured(env)) return null;

  const header = { alg: 'RS256', kid: env.STREAM_KEY_ID };
  const payload = {
    sub: videoId,
    kid: env.STREAM_KEY_ID,
    exp: Math.floor(Date.now() / 1000) + TOKEN_LIFETIME_SECONDS,
  };

  const body = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}`;

  const signature = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' },
    await signingKey(env.STREAM_JWK),
    new TextEncoder().encode(body)
  );

  return `${body}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

/**
 * The player URL for a lesson video — signed if we can, plain if not.
 *
 * Stream takes the token in the same position as the video id, so the URL shape
 * doesn't change.
 */
export async function playerUrl(env, videoId, { customerCode, primaryColor }) {
  const token = (await signedToken(env, videoId)) || videoId;
  const base = `https://customer-${customerCode}.cloudflarestream.com`;

  // The poster is a separate request, and also refuses unsigned access once
  // requireSignedURLs is on, so it needs the token too.
  const poster = `${base}/${token}/thumbnails/thumbnail.jpg?time=&height=600`;

  return (
    `${base}/${token}/iframe` +
    `?poster=${encodeURIComponent(poster)}` +
    `&primaryColor=${encodeURIComponent(primaryColor)}` +
    `&letterboxColor=transparent`
  );
}

function base64Url(str) {
  return bytesToBase64Url(new TextEncoder().encode(str));
}

function bytesToBase64Url(bytes) {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
