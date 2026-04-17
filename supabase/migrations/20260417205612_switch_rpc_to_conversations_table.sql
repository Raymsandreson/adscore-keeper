-- Fase 2: Substitui get_conversation_summaries pra ler da tabela conversations.
-- Assinatura IDENTICA a versao anterior (preserva contrato com cliente).
-- Sem SET statement_timeout: o SELECT da tabela materializada e <100ms,
-- nao precisa do orcamento estendido.
--
-- Diferencas semanticas vs versao anterior:
--   * message_count agora retorna contagem real (era hard-coded 0).
--     Verificado via grep que nenhum consumidor do frontend le esse campo.
--   * contact_name preserva ultimo-nao-vazio (trigger da Fase 1 faz
--     COALESCE com existente); versao antiga pegava sempre do last
--     message, mesmo se vazio. Estritamente >= qualidade.
--
-- LEFT JOIN com contacts mantido como fallback pra contact_name vazio.
--
-- Rollback: apply_migration com corpo do get_conversation_summaries_legacy
-- (tambem disponivel em .claude/rollback_get_conversation_summaries.sql).

CREATE OR REPLACE FUNCTION public.get_conversation_summaries(
  p_instance_names text[],
  p_days_back integer DEFAULT 30
)
RETURNS TABLE(
  phone text,
  contact_name text,
  contact_id text,
  lead_id text,
  last_message_text text,
  last_message_at timestamptz,
  last_direction text,
  instance_name text,
  unread_count bigint,
  message_count bigint
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    c.phone,
    COALESCE(NULLIF(c.contact_name, ''), ct.full_name, '')::text AS contact_name,
    COALESCE(c.contact_id::text, '')                             AS contact_id,
    COALESCE(c.lead_id::text,    '')                             AS lead_id,
    c.last_message_text,
    c.last_message_at,
    c.last_direction,
    c.instance_name,
    c.unread_count::bigint                                       AS unread_count,
    c.message_count::bigint                                      AS message_count
  FROM public.conversations c
  LEFT JOIN public.contacts ct ON ct.id = c.contact_id
  WHERE c.instance_name = ANY(p_instance_names)
    AND c.last_message_at > now() - make_interval(days => p_days_back)
  ORDER BY c.last_message_at DESC;
$$;
