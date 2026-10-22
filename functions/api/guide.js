// Cloudflare Pages Function: POST /api/guide
//
// The free exit guide's PDF, in exchange for a first name and an email.
// Reading the guide online stays free (/exit-guide); this is only the download.
//
// What happens:
//   1. She's saved to `leads` on the "exit-guide" list — separate from the
//      course waitlist, see migrations/0002-leads.sql.
//   2. The response carries the PDF link, so she can download it right away.
//   3. She's emailed the same link from Maria, with an unsubscribe link.
//   4. Maria is told, but only the first time an address signs up.
//
// Steps 3 and 4 run in waitUntil and can't fail the signup: she has the PDF
// the moment step 1 succeeds, and a mail outage costs an email, never a lead.

import { sendEmail, guideDeliveryEmail, guideSignupEmail } from '../_lib/email.js';
import { hmacHex } from '../_lib/crypto.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LIST = 'exit-guide';

// Not linked from any page — it's handed out here, after the form.
export const GUIDE_PDF_PATH = '/exit-guide/pdf/k7q3m-how-to-prepare-your-exit.pdf';

// The table is created on first use so the form works on the first deploy,
// before anyone has run the migration by hand. Cheap: it's a no-op once it exists.
const CREATE_LEADS = `CREATE TABLE IF NOT EXISTS leads (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  list             TEXT NOT NULL,
  first_name       TEXT NOT NULL,
  email            TEXT NOT NULL,
  source           TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  unsubscribed_at  TEXT,
  UNIQUE (email, list)
)`;

export async function onRequestPost({ request, env, waitUntil }) {
  let data;
  try {
    data = await request.json();
  } catch {
    return json({ error: 'Invalid request' }, 400);
  }

  const url = new URL(request.url);
  const pdfUrl = `${url.origin}${GUIDE_PDF_PATH}`;

  // Honeypot: only bots fill this in. Report success, write and send nothing.
  if (String(data.company || '').trim()) {
    return json({ ok: true, pdf: GUIDE_PDF_PATH });
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
    await env.DB.prepare(CREATE_LEADS).run();

    const existing = await env.DB.prepare('SELECT id FROM leads WHERE email = ?1 AND list = ?2')
      .bind(email, LIST)
      .first();
    isNew = !existing;

    // Signing up again counts as wanting the emails again.
    await env.DB.prepare(
      `INSERT INTO leads (list, first_name, email, source, created_at)
       VALUES (?1, ?2, ?3, ?4, datetime('now'))
       ON CONFLICT(email, list) DO UPDATE SET
         first_name = excluded.first_name,
         unsubscribed_at = NULL`
    )
      .bind(LIST, firstName, email, source)
      .run();

    if (isNew) {
      const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM leads WHERE list = ?1')
        .bind(LIST)
        .first();
      total = row?.n ?? 0;
    }
  } catch (err) {
    console.error('guide signup failed:', err.message);
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }

  const unsubscribeUrl = await unsubscribeLink(env, url.origin, email);

  waitUntil(
    sendEmail(env, { to: email, ...guideDeliveryEmail({ firstName, pdfUrl, unsubscribeUrl }) }).catch(
      (err) => console.error('guide delivery email failed:', err.message)
    )
  );

  if (isNew && env.NOTIFY_EMAIL) {
    waitUntil(
      sendEmail(env, {
        to: env.NOTIFY_EMAIL,
        ...guideSignupEmail({ firstName, email, source, total }),
      }).catch((err) => console.error('guide notification failed:', err.message))
    );
  }

  return json({ ok: true, pdf: GUIDE_PDF_PATH });
}

/**
 * A one-click unsubscribe link. The token is an HMAC of the address, so nobody
 * can unsubscribe someone else by editing the URL. Without SESSION_SECRET
 * (local dev) the link still renders but won't verify.
 */
export async function unsubscribeLink(env, origin, email) {
  const token = env.SESSION_SECRET ? await hmacHex(env.SESSION_SECRET, `unsub:${email}`) : 'dev';
  return `${origin}/api/unsubscribe?e=${encodeURIComponent(email)}&t=${token}`;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
