-- Audit trail of contact and KYB unlocks (brief: Privacy). Ids and types only; never revealed details.
CREATE TABLE IF NOT EXISTS unlock_audit (
  id              bigserial PRIMARY KEY,
  created_at      timestamptz NOT NULL DEFAULT now(),
  connection_id   uuid,
  key_fingerprint text NOT NULL,
  tool            text NOT NULL,
  subject_type    text NOT NULL CHECK (subject_type IN ('contact', 'kyb')),
  subject_id      text NOT NULL,
  unlocked        text[] NOT NULL,
  credits_used    integer NOT NULL
);
CREATE INDEX IF NOT EXISTS unlock_audit_fingerprint_idx ON unlock_audit (key_fingerprint, created_at);
CREATE INDEX IF NOT EXISTS unlock_audit_subject_idx ON unlock_audit (subject_type, subject_id);
