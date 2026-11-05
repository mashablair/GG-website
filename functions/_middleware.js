// Runs on every request, before anything else.
//
// Two jobs: keep search engines out of preview builds, and keep everyone
// without a paid enrollment out of the thing they're trying to open.
//
// The gate lives here rather than in the pages because it's a single choke
// point. Adding a new page under /learn can't accidentally leave it
// unprotected — there's nowhere to forget.
//
// Which course is being asked for comes from the URL — /learn/<course>/… — and
// access is checked against *that* course. Owning one course grants nothing in
// another.

import { readSession } from './_lib/session.js';
import { courseContext } from './_lib/access.js';
import { getProduct, isCourse } from './_lib/catalog.js';
import { shell, escapeHtml, supportBlock } from './_lib/render.js';

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);

  const moved = toCanonicalHost(request, url);
  if (moved) return moved;

  const toAi = toAiConsulting(request, url);
  if (toAi) return toAi;

  if (needsAccount(url.pathname)) {
    const denied = await gate(context, url);
    if (denied) return withNoindex(denied, url);
  }

  return withNoindex(await context.next(), url);
}

/**
 * dating-goddess.com is the canonical domain for the dating site (Masha Blair).
 * www.dating-goddess.com goes to the bare domain the same way.
 *
 * mariablair.com is Maria Blair's AI consulting brand, not the dating site.
 * Pages there redirect to https://mariablairai.com/ (the AI site's root, not
 * the same path, so old dating paths don't 404 on the AI site).
 *
 * The exception is anything a woman may still have a mariablair.com link to
 * from before the move: emails sent then carry unsubscribe links, guide PDF
 * links, sign-in links and course links. Those (KEEP_ON_DATING_SITE) go to the
 * same path on dating-goddess.com, so they keep working. Unsubscribe in
 * particular has to keep working; it's what the privacy policy promises.
 *
 * Payment webhooks are answered right here instead of bounced: Stripe doesn't
 * follow redirects. That keeps purchases working even if a dashboard is missed.
 */
const CANONICAL_HOST = 'dating-goddess.com';
const OLD_HOSTS = new Set(['www.dating-goddess.com']);
const AI_HOSTS = new Set(['mariablair.com', 'www.mariablair.com']);
const AI_CONSULTING_URL = 'https://mariablairai.com/';

function toCanonicalHost(request, url) {
  if (!OLD_HOSTS.has(url.hostname)) return null;
  if (url.pathname.startsWith('/api/webhooks/')) return null;

  // 301 can turn a POST into a GET; 308 keeps the method and body.
  const safe = request.method === 'GET' || request.method === 'HEAD';
  return new Response(null, {
    status: safe ? 301 : 308,
    headers: {
      Location: `https://${CANONICAL_HOST}${url.pathname}${url.search}`,
    },
  });
}

function toAiConsulting(request, url) {
  if (!AI_HOSTS.has(url.hostname)) return null;
  if (url.pathname.startsWith('/api/webhooks/')) return null;

  // 301 can turn a POST into a GET; 308 keeps the method and body.
  const safe = request.method === 'GET' || request.method === 'HEAD';
  const location = keepOnDatingSite(url.pathname)
    ? `https://${CANONICAL_HOST}${url.pathname}${url.search}`
    : AI_CONSULTING_URL;
  return new Response(null, {
    status: safe ? 301 : 308,
    headers: { Location: location },
  });
}

/** Links from old emails that must keep working on the dating site. */
function keepOnDatingSite(pathname) {
  return (
    pathname.startsWith('/api/') || // unsubscribe, sign-in, guide signup
    /^\/[^/]+\/pdf\//.test(pathname) || // free guide PDFs
    ['/login', '/logout', '/welcome', '/dashboard', '/account', '/learn'].some(
      (p) => pathname === p || pathname.startsWith(p + '/')
    ) ||
    pathname.startsWith('/pay/')
  );
}

/** Everything a signed-in student owns lives behind one of these. */
function needsAccount(pathname) {
  return (
    pathname === '/learn' ||
    pathname.startsWith('/learn/') ||
    pathname === '/dashboard' ||
    pathname === '/account'
  );
}

/**
 * The course slug from /learn/<slug>/…, or null for pages that aren't inside a
 * course (the dashboard and the account page).
 */
function courseSlugFromPath(pathname) {
  if (!pathname.startsWith('/learn/')) return null;
  const [slug] = pathname.slice('/learn/'.length).split('/');
  return slug || null;
}

/**
 * Returns a response when the request should be refused, or null to let it
 * through.
 */
async function gate(context, url) {
  const { request, env } = context;
  const studentId = await readSession(env.SESSION_SECRET, request);

  if (!studentId) {
    // Send her to sign in, and back to whatever she was trying to open.
    const next = encodeURIComponent(url.pathname + url.search);
    return new Response(null, {
      status: 302,
      headers: { Location: `/login?next=${next}` },
    });
  }

  context.data.studentId = studentId;

  // The dashboard and the account page are hers whatever she owns — they're
  // where someone whose access lapsed goes to see what happened.
  const courseSlug = courseSlugFromPath(url.pathname);
  if (!courseSlug) return null;

  // A slug that isn't a course — a typo, or a consultation, which has nothing
  // to open. Not an access problem, so don't imply she's missing something.
  if (!isCourse(courseSlug)) return notACourse(courseSlug);

  // Enrollment and progress in one round-trip. Checked on every request rather
  // than trusted from the cookie, so a refund takes effect on her next page
  // load instead of whenever the session expires.
  const { hasAccess, completed } = await courseContext(env.DB, studentId, courseSlug);

  if (!hasAccess) return accessEndedPage(courseSlug);

  // Handed to the page, so nothing downstream has to ask again.
  context.data.courseSlug = courseSlug;
  context.data.completed = completed;
  context.data.hasAccess = hasAccess;

  return null;
}

/**
 * The parts of dating-goddess.com that are an application, not a website.
 *
 * This site is now both things at once. The marketing pages — the homepage, My
 * Story, the course and consultation pages — are the whole point of the SEO and
 * AI-discoverability work, and must stay indexable. Everything below is the
 * app, and has no business in a search result: it's either private, or a
 * redirect, or a page that only makes sense mid-purchase.
 *
 * Matching is by path prefix, so a new page under /learn or /account is covered
 * the moment it exists rather than the moment someone remembers.
 */
const APP_PREFIXES = [
  '/login',
  '/logout',
  '/dashboard',
  '/account',
  '/learn',
  '/welcome',
  '/pay',
  '/api',
];

function isAppPath(pathname) {
  return APP_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );
}

/**
 * Keep the app out of search results — and preview builds out entirely.
 *
 * Signed-in pages already carry a noindex meta tag, but a header is stronger:
 * it applies to redirects and to anything that never renders a document.
 */
function withNoindex(response, url) {
  const host = url.hostname;
  const isPreview =
    host.endsWith('.pages.dev') || host === 'localhost' || host === '127.0.0.1';

  if (!isPreview && !isAppPath(url.pathname)) return response;

  // Response headers are immutable until the response is cloned
  const out = new Response(response.body, response);
  out.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return out;
}

/**
 * Signed in, but the enrollment isn't active — a refund, a course she never
 * bought, or a second email address. Deliberately not a bare "403": she's a
 * real person who may well have paid, so it says what to do next.
 */
function accessEndedPage(courseSlug) {
  const product = getProduct(courseSlug);
  const name = product ? product.title : 'This course';

  const content = `
    <section class="welcome">
      <p class="eyebrow">Your access</p>
      <h1>${escapeHtml(name)} isn't on your account</h1>
      <div class="welcome__lead">
        <p>You're signed in, but this course isn't showing as active for you.
        That usually means a refund went through — or that you bought it with a
        different email address from the one you're signed in with.</p>
      </div>
      <a class="btn btn--primary welcome__cta" href="/dashboard">See what's on your account</a>
      ${supportBlock(
        'Think this is wrong?',
        "If you've paid and you're seeing this, get in touch — and please don't buy it again."
      )}
    </section>`;

  return new Response(
    shell({ title: 'Your access', content, sidebar: false, bare: true }),
    { status: 403, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}

/** /learn/<something that isn't a course>. */
function notACourse(slug) {
  const product = getProduct(slug);

  const content = `
    <section class="welcome">
      <p class="eyebrow">Hmm</p>
      <h1>There's nothing to open here</h1>
      <div class="welcome__lead">
        <p>${
          product
            ? `${escapeHtml(product.title)} isn't a course — there are no lessons to work through.`
            : "We can't find a course at that address."
        }</p>
      </div>
      <a class="btn btn--primary welcome__cta" href="/dashboard">Back to your dashboard</a>
    </section>`;

  return new Response(
    shell({ title: 'Not found', content, sidebar: false, bare: true }),
    { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}
