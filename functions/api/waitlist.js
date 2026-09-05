// Cloudflare Pages Function: POST /api/waitlist
// Stores waitlist signups in a D1 database bound as "DB", and emails Maria.
// See README.md for the one-time D1 setup steps.

import { sendEmail, waitlistSignupEmail } from '../_lib/email.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function onRequestPost({ request, env, waitUntil }) {
  let data;
  try {
    data = await request.json();
  } catch {
    return json({ error: 'Invalid request' }, 400);
  }

  // Honeypot: only bots fill this in. Report success so they don't retry.
  // Nothing is written and nothing is sent — this is also what keeps the
  // notification from becoming a way to spam Maria's inbox.
  if (String(data.company || '').trim()) {
    return json({ ok: true });
  }

  const firstName = String(data.first_name || '').trim().slice(0, 100);
  const email = String(data.email || '').trim().toLowerCase().slice(0, 200);

  if (!firstName || !EMAIL_RE.test(email)) {
    return json({ error: 'Please provide a first name and a valid email.' }, 400);
  }

  const source = request.headers.get('Referer') || '';
  let isNew = false;
  let total = 0;

  try {
    // Asked before the insert, because ON CONFLICT makes the two cases
    // indistinguishable afterwards — and someone re-submitting the form is not
    // news worth emailing about.
    const existing = await env.DB.prepare('SELECT id FROM waitlist WHERE email = ?1')
      .bind(email)
      .first();
    isNew = !existing;

    await env.DB.prepare(
      `INSERT INTO waitlist (first_name, email, source, created_at)
       VALUES (?1, ?2, ?3, datetime('now'))
       ON CONFLICT(email) DO UPDATE SET first_name = excluded.first_name`
    )
      .bind(firstName, email, source)
      .run();

    if (isNew) {
      const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM waitlist').first();
      total = row?.n ?? 0;
    }
  } catch (err) {
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }

  // She's on the list — that part is done and saved. The notification is a
  // convenience for Maria, so it must not be able to fail the signup or make
  // the woman wait for an SMTP round trip. waitUntil lets the response go back
  // immediately while the send finishes in the background, and the catch means
  // a mail outage costs a notification, never a subscriber.
  if (isNew && env.NOTIFY_EMAIL) {
    const message = waitlistSignupEmail({ firstName, email, source, total });
    waitUntil(
      sendEmail(env, { to: env.NOTIFY_EMAIL, ...message }).catch((err) =>
        console.error('waitlist notification failed:', err.message)
      )
    );
  }

  return json({ ok: true });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
