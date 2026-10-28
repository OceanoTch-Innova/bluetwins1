BEGIN IMMEDIATE;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS piscis_identities (
  identity_id TEXT PRIMARY KEY,
  supabase_sub TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  display_name TEXT,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS piscis_sessions (
  sid TEXT PRIMARY KEY,
  identity_id TEXT NOT NULL REFERENCES piscis_identities(identity_id),
  refresh_token_hash TEXT,
  previous_refresh_token_hash TEXT,
  rotation_successor_encrypted TEXT,
  refresh_rotated_at INTEGER NOT NULL,
  supabase_refresh_token_encrypted TEXT,
  supabase_verified_at INTEGER NOT NULL,
  last_activity_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  absolute_expires_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'revoked', 'remote_revoked', 'expired_or_disabled', 'refresh_reuse')),
  revoked_at INTEGER,
  refresh_lock_id TEXT,
  refresh_lock_until INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_piscis_sessions_refresh_hash
  ON piscis_sessions(refresh_token_hash)
  WHERE refresh_token_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_piscis_sessions_identity_status
  ON piscis_sessions(identity_id, status);

CREATE INDEX IF NOT EXISTS idx_piscis_sessions_previous_refresh_hash
  ON piscis_sessions(previous_refresh_token_hash)
  WHERE previous_refresh_token_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS piscis_refresh_history (
  sid TEXT NOT NULL REFERENCES piscis_sessions(sid) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  issued_at INTEGER NOT NULL,
  PRIMARY KEY (sid, token_hash)
);

UPDATE refresh_tokens
SET revoked = 1
WHERE revoked = 0;

COMMIT;
