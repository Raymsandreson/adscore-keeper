-- ROLLBACK da migration rpc_conversation_summaries_inlined.
--
-- Bug descoberto POS-deploy via smoke test end-to-end pelo cliente:
--   * A v2 inlineable removeu SET statement_timeout=25s para destravar inlining.
--   * Com isso, o limite efetivo passou a ser o statement_timeout do role:
--       anon          = 3s
--       authenticated = 8s
--   * Chamadas cold-cache que rodam em 11-22s (medidas via role postgres sem
--     limite) passaram a retornar ERRO ao cliente real (authenticated, 8s),
--     em vez de apenas serem lentas como antes.
--
-- A versao antiga (SET statement_timeout=25s na propria funcao) sobrescrevia
-- o timeout do role durante a execucao, dando orcamento de 25s. Essa era
-- a protecao que o inline retirou.
--
-- Trade-off conhecido do estado restaurado (pre-existente):
--   * Continua lento (~10-25s em cold cache de instancias grandes).
--   * Instancias muito pesadas (Luiz Abraci 60d) ainda estouram o SET=25s
--     interno esporadicamente — pg_stat_statements mostra max 24.9s / 25.0s
--     de antes do deploy, ou seja: convivemos com esse teto ha tempos.
--   * Mas RESPONDE com dados em vez de dar erro pro cliente, que era o
--     comportamento pos-inline.
--
-- Restaura-se aqui o corpo idêntico ao get_conversation_summaries_legacy.
-- Plano para otimizar com LATERAL skip scan (Fase 2) fica adiado ate
-- analisarmos o padrao warm/cold real.

CREATE OR REPLACE FUNCTION public.get_conversation_summaries(
  p_instance_names text[],
  p_days_back integer DEFAULT 60
)
RETURNS TABLE(
  phone text, contact_name text, contact_id text, lead_id text,
  last_message_text text, last_message_at timestamptz, last_direction text,
  instance_name text, unread_count bigint, message_count bigint
)
LANGUAGE sql
STABLE
SET statement_timeout TO '25s'
SET search_path TO 'public'
AS $rollback$
  WITH latest AS (
    SELECT DISTINCT ON (m.instance_name, m.phone)
      m.instance_name,
      m.phone,
      m.message_text   AS last_message_text,
      m.created_at     AS last_message_at,
      m.direction      AS last_direction,
      m.contact_name,
      m.contact_id::text AS contact_id,
      m.lead_id::text    AS lead_id
    FROM whatsapp_messages m
    WHERE m.instance_name = ANY(p_instance_names)
      AND m.created_at > now() - (p_days_back || ' days')::interval
    ORDER BY m.instance_name, m.phone, m.created_at DESC
  ),
  unread AS (
    SELECT m.instance_name, m.phone, COUNT(*)::bigint AS unread
    FROM whatsapp_messages m
    WHERE m.instance_name = ANY(p_instance_names)
      AND m.direction = 'inbound'
      AND m.read_at IS NULL
    GROUP BY m.instance_name, m.phone
  )
  SELECT
    l.phone,
    COALESCE(NULLIF(l.contact_name, ''), ct.full_name, '')::text AS contact_name,
    COALESCE(l.contact_id, '')::text,
    COALESCE(l.lead_id, '')::text,
    l.last_message_text,
    l.last_message_at,
    l.last_direction,
    l.instance_name,
    COALESCE(u.unread, 0) AS unread_count,
    0::bigint AS message_count
  FROM latest l
  LEFT JOIN unread u   ON u.instance_name = l.instance_name AND u.phone = l.phone
  LEFT JOIN contacts ct ON ct.id::text = l.contact_id
  ORDER BY l.last_message_at DESC;
$rollback$;
