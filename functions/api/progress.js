// POST /api/progress — mark a lesson finished, or unfinish it.
//
// A plain form post rather than JavaScript, so it works the same on a flaky
// phone connection as on a laptop. The button submits, the row is written, and
// she's redirected on to the next lesson.
//
// The lesson form sends which course it belongs to, because this endpoint sits
// outside /learn and so isn't covered by the gate in _middleware.js. It does
// its own two checks: is she signed in, and does she own *this* course.

import { markComplete, markIncomplete, hasAccess } from '../_lib/access.js';
import { readSession } from '../_lib/session.js';
import { getCourse, findLesson } from '../_lib/catalog.js';

export async function onRequestPost({ request, env }) {
  const studentId = await readSession(env.SESSION_SECRET, request);
  if (!studentId) return redirect('/login');

  const form = await request.formData();
  const courseSlug = String(form.get('course') || '');
  const lessonRef = String(form.get('lesson') || '');
  const done = form.get('done') === '1';

  // Has to name a real course, not a consultation and not a typo.
  const course = getCourse(courseSlug);
  if (!course) return new Response('Unknown course', { status: 400 });

  // Only ids that name a real lesson in that course — otherwise the progress
  // table fills with whatever anyone cares to post.
  const [moduleSlug, lessonSlug] = lessonRef.split('/');
  if (!findLesson(course, moduleSlug, lessonSlug)) {
    return new Response('Unknown lesson', { status: 400 });
  }

  // Owning one course must not let her write progress into another.
  if (!(await hasAccess(env.DB, studentId, courseSlug))) {
    return new Response('Not enrolled', { status: 403 });
  }

  if (done) {
    await markComplete(env.DB, studentId, courseSlug, lessonRef);
  } else {
    await markIncomplete(env.DB, studentId, courseSlug, lessonRef);
  }

  return redirect(safeNext(form.get('next')) || `/learn/${courseSlug}`);
}

function redirect(location) {
  return new Response(null, { status: 302, headers: { Location: location } });
}

/** Only ever redirect within this site. */
function safeNext(value) {
  const next = String(value || '');
  return next.startsWith('/') && !next.startsWith('//') ? next : null;
}
