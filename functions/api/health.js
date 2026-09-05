// GET /api/health
//
// Reports whether each piece of configuration is present — never its value.
// Exists because a missing binding fails silently: codes get created, the page
// says "check your inbox", and nothing is ever sent. This turns that into a
// question you can answer in one request.

import { catalog } from '../_lib/catalog.js';
import { emailIsConfigured } from '../_lib/email.js';
import { lavaIsConfigured, lavaCheckoutReady } from '../_lib/lava.js';

export function onRequestGet({ env }) {
  const lava = { ...catalog.lava, offerId: env.LAVA_OFFER_ID || catalog.lava.offerId };

  return Response.json({
    ok: true,
    bindings: {
      database: Boolean(env.DB),
      emailToken: Boolean(env.CF_EMAIL_TOKEN),
      emailAccount: Boolean(env.CF_ACCOUNT_ID),
    },
    settings: {
      emailFrom: env.EMAIL_FROM || null,
      emailConsoleMode: env.EMAIL_DEV_CONSOLE === 'true',
      // Where "someone joined the waitlist" goes. This is the exact failure
      // this endpoint was built for: with NOTIFY_EMAIL missing the signup
      // still saves and the woman still sees "you're on the list", so nothing
      // looks wrong — Maria simply never hears about it.
      notifyEmail: env.NOTIFY_EMAIL || null,
      waitlistNotifyReady: Boolean(env.NOTIFY_EMAIL) && emailIsConfigured(env),
      stripeKey: Boolean(env.STRIPE_SECRET_KEY),
      // 'test' means no real money can move. Check this before a launch.
      stripeMode: env.STRIPE_SECRET_KEY
        ? env.STRIPE_SECRET_KEY.startsWith('sk_live') ? 'LIVE' : 'test'
        : null,
      stripeWebhookSecret: Boolean(env.STRIPE_WEBHOOK_SECRET),
      sessionSecret: Boolean(env.SESSION_SECRET),
      // Both halves are needed to sign a video URL, and they must come from the
      // same call to /stream/keys — a key id from one pair with a jwk from
      // another is rejected by Stream with nothing useful to go on.
      streamKeyId: Boolean(env.STREAM_KEY_ID),
      streamJwk: Boolean(env.STREAM_JWK),
      streamSigning: Boolean(env.STREAM_KEY_ID && env.STREAM_JWK),
      // Catches the likeliest paste error: the API token is much longer than a
      // key id, and putting it in STREAM_KEY_ID produces tokens Stream refuses.
      streamKeyIdLooksRight: env.STREAM_KEY_ID
        ? /^[0-9a-f]{32}$/.test(env.STREAM_KEY_ID)
        : null,
      // Lava has two halves that fail independently. Without the API key we
      // can't sell (the page says «Скоро») and can't verify a webhook; without
      // the webhook secret every delivery is rejected with a 401 and access is
      // granted only when the buyer returns to /pay/complete.
      lavaApiKey: Boolean(env.LAVA_API_KEY),
      lavaWebhookSecret: Boolean(env.LAVA_WEBHOOK_SECRET),
      lavaWebhooksReady: lavaIsConfigured(env),
      lavaCheckoutReady: lavaCheckoutReady(env, lava),
      // The offer is the price; the product is what the webhook names. Both
      // must be set, and a mapped product is what turns a payment into access.
      lavaOfferId: lava.offerId || null,
      lavaProductMapped: Boolean(catalog.byLavaProduct[lava.productId]),
    },
  });
}
