-- Job mailbox schema. Apply with:
--   wrangler d1 execute neo-portable-relay --remote --file schema.sql
-- (keep in sync with SCHEMA in src/handler.ts)
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  task TEXT NOT NULL,
  result TEXT,
  created_at INTEGER NOT NULL,
  claimed_at INTEGER,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, created_at);
