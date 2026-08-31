// Checks that signed video URLs are genuinely signed.
//
// Generates a throwaway RSA keypair, signs a token with the same code the site
// uses, then verifies it with the public half. If this passes, Cloudflare
// Stream will accept the tokens too — it's the same algorithm and the same
// claims.
//
//   node test/stream-signing.mjs

import { signedToken, playerUrl, signingIsConfigured } from '../functions/_lib/stream.js';

let pass = 0;
let fail = 0;
const ok = (m) => { console.log(`  ✅ ${m}`); pass++; };
const bad = (m) => { console.log(`  ❌ ${m}`); fail++; };
const check = (m, a, b) => (a === b ? ok(`${m} (${a})`) : bad(`${m} — expected ${b}, got ${a}`));

const decode = (part) =>
  JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());

console.log('── Without a key configured ───────────────────────');
check('signing reports itself unconfigured', signingIsConfigured({}), false);
check('no token issued', await signedToken({}, 'abc123'), null);

const unsigned = await playerUrl({}, 'abc123', { customerCode: 'cust', primaryColor: '#800020' });
unsigned.includes('/abc123/iframe')
  ? ok('falls back to the plain video id, so lessons still play')
  : bad('fallback URL is wrong');

console.log('\n── With a key ─────────────────────────────────────');
const { publicKey, privateKey } = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true,
  ['sign', 'verify']
);

const jwk = await crypto.subtle.exportKey('jwk', privateKey);
const env = {
  STREAM_KEY_ID: 'test-key-id',
  STREAM_JWK: Buffer.from(JSON.stringify(jwk)).toString('base64'),
};

check('signing reports itself configured', signingIsConfigured(env), true);

const videoId = '6efa8f26447f013884ac8e00515129d7';
const token = await signedToken(env, videoId);
const [headerPart, payloadPart, signaturePart] = token.split('.');

check('token has three parts', token.split('.').length, 3);

const header = decode(headerPart);
check('algorithm is RS256', header.alg, 'RS256');
check('names the key', header.kid, 'test-key-id');

const payload = decode(payloadPart);
check('names the video', payload.sub, videoId);
const life = payload.exp - Math.floor(Date.now() / 1000);
life > 0 && life <= 24 * 3600
  ? ok(`expires in ${Math.round(life / 60)} minutes — inside Stream's 24h limit`)
  : bad(`expiry out of range (${life}s)`);

console.log('\n── The signature actually verifies ────────────────');
const valid = await crypto.subtle.verify(
  { name: 'RSASSA-PKCS1-v1_5' },
  publicKey,
  Buffer.from(signaturePart.replace(/-/g, '+').replace(/_/g, '/'), 'base64'),
  new TextEncoder().encode(`${headerPart}.${payloadPart}`)
);
valid ? ok('verifies against the public key') : bad('signature does not verify');

// Tamper with the video id and the signature must stop matching — otherwise
// anyone could swap in a different video.
const tampered = `${headerPart}.${Buffer.from(
  JSON.stringify({ ...payload, sub: 'some-other-video' })
).toString('base64url')}`;
const stillValid = await crypto.subtle.verify(
  { name: 'RSASSA-PKCS1-v1_5' },
  publicKey,
  Buffer.from(signaturePart.replace(/-/g, '+').replace(/_/g, '/'), 'base64'),
  new TextEncoder().encode(tampered)
);
stillValid ? bad('a swapped video id still verified') : ok('swapping the video id breaks it');

console.log('\n── The player URL ─────────────────────────────────');
const signed = await playerUrl(env, videoId, { customerCode: 'k0aprwjw2ij8nfpy', primaryColor: '#800020' });
signed.includes(`/${token.split('.')[0]}`)
  ? ok('uses the token in place of the video id')
  : bad('token not in the URL');
signed.includes(`/${videoId}/iframe`)
  ? bad('the bare video id is still in the URL')
  : ok('the bare video id never appears');
signed.includes('poster=')
  ? ok('poster included')
  : bad('poster missing');
decodeURIComponent(signed).includes(`${token}/thumbnails`)
  ? ok('the poster is signed too')
  : bad('poster is not signed — it would 403 once signing is required');

console.log('\n═══════════════════════════════════════════════════');
console.log(`  ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
