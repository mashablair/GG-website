// POST /api/webhooks/stripe
//
// Stripe's server-to-server notification that something happened. This is the
// reliable half of the purchase flow: it arrives whether or not she stayed in
// her browser, closed the tab, or paid on a phone and never came back.
//
// Register this URL in the Stripe dashboard under Developers → Webhooks, for
// the events `checkout.session.completed` and `charge.refunded`.

import {
  verifyWebhook,
  purchaseFromSession,
  isPaid,
  findSessionByPaymentIntent,
  retrieveCheckoutSession,
} from '../../_lib/stripe.js';
import { grantAccess, revokeAccess } from '../../_lib/access.js';
import { productsInSession } from '../../_lib/catalog.js';

export async function onRequestPost({ request, env }) {
  // The raw bytes, not the parsed object — the signature covers exactly these.
  const rawBody = await request.text();

  let event;
  try {
    event = await verifyWebhook(
      rawBody,
      request.headers.get('Stripe-Signature'),
      env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    // 400 tells Stripe not to bother retrying — a bad signature stays bad.
    console.error('stripe webhook rejected:', err.message);
    return new Response(`Webhook signature verification failed: ${err.message}`, { status: 400 });
  }

  try {
    switch (event.type) {
      // Cards settle immediately and arrive as `completed` already paid.
      //
      // Klarna, bank transfers and the other delayed methods do not: they send
      // `completed` while still unpaid, and then `async_payment_succeeded` once
      // the money actually lands. Both routes go through the same handler,
      // which grants nothing unless Stripe says the session is paid — so the
      // unpaid `completed` is ignored and the later event does the work.
      //
      // Without the async event, anyone paying by Klarna would be charged and
      // never get access.
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded':
        await handlePurchase(env, event.data.object);
        break;

      case 'charge.refunded':
        await handleRefund(env, event.data.object);
        break;

      case 'checkout.session.async_payment_failed':
        // Her bank declined a delayed payment. Nothing to undo — access was
        // never granted — but worth a line in the log if she gets in touch.
        console.log(`delayed payment failed for session ${event.data.object?.id}`);
        break;

      default:
        // Anything else is fine and uninteresting; acknowledge so Stripe stops.
        break;
    }
  } catch (err) {
    // 500 makes Stripe retry, which is what we want for a transient database
    // problem. grantAccess is idempotent, so a retry can't double-enroll.
    console.error(`stripe webhook handler failed for ${event.type}:`, err);
    return new Response('Handler error', { status: 500 });
  }

  return new Response('ok');
}

async function handlePurchase(env, eventSession) {
  if (!isPaid(eventSession)) {
    console.log(`ignoring unpaid checkout session ${eventSession.id}`);
    return;
  }

  // Re-read the session from Stripe rather than trusting the event body. The
  // event omits line_items, so without this there's no price id to map to a
  // course — and asking Stripe directly is a second check that this really
  // happened, on top of the signature.
  const session =
    (await retrieveCheckoutSession(env, eventSession.id)) || eventSession;

  const base = purchaseFromSession(session, null);

  if (!base.email) {
    // Without an email there is no account to create. Loud, because it means
    // the Payment Link isn't collecting one.
    console.error(`checkout session ${session.id} arrived with no email`);
    return;
  }

  // A basket can hold several products; enroll her in each course it contained
  // and ignore anything that isn't a course.
  const courseSlugs = productsInSession(session);
  if (!courseSlugs.length) {
    console.log(`checkout session ${session.id} contained no course — nothing to grant`);
    return;
  }

  for (const courseSlug of courseSlugs) {
    const { studentId, enrollmentCreated } = await grantAccess(env.DB, { ...base, courseSlug });
    console.log(
      `webhook: ${enrollmentCreated ? 'enrolled' : 'already enrolled'} student ${studentId} ` +
        `(${base.email}) in ${courseSlug}`
    );
  }
}

async function handleRefund(env, charge) {
  // Enrollments are keyed on the checkout session id, but a refund only names
  // the payment intent, so ask Stripe which session that payment belonged to.
  const session = await findSessionByPaymentIntent(env, charge.payment_intent);

  if (!session) {
    console.error(`refund for payment_intent ${charge.payment_intent} matched no checkout session`);
    return;
  }

  const revoked = await revokeAccess(env.DB, 'stripe', session.id);
  console.log(`webhook: refund for ${session.id} — ${revoked ? 'access revoked' : 'no match'}`);
}
