-- Migration 0002 — a list for free-resource signups
--
-- WHY
-- The free exit guide (/exit-guide) gives the PDF in exchange for a first name
-- and an email. Those signups are a different list from the course waitlist —
-- a woman who wanted a free guide hasn't asked to hear about the course launch,
-- and the waitlist count in Maria's notification email shouldn't jump because
-- of her. So they get their own table, keyed by (email, list) so one address
-- can sit on more than one free resource later.
--
-- functions/api/guide.js also runs this CREATE TABLE IF NOT EXISTS itself, so
-- the form works on the first deploy even if nobody runs this file. Running it
-- is still the tidy thing to do:
--   npx wrangler d1 execute dating-goddess-db --remote --file=migrations/0002-leads.sql

CREATE TABLE IF NOT EXISTS leads (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  list             TEXT NOT NULL,
  first_name       TEXT NOT NULL,
  email            TEXT NOT NULL,
  source           TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  unsubscribed_at  TEXT,
  UNIQUE (email, list)
);
