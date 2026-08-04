-- Backfill de conversations.lead_id para conversas de GRUPO
-- Banco: Externo (kmedldlepwiityjsdahz). NÃO é migration do Cloud.
-- Contexto: o vínculo grupo→lead vive em lead_whatsapp_groups, mas a sidebar do
-- Inbox lê conversations.lead_id. Quem vincula pela aba Contatos só escreve na
-- primeira, então o grupo aparecia "com lead" em Contatos e "sem lead" no WhatsApp.
--
-- Situação em 04/08/2026 (conversas de grupo que TÊM vínculo em lead_whatsapp_groups):
--   5.765 linhas com lead_id NULL          <- LOTE A (este script)
--   1.972 linhas com lead_id DIFERENTE     <- LOTE B (NÃO tocado aqui, ver rodapé)
--     853 linhas já corretas
--   1.397 grupos distintos, 6 instâncias
--
-- Desempate: 260 JIDs estão vinculados a mais de um lead. Vence o vínculo mais
-- recente (created_at DESC) — a MESMA regra que o front usa em
-- src/integrations/supabase/group-lead-links.ts, para banco e UI não divergirem.

-- ---------------------------------------------------------------------------
-- 0) Fonte da verdade: 1 lead por JID normalizado (sem sufixo @g.us)
-- ---------------------------------------------------------------------------
-- (repetida em cada passo porque cada statement roda isolado)

-- ---------------------------------------------------------------------------
-- 1) BACKUP — obrigatório antes do UPDATE (rollback em <1min)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.zz_conversations_lead_bkp_20260804 AS
WITH pick AS (
  SELECT DISTINCT ON (regexp_replace(group_jid, '@g\.us$', ''))
         regexp_replace(group_jid, '@g\.us$', '') AS jid,
         lead_id
  FROM public.lead_whatsapp_groups
  WHERE lead_id IS NOT NULL
  ORDER BY regexp_replace(group_jid, '@g\.us$', ''), created_at DESC
)
SELECT c.instance_name,
       c.phone,
       c.lead_id AS lead_id_antes,
       p.lead_id AS lead_id_depois,
       now()     AS backed_up_at
FROM public.conversations c
JOIN pick p ON p.jid = c.phone
WHERE c.lead_id IS NULL;

-- ---------------------------------------------------------------------------
-- 2) UPDATE — LOTE A: só o que estava NULL (nenhum vínculo é sobrescrito)
--    Esperado: 5.765 linhas
-- ---------------------------------------------------------------------------
WITH pick AS (
  SELECT DISTINCT ON (regexp_replace(group_jid, '@g\.us$', ''))
         regexp_replace(group_jid, '@g\.us$', '') AS jid,
         lead_id
  FROM public.lead_whatsapp_groups
  WHERE lead_id IS NOT NULL
  ORDER BY regexp_replace(group_jid, '@g\.us$', ''), created_at DESC
)
UPDATE public.conversations c
SET lead_id = p.lead_id
FROM pick p
WHERE p.jid = c.phone
  AND c.lead_id IS NULL;

-- ---------------------------------------------------------------------------
-- 3) VERIFICAÇÃO — depois do UPDATE, sem_lead deve ser 0
-- ---------------------------------------------------------------------------
WITH pick AS (
  SELECT DISTINCT ON (regexp_replace(group_jid, '@g\.us$', ''))
         regexp_replace(group_jid, '@g\.us$', '') AS jid,
         lead_id
  FROM public.lead_whatsapp_groups
  WHERE lead_id IS NOT NULL
  ORDER BY regexp_replace(group_jid, '@g\.us$', ''), created_at DESC
)
SELECT count(*) FILTER (WHERE c.lead_id IS NULL)                        AS sem_lead,
       count(*) FILTER (WHERE c.lead_id = p.lead_id)                    AS ok,
       count(*) FILTER (WHERE c.lead_id IS NOT NULL
                          AND c.lead_id <> p.lead_id)                   AS divergente_lote_b
FROM public.conversations c
JOIN pick p ON p.jid = c.phone;

-- ---------------------------------------------------------------------------
-- ROLLBACK (restaura os NULLs exatamente como estavam)
-- ---------------------------------------------------------------------------
-- UPDATE public.conversations c
-- SET lead_id = b.lead_id_antes
-- FROM public.zz_conversations_lead_bkp_20260804 b
-- WHERE b.instance_name = c.instance_name
--   AND b.phone = c.phone;

-- ---------------------------------------------------------------------------
-- LOTE B — 1.972 linhas onde conversations.lead_id JÁ aponta para outro lead.
-- NÃO incluído de propósito: a amostra mostra que nem sempre o vínculo é o
-- melhor dos dois. Exemplos reais:
--   grupo "✅ Caso 141 - Paulo Ramos/MA": conversa → "✅ Caso 141 - Paulo Ramos/MA"
--                                          vínculo  → "✅Caso 141/1 Paulo Ramos - MA"
--   grupo "✅ Caso 185 - ÍTALO AZEVEDO...": conversa → nome idêntico ao grupo
--                                            vínculo  → "✅PREV 185 - ( ) Acd- -"
-- Só 7 dessas linhas têm o lead da conversa TAMBÉM vinculado ao grupo; 47 apontam
-- para lead soft-deletado (candidatas seguras a corrigir num lote menor).
-- ---------------------------------------------------------------------------
