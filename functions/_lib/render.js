// Shared HTML shell for every signed-in page.
// The server renders the structure; js/course.js handles the mobile drawer.
//
// Every page belongs to one of two places:
//
//   inside a course   pass `course` and `courseSlug` — you get the curriculum
//                     rail, the course's own progress bar, and a Resources link
//   outside a course  the dashboard and the account page — no curriculum, and
//                     the brand points back to /dashboard
//
// Nothing here names a specific course. It renders whichever one it's handed.

import { lessonId, support } from "./catalog.js";

export function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** The curriculum list — used as the lesson sidebar and the mobile drawer. */
export function curriculum(course, courseSlug, currentId, completed = new Set()) {
  const modules = course.modules
    .map((module) => {
      const lessons = module.lessons
        .map((lesson) => {
          const id = lessonId(module.slug, lesson.slug);
          const current = id === currentId;
          const done = completed.has(id);
          return `
            <li>
              <a class="curriculum__lesson${current ? " is-current" : ""}${done ? " is-done" : ""}"
                 href="/learn/${escapeHtml(courseSlug)}/${module.slug}/${lesson.slug}"
                 data-lesson-id="${escapeHtml(id)}"
                 ${current ? 'aria-current="page"' : ""}>
                <span class="curriculum__check" aria-hidden="true"></span>
                <span class="curriculum__lesson-title">${escapeHtml(lesson.title)}</span>
              </a>
            </li>`;
        })
        .join("");

      const open = currentId && currentId.startsWith(`${module.slug}/`);
      const doneInModule = module.lessons.filter((l) =>
        completed.has(lessonId(module.slug, l.slug))
      ).length;

      return `
        <details class="curriculum__module" ${open ? "open" : ""}>
          <summary>
            <span class="curriculum__num">${module.number}</span>
            <span class="curriculum__module-title">${escapeHtml(module.title)}</span>
            <span class="curriculum__count">${doneInModule ? `${doneInModule}/${module.lessons.length}` : ""}</span>
          </summary>
          <ul>${lessons}</ul>
        </details>`;
    })
    .join("");

  return `<nav class="curriculum" aria-label="Course curriculum">${modules}</nav>`;
}

/**
 * The same links in the header and in the mobile drawer.
 *
 * They have to be in both: the header row is hidden below 900px, so without the
 * drawer copy there is no way to reach the dashboard, resources or the account
 * page on a phone at all.
 *
 * "Dashboard" always means *her* dashboard — everything she's bought — not one
 * course's home. Inside a course there's a Resources link too; outside one it
 * would have no course to belong to.
 *
 * Sign out is here rather than tucked away because signing out is cheap now —
 * a browser she's used before gets back in with one tap, no code.
 */
function navLinks(courseSlug) {
  return `
          <a href="/dashboard">Dashboard</a>
          ${
            courseSlug
              ? `<a href="/learn/${escapeHtml(courseSlug)}/resources">Resources</a>`
              : ""
          }
          <a href="/account">Account</a>
          <a class="app-bar__account" href="/logout">Sign out</a>`;
}

/**
 * Full page document.
 *  title       browser tab title
 *  content     the <main> contents
 *  course      the course object, when this page is inside one
 *  courseSlug  its slug, for building links
 *  current     lesson id to highlight in the sidebar, or null
 *  completed   set of finished lesson ids, for checkmarks
 *  sidebar     whether to show the curriculum rail (needs `course`)
 *  bare        no navigation at all — for pages seen before signing in, where
 *              "Dashboard" and "Sign out" would be meaningless or broken
 *  progress    percent for the header bar, or null to hide it
 */
export function shell({
  title,
  content,
  course = null,
  courseSlug = null,
  current = null,
  completed = new Set(),
  sidebar = true,
  bare = false,
  progress = null
}) {
  // The curriculum rail only means anything inside a course.
  const showSidebar = sidebar && Boolean(course);

  const brandHref = bare ? "/" : courseSlug ? `/learn/${courseSlug}` : "/dashboard";
  const brandName = course ? course.title : "Maria Blair";
  const suffix = course ? course.title : "Maria Blair";
  const links = navLinks(courseSlug);

  // A course's own home page is titled after the course, and the suffix is too
  // — "The Dating Method — The Dating Method" helps nobody.
  const tabTitle = title === suffix ? title : `${title} — ${suffix}`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(tabTitle)}</title>
    <meta name="robots" content="noindex" />
    <link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🐆</text></svg>" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,500;0,600;1,500&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
    <link rel="stylesheet" href="/css/style.css?v=3" />
    <link rel="stylesheet" href="/css/course.css?v=3" />
  </head>
  <body class="app">
    <header class="app-bar">
      <div class="app-bar__inner">
        <a class="app-bar__brand" href="${escapeHtml(brandHref)}">
          <img src="/images/logo-cat.png" alt="" width="729" height="210" />
          <span>${escapeHtml(brandName)}</span>
        </a>
${
  bare
    ? ""
    : `
        ${
          progress === null
            ? ""
            : `<div class="app-bar__progress">
          <div class="progress-bar"><span style="width:${progress}%"></span></div>
          <span class="app-bar__progress-label">${progress}%</span>
        </div>`
        }

        <nav class="app-bar__links" aria-label="Course">
          ${links}
        </nav>

        <button class="app-bar__toggle" data-drawer-toggle aria-label="Menu" aria-expanded="false">
          <span></span><span></span><span></span>
        </button>`
}
      </div>
    </header>

    ${bare ? "" : '<div class="app-scrim" data-scrim></div>'}

    <div class="app-body${showSidebar ? "" : " app-body--wide"}">
      ${
        bare
          ? ""
          : `<aside class="app-rail" data-drawer>
        <nav class="app-rail__nav" aria-label="Your account">
          ${links}
        </nav>
        ${
          showSidebar
            ? `<p class="app-rail__heading">Curriculum</p>
        ${curriculum(course, courseSlug, current, completed)}`
            : ""
        }
      </aside>`
      }
      <main class="app-main">${content}</main>
    </div>

    <script src="/js/course.js"></script>
  </body>
</html>`;
}

/**
 * How to reach a human. Used on every page where something might have gone
 * wrong — the whole point is that it's the same everywhere, so it can't drift.
 *
 * `extra` is a sentence specific to the situation, added after the address.
 */
export function supportBlock(heading, extra = '') {
  return `
    <div class="welcome__support">
      <h2>${escapeHtml(heading)}</h2>
      <p>
        Email me at
        <a href="mailto:${escapeHtml(support.email)}">${escapeHtml(support.email)}</a>
        and I'll sort it out personally.${extra ? ` ${extra}` : ''}
      </p>
      <p>
        Or message me on Instagram at
        <a href="${escapeHtml(support.instagram)}" target="_blank" rel="noopener">${escapeHtml(
          support.instagramHandle
        )}</a>
        if that's easier.
      </p>
    </div>`;
}

export function html(body) {
  return new Response(body, {
    headers: { "Content-Type": "text/html; charset=utf-8" }
  });
}
