-- Adiciona UNIQUE para evitar duplicidade de vinculação grupo->lead
-- Remove duplicatas existentes mantendo a mais antiga
DELETE FROM public.lead_whatsapp_groups a
USING public.lead_whatsapp_groups b
WHERE a.ctid > b.ctid
  AND a.lead_id = b.lead_id
  AND a.group_jid IS NOT NULL
  AND a.group_jid = b.group_jid;

CREATE UNIQUE INDEX IF NOT EXISTS lead_whatsapp_groups_lead_jid_unique
  ON public.lead_whatsapp_groups (lead_id, group_jid)
  WHERE group_jid IS NOT NULL;