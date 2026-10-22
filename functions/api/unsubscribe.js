// Cloudflare Pages Function: GET /api/unsubscribe?e=<email>&t=<token>
//
// The link at the bottom of every email to a free-guide lead. One click, no
// sign-in, no "are you sure" — that's what the privacy policy promises and what
// the law expects. The token is an HMAC of the address (see guide.js), so the
// link only works for the address it was sent to.
//
// Unsubscribing marks every free-resource list for that address. It doesn't
// touch purchases, courses or sign-in codes: those aren't marketing.

import { hmacHex, timingSafeEqual } from '../_lib/crypto.js';

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const email = String(url.searchParams.get('e') || '').trim().toLowerCase();
  const token = String(url.searchParams.get('t') || '');

  let ok = false;
  if (email && token && env.SESSION_SECRET) {
    const expected = await hmacHex(env.SESSION_SECRET, `unsub:${email}`);
    ok = timingSafeEqual(token, expected);
  }

  if (!ok) {
    return page(
      "That link didn't work",
      'It may have been cut off when it was copied. Reply to any of my emails with "unsubscribe" and I\'ll take you off by hand.'
    );
  }

  try {
    await env.DB.prepare(
      `UPDATE leads SET unsubscribed_at = datetime('now')
       WHERE email = ?1 AND unsubscribed_at IS NULL`
    )
      .bind(email)
      .run();
  } catch (err) {
    // No leads table yet means there was nothing to unsubscribe from.
    console.error('unsubscribe failed:', err.message);
  }

  return page(
    "You're unsubscribed",
    "You won't get any more emails from me. If you ever want them back, just download a free guide again. Wishing you a beautiful new chapter. Maria"
  );
}

function page(title, message) {
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${title} | Maria Blair</title>
<style>
  body{margin:0;background:#FAF6F1;color:#2D2A26;font:17px/1.65 -apple-system,"Helvetica Neue",sans-serif}
  main{max-width:520px;margin:12vh auto;padding:0 20px;text-align:center}
  h1{font:600 30px/1.2 Georgia,serif;color:#7A2E3A;margin:0 0 16px}
  a{color:#7A2E3A}
</style></head>
<body><main><h1>${title}</h1><p>${message}</p><p><a href="/">mariablair.com</a></p></main></body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
