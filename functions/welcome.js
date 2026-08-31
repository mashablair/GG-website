// GET /welcome?session_id=cs_…
//
// Where Stripe sends her after paying. This is the fast half of the purchase
// flow: she arrives with a browser attached, so we can set up her account and
// log her in without asking her to go and find an email.
//
// It does not trust the URL. The session id is checked against Stripe's API,
// and access is granted only if Stripe itself says the thing is paid.
//
// It also doesn't depend on the webhook having arrived. Whichever of the two
// gets here first creates the enrollment; grantAccess() makes the loser a
// no-op. That's why there's no race to worry about.
//
// It deliberately shows a page rather than bouncing straight into the course.
// Someone who has just handed over $247 should see that it worked, see which
// email address her access is attached to, and — if anything went wrong — see
// how to reach a human.

import { retrieveCheckoutSession, purchaseFromSession, isPaid } from './_lib/stripe.js';
import { grantAccess, redeemForLogin } from './_lib/access.js';
import { productsInSession, productTitle, isCourse } from './_lib/catalog.js';
import {
  createSession,
  sessionCookie,
  createDeviceToken,
  deviceCookie,
} from './_lib/session.js';
import { shell, html, escapeHtml, supportBlock } from './_lib/render.js';

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get('session_id');

  if (!sessionId) return problem('Already bought the course?', NO_SESSION);

  let checkout;
  try {
    checkout = await retrieveCheckoutSession(env, sessionId);
  } catch (err) {
    console.error('welcome: could not reach Stripe:', err.message);
    return problem('Your payment went through', STRIPE_UNREACHABLE);
  }

  if (!checkout || !isPaid(checkout)) {
    console.warn(`welcome: session ${sessionId} is missing or unpaid`);
    return problem("We couldn't confirm that payment", NOT_CONFIRMED);
  }

  // A checkout can contain more than one product — the cross-sell on the
  // Payment Link means a buyer might take the consultation too. Enroll her in
  // every course in the basket, and ignore anything that isn't one.
  const courseSlugs = productsInSession(checkout);
  if (!courseSlugs.length) {
    console.error(`welcome: session ${sessionId} contained no known course`);
    return problem('Thank you for your purchase', NO_COURSE);
  }

  const base = purchaseFromSession(checkout, null);
  if (!base.email) {
    console.error(`welcome: session ${sessionId} has no email`);
    return problem('Almost there', NO_EMAIL);
  }

  let studentId = null;
  for (const courseSlug of courseSlugs) {
    ({ studentId } = await grantAccess(env.DB, { ...base, courseSlug }));
  }

  // The session id lives in her URL bar, so it can leak into history or a
  // screenshot. It logs someone in exactly once, ever.
  const firstVisit = await redeemForLogin(env.DB, 'stripe', base.externalId);

  const page = welcomePage({
    firstName: base.firstName,
    email: base.email,
    firstVisit,
    slugs: courseSlugs,
  });

  if (!firstVisit) return html(page);

  const token = await createSession(env.SESSION_SECRET, studentId);

  const headers = new Headers({ 'Content-Type': 'text/html; charset=utf-8' });
  headers.append('Set-Cookie', sessionCookie(token, request.url));
  headers.append(
    'Set-Cookie',
    deviceCookie(await createDeviceToken(env.SESSION_SECRET, studentId), request.url)
  );

  return new Response(page, { headers });
}

// ---------- The page she actually sees ----------

function welcomePage({ firstName, email, firstVisit, slugs = [] }) {
  const greeting = firstName ? `Welcome, ${escapeHtml(firstName)}` : 'Welcome';

  // Name what she actually bought, so a basket with two things doesn't claim
  // she bought one. Falls back to something true but vague if the catalog
  // doesn't recognise it.
  const names = slugs.map((s) => productTitle(s));
  const bought =
    names.length === 1
      ? `${escapeHtml(names[0])} is yours`
      : names.length > 1
        ? `${escapeHtml(names.slice(0, -1).join(', '))} and ${escapeHtml(
            names[names.length - 1]
          )} are yours`
        : "It's all yours";

  // One course? Take her straight into it. Anything else — several things, or
  // a consultation with no lessons — and the dashboard is the honest landing.
  const courses = slugs.filter(isCourse);
  const cta =
    courses.length === 1
      ? { href: `/learn/${courses[0]}`, label: 'Start the course 🐆' }
      : { href: '/dashboard', label: 'Go to your dashboard 🐆' };

  const content = `
    <section class="welcome">
      <div class="welcome__mark" aria-hidden="true">🐆</div>
      <p class="eyebrow">Payment received</p>
      <h1>${greeting}</h1>
      <p class="welcome__lead">
        You're in. ${bought}, and everything is ready whenever you are.
      </p>

      <div class="welcome__card">
        <p class="welcome__label">Your access is linked to</p>
        <p class="welcome__email">${escapeHtml(email)}</p>
        <p class="welcome__note">
          Sign in with this address any time, from any device. There's no
          password to remember — we email you a code.
        </p>
      </div>

      <a class="btn btn--primary welcome__cta" href="${escapeHtml(cta.href)}">${cta.label}</a>

      ${
        firstVisit
          ? ''
          : `<p class="welcome__reused">
               You've opened this link before, so we haven't signed you in again
               — that keeps your account safe. Use <a href="/login">sign in</a>
               to get back to your lessons.
             </p>`
      }

      ${supportBlock('Something not right?', "If you've been charged, you have the course — even if something on this page went wrong.")}
    </section>`;

  return shell({ title: 'Welcome', content, sidebar: false, bare: true });
}

// ---------- When the happy path doesn't apply ----------

function problem(heading, body) {
  const content = `
    <section class="welcome">
      <p class="eyebrow">Your purchase</p>
      <h1>${escapeHtml(heading)}</h1>
      <div class="welcome__lead">${body}</div>
      <a class="btn btn--primary welcome__cta" href="/login">Sign in</a>
      ${supportBlock('Need a hand?')}
    </section>`;

  return html(shell({ title: heading, content, sidebar: false, bare: true }));
}

const NO_SESSION = `
  <p>If you've already bought the course, sign in with the email address you
  used at checkout and you'll go straight to your lessons.</p>`;

const STRIPE_UNREACHABLE = `
  <p>Your payment went through, but we couldn't finish setting you up just now.
  Nothing is lost. Sign in with the email address you used at checkout — and if
  that doesn't work yet, give it a few minutes and try again.</p>`;

const NOT_CONFIRMED = `
  <p>We couldn't match this link to a completed payment. If you haven't been
  charged, nothing has happened and you can safely try again.</p>
  <p>If you <strong>have</strong> been charged, don't worry and don't pay
  again — get in touch below and I'll open it up for you straight away.</p>`;

const NO_COURSE = `
  <p>Your payment went through, but we couldn't tell which course it was for.
  That's our end, not yours. Get in touch below and I'll fix it right away.</p>`;

const NO_EMAIL = `
  <p>Your payment went through, but no email address came with it, so there's
  nothing to attach your access to. Get in touch below and I'll set you up
  manually — it takes a minute.</p>`;
