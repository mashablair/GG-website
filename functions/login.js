// /login — two steps on one page, no JavaScript required.
//
//   GET  /login                    the email form, or a one-tap return
//   POST /login  step=device       sign back in on a browser she's used before
//   POST /login  step=request      issue a code, then show the code form
//   POST /login  step=verify       check the code and sign her in
//
// Both POSTs answer identically whether or not the address has an account.
// Saying "no account found" would let anyone check who bought the course.

import { issueCode, verifyCode, LOGIN_LIMITS } from './_lib/login.js';
import { sendEmail, loginCodeEmail, emailIsConfigured } from './_lib/email.js';
import {
  createSession,
  sessionCookie,
  createDeviceToken,
  readDeviceToken,
  deviceCookie,
  clearDeviceCookie,
} from './_lib/session.js';
import { normalizeEmail, studentProfile } from './_lib/access.js';
import { shell, html, escapeHtml, supportBlock } from './_lib/render.js';

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const next = url.searchParams.get('next');

  // "Not you?" — stop trusting this browser and start clean.
  if (url.searchParams.has('forget')) {
    return new Response(emailForm({ next }), {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Set-Cookie': clearDeviceCookie(request.url),
      },
    });
  }

  // A browser she's signed in on before gets straight back in with one tap.
  // The student is looked up rather than trusted from the cookie, so a deleted
  // account can't leave someone bouncing between here and the gate.
  const deviceStudentId = await readDeviceToken(env.SESSION_SECRET, request);
  if (deviceStudentId) {
    const profile = await studentProfile(env.DB, deviceStudentId);
    if (profile) return html(returningForm({ next, profile }));
  }

  return html(emailForm({ next }));
}

export async function onRequestPost({ request, env }) {
  const form = await request.formData();
  const step = form.get('step');
  const next = safeNext(form.get('next'));

  if (step === 'device') return handleDevice({ request, env, next });
  if (step === 'verify') return handleVerify({ request, env, form, next });
  return handleRequest({ request, env, form, next });
}

// ---------- Signing back in on a browser she's used before ----------
//
// No code, by design: this browser already proved itself once, and the cookie
// is signed so it can't be forged. SameSite=Lax means another site can't POST
// here on her behalf.
//
// The trade-off is deliberate and it's why "sign out everywhere" exists: this
// survives an ordinary sign-out, so on a shared computer she should use the
// other one.

async function handleDevice({ request, env, next }) {
  const studentId = await readDeviceToken(env.SESSION_SECRET, request);
  if (!studentId) return html(emailForm({ next }));

  const profile = await studentProfile(env.DB, studentId);
  if (!profile) return html(emailForm({ next }));

  const token = await createSession(env.SESSION_SECRET, studentId);
  const headers = new Headers({ Location: next || '/dashboard' });
  headers.append('Set-Cookie', sessionCookie(token, request.url));

  return new Response(null, { status: 302, headers });
}

// ---------- Step 1: ask for a code ----------

async function handleRequest({ request, env, form, next }) {
  const email = normalizeEmail(form.get('email'));

  if (!email.includes('@')) {
    return html(emailForm({ next, error: 'That doesn’t look like an email address.' }));
  }

  const { student, code } = await issueCode(env.DB, env.SESSION_SECRET, email);

  // A real account gets a real email. An unknown address gets nothing — but
  // both land on the same page, so the two are indistinguishable from outside.
  if (student && code) {
    const message = loginCodeEmail(code, student.first_name);
    try {
      await sendEmail(env, { to: student.email, ...message });
    } catch (err) {
      console.error('login: sending the code failed:', err.message);
      return html(codeForm({ email, next, error: SEND_FAILED }));
    }
  }

  // With no email provider configured the code only reaches the console. Say
  // so — but only on localhost, so a misconfigured production site can never
  // show this to a real student.
  const local = ['localhost', '127.0.0.1'].includes(new URL(request.url).hostname);
  const devNote = local && !emailIsConfigured(env);

  return html(codeForm({ email, next, devNote }));
}

// ---------- Step 2: check the code ----------

async function handleVerify({ request, env, form, next }) {
  const email = normalizeEmail(form.get('email'));
  const code = String(form.get('code') || '');

  const studentId = await verifyCode(env.DB, env.SESSION_SECRET, email, code);

  if (!studentId) {
    return html(
      codeForm({
        email,
        next,
        error:
          'That code didn’t work. It may have expired — they last ' +
          `${LOGIN_LIMITS.CODE_TTL_MINUTES} minutes. Ask for a new one below.`,
      })
    );
  }

  const token = await createSession(env.SESSION_SECRET, studentId);

  const headers = new Headers({ Location: next || '/dashboard' });
  headers.append('Set-Cookie', sessionCookie(token, request.url));
  headers.append(
    'Set-Cookie',
    deviceCookie(await createDeviceToken(env.SESSION_SECRET, studentId), request.url)
  );

  return new Response(null, { status: 302, headers });
}

// ---------- Pages ----------

function returningForm({ next, profile }) {
  const hello = profile.first_name ? `Welcome back, ${escapeHtml(profile.first_name)}` : 'Welcome back';

  const content = `
    <section class="auth">
      <p class="eyebrow">You've been here before</p>
      <h1>${hello}</h1>
      <p class="auth__lead">
        You're signed in as <strong>${escapeHtml(profile.email)}</strong> on this
        device. No code needed.
      </p>

      <form class="auth__form" method="POST" action="/login">
        <input type="hidden" name="step" value="device" />
        ${next ? `<input type="hidden" name="next" value="${escapeHtml(next)}" />` : ''}
        <button class="btn btn--primary auth__submit" type="submit">Continue to the course 🐆</button>
      </form>

      <p class="auth__forget">
        Not you, or on someone else's computer?
        <a href="/login${next ? `?next=${encodeURIComponent(next)}&forget=1` : '?forget=1'}">Sign in as someone else</a>
      </p>

      ${helpBlock()}
    </section>`;

  return shell({ title: 'Welcome back', content, sidebar: false, bare: true });
}

function emailForm({ next, error }) {
  const content = `
    <section class="auth">
      <p class="eyebrow">Welcome back</p>
      <h1>Sign in</h1>
      <p class="auth__lead">
        Use the email address you bought the course with. We'll send you a
        six-digit code — there's no password to remember.
      </p>

      <form class="auth__form" method="POST" action="/login">
        <input type="hidden" name="step" value="request" />
        ${next ? `<input type="hidden" name="next" value="${escapeHtml(next)}" />` : ''}
        <label class="auth__label" for="email">Your email</label>
        <input
          class="auth__input" id="email" name="email" type="email"
          autocomplete="email" inputmode="email" required autofocus
          placeholder="you@example.com" />
        ${error ? `<p class="auth__error" role="alert">${escapeHtml(error)}</p>` : ''}
        <button class="btn btn--primary auth__submit" type="submit">Send my code</button>
      </form>

      ${helpBlock()}
    </section>`;

  return shell({ title: 'Sign in', content, sidebar: false, bare: true });
}

function codeForm({ email, next, error, devNote }) {
  const content = `
    <section class="auth">
      ${
        devNote
          ? `<p class="auth__dev">Local development: no email provider is
             configured, so the code was printed to the wrangler console
             instead of being sent.</p>`
          : ''
      }
      <p class="eyebrow">Check your inbox</p>
      <h1>Enter your code</h1>
      <p class="auth__lead">
        If <strong>${escapeHtml(email)}</strong> has access to the course, a
        six-digit code is on its way. It's good for
        ${LOGIN_LIMITS.CODE_TTL_MINUTES} minutes.
      </p>

      <form class="auth__form" method="POST" action="/login">
        <input type="hidden" name="step" value="verify" />
        <input type="hidden" name="email" value="${escapeHtml(email)}" />
        ${next ? `<input type="hidden" name="next" value="${escapeHtml(next)}" />` : ''}
        <label class="auth__label" for="code">Six-digit code</label>
        <input
          class="auth__input auth__input--code" id="code" name="code" type="text"
          inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="one-time-code"
          required autofocus placeholder="000000" />
        ${error ? `<p class="auth__error" role="alert">${error}</p>` : ''}
        <button class="btn btn--primary auth__submit" type="submit">Sign in</button>
      </form>

      <form class="auth__resend" method="POST" action="/login">
        <input type="hidden" name="step" value="request" />
        <input type="hidden" name="email" value="${escapeHtml(email)}" />
        ${next ? `<input type="hidden" name="next" value="${escapeHtml(next)}" />` : ''}
        <button type="submit">Didn't get it? Send another</button>
      </form>

      ${helpBlock()}
    </section>`;

  return shell({ title: 'Enter your code', content, sidebar: false, bare: true });
}

function helpBlock() {
  return supportBlock(
    "Didn't get it?",
    'Check your spam folder first — that\'s where it usually hides.'
  );
}

const SEND_FAILED =
  'We couldn’t send that code just now. Try again in a moment — and if it ' +
  'keeps failing, message me and I’ll sign you in myself.';

/** Only ever redirect within this site — never to a URL someone supplied. */
function safeNext(value) {
  const next = String(value || '');
  return next.startsWith('/') && !next.startsWith('//') ? next : null;
}
