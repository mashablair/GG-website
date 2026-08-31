// Everything that knows what a Lava.top is.
//
// Lava sells to Russia and the CIS, where Stripe doesn't operate. It reaches
// this codebase the same way Stripe does — as an adapter that ends in
// grantAccess() — so nothing downstream knows or cares which one paid.
//
// It differs from Stripe in one way that matters. Stripe signs the webhook
// body, so a valid signature proves both "this came from Stripe" and "nobody
// edited it". Lava authenticates with a shared secret in a header, which proves
// only the first. Anyone who learns that secret could post a made-up purchase.
//
// So a Lava webhook is never trusted on its own: we call their API and ask
// whether that contract really exists, really completed, and really belongs to
// that buyer. The webhook tells us where to look; their API decides.
//
// Treat lavatop-docs.yaml as a sketch, not a contract. GET /api/v2/products is
// documented as items[].data.{id,title,offers} with a POST/PRODUCT type; the
// live API returns those fields flat on the item, with the *product* type
// (COURSE, BOOK…) in `type` and no `data` at all. Their own SDK's signature
// check is likewise a stub. Every field read here is optional-chained on
// purpose — verify shapes against the real API before relying on them.

import { timingSafeEqual } from './crypto.js';
import { normalizeEmail } from './access.js';

const API = 'https://gate.lava.top';

function apiBase(env) {
  return (env && env.LAVA_API_BASE) || API;
}

export function lavaIsConfigured(env) {
  return Boolean(env.LAVA_API_KEY && env.LAVA_WEBHOOK_SECRET);
}

/** Can we actually sell through Lava, or only receive its webhooks? */
export function lavaCheckoutReady(env, lava) {
  return Boolean(env.LAVA_API_KEY && lava?.offerId);
}

/**
 * Create a contract and get the URL of Lava's payment widget.
 *
 * Unlike Stripe, Lava wants the buyer's email before payment rather than
 * collecting it itself — which is why there's a form in front of this. The
 * upside is that we know the contract id before she pays, so the return URL can
 * carry it without needing a placeholder.
 *
 * `offerId` is the price, not the product. A product has one offer per currency
 * and period, and the two ids look alike.
 *
 * `method` picks how she pays. Cards go through SMART_GLOCAL, Lava's default
 * for roubles; СБП is only available through PAY2ME and has to be asked for by
 * name. Both are confirmed working on this account.
 */
export async function createInvoice(env, { email, offerId, currency, returnUrls, method }) {
  if (!env.LAVA_API_KEY) throw new Error('missing LAVA_API_KEY');

  const sbp = method === 'sbp';

  const response = await fetch(`${apiBase(env)}/api/v3/invoice`, {
    method: 'POST',
    headers: {
      'X-Api-Key': env.LAVA_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      offerId,
      currency: currency || 'RUB',
      // Their widget and their receipts follow this, so a Russian buyer gets a
      // Russian checkout even though the course itself is in English.
      buyerLanguage: 'RU',
      periodicity: 'ONE_TIME',
      // Omitted for cards, so Lava applies its own default rather than us
      // hard-coding a provider it might change.
      ...(sbp ? { paymentProvider: 'PAY2ME', paymentMethod: 'SBP' } : {}),
      successful_return_url: returnUrls.success,
      failure_return_url: returnUrls.failure,
      cancel_return_url: returnUrls.cancel,
    }),
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    // Their message is carried along, not just logged: some of these are the
    // buyer's problem and only she can fix them. "Incorrect email to purchase"
    // is a 400 and comes back for an address Lava won't sell to — the seller's
    // own, for one. Telling her to try again in a minute would be a loop.
    const error = new Error(
      `Lava refused the invoice (${response.status}): ${body.error || 'unknown'}`
    );
    error.status = response.status;
    error.lavaError = typeof body.error === 'string' ? body.error : '';
    throw error;
  }

  // paymentUrl is null for a free product — a promo code taking it to zero, for
  // instance. There's nothing to pay, so the contract is already done.
  return { id: body.id, paymentUrl: body.paymentUrl || null, status: body.status };
}

/**
 * Is this request really from Lava?
 *
 * They offer HTTP Basic or an X-Api-Key header; which one you get depends on
 * how the endpoint is set up in their dashboard, so both are accepted. The
 * comparison is constant-time for the same reason signature checks are.
 */
export function webhookAuthOk(request, secret) {
  if (!secret) return false;

  const apiKey = request.headers.get('X-Api-Key');
  if (apiKey) return timingSafeEqual(apiKey, secret);

  const auth = request.headers.get('Authorization') || '';
  if (auth.startsWith('Basic ')) {
    let decoded;
    try {
      decoded = atob(auth.slice(6));
    } catch {
      return false;
    }
    // The secret is stored as the whole "user:password" pair.
    return timingSafeEqual(decoded, secret);
  }

  return false;
}

/**
 * Purchase webhooks are camelCase and flat; refunds and chargebacks are
 * snake_case and nested under `data`. Same endpoint, two shapes — easy to miss
 * and confusing to debug, so they're separated here once.
 */
export function eventKind(body) {
  const type = body?.eventType || body?.event_type || '';

  if (type === 'payment.success') return 'purchase';
  if (type === 'subscription.recurring.payment.success') return 'purchase';
  if (type === 'refund.success') return 'refund';
  if (type === 'chargeback.initiated') return 'refund';
  return 'ignore';
}

/** The facts we need from a successful-payment webhook. */
export function purchaseFromWebhook(body) {
  return {
    email: normalizeEmail(body?.buyer?.email),
    contractId: body?.contractId || null,
    productId: body?.product?.id || null,
    amountCents: toCents(body?.amount),
    currency: String(body?.currency || 'rub').toLowerCase(),
    // 'completed' for one-off products; subscriptions say 'subscription-active'
    completed: body?.status === 'completed' || body?.status === 'subscription-active',
  };
}

/** The facts we need from a refund or chargeback webhook. */
export function refundFromWebhook(body) {
  const data = body?.data || {};
  return {
    email: normalizeEmail(data.customer_email),
    // These events name the refund, not the original contract, so access is
    // revoked by matching the buyer rather than the transaction id.
    refundId: data.refund_id || data.chargeback_id || null,
    productId: data.product?.product_id || null,
  };
}

/**
 * Ask Lava whether a contract is real and paid.
 *
 * This is the check that makes a shared-secret webhook safe to act on. Returns
 * the invoice, or null if Lava doesn't recognise it.
 */
export async function fetchInvoice(env, contractId) {
  if (!env.LAVA_API_KEY) throw new Error('missing LAVA_API_KEY');
  if (!contractId) return null;

  const response = await fetch(
    `${apiBase(env)}/api/v1/invoices/${encodeURIComponent(contractId)}`,
    { headers: { 'X-Api-Key': env.LAVA_API_KEY } }
  );

  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Lava returned ${response.status} for invoice`);

  return response.json();
}

/**
 * Does this invoice justify granting access?
 *
 * Their status enum is NEW / IN_PROGRESS / COMPLETED / FAILED. Only COMPLETED
 * means the money arrived.
 *
 * The buyer email is compared too: the webhook's email is what we'd create the
 * account with, so if it disagrees with Lava's record, something is wrong and
 * we should do nothing rather than guess.
 */
export function invoiceConfirms(invoice, email) {
  if (!invoice) return false;
  if (String(invoice.status).toUpperCase() !== 'COMPLETED') return false;

  const onRecord = normalizeEmail(invoice.buyer?.email);
  return Boolean(onRecord) && onRecord === normalizeEmail(email);
}

function toCents(amount) {
  const n = Number(amount);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}
