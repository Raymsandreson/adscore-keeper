-- Snapshot da função get_conversation_summaries (pre-inline)
-- preservada como _legacy por 24h para rollback (Regra 4).
-- Motivo da troca: SET statement_timeout + SET search_path impedem inlining;
-- evidência em pg_stat_statements (mean 19.7s, max 24.9s, bate no timeout 25s).
-- Rollback: copiar o corpo desta função pra get_conversation_summaries.

CREATE OR REPLACE FUNCTION public.get_conversation_summaries_legacy(
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
AS $legacy$
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
$legacy$;

GRANT EXECUTE ON FUNCTION public.get_conversation_summaries_legacy(text[], integer)
  TO anon, authenticated;
