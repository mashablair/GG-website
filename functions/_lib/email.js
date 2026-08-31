// Sending email.
//
// One function, one job: deliver a message. Which service does it is an
// implementation detail — swapping Cloudflare for something else later means
// editing this file and nothing else.
//
// Uses Cloudflare Email Sending through its REST API rather than the
// `send_email` binding. The binding is neater — no token — but Pages only
// simulates it locally: the deploy pipeline rejects it in wrangler.toml, and
// every build silently failed until it was removed. The REST API works from any
// Function, so that's what this uses.
//
// With no token, or with EMAIL_DEV_CONSOLE set, the message is written to the
// console instead. That keeps the whole sign-in flow testable locally without
// sending anything to a real inbox.

const API = 'https://api.cloudflare.com/client/v4';

export function emailIsConfigured(env) {
  if (env.EMAIL_DEV_CONSOLE === 'true') return false;
  return Boolean(env.CF_EMAIL_TOKEN && env.CF_ACCOUNT_ID && env.EMAIL_FROM);
}

/**
 * Send one message. Throws if sending was configured but failed — the caller
 * needs to know, because a login code that never arrives is a locked-out
 * customer.
 */
export async function sendEmail(env, { to, subject, html, text }) {
  if (!emailIsConfigured(env)) {
    console.log(
      `\n──────── email (not sent — console mode) ────────\n` +
        `To:      ${to}\nSubject: ${subject}\n\n${text}\n` +
        `────────────────────────────────────────────────\n`
    );
    return { delivered: false, reason: 'console-mode' };
  }

  const response = await fetch(`${API}/accounts/${env.CF_ACCOUNT_ID}/email/sending/send`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.CF_EMAIL_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      to,
      // `address` here, not `email` — the binding uses the other spelling for
      // the same field, which is an easy hour to lose.
      from: { address: env.EMAIL_FROM, name: env.EMAIL_FROM_NAME || 'Maria Blair' },
      subject,
      html,
      text,
    }),
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok || body.success === false) {
    const detail = body.errors?.map((e) => e.message).join('; ') || `HTTP ${response.status}`;
    throw new Error(`email send failed: ${detail}`);
  }

  return { delivered: true, result: body.result };
}

/** The login code email. Plain and short — it's read in three seconds. */
export function loginCodeEmail(code, firstName) {
  const hello = firstName ? `Hi ${firstName},` : 'Hi,';

  const text = `${hello}

Your sign-in code is ${code}

It works for the next 10 minutes. If you didn't ask to sign in, you can ignore
this — nobody can get into your account without this code.

Maria`;

  const html = `
<div style="font-family:-apple-system,'Helvetica Neue',sans-serif;font-size:16px;line-height:1.6;color:#2D2A26;max-width:480px;margin:0 auto;padding:32px 24px">
  <p>${escapeHtml(hello)}</p>
  <p>Your sign-in code is</p>
  <p style="font-family:Georgia,serif;font-size:38px;letter-spacing:8px;color:#7A2E3A;margin:28px 0;font-weight:600">${escapeHtml(
    code
  )}</p>
  <p style="color:#6B6560">It works for the next 10 minutes.</p>
  <p style="color:#6B6560;font-size:14px">If you didn't ask to sign in, you can ignore this — nobody can get into your account without this code.</p>
  <p style="font-family:Georgia,serif;font-style:italic;color:#7A2E3A">Maria</p>
</div>`;

  return { subject: `${code} is your sign-in code`, text, html };
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
