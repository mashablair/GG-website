// /account — what she can see and change about herself.
//
// Deliberately small. The only editable field is her first name; everything
// else is shown so she can check it, not change it.
//
// Her email address is not editable, and that's a decision rather than an
// omission. It's the key her whole account hangs on: it's what Stripe recorded
// at checkout, what a sign-in code gets sent to, and what a future purchase
// will match on. Letting her change it here would need the new address verified
// before the switch, or she could lock herself out by typing it wrong — and it
// would still leave her old purchases pointing somewhere else. That's the
// account-merge problem, and it belongs in an admin tool with a human looking
// at it, not on a self-service form.

import { studentProfile, updateFirstName } from './_lib/access.js';
import { getProduct } from './_lib/catalog.js';
import { shell, html, escapeHtml, supportBlock } from './_lib/render.js';

export async function onRequestGet({ env, data }) {
  const profile = await studentProfile(env.DB, data.studentId);
  if (!profile) return html(shell({ title: 'Account', content: MISSING, sidebar: false, bare: true }));
  return html(accountPage(profile));
}

export async function onRequestPost({ request, env, data }) {
  const form = await request.formData();
  await updateFirstName(env.DB, data.studentId, form.get('first_name'));

  const profile = await studentProfile(env.DB, data.studentId);
  return html(accountPage(profile, 'Saved.'));
}

function accountPage(profile, notice) {
  const enrollments = profile.enrollments.length
    ? profile.enrollments.map(enrollmentRow).join('')
    : `<li class="account__course account__course--none">
         <span>Nothing on your account yet.</span>
       </li>`;

  const content = `
    <section class="account">
      <p class="eyebrow">Your account</p>
      <h1>Your details</h1>

      ${notice ? `<p class="account__notice" role="status">${escapeHtml(notice)}</p>` : ''}

      <form class="account__form" method="POST" action="/account">
        <label class="auth__label" for="first_name">What should I call you?</label>
        <input class="auth__input" id="first_name" name="first_name" type="text"
               maxlength="60" value="${escapeHtml(profile.first_name || '')}"
               placeholder="Your first name" />
        <p class="account__hint">Used to say hello — nothing more.</p>
        <button class="btn btn--primary account__save" type="submit">Save</button>
      </form>

      <div class="account__block">
        <p class="welcome__label">You sign in with</p>
        <p class="welcome__email">${escapeHtml(profile.email)}</p>
        <p class="account__hint">
          This is the address you used at checkout, and where your sign-in codes
          go. It can't be changed here — it's what links you to what you've
          bought. If you need it moved to a different address, message me and
          I'll do it properly.
        </p>
      </div>

      <div class="account__block">
        <p class="welcome__label">What you have</p>
        <ul class="account__courses">${enrollments}</ul>
      </div>

      <div class="account__actions">
        <a class="btn btn--ghost" href="/dashboard">Back to your dashboard</a>
        <a class="btn btn--ghost" href="/logout">Sign out</a>
      </div>
      <p class="account__hint account__signout-note">
        Signing out keeps this device remembered, so you can get back in with
        one tap. On a shared or borrowed computer use
        <a href="/logout?everywhere">sign out and forget this device</a>
        instead — the next person will need a code.
      </p>

      ${supportBlock('Need something changed?')}
    </section>`;

  return shell({ title: 'Your account', content, sidebar: false });
}

function enrollmentRow(e) {
  const product = getProduct(e.course_slug);
  // Falls back to the slug rather than showing nothing, so a product removed
  // from the catalog still appears on the account of someone who bought it.
  const name = product?.title || e.course_slug;
  const openable = product?.type === 'course';
  const refunded = e.status !== 'active';
  const price =
    e.amount_cents != null
      ? `${(e.amount_cents / 100).toFixed(2)} ${String(e.currency || 'usd').toUpperCase()}`
      : null;

  return `
    <li class="account__course${refunded ? ' account__course--ended' : ''}">
      <div>
        <strong>${escapeHtml(name)}</strong>
        <span class="account__meta">
          ${refunded ? 'Access ended' : 'Active'}${price ? ` · ${escapeHtml(price)}` : ''}
          ${e.purchased_at ? ` · bought ${escapeHtml(e.purchased_at.slice(0, 10))}` : ''}
        </span>
      </div>
      ${
        refunded || !openable
          ? ''
          : `<a class="btn btn--ghost btn--nav" href="/learn/${escapeHtml(e.course_slug)}">Open</a>`
      }
    </li>`;
}

const MISSING = `
  <section class="account">
    <h1>We can't find your account</h1>
    <p class="welcome__lead">Try signing in again.</p>
    <a class="btn btn--primary" href="/login">Sign in</a>
  </section>`;
