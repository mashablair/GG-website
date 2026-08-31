// Everything that knows what a Stripe is.
//
// Deliberately no SDK: Stripe's library uses Node's crypto module, which does
// not exist on Workers. The two things we need — verifying a webhook signature
// and reading a checkout session — are a dozen lines each against their REST
// API, and this way the project keeps having no dependencies and no build step.

import { hmacHex, timingSafeEqual } from './crypto.js';
import { normalizeEmail } from './access.js';

const API = 'https://api.stripe.com/v1';

/**
 * Where Stripe's API lives. Overridable through STRIPE_API_BASE purely so the
 * test suite can point the whole purchase flow at a local stand-in and exercise
 * it for real, without live keys and without touching Stripe. Never set in
 * production.
 */
function apiBase(env) {
  return (env && env.STRIPE_API_BASE) || API;
}

/**
 * Verify a webhook really came from Stripe, and return its parsed body.
 *
 * Stripe sends `Stripe-Signature: t=<unix>,v1=<hex>`, where the signature is
 * HMAC-SHA256 of "<timestamp>.<raw body>" under the endpoint's signing secret.
 *
 * The raw body matters: re-serialising the parsed JSON would produce different
 * bytes and the signature would never match.
 *
 * Throws if anything is off. Never grant access on an unverified webhook —
 * without this check, anyone who knows the URL could post themselves a course.
 */
export async function verifyWebhook(rawBody, signatureHeader, secret, toleranceSeconds = 300) {
  if (!signatureHeader) throw new Error('missing Stripe-Signature header');
  if (!secret) throw new Error('missing webhook signing secret');

  let timestamp = null;
  const signatures = [];
  for (const part of signatureHeader.split(',')) {
    const [key, value] = part.split('=');
    if (key === 't') timestamp = value;
    if (key === 'v1') signatures.push(value);
  }

  if (!timestamp || !signatures.length) throw new Error('malformed Stripe-Signature header');

  // Reject old signatures, so a captured webhook can't be replayed later.
  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(age) || age > toleranceSeconds) {
    throw new Error(`webhook timestamp outside tolerance (${age}s)`);
  }

  const expected = await hmacHex(secret, `${timestamp}.${rawBody}`);
  if (!signatures.some((s) => timingSafeEqual(s, expected))) {
    throw new Error('webhook signature did not match');
  }

  return JSON.parse(rawBody);
}

/**
 * Read a checkout session straight from Stripe — the source of truth.
 *
 * line_items is expanded explicitly: Stripe leaves it out by default, both here
 * and on the webhook event, and without it there's no price id to map to a
 * course.
 */
export async function retrieveCheckoutSession(env, sessionId) {
  if (!env.STRIPE_SECRET_KEY) throw new Error('missing STRIPE_SECRET_KEY');

  const url = `${apiBase(env)}/checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=line_items`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Stripe-Version': '2024-06-20',
    },
  });

  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Stripe returned ${response.status} for checkout session`);
  }

  return response.json();
}

/**
 * Find the checkout session behind a payment intent.
 *
 * Needed for refunds: a `charge.refunded` event names the payment intent, but
 * enrollments are keyed on the checkout session id, so the two don't match on
 * their own. Stripe can look it up.
 */
export async function findSessionByPaymentIntent(env, paymentIntentId) {
  if (!env.STRIPE_SECRET_KEY) throw new Error('missing STRIPE_SECRET_KEY');
  if (!paymentIntentId) return null;

  const url = `${apiBase(env)}/checkout/sessions?payment_intent=${encodeURIComponent(paymentIntentId)}&limit=1`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Stripe-Version': '2024-06-20',
    },
  });

  if (!response.ok) throw new Error(`Stripe returned ${response.status} listing sessions`);

  const body = await response.json();
  return body.data?.[0] || null;
}

/**
 * Pull the handful of facts we care about out of a checkout session, in the
 * shape grantAccess() wants. Works for both the webhook event and a direct
 * lookup, since they carry the same object.
 */
export function purchaseFromSession(session, courseSlug) {
  const details = session.customer_details || {};
  return {
    // Normalised here, at the boundary, so the address we store, the address we
    // show her, and the address she later signs in with are the same string.
    email: normalizeEmail(details.email || session.customer_email),
    firstName: (details.name || '').trim().split(/\s+/)[0] || null,
    courseSlug,
    provider: 'stripe',
    externalId: session.id,
    providerCustomerId: typeof session.customer === 'string' ? session.customer : null,
    amountCents: session.amount_total ?? null,
    currency: session.currency || 'usd',
  };
}

/** Stripe considers a session bought when payment_status says so. */
export function isPaid(session) {
  return session?.payment_status === 'paid' || session?.payment_status === 'no_payment_required';
}
