-- bold-mcp schema v1: OAuth clients, connections (encrypted API keys), token hashes, usage log.

CREATE TABLE IF NOT EXISTS oauth_clients (
  id            text PRIMARY KEY,                -- DCR id, or the CIMD URL
  kind          text NOT NULL CHECK (kind IN ('dcr', 'cimd')),
  client_name   text,
  redirect_uris text[] NOT NULL,
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS connections (
  id                    uuid PRIMARY KEY,
  encrypted_key         jsonb NOT NULL,           -- KeyVault envelope; never plaintext
  key_fingerprint       text NOT NULL,            -- first 12 hex of SHA-256
  client_id             text NOT NULL,
  client_name           text,
  per_call_limit        integer NOT NULL,
  daily_limit           integer NOT NULL,
  allow_contact_unlocks boolean NOT NULL,
  allow_kyb_unlocks     boolean NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  last_used_at          timestamptz NOT NULL DEFAULT now(),
  invalid_at            timestamptz,              -- Partner API rejected the key
  revoked_at            timestamptz,
  revoked_reason        text
);
CREATE INDEX IF NOT EXISTS connections_fingerprint_idx ON connections (key_fingerprint);
CREATE INDEX IF NOT EXISTS connections_last_used_idx ON connections (last_used_at) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS oauth_tokens (
  token_hash    text PRIMARY KEY,                 -- SHA-256 of the opaque token
  kind          text NOT NULL CHECK (kind IN ('access', 'refresh')),
  connection_id uuid NOT NULL REFERENCES connections (id) ON DELETE CASCADE,
  client_id     text NOT NULL,
  resource      text NOT NULL,
  family_id     uuid NOT NULL,                    -- refresh rotation family
  expires_at    timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  used_at       timestamptz                       -- refresh tokens: set when rotated
);
CREATE INDEX IF NOT EXISTS oauth_tokens_connection_idx ON oauth_tokens (connection_id);

CREATE TABLE IF NOT EXISTS usage_log (
  id                bigserial PRIMARY KEY,
  created_at        timestamptz NOT NULL DEFAULT now(),
  connection_id     uuid,
  key_fingerprint   text NOT NULL,
  auth_mode         text NOT NULL,
  tool              text NOT NULL,
  pool              text,
  credits_estimated integer NOT NULL,
  credits_used      integer,
  outcome           text NOT NULL,
  latency_ms        integer NOT NULL
);
CREATE INDEX IF NOT EXISTS usage_log_created_idx ON usage_log (created_at);
CREATE INDEX IF NOT EXISTS usage_log_fingerprint_idx ON usage_log (key_fingerprint, created_at);
