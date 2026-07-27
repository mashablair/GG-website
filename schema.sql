-- Waitlist table for the Intentional Dating Method
-- Run once against your D1 database (see README.md)

CREATE TABLE IF NOT EXISTS waitlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  source TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
