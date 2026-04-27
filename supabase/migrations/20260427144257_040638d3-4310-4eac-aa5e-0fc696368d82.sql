-- 1) Cache de /group/list por instância
CREATE TABLE IF NOT EXISTS public.whatsapp_groups_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_name text NOT NULL,
  group_jid text NOT NULL,
  group_name text,
  invite_link text,
  participants jsonb NOT NULL DEFAULT '[]'::jsonb,
  participants_count integer NOT NULL DEFAULT 0,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (instance_name, group_jid)
);

CREATE INDEX IF NOT EXISTS idx_wgc_instance ON public.whatsapp_groups_cache (instance_name);
CREATE INDEX IF NOT EXISTS idx_wgc_fetched_at ON public.whatsapp_groups_cache (fetched_at);
CREATE INDEX IF NOT EXISTS idx_wgc_participants_gin ON public.whatsapp_groups_cache USING gin (participants);

ALTER TABLE public.whatsapp_groups_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read groups cache" ON public.whatsapp_groups_cache;
CREATE POLICY "Authenticated users can read groups cache"
ON public.whatsapp_groups_cache
FOR SELECT
TO authenticated
USING (true);

-- 2) Colunas novas em lead_whatsapp_groups
ALTER TABLE public.lead_whatsapp_groups
  ADD COLUMN IF NOT EXISTS instance_name text,
  ADD COLUMN IF NOT EXISTS auto_linked boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_lwg_instance_name ON public.lead_whatsapp_groups (instance_name);