CREATE EXTENSION IF NOT EXISTS pgcrypto;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['campaigns','contacts','calls','results','audit_log','suppression','destinations','deliveries','settings'] LOOP
    EXECUTE format('CREATE TABLE IF NOT EXISTS %I (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL, data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())', t);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I(org_id,created_at DESC)', t || '_org_created', t);
  END LOOP;
END $$;
CREATE TABLE IF NOT EXISTS users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL, email text UNIQUE NOT NULL, password_hash text NOT NULL, data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS sessions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL, token_hash text UNIQUE NOT NULL, expires_at timestamptz NOT NULL, data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS suppression_phone ON suppression(org_id,(data->>'phone'));
CREATE UNIQUE INDEX IF NOT EXISTS contacts_campaign_phone ON contacts(org_id,(data->>'campaign_id'),(data->>'phone'));
CREATE UNIQUE INDEX IF NOT EXISTS result_call ON results(org_id,(data->>'call_id'));
CREATE UNIQUE INDEX IF NOT EXISTS delivery_key ON deliveries(org_id,(data->>'idempotency_key'));
CREATE INDEX IF NOT EXISTS calls_campaign ON calls(org_id,(data->>'campaign_id'));
CREATE INDEX IF NOT EXISTS calls_sid ON calls((data->>'sid'));
CREATE INDEX IF NOT EXISTS contacts_campaign ON contacts(org_id,(data->>'campaign_id'));
