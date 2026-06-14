-- Fling milestone receiver — D1 (SQLite) schema.
-- Append-only event log. One row per (install, milestone) crossing.

CREATE TABLE IF NOT EXISTS milestone_events (
  idempotency_key TEXT PRIMARY KEY,   -- "{install_id}:{milestone}" — enforces dedupe at the DB level
  install_id      TEXT NOT NULL,      -- anonymous random UUID from the app's Keychain
  milestone       INTEGER NOT NULL,   -- 10 | 100 | 500 | 1000
  total_flings    INTEGER,            -- client-reported running count (untrusted — never use for billing)
  app_version     TEXT,
  build           TEXT,
  created_at      TEXT NOT NULL,      -- client clock at milestone fire (untrusted)
  received_at     TEXT NOT NULL,      -- server clock (TRUSTED — use this for any "early user" cutoff)
  ip_hash         TEXT                -- SHA-256(salt:ip) for rate-limit only; raw IP is never stored
);

-- "which installs crossed milestone X before date Y" (grandfather queries) + stats.
CREATE INDEX IF NOT EXISTS idx_milestone_received ON milestone_events(milestone, received_at);
CREATE INDEX IF NOT EXISTS idx_install           ON milestone_events(install_id);
CREATE INDEX IF NOT EXISTS idx_ip_received       ON milestone_events(ip_hash, received_at);
