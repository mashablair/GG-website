-- Migration 0001 — one enrollment row per product, not per transaction
--
-- WHY
-- `enrollments` was created with UNIQUE (provider, external_id): one row per
-- payment. That was right while a checkout could only ever contain one course.
--
-- It stops being right the moment a basket holds two things — a bundle of two
-- courses, or a course with the consultation cross-sell. Both products share
-- one Stripe session id, so the second INSERT hit the constraint and did
-- nothing. The buyer paid for two things and silently received one.
--
-- This widens the key to (provider, external_id, course_slug). Retries and the
-- redirect/webhook race are still idempotent — now per product rather than per
-- transaction, which is what was actually meant.
--
-- SQLite can't alter a UNIQUE constraint in place, so the table is rebuilt.
-- Existing rows are copied across untouched.
--
-- APPLY IT
--   npx wrangler d1 execute dating-goddess-db --local  --file=migrations/0001-enrollments-per-product.sql
--   npx wrangler d1 execute dating-goddess-db --remote --file=migrations/0001-enrollments-per-product.sql
--
-- Safe to run twice: if the new table is already in place the rename fails and
-- nothing is lost. Check afterwards with:
--   SELECT sql FROM sqlite_master WHERE name='enrollments';

DROP TABLE IF EXISTS enrollments_old;

ALTER TABLE enrollments RENAME TO enrollments_old;

CREATE TABLE enrollments (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id           INTEGER NOT NULL REFERENCES students(id),
  course_slug          TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'active',
  provider             TEXT NOT NULL DEFAULT 'stripe',
  external_id          TEXT,
  provider_customer_id TEXT,
  amount_cents         INTEGER,
  currency             TEXT NOT NULL DEFAULT 'usd',
  purchased_at         TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at           TEXT,
  redeemed_at          TEXT,
  UNIQUE (provider, external_id, course_slug)
);

INSERT INTO enrollments
  (id, student_id, course_slug, status, provider, external_id,
   provider_customer_id, amount_cents, currency, purchased_at, expires_at, redeemed_at)
SELECT
   id, student_id, course_slug, status, provider, external_id,
   provider_customer_id, amount_cents, currency, purchased_at, expires_at, redeemed_at
  FROM enrollments_old;

DROP TABLE enrollments_old;

CREATE INDEX IF NOT EXISTS idx_enrollments_access
  ON enrollments (student_id, course_slug, status);
