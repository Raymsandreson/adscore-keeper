-- Retroactive migration (External DB: kmedldlepwiityjsdahz)
-- Documents schema already deployed in production via run-external-migration.
-- Idempotent: safe to re-run.

-- 1) lead_custom_fields.tab — categorizes custom fields per form tab
ALTER TABLE public.lead_custom_fields
  ADD COLUMN IF NOT EXISTS tab text NOT NULL DEFAULT 'basic';

-- 2) lead_field_layouts — per-board layout overrides for fixed + custom fields
CREATE TABLE IF NOT EXISTS public.lead_field_layouts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id      uuid NOT NULL,
  field_key     text NOT NULL,
  tab           text NOT NULL,
  display_order integer NOT NULL DEFAULT 0,
  hidden        boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lead_field_layouts_board_id_field_key_key UNIQUE (board_id, field_key)
);

CREATE INDEX IF NOT EXISTS idx_lead_field_layouts_board
  ON public.lead_field_layouts (board_id);

-- 3) RLS
ALTER TABLE public.lead_custom_fields  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_field_layouts  ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='lead_field_layouts' AND policyname='lead_field_layouts_all_authenticated'
  ) THEN
    CREATE POLICY lead_field_layouts_all_authenticated
      ON public.lead_field_layouts
      FOR ALL TO authenticated
      USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 4) updated_at trigger
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_lead_field_layouts_updated_at ON public.lead_field_layouts;
CREATE TRIGGER trg_lead_field_layouts_updated_at
  BEFORE UPDATE ON public.lead_field_layouts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
