# mariablair.com — Glorious Goddess 🐆

Maria's whole web presence in one place: the marketing site **and** the teaching
platform behind it. Plain HTML, CSS and JavaScript with Cloudflare Pages
Functions — no framework, no build step.

This is the **hub** in the "one brain, many faces" plan. Exactly one place holds
accounts, payments, access and video. Marketing sites like dating-goddess.com
stay dumb and static: they tell a story, hand the buyer to a payment link, and
she lands back here to sign in and learn.

Live at **https://mariablair.com**.

See [COMMANDS.md](COMMANDS.md) for everything you'll need to run day to day.

## The two halves

| | |
| --- | --- |
| **The website** | `/`, `/my-story`, `/course`, `/consultations`, `/contact`, plus the legal pages. Public, indexed, and the target of all the SEO and AI-discoverability work. |
| **The platform** | `/login`, `/dashboard`, `/learn/…`, `/account`, `/api/…`. Private, `noindex`, and where anyone who has bought something actually goes. |

They share a domain, a database, a stylesheet and a deploy. What separates them
is the URL, and that separation is enforced in exactly two places:
`APP_PREFIXES` in `functions/_middleware.js` (what stays out of Google) and the
gate in the same file (what needs an account).

## How the URLs work

| URL | What it is |
| --- | --- |
| `/` | The homepage |
| `/my-story`, `/course`, `/consultations`, `/contact` | Marketing |
| `/login` | Sign in — a six-digit code by email, no password |
| `/dashboard` | **Everything she's bought** — the front door once signed in |
| `/learn/<course>` | One course's module grid |
| `/learn/<course>/<module>/<lesson>` | A lesson |
| `/learn/<course>/resources` | That course's downloads |
| `/account` | Her details and purchase history |
| `/welcome` | Where Stripe sends her after paying |
| `/api/waitlist` | The course waitlist form |
| `/api/webhooks/stripe`, `/api/webhooks/lava` | Payment providers telling us things |

Access is checked **per course**, from the URL. Owning one course grants nothing
in another.

## It holds many courses, not one

A student signs in once and sees everything she's bought — courses and
consultations — on a single dashboard. Adding a second course is a new file plus
one line in the catalog; routing, the gate, the dashboard, progress and the
account page all read from it. See **Adding a whole course** below.

## What's where

Everything under `public/` is served to the world. Everything else — including
all of `functions/` — is not.

| Path | What it is |
| --- | --- |
| `public/*.html` | The marketing pages |
| `public/css/style.css` | Brand styles, shared by both halves |
| `public/css/course.css` | The course app |
| `public/js/main.js` | Marketing-site behaviour (nav, carousel, waitlist form) |
| `public/js/course.js` | The mobile curriculum drawer |
| `functions/_lib/catalog.js` | **Everything Maria sells** — courses, services, prices |
| `functions/_lib/courses/dating.js` | **The Dating Method — modules, lessons, video, text** |
| `functions/_lib/render.js` | The page shell every signed-in page uses |
| `functions/_lib/access.js` | Granting and checking access — payment-provider-neutral |
| `functions/_middleware.js` | The gate, and what stays out of search results |
| `functions/dashboard.js` | `/dashboard` — everything she's bought |
| `functions/learn/[[path]].js` | Lesson pages, module links, resources |
| `functions/api/waitlist.js` | The course waitlist |
| `functions/api/webhooks/` | Stripe and Lava |
| `wrangler.toml` | Build output dir and the database binding |
| `schema.sql` | The database, as a fresh one would be built |
| `migrations/` | Changes to a database that already exists |
| `test/` | End-to-end tests — 190 checks across five suites |

> **Why `public/` matters.** The deploy used to serve the repo root, which meant
> `schema.sql`, `README.md` and the source of every Function were downloadable
> from the live site. `pages_build_output_dir = "public"` in `wrangler.toml` is
> what fixed that — don't move servable files back out of it.

## One database

`dating-goddess-db` holds students, what they've bought, how far they've got,
sign-in codes, and the waitlist. The name is a leftover from when the platform
was only the dating course; D1 databases can't be renamed and the name is
internal, so it stays.

## Adding a whole course

Three steps, and nothing outside them needs touching.

1. **Write the content.** Copy `functions/_lib/courses/dating.js` to
   `functions/_lib/courses/<name>.js`, rename its two exports, and put your
   modules and lessons in it.
2. **Add it to the catalog.** In `functions/_lib/catalog.js`, import the file
   and add one entry to `products`:

   ```js
   brand: {
     slug: 'brand',
     type: 'course',
     title: brandCourse.title,
     tagline: brandCourse.tagline,
     content: brandCourse,
     resources: brandResources,
     salesUrl: 'https://wherever-it-is-sold.com',
   },
   ```
3. **Map the payment.** Add the Stripe price id (and the Lava product id, if it
   sells there) to the maps at the bottom of the same file.

It's then live at `/learn/brand` and appears on the dashboard of anyone who buys
it. `type: 'service'` is the other option — a consultation, which shows on her
dashboard as something she bought but has no lessons to open.

**One thing to be careful about.** While there is exactly one course, an
unrecognised Stripe price still falls back to it, so payments work before you've
filled the ids in. That fallback switches itself off the moment a second course
exists — with two, a guess could hand someone the wrong one. So when you add
course number two, fill in the real price ids at the same time, or purchases
will be refused rather than mis-granted.

## Adding a lesson

Open the course's file — `functions/_lib/courses/dating.js` — and add an object
to a module's `lessons` array:

```js
{
  slug: 'what-to-say-first',
  title: 'What to say first',
  video: 'abc123...',        // the Cloudflare Stream video ID
  duration: '9 min',
  body: `<p>Your words here.</p>`,
  images: [],
  resources: [],
}
```

Leave `video: null` and the lesson shows a "being edited right now" card instead
of a broken player. Leave `body: ''` and it shows a friendly note instead of an
empty page. Reordering is just moving things around in the file — the sidebar,
the dashboard, the progress bars and the next/previous links all follow.

## Who can see what

`functions/_middleware.js` is the only gate, and it runs before everything else:
anything under `/learn` needs a signed-in student with an active enrollment **in
the course named in the URL**. A new page under `/learn` is protected
automatically — there's nowhere to forget.

`/dashboard` and `/account` need only a signed-in student, whatever she owns.
That's deliberate: someone whose access was refunded still needs somewhere to go
and see what happened.

Access is re-checked from the database on every request rather than trusted from
the cookie, so a refund takes effect on her next page load.

One endpoint sits outside the gate and so checks for itself: `POST
/api/progress` takes the course from the submitted form and verifies both that
the lesson exists in it and that she owns it.

## Search engines

The marketing pages are indexed. The app is not.

`APP_PREFIXES` in `functions/_middleware.js` lists the paths that get
`X-Robots-Tag: noindex` — `/login`, `/dashboard`, `/learn`, `/account`,
`/welcome`, `/pay`, `/api`. Matching is by prefix, so a new page under one of
them is covered the moment it exists. Preview builds on `*.pages.dev` are
noindex in their entirety, so they can never compete with the real domain.

Signed-in pages also carry their own `noindex` meta tag. The header is the
belt-and-braces version: it applies to redirects and to responses that never
render a document.

## Local preview

```
npx wrangler pages dev
```

Then open http://127.0.0.1:8788. Edit a file, refresh, see it.

Sign-in codes are printed to the console instead of emailed
(`EMAIL_DEV_CONSOLE=true` in `.dev.vars`), so development can never email a real
person. `.dev.vars` holds the local secrets and is gitignored —
`.dev.vars.example` is the safe copy showing which names are needed.

## Tests

190 checks across five suites. They wipe the **local** database each time, never
production. See COMMANDS.md for how to run them.

## Still to build

- **Account merging** — one person, two email addresses. She buys one course
  with a personal address and another with a work one, and ends up with two
  accounts each holding half of what she paid for. With several courses sold
  across several marketing sites this becomes likely rather than theoretical. It
  needs an admin tool that moves enrollments and progress onto one student row,
  with a human looking at it.
- **Worksheets in R2**, served only to signed-in students who own that course
- **dating-goddess.com** — the first satellite: the Dating Method sales page,
  static, no backend, pointing its buy button back here
