// Cloudflare Pages Function: POST /api/waitlist
// Stores waitlist signups in a D1 database bound as "DB".
// See README.md for the one-time D1 setup steps.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function onRequestPost({ request, env }) {
  let data;
  try {
    data = await request.json();
  } catch {
    return json({ error: 'Invalid request' }, 400);
  }

  const firstName = String(data.first_name || '').trim().slice(0, 100);
  const email = String(data.email || '').trim().toLowerCase().slice(0, 200);

  if (!firstName || !EMAIL_RE.test(email)) {
    return json({ error: 'Please provide a first name and a valid email.' }, 400);
  }

  try {
    await env.DB.prepare(
      `INSERT INTO waitlist (first_name, email, source, created_at)
       VALUES (?1, ?2, ?3, datetime('now'))
       ON CONFLICT(email) DO UPDATE SET first_name = excluded.first_name`
    )
      .bind(firstName, email, request.headers.get('Referer') || '')
      .run();
  } catch (err) {
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }

  return json({ ok: true });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
