// Cloudflare Pages Function: POST /api/guide
//
// A free guide's PDF, in exchange for a first name and an email. The form
// sends `guide` (a key of GUIDES below); no key means the exit guide, so the
// original form keeps working unchanged.
//   - exit-guide: reading it online stays free (/exit-guide); the PDF is emailed.
//   - let-go: /let-go is just the sign-up page; the PDF is emailed.
//   - stop-chasing: reading it online stays free (/stop-chasing); the PDF is emailed.
//
// The PDF link only ever goes out by email, never in this response, so a fake
// address gets nothing and every lead on the list is a real inbox.
//
// What happens:
//   1. She's saved to `leads` on that guide's list — separate from the
//      course waitlist, see migrations/0002-leads.sql.
//   2. The response just says it worked; the page tells her to check her inbox.
//   3. She's emailed the PDF link from Masha, with an unsubscribe link.
//   4. Masha is told, but only the first time an address signs up.
//
// Steps 3 and 4 run in waitUntil and can't fail the signup: a mail outage
// costs an email, never a lead. The page tells her who to write to if the
// email doesn't arrive.

import { sendEmail, guideDeliveryEmail, guideSignupEmail } from '../_lib/email.js';
import { hmacHex } from '../_lib/crypto.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// The PDFs aren't linked from any page — they're handed out here, after the form.
// `list` is the leads list; `title` goes in the emails.
export const GUIDES = {
  'exit-guide': {
    list: 'exit-guide',
    title: 'How to Prepare Your Exit',
    pdf: '/exit-guide/pdf/k7q3m-how-to-prepare-your-exit.pdf',
  },
  'let-go': {
    list: 'let-go',
    title: 'How to Let Go of an Ex',
    pdf: '/let-go/pdf/w9h2t-how-to-let-go-of-an-ex.pdf',
  },
  'stop-chasing': {
    list: 'stop-chasing',
    title: 'Stop Chasing, Start Choosing',
    pdf: '/stop-chasing/pdf/r4v8n-stop-chasing-start-choosing.pdf',
  },
};

// Kept for anything that still imports the old single path.
export const GUIDE_PDF_PATH = GUIDES['exit-guide'].pdf;

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

  const guideKey = String(data.guide || 'exit-guide');
  const guide = Object.hasOwn(GUIDES, guideKey) ? GUIDES[guideKey] : null;
  if (!guide) {
    return json({ error: 'Unknown guide' }, 400);
  }
  const LIST = guide.list;

  const url = new URL(request.url);
  const pdfUrl = `${url.origin}${guide.pdf}`;

  // Honeypot: only bots fill this in. Report success, write and send nothing.
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
    sendEmail(env, { to: email, ...guideDeliveryEmail({ guide: guideKey, firstName, pdfUrl, unsubscribeUrl }) }).catch(
      (err) => console.error('guide delivery email failed:', err.message)
    )
  );

  if (isNew && env.NOTIFY_EMAIL) {
    waitUntil(
      sendEmail(env, {
        to: env.NOTIFY_EMAIL,
        ...guideSignupEmail({ title: guide.title, firstName, email, source, total }),
      }).catch((err) => console.error('guide notification failed:', err.message))
    );
  }

  return json({ ok: true });
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
