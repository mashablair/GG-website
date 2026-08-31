// POST /api/webhooks/lava
//
// Lava.top telling us about a payment, refund or chargeback. The Stripe
// equivalent of this file is api/webhooks/stripe.js, and the two converge on
// the same grantAccess() — which is the whole point of the provider-agnostic
// design.
//
// Register this URL in the Lava dashboard, with a secret that matches
// LAVA_WEBHOOK_SECRET.
//
// One behavioural note: Lava retries a failed delivery 19 times over several
// hours. Answering 2xx stops that, so anything we've genuinely handled — or
// genuinely don't care about — gets a 200. A 5xx is reserved for problems a
// retry might actually fix.

import {
  webhookAuthOk,
  eventKind,
  purchaseFromWebhook,
  refundFromWebhook,
  fetchInvoice,
  invoiceConfirms,
} from '../../_lib/lava.js';
import { grantAccess, revokeAccessByEmail } from '../../_lib/access.js';
import { courseForLavaProduct } from '../../_lib/catalog.js';

export async function onRequestPost({ request, env }) {
  if (!webhookAuthOk(request, env.LAVA_WEBHOOK_SECRET)) {
    console.error('lava webhook rejected: bad or missing credentials');
    return new Response('Unauthorized', { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  try {
    switch (eventKind(body)) {
      case 'purchase':
        await handlePurchase(env, body);
        break;
      case 'refund':
        await handleRefund(env, body);
        break;
      default:
        // Failed payments, cancellations, everything else. Acknowledge so Lava
        // stops retrying something we were never going to act on.
        break;
    }
  } catch (err) {
    // A retry might succeed — the database could be briefly unavailable, or
    // their API could be. grantAccess is idempotent, so retrying is safe.
    console.error('lava webhook handler failed:', err);
    return new Response('Handler error', { status: 500 });
  }

  return new Response('ok');
}

async function handlePurchase(env, body) {
  const purchase = purchaseFromWebhook(body);

  if (!purchase.completed) {
    console.log(`lava: contract ${purchase.contractId} not completed yet — ignoring`);
    return;
  }

  if (!purchase.email) {
    console.error(`lava: contract ${purchase.contractId} arrived with no buyer email`);
    return;
  }

  // The webhook is only a pointer. Lava's own record decides whether this
  // happened — without this, anyone holding the shared secret could post
  // themselves a course.
  const invoice = await fetchInvoice(env, purchase.contractId);
  if (!invoiceConfirms(invoice, purchase.email)) {
    console.error(
      `lava: refusing contract ${purchase.contractId} — Lava's record doesn't confirm it ` +
        `(status ${invoice?.status ?? 'not found'})`
    );
    return;
  }

  const courseSlug = courseForLavaProduct(purchase.productId);
  if (!courseSlug) {
    console.log(`lava: product ${purchase.productId} isn't a course — nothing to grant`);
    return;
  }

  const { studentId, enrollmentCreated } = await grantAccess(env.DB, {
    email: purchase.email,
    firstName: null, // Lava's purchase webhook doesn't carry a name
    courseSlug,
    provider: 'lava',
    externalId: purchase.contractId,
    amountCents: purchase.amountCents,
    currency: purchase.currency,
  });

  console.log(
    `lava: ${enrollmentCreated ? 'enrolled' : 'already enrolled'} student ${studentId} ` +
      `(${purchase.email}) in ${courseSlug}`
  );
}

async function handleRefund(env, body) {
  const refund = refundFromWebhook(body);

  // Refund and chargeback events name the refund, not the original contract,
  // so there's no external_id to match on. Revoke by buyer and course instead.
  const courseSlug = courseForLavaProduct(refund.productId);
  if (!refund.email || !courseSlug) {
    console.error(
      `lava: refund ${refund.refundId} couldn't be matched to a student and course`
    );
    return;
  }

  const revoked = await revokeAccessByEmail(env.DB, 'lava', refund.email, courseSlug);

  console.log(
    `lava: refund ${refund.refundId} for ${refund.email} — ${revoked ? 'access revoked' : 'no match'}`
  );
}
