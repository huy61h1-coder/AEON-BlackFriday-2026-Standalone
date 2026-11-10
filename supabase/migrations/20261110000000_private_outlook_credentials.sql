-- Outlook credentials are encrypted by the Node server before storage.
-- This table must never share the public aeon_state policies.
CREATE TABLE IF NOT EXISTS public.aeon_outlook_credentials (
  id text PRIMARY KEY,
  payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.aeon_outlook_credentials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.aeon_outlook_credentials FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.aeon_outlook_credentials TO service_role;
