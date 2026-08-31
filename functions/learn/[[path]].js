// Everything under /learn/ — course homes, lessons, module shortcuts and
// resources.
//
//   /learn                              → her dashboard
//   /learn/<course>                     → that course's module grid
//   /learn/<course>/resources           → its downloads
//   /learn/<course>/<module>            → first lesson of that module
//   /learn/<course>/<module>/<lesson>   → the lesson
//
// The middleware has already proved three things before any of this runs: she
// is signed in, <course> is really a course, and she owns it. So the only job
// here is finding the right content and drawing it.

import {
  getCourse,
  getResources,
  findModule,
  findLesson,
  lessonId,
  flatLessons,
  totalLessons,
  stream,
} from '../_lib/catalog.js';
import { courseHomePage } from '../_lib/course-home.js';
import { playerUrl, signingIsConfigured } from '../_lib/stream.js';
import { shell, html, escapeHtml } from '../_lib/render.js';

export async function onRequestGet(context) {
  const parts = (context.params.path || []).filter(Boolean);

  // /learn on its own isn't a place — send her where everything is.
  if (parts.length === 0) {
    return Response.redirect(new URL('/dashboard', context.request.url), 302);
  }

  const [courseSlug, ...rest] = parts;
  const course = getCourse(courseSlug);

  // The middleware already refuses non-courses, so this is belt and braces.
  if (!course) return notFound(courseSlug);

  // Put there by the middleware, which fetched it alongside the access check —
  // one round-trip for both.
  const completed = context.data.completed || new Set();
  const percent = percentComplete(course, completed);

  // This catch-all also serves /learn/<course> itself — a sibling index.js
  // would be shadowed by it and never run.
  if (rest.length === 0) return courseHomePage(course, courseSlug, completed);

  // Checked before modules, so a module may not be called "resources".
  if (rest[0] === 'resources') {
    return resourcesPage(course, courseSlug, percent);
  }

  // /learn/<course>/<module> — send her to the first lesson of that module
  if (rest.length === 1) {
    const module = findModule(course, rest[0]);
    if (!module || !module.lessons.length) return notFound(courseSlug);
    return Response.redirect(
      new URL(
        `/learn/${courseSlug}/${module.slug}/${module.lessons[0].slug}`,
        context.request.url
      ),
      302
    );
  }

  if (rest.length === 2) {
    const found = findLesson(course, rest[0], rest[1]);
    if (!found) return notFound(courseSlug);
    return lessonPage(found, course, courseSlug, completed, percent, context.env);
  }

  return notFound(courseSlug);
}

function percentComplete(course, completed) {
  const total = totalLessons(course);
  const done = flatLessons(course).filter((l) =>
    completed.has(lessonId(l.module.slug, l.slug))
  ).length;
  return total ? Math.round((done / total) * 100) : 0;
}

// ---------- Lesson ----------

async function lessonPage(
  { module, lesson, prev, next },
  course,
  courseSlug,
  completed,
  percent,
  env
) {
  const base = `/learn/${courseSlug}`;
  const id = lessonId(module.slug, lesson.slug);
  const isDone = completed.has(id);

  const images = (lesson.images || [])
    .map(
      (img) => `
      <figure class="lesson__figure">
        <img src="${escapeHtml(img.src)}" alt="${escapeHtml(img.alt || '')}" loading="lazy" />
        ${img.caption ? `<figcaption>${escapeHtml(img.caption)}</figcaption>` : ''}
      </figure>`
    )
    .join('');

  const downloads = (lesson.resources || []).length
    ? `<div class="lesson__downloads">
         <h3>For this lesson</h3>
         <ul>
           ${lesson.resources
             .map(
               (r) =>
                 `<li><a href="${base}/download/${escapeHtml(r.file)}">${escapeHtml(r.label)}</a></li>`
             )
             .join('')}
         </ul>
       </div>`
    : '';

  const body = lesson.body && lesson.body.trim()
    ? `<div class="lesson__body">${lesson.body}</div>`
    : `<div class="lesson__body">
         <p class="lesson__pending">The written notes for this lesson are on their way. 💫</p>
       </div>`;

  const content = `
    <article class="lesson">
      <p class="lesson__crumb">
        <span class="lesson__crumb-num">Module ${module.number}</span>
        ${escapeHtml(module.title)}
      </p>
      <h1>${escapeHtml(lesson.title)}</h1>
      ${lesson.duration ? `<p class="lesson__duration">${escapeHtml(lesson.duration)}</p>` : ''}

      ${await videoBlock(lesson, env)}

      ${body}
      ${images}
      ${downloads}

      <div class="lesson__actions">
        <form method="POST" action="/api/progress">
          <input type="hidden" name="course" value="${escapeHtml(courseSlug)}" />
          <input type="hidden" name="lesson" value="${escapeHtml(id)}" />
          <input type="hidden" name="done" value="${isDone ? '0' : '1'}" />
          <input type="hidden" name="next" value="${escapeHtml(
            isDone
              ? `${base}/${module.slug}/${lesson.slug}`
              : next
                ? `${base}/${next.module.slug}/${next.slug}`
                : base
          )}" />
          <button class="btn ${isDone ? 'btn--ghost lesson__undo' : 'btn--primary'}" type="submit">
            ${isDone ? 'Mark as not complete' : 'Mark complete &amp; continue'}
          </button>
        </form>
        ${
          isDone && next
            ? `<a class="btn btn--primary" href="${base}/${next.module.slug}/${next.slug}">Next lesson →</a>`
            : ''
        }
      </div>

      <nav class="lesson__nav" aria-label="Lesson">
        ${
          prev
            ? `<a class="lesson__nav-link lesson__nav-link--prev" href="${base}/${prev.module.slug}/${prev.slug}">
                 <span>Previous</span><strong>${escapeHtml(prev.title)}</strong>
               </a>`
            : '<span></span>'
        }
        ${
          next
            ? `<a class="lesson__nav-link lesson__nav-link--next" href="${base}/${next.module.slug}/${next.slug}">
                 <span>Next</span><strong>${escapeHtml(next.title)}</strong>
               </a>`
            : `<a class="lesson__nav-link lesson__nav-link--next" href="${base}">
                 <span>You made it</span><strong>Back to the course</strong>
               </a>`
        }
      </nav>
    </article>
  `;

  return html(
    shell({
      title: lesson.title,
      content,
      course,
      courseSlug,
      current: id,
      completed,
      progress: percent,
    })
  );
}

async function videoBlock(lesson, env) {
  if (!lesson.video) return pendingVideo('This video is being edited right now.');

  // Lesson videos require signed URLs in Stream, so without a signing key the
  // player would load a URL Stream refuses — a black box with no explanation.
  // Say something useful instead, and make the cause obvious in the logs.
  if (!signingIsConfigured(env)) {
    console.error(
      `no Stream signing key configured — lesson "${lesson.title}" cannot play. ` +
        'Set STREAM_KEY_ID and STREAM_JWK, then redeploy.'
    );
    return pendingVideo("This video is just being set up. It'll be here shortly.");
  }

  // A short-lived signed URL, so a link copied out of this page stops working
  // shortly afterwards.
  const src = await playerUrl(env, lesson.video, stream);

  return `
    <div class="video">
      <iframe
        src="${escapeHtml(src)}"
        loading="lazy"
        allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;"
        allowfullscreen
        title="${escapeHtml(lesson.title)}"
      ></iframe>
    </div>`;
}

/** The card shown in place of a player when there's nothing to play yet. */
function pendingVideo(message) {
  return `
      <div class="video video--pending">
        <div class="video__pending-inner">
          <span class="video__pending-icon" aria-hidden="true">🎬</span>
          <p>${escapeHtml(message)}</p>
        </div>
      </div>`;
}

// ---------- Resources ----------

function resourcesPage(course, courseSlug, percent) {
  const base = `/learn/${courseSlug}`;
  const items = getResources(courseSlug)
    .map(
      (r) => `
      <li class="resource${r.ready ? '' : ' resource--pending'}">
        <span class="resource__icon" aria-hidden="true">📄</span>
        <span class="resource__label">${escapeHtml(r.label)}</span>
        ${
          r.ready
            ? `<a class="btn btn--ghost btn--nav" href="${base}/download/${escapeHtml(r.file)}">Download</a>`
            : '<span class="resource__soon">Coming soon</span>'
        }
      </li>`
    )
    .join('');

  const content = `
    <section class="resources-page">
      <p class="eyebrow">Yours to keep</p>
      <h1>Worksheets &amp; downloads</h1>
      <p class="resources-page__intro">
        Print them, fill them in, keep them on your phone. They're yours for as
        long as you have access to the course.
      </p>
      <ul class="resource-list">${items}</ul>
    </section>
  `;

  return html(
    shell({
      title: 'Resources',
      content,
      course,
      courseSlug,
      sidebar: false,
      progress: percent,
    })
  );
}

// ---------- 404 ----------

function notFound(courseSlug) {
  const content = `
    <section class="resources-page">
      <p class="eyebrow">Hmm</p>
      <h1>We can't find that lesson</h1>
      <p class="resources-page__intro">It may have been renamed or moved.</p>
      <a class="btn btn--primary" href="/learn/${escapeHtml(courseSlug)}">Back to the course</a>
    </section>`;
  return new Response(shell({ title: 'Not found', content, sidebar: false, bare: true }), {
    status: 404,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
