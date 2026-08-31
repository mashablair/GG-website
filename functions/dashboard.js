// /dashboard — everything she's bought, in one place.
//
// This is the front door once someone is signed in. It's deliberately *not* a
// course page: a student may own one course, three courses and a consultation,
// or a consultation and nothing else, and all of those should land somewhere
// that makes sense.
//
// Courses get a progress bar and a way back in. Services — the $97 call —
// appear so she can see what she's paid for, but there's nothing to open.
// Anything refunded is shown quietly rather than hidden, so "where did it go?"
// answers itself.

import { studentProfile, progressByCourse } from './_lib/access.js';
import { getProduct, products, isCourse, totalLessons } from './_lib/catalog.js';
import { shell, html, escapeHtml, supportBlock } from './_lib/render.js';

export async function onRequestGet({ env, data }) {
  const [profile, done] = await Promise.all([
    studentProfile(env.DB, data.studentId),
    progressByCourse(env.DB, data.studentId),
  ]);

  if (!profile) {
    return html(
      shell({ title: 'Dashboard', content: MISSING, sidebar: false, bare: true })
    );
  }

  return html(dashboardPage(profile, done));
}

function dashboardPage(profile, doneByCourse) {
  const active = profile.enrollments.filter((e) => e.status === 'active');
  const ended = profile.enrollments.filter((e) => e.status !== 'active');

  // One card per thing she owns, courses first — they're what she came for.
  const owned = [...active].sort((a, b) => {
    const rank = (e) => (isCourse(e.course_slug) ? 0 : 1);
    return rank(a) - rank(b);
  });

  const greeting = profile.first_name
    ? `Welcome back, ${escapeHtml(profile.first_name)}`
    : 'Welcome back';

  const cards = owned.length
    ? owned.map((e) => card(e, doneByCourse[e.course_slug] || 0)).join('')
    : `<p class="dash-empty">There's nothing on your account yet.</p>`;

  const content = `
    <section class="dash-hero">
      <p class="eyebrow">Your account</p>
      <h1>${greeting}</h1>
      <p class="dash-hero__sub">Everything you've got with me, in one place.</p>
    </section>

    <section class="dash-modules">
      <div class="module-grid">${cards}</div>
    </section>

    ${ended.length ? endedBlock(ended) : ''}
    ${moreFromMaria(profile.enrollments)}

    ${supportBlock('Something missing?', "If you've bought something that isn't showing here, tell me and I'll put it right.")}
  `;

  return shell({ title: 'Your dashboard', content, sidebar: false });
}

/** One thing she owns. A course opens; a consultation just reassures. */
function card(enrollment, doneCount) {
  const slug = enrollment.course_slug;
  const product = getProduct(slug);
  const title = product ? product.title : slug;

  if (!product || product.type !== 'course') {
    return `
      <div class="module-card module-card--service">
        <div class="module-card__head">
          <span class="module-card__num" aria-hidden="true">★</span>
          <span class="module-card__done">Purchased</span>
        </div>
        <h3>${escapeHtml(title)}</h3>
        <p class="module-card__summary">${escapeHtml(product?.tagline || '')}</p>
        <span class="module-card__meta">
          ${enrollment.purchased_at ? `Bought ${escapeHtml(enrollment.purchased_at.slice(0, 10))}` : ''}
        </span>
      </div>`;
  }

  const total = totalLessons(product.content);
  // Clamp: a renamed lesson slug can leave a progress row that no longer
  // matches anything, and "36 of 35" would look broken.
  const done = Math.min(doneCount, total);
  const percent = total ? Math.round((done / total) * 100) : 0;
  const finished = total > 0 && done >= total;

  const label = !done ? 'Start' : finished ? 'Revisit' : 'Continue';

  return `
    <a class="module-card${finished ? ' is-done' : ''}" href="/learn/${escapeHtml(slug)}">
      <div class="module-card__head">
        <span class="module-card__num" aria-hidden="true">🐆</span>
        <span class="module-card__done${finished ? ' is-done' : ''}">
          ${finished ? '✓ Done' : done ? `${done}/${total}` : ''}
        </span>
      </div>
      <h3>${escapeHtml(title)}</h3>
      <p class="module-card__summary">${escapeHtml(product.tagline || '')}</p>
      <div class="progress-bar progress-bar--slim"><span style="width:${percent}%"></span></div>
      <span class="module-card__meta">${label} · ${done} of ${total} lessons</span>
    </a>`;
}

/** Refunded or lapsed. Shown, not hidden — it answers its own question. */
function endedBlock(ended) {
  const rows = ended
    .map(
      (e) => `
      <li class="account__course account__course--ended">
        <div>
          <strong>${escapeHtml(getProduct(e.course_slug)?.title || e.course_slug)}</strong>
          <span class="account__meta">Access ended</span>
        </div>
      </li>`
    )
    .join('');

  return `
    <section class="dash-resources">
      <div class="dash-resources__card">
        <h3>No longer active</h3>
        <ul class="account__courses">${rows}</ul>
      </div>
    </section>`;
}

/**
 * What she doesn't own yet.
 *
 * Only shown when there's actually something to show, so it never renders an
 * empty "buy more" shelf — and never nags someone who already has everything.
 */
function moreFromMaria(enrollments) {
  const has = new Set(enrollments.map((e) => e.course_slug));
  const rest = Object.values(products).filter((p) => !has.has(p.slug));
  if (!rest.length) return '';

  const items = rest
    .map(
      (p) => `
      <li class="resource">
        <span class="resource__icon" aria-hidden="true">${p.type === 'course' ? '📘' : '☎️'}</span>
        <span class="resource__label">${escapeHtml(p.title)}</span>
        <a class="btn btn--ghost btn--nav" href="${escapeHtml(p.salesUrl || '/')}">Take a look</a>
      </li>`
    )
    .join('');

  return `
    <section class="dash-resources">
      <div class="dash-resources__card">
        <h3>Also from me</h3>
        <ul class="resource-list">${items}</ul>
      </div>
    </section>`;
}

const MISSING = `
  <section class="account">
    <h1>We can't find your account</h1>
    <p class="welcome__lead">Try signing in again.</p>
    <a class="btn btn--primary" href="/login">Sign in</a>
  </section>`;
