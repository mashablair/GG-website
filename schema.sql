-- mariablair.com — the one database (Cloudflare D1 / SQLite)
--
-- Apply it with:
--   npx wrangler d1 execute dating-goddess-db --remote --file=schema.sql
--   npx wrangler d1 execute dating-goddess-db --local  --file=schema.sql
--
-- Every statement is written so it can be run twice without complaining, so
-- re-running this after adding a table is safe.

-- ---------- Who they are ----------

CREATE TABLE IF NOT EXISTS students (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  email       TEXT NOT NULL UNIQUE,   -- always stored lowercased and trimmed
  first_name  TEXT,                   -- from Stripe if she gave one; may be NULL
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------- What they bought ----------
--
-- One row per purchase. A student who buys a second course gets a second row,
-- which is why course_slug lives here rather than being assumed.
--
-- Nothing here knows what a "Stripe" is. `provider` names who took the money
-- and `external_id` is that provider's own id for the transaction, so adding
-- Lava.top (or anything else) later is a new adapter, not a schema change.
--
-- UNIQUE (provider, external_id, course_slug) is the important one. The
-- checkout redirect and the provider's webhook will both try to record the same
-- purchase, and this is what guarantees only one row can ever result per
-- product — whichever arrives first wins and the other quietly does nothing, in
-- any order.
--
-- course_slug is part of the key, not just (provider, external_id), because one
-- checkout can contain several things: a bundle of two courses, or a course
-- with the consultation cross-sell. Keyed on the transaction alone, the second
-- product in a basket would be silently dropped and the buyer would be missing
-- something she paid for.

CREATE TABLE IF NOT EXISTS enrollments (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id           INTEGER NOT NULL REFERENCES students(id),
  course_slug          TEXT NOT NULL,                    -- 'dating'
  status               TEXT NOT NULL DEFAULT 'active',   -- 'active' | 'refunded'
  provider             TEXT NOT NULL DEFAULT 'stripe',   -- 'stripe' | 'lava' | ...
  external_id          TEXT,           -- the provider's transaction id
  provider_customer_id TEXT,           -- the provider's customer id, if it has one
  amount_cents         INTEGER,
  currency             TEXT NOT NULL DEFAULT 'usd',      -- Lava sells in RUB
  purchased_at         TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at           TEXT,           -- recorded, not enforced (see README)
  redeemed_at          TEXT,           -- set when the checkout redirect is used once
  UNIQUE (provider, external_id, course_slug)
);

-- The access check on every page load: "does this student have an active
-- enrollment in this course?"
CREATE INDEX IF NOT EXISTS idx_enrollments_access
  ON enrollments (student_id, course_slug, status);

-- ---------- Proving it's them ----------
--
-- Short-lived login codes. The code itself is never stored — only a hash of it,
-- for the same reason you'd never store a password in plain text.

CREATE TABLE IF NOT EXISTS login_codes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  email       TEXT NOT NULL,
  code_hash   TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  used_at     TEXT,
  attempts    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_login_codes_email ON login_codes (email);

-- ---------- How far they've got ----------
--
-- A row means "this student has completed this lesson". No row means she
-- hasn't. There is deliberately no timestamp and no ordering: lessons can be
-- completed in any order, and the set of rows describes that perfectly.
--
-- lesson_id looks like 'flags/red-flags' — the module slug and lesson slug from
-- the course's file in functions/_lib/courses/. It carries no course prefix
-- because course_slug is already its own column here. Renaming a slug after
-- students exist orphans their progress for that lesson; renaming a *title* is
-- always safe.

CREATE TABLE IF NOT EXISTS progress (
  student_id   INTEGER NOT NULL REFERENCES students(id),
  course_slug  TEXT NOT NULL,
  lesson_id    TEXT NOT NULL,
  PRIMARY KEY (student_id, course_slug, lesson_id)
);

-- ---------- The course waitlist ----------
--
-- People who asked to be told when a course opens. Not students — there's no
-- account here and nothing to sign into. It lives in the same database purely
-- so there's one place to look at "who are my people", and it's deliberately
-- not joined to `students`: someone can be on the waitlist for years without
-- ever buying, and someone can buy without ever being on it.
--
-- `email` is UNIQUE so signing up twice updates the name rather than making a
-- second row.

CREATE TABLE IF NOT EXISTS waitlist (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name  TEXT NOT NULL,
  email       TEXT NOT NULL UNIQUE,
  source      TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
