# Glorious Goddess · Digital Course Platform

A responsive marketing website and server-rendered learning platform for an independent education business. The project connects public course discovery with passwordless sign-in, purchase-based access, lesson navigation, and progress tracking.

**HTML · CSS · JavaScript · Cloudflare Pages Functions · Cloudflare D1**

[Visit the public website](https://dating-goddess.com) · [Architecture](#architecture) · [Run locally](#run-locally) · [Tests](#tests)

> **Portfolio context:** This is a business website with an implemented learning platform, not an open demo account. Public pages can be explored without signing in. Student pages require an account and the appropriate enrollment. Course availability, checkout configuration, and email-provider setup are operational concerns separate from the features present in this repository.

## The product problem

A small education business needs more than a landing page: customers must be able to return after buying, find their content, continue learning, and understand their account status. This project keeps that journey on one domain without introducing a front-end framework or a client-side application build.

The public site communicates the brand and offerings. The application handles the stateful parts: identity, enrollment, account history, and lesson progress.

## What the application includes

- **Public marketing pages** for the brand story, course, consultations, and contact, with responsive navigation and shared visual styling.
- **Passwordless student sign-in** using an emailed six-digit code and a signed session cookie.
- **A student dashboard** showing purchased products and course progress, with an account page for profile and purchase history.
- **Course and lesson navigation** driven by a shared product catalog, including a mobile curriculum drawer and previous/next lesson links.
- **Per-course access checks** so enrollment in one product does not unlock another.
- **Persistent progress** with repeat-safe completion and undo actions.
- **Payment-provider adapters** for Stripe and Lava.top that normalize purchases into a common enrollment model.
- **Waitlist and guide-request endpoints**, including website guide unsubscribe handling. These endpoints are not evidence that a separate marketing automation service is configured or running.

## Engineering highlights

### Server-rendered flows, small browser surface

Public pages are static HTML. Pages requiring account or enrollment data are rendered by Pages Functions. Lesson completion uses a normal form POST and redirect rather than depending on a client-side state-management layer. CSS and selective browser JavaScript provide the responsive presentation and interactions.

### Centralized authorization with explicit endpoint checks

[`functions/_middleware.js`](functions/_middleware.js) gates `/dashboard`, `/account`, and `/learn/…`. Course access is checked against the course named in the URL, using current database state rather than trusting an enrollment snapshot in a cookie. The progress endpoint performs its own session, course, lesson, and enrollment validation because it sits outside the lesson-route gate.

### Repeat-safe purchase and progress handling

[`functions/_lib/access.js`](functions/_lib/access.js) separates enrollment logic from individual payment providers. Purchases are keyed by provider, transaction, and course, so repeated deliveries do not create duplicate enrollments. Checkout login redemption is one-time. Completion is keyed by student, course, and lesson, making repeated submissions harmless.

### Clear boundaries between public pages and the application

Only `public/` is the static deployment output. Function source and database files are not part of that static output. Account and learning routes receive `noindex` headers, and preview hosts are excluded from indexing. **Indexing controls are not access controls:** the session and enrollment checks provide authorization.

## Architecture

```text
Browser
  ├─ Public pages ─────────────── static HTML / CSS / JavaScript
  └─ Account and course routes ─ Cloudflare Pages Functions
                                   ├─ Session + enrollment middleware
                                   ├─ Catalog-driven page rendering
                                   └─ Cloudflare D1
                                       students / enrollments / progress
                                       login codes / waitlist / guide leads

Payment provider callbacks ── provider adapters ── shared enrollment logic
```

| Area | Main files |
| --- | --- |
| Public presentation | `public/*.html`, `public/css/style.css`, `public/js/main.js` |
| Learning UI | `public/css/course.css`, `public/js/course.js`, `functions/learn/[[path]].js` |
| Shared page rendering | `functions/_lib/render.js` |
| Product catalog | `functions/_lib/catalog.js` |
| Sessions and authorization | `functions/_lib/session.js`, `functions/_middleware.js`, `functions/_lib/access.js` |
| Dashboard and progress | `functions/dashboard.js`, `functions/api/progress.js` |
| Payments | `functions/api/webhooks/` |
| Storage | `schema.sql`, `migrations/` |
| Runtime configuration | `wrangler.toml`, `.dev.vars.example` |
| Flow tests | `test/` |

## Run locally

Prerequisites: Node.js/npm for the Wrangler CLI. The integration suites also use Bash, Python 3, and curl.

```bash
git clone https://github.com/mashablair/GG-website.git
cd GG-website
cp .dev.vars.example .dev.vars
```

Configure **local-only** values in `.dev.vars`. Keep `EMAIL_DEV_CONSOLE=true` so sign-in codes are printed locally instead of sent. Use a separate random session secret and test/mock payment configuration, never production credentials. `.dev.vars` is gitignored.

Initialize an isolated local database, then start the development server:

```bash
npx wrangler d1 execute dating-goddess-db --local --file=schema.sql
npx wrangler pages dev
```

Open **http://127.0.0.1:8788**. There is no application bundling step or root `package.json`.

For an existing database, review and apply the relevant files in `migrations/`; `CREATE TABLE IF NOT EXISTS` in the schema does not upgrade existing tables. Do not use `--remote` for a local preview or test run.

## Tests

The repository includes shell-based HTTP integration suites and a standalone video-signing check. These exercise purchase events, authentication, course gates, progress, and refunds. They are implementation tests, not a claim that live provider accounts or the complete deployed system have been verified.

Start the local server with its output available to the login tests:

```bash
npx wrangler pages dev > /tmp/wrangler-dev.log 2>&1
```

Set the mock API base URLs and matching test values in `.dev.vars` before running payment tests. See the example file and the relevant test scripts. The purchase scripts start and stop their own local provider stand-ins.

In another terminal:

```bash
bash test/purchase-flow.sh
bash test/login-flow.sh
bash test/gate-flow.sh
bash test/progress-flow.sh
bash test/lava-flow.sh
node test/stream-signing.mjs
```

**Use a disposable local database:** the integration scripts delete local fixture data during setup. Do not point them at production. Run the suites sequentially because they share local state and mock ports.

Test coverage in the source includes:

- invalid and reused sign-in codes, session tampering, and redirect handling;
- per-course access, including access after a refund;
- repeated payment events and unpaid or invalid purchase refusals;
- repeated completion, undo, and invalid lesson submissions;
- signed video-token generation and signature validation.

See [`test/README.md`](test/README.md) for detailed scenarios. Some historical counts and setup examples there predate the current scripts; use the checked-in scripts as the source of truth rather than treating a fixed test count as a quality badge.

## Maintainer notes

- **Keep the static output at `public/`.** `pages_build_output_dir` in `wrangler.toml` must not be changed to the repository root.
- **Add products through the catalog.** Create a course definition under `functions/_lib/courses/`, register it in `functions/_lib/catalog.js`, and map the actual payment-provider product/price IDs. Verify the mapping and per-course access tests before enabling sales. The catalog supports course and service products.
- **Keep lesson content and navigation together.** Lessons are defined in their course file. Reordering that data drives the curriculum and next/previous navigation. A missing video is handled as an unavailable-content state, not a working media lesson.
- **Version stylesheet URLs after CSS changes.** Update the existing `?v=` values in public HTML and the shared application renderer to avoid serving new markup with cached old styles.
- **Separate schema creation from migrations.** Update the fresh schema alongside numbered migrations. Review and test migrations locally before any deployment decision.
- **Treat subscriber state carefully.** Website guide unsubscribe state and a third-party email platform's suppression state are separate concerns. Imports and retries must not silently restore an opt-out.
- **Protect real data.** Never commit student exports, subscriber lists, credentials, session tokens, or screenshots of real accounts. Use fictional data for development and portfolio examples.

[`COMMANDS.md`](COMMANDS.md) contains the longer operator reference. Its remote database and deployment commands are for authorized maintenance, not the local quick start above. The current workflow deploys pushes to `main`; review changes and verify the resulting deployment rather than assuming a push succeeded.

## Current boundaries

The code supports multiple courses, but that does not mean multiple courses are available for purchase. Cross-account enrollment merging and private R2 worksheet delivery remain planned rather than presented as complete. Enrollment expiration timestamps are recorded; the current access check uses enrollment status rather than enforcing those timestamps. Video signing depends on configuration. Third-party marketing automation, buyer exclusions, and cross-system unsubscribe behavior require their own operational validation.

This repository demonstrates a framework-free approach to a complete customer journey: public discovery, identity, entitlements, and persistent learning state, with explicit boundaries between presentation and business rules.
