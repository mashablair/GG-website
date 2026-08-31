// One course's home page — what a student sees at /learn/<course>
//
// This is the module grid for a single course. Her *account* dashboard, which
// lists every course and consultation she owns, is /dashboard — a different
// page with a different job.

import { lessonId, totalLessons, flatLessons } from './catalog.js';
import { shell, html, escapeHtml } from './render.js';

export function courseHomePage(course, courseSlug, completed = new Set()) {
  const total = totalLessons(course);
  const done = flatLessons(course).filter((l) =>
    completed.has(lessonId(l.module.slug, l.slug))
  ).length;
  const percent = total ? Math.round((done / total) * 100) : 0;

  const base = `/learn/${courseSlug}`;

  // Where "continue" goes: the first lesson she hasn't finished. Once she's
  // done everything it points back to the start, for a second pass.
  const nextUp = flatLessons(course).find(
    (l) => !completed.has(lessonId(l.module.slug, l.slug))
  );
  const first = course.modules[0];
  const continueHref = nextUp
    ? `${base}/${nextUp.module.slug}/${nextUp.slug}`
    : `${base}/${first.slug}/${first.lessons[0].slug}`;
  const continueLabel = !done
    ? 'Start the course 🐆'
    : nextUp
      ? 'Continue where you left off 🐆'
      : 'Revisit the course 🐆';

  const modules = course.modules
    .map((module) => {
      const firstLesson = module.lessons[0];
      const href = firstLesson ? `${base}/${module.slug}/${firstLesson.slug}` : '#';
      const n = module.lessons.filter((l) => completed.has(lessonId(module.slug, l.slug))).length;
      const finished = n === module.lessons.length && module.lessons.length > 0;
      const fill = module.lessons.length ? (n / module.lessons.length) * 100 : 0;

      return `
        <a class="module-card${finished ? ' is-done' : ''}" href="${href}">
          <div class="module-card__head">
            <span class="module-card__num">${module.number}</span>
            <span class="module-card__done${finished ? ' is-done' : ''}">
              ${finished ? '✓ Done' : n ? `${n}/${module.lessons.length}` : ''}
            </span>
          </div>
          <h3>${escapeHtml(module.title)}</h3>
          ${module.subtitle ? `<p class="module-card__sub">${escapeHtml(module.subtitle)}</p>` : ''}
          <p class="module-card__summary">${escapeHtml(module.summary || '')}</p>
          <div class="progress-bar progress-bar--slim"><span style="width:${fill}%"></span></div>
          <span class="module-card__meta">
            ${module.lessons.length} ${module.lessons.length === 1 ? 'lesson' : 'lessons'}
          </span>
        </a>`;
    })
    .join('');

  const content = `
    <section class="dash-hero">
      <p class="eyebrow">Welcome back</p>
      <h1>${escapeHtml(course.title)}</h1>
      <p class="dash-hero__sub">${escapeHtml(course.tagline)}</p>

      <div class="dash-hero__progress">
        <div class="progress-bar progress-bar--large"><span style="width:${percent}%"></span></div>
        <p class="dash-hero__count"><strong>${done}</strong> of ${total} lessons complete</p>
      </div>

      <a class="btn btn--primary dash-hero__continue" href="${continueHref}">${continueLabel}</a>
    </section>

    <section class="dash-modules">
      <div class="section-header">
        <p class="eyebrow">The Curriculum</p>
        <h2>Your modules</h2>
      </div>
      <div class="module-grid">${modules}</div>
    </section>

    <section class="dash-resources">
      <div class="dash-resources__card">
        <h3>Worksheets &amp; downloads</h3>
        <p>Every checklist, template and worksheet from the course, in one place.</p>
        <a class="btn btn--ghost" href="${base}/resources">Open resources</a>
      </div>
    </section>
  `;

  return html(
    shell({
      title: course.title,
      content,
      course,
      courseSlug,
      sidebar: false,
      progress: percent,
    })
  );
}
