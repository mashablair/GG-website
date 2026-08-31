// Granting and checking course access.
//
// This is the seam between "someone paid" and "someone can watch". Nothing in
// here knows what a Stripe is — payment providers hand it a normalised set of
// facts and it does the same thing regardless. Adding Lava.top means writing an
// adapter that calls grantAccess(); it does not mean touching this file.

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

/** Emails are identity here, so they get normalised in exactly one place. */
export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

/** 'YYYY-MM-DD HH:MM:SS' — the shape SQLite's own datetime() produces. */
function sqlDateTime(ms) {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * Record a purchase and make sure the student exists.
 *
 * Safe to call repeatedly with the same (provider, externalId, courseSlug) —
 * the second and later calls change nothing. That is deliberate: the checkout
 * redirect and the provider's webhook both call this, in whatever order they
 * happen to arrive, and Lava retries a failed webhook up to 19 times.
 *
 * The course slug is part of that key, so one checkout containing two things
 * records both — call it once per product in the basket.
 *
 * Returns { studentId, enrollmentCreated }.
 */
export async function grantAccess(db, purchase) {
  const email = normalizeEmail(purchase.email);
  if (!email) throw new Error('grantAccess needs an email');

  const courseSlug = purchase.courseSlug;
  if (!courseSlug) throw new Error('grantAccess needs a courseSlug');

  // Find or create the student. If we already know them but never captured a
  // first name, and this purchase has one, fill it in without overwriting.
  await db
    .prepare(
      `INSERT INTO students (email, first_name) VALUES (?1, ?2)
       ON CONFLICT(email) DO UPDATE
         SET first_name = COALESCE(students.first_name, excluded.first_name)`
    )
    .bind(email, purchase.firstName || null)
    .run();

  const student = await db
    .prepare('SELECT id FROM students WHERE email = ?1')
    .bind(email)
    .first();

  if (!student) throw new Error('student row vanished right after insert');

  // A year from now unless the caller says otherwise. Recorded, not enforced —
  // storing it at purchase time locks in the terms she was actually sold, so
  // changing the policy later can't retroactively change what she was promised.
  const expiresAt = purchase.expiresAt ?? sqlDateTime(Date.now() + YEAR_MS);

  const result = await db
    .prepare(
      `INSERT INTO enrollments
         (student_id, course_slug, status, provider, external_id,
          provider_customer_id, amount_cents, currency, expires_at)
       VALUES (?1, ?2, 'active', ?3, ?4, ?5, ?6, ?7, ?8)
       ON CONFLICT (provider, external_id, course_slug) DO NOTHING`
    )
    .bind(
      student.id,
      courseSlug,
      purchase.provider,
      purchase.externalId,
      purchase.providerCustomerId || null,
      purchase.amountCents ?? null,
      purchase.currency || 'usd',
      expiresAt
    )
    .run();

  return {
    studentId: student.id,
    enrollmentCreated: (result.meta?.changes ?? 0) > 0,
  };
}

/**
 * Claim the one-time right to log someone in from a checkout redirect.
 *
 * The provider's transaction id sits in her URL bar after payment, so it can
 * end up in browser history or a screenshot. Redeeming it exactly once means a
 * leaked link is worthless afterwards.
 *
 * Returns true only for the caller that actually won the claim.
 */
export async function redeemForLogin(db, provider, externalId) {
  const result = await db
    .prepare(
      `UPDATE enrollments SET redeemed_at = datetime('now')
        WHERE provider = ?1 AND external_id = ?2 AND redeemed_at IS NULL`
    )
    .bind(provider, externalId)
    .run();

  return (result.meta?.changes ?? 0) > 0;
}

/** Does this student currently have access to this course? */
export async function hasAccess(db, studentId, courseSlug) {
  const row = await db
    .prepare(
      `SELECT 1 AS ok FROM enrollments
        WHERE student_id = ?1 AND course_slug = ?2 AND status = 'active'
        LIMIT 1`
    )
    .bind(studentId, courseSlug)
    .first();

  return Boolean(row);
}

/**
 * Mark a purchase refunded by buyer and course, rather than by transaction.
 *
 * Lava's refund and chargeback events name the refund, not the contract that
 * was originally paid, so there's no external id to match on. This is the
 * fallback: find her active enrollment in that course and end it.
 */
export async function revokeAccessByEmail(db, provider, email, courseSlug) {
  const result = await db
    .prepare(
      `UPDATE enrollments SET status = 'refunded'
        WHERE provider = ?1
          AND course_slug = ?2
          AND status = 'active'
          AND student_id = (SELECT id FROM students WHERE email = ?3)`
    )
    .bind(provider, courseSlug, normalizeEmail(email))
    .run();

  return (result.meta?.changes ?? 0) > 0;
}

/** Mark a purchase refunded, which removes access on her next page load. */
export async function revokeAccess(db, provider, externalId) {
  const result = await db
    .prepare(
      `UPDATE enrollments SET status = 'refunded'
        WHERE provider = ?1 AND external_id = ?2`
    )
    .bind(provider, externalId)
    .run();

  return (result.meta?.changes ?? 0) > 0;
}

/** Everything she's completed, as a Set of lesson ids. */
export async function completedLessons(db, studentId, courseSlug) {
  const { results } = await db
    .prepare('SELECT lesson_id FROM progress WHERE student_id = ?1 AND course_slug = ?2')
    .bind(studentId, courseSlug)
    .all();

  return new Set((results || []).map((r) => r.lesson_id));
}

/**
 * Is she enrolled, and what has she finished? Both answers in one round-trip.
 *
 * Every page under /course needs exactly these two facts, so they're fetched
 * together in the middleware and handed to the page. One trip, not two, and no
 * page has to remember to ask.
 */
export async function courseContext(db, studentId, courseSlug) {
  const [access, progress] = await db.batch([
    db
      .prepare(
        `SELECT 1 AS ok FROM enrollments
          WHERE student_id = ?1 AND course_slug = ?2 AND status = 'active' LIMIT 1`
      )
      .bind(studentId, courseSlug),
    db
      .prepare('SELECT lesson_id FROM progress WHERE student_id = ?1 AND course_slug = ?2')
      .bind(studentId, courseSlug),
  ]);

  return {
    hasAccess: (access.results || []).length > 0,
    completed: new Set((progress.results || []).map((r) => r.lesson_id)),
  };
}

/** Mark a lesson finished. Doing it twice is harmless. */
export async function markComplete(db, studentId, courseSlug, lessonId) {
  await db
    .prepare(
      `INSERT INTO progress (student_id, course_slug, lesson_id) VALUES (?1, ?2, ?3)
       ON CONFLICT (student_id, course_slug, lesson_id) DO NOTHING`
    )
    .bind(studentId, courseSlug, lessonId)
    .run();
}

/** Unmark a lesson. Also harmless to repeat. */
export async function markIncomplete(db, studentId, courseSlug, lessonId) {
  await db
    .prepare(
      'DELETE FROM progress WHERE student_id = ?1 AND course_slug = ?2 AND lesson_id = ?3'
    )
    .bind(studentId, courseSlug, lessonId)
    .run();
}

/**
 * How many lessons she's finished in each course, as { courseSlug: count }.
 *
 * One query for every course at once, so her dashboard costs the same whether
 * she owns one course or ten. Courses she hasn't started simply don't appear —
 * callers should treat a missing key as zero.
 */
export async function progressByCourse(db, studentId) {
  const { results } = await db
    .prepare(
      `SELECT course_slug, COUNT(*) AS done
         FROM progress WHERE student_id = ?1
        GROUP BY course_slug`
    )
    .bind(studentId)
    .all();

  const counts = {};
  for (const row of results || []) counts[row.course_slug] = row.done;
  return counts;
}

/** Her account, and everything she's bought. */
export async function studentProfile(db, studentId) {
  const student = await db
    .prepare('SELECT id, email, first_name, created_at FROM students WHERE id = ?1')
    .bind(studentId)
    .first();

  if (!student) return null;

  const { results } = await db
    .prepare(
      `SELECT course_slug, status, purchased_at, expires_at, amount_cents, currency
         FROM enrollments WHERE student_id = ?1 ORDER BY purchased_at DESC`
    )
    .bind(studentId)
    .all();

  return { ...student, enrollments: results || [] };
}

/** Change the name we greet her by. The only thing she can edit herself. */
export async function updateFirstName(db, studentId, firstName) {
  const clean = String(firstName || '').trim().slice(0, 60);
  await db
    .prepare('UPDATE students SET first_name = ?2 WHERE id = ?1')
    .bind(studentId, clean || null)
    .run();
  return clean;
}
