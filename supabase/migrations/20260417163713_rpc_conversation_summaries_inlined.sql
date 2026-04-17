-- Substitui get_conversation_summaries pela versão inlineable.
-- Mudanças vs versão anterior (agora preservada como _legacy):
--   - Remove SET statement_timeout e SET search_path (impediam inlining)
--   - Qualifica public.whatsapp_messages e public.contacts
--   - JOIN com contacts passa a ser uuid=uuid (sem cast ::text)
--   - Default p_days_back: 60 -> 30
--   - Usa make_interval() em vez de concat '||' com string.
-- Evidência: EXPLAIN ANALYZE da v2 inlineable com ARRAY['cris']/30 = 1.617ms
-- vs versão atual = 10.657ms. Detalhes no histórico da conversa.

CREATE OR REPLACE FUNCTION public.get_conversation_summaries(
  p_instance_names text[],
  p_days_back integer DEFAULT 30
)
RETURNS TABLE(
  phone text, contact_name text, contact_id text, lead_id text,
  last_message_text text, last_message_at timestamptz, last_direction text,
  instance_name text, unread_count bigint, message_count bigint
)
LANGUAGE sql
STABLE
AS $new$
  WITH latest AS (
    SELECT DISTINCT ON (m.instance_name, m.phone)
      m.instance_name, m.phone,
      m.message_text AS last_message_text,
      m.created_at   AS last_message_at,
      m.direction    AS last_direction,
      m.contact_name,
      m.contact_id,
      m.lead_id
    FROM public.whatsapp_messages m
    WHERE m.instance_name = ANY(p_instance_names)
      AND m.created_at > now() - make_interval(days => p_days_back)
    ORDER BY m.instance_name, m.phone, m.created_at DESC
  ),
  unread AS (
    SELECT m.instance_name, m.phone, COUNT(*)::bigint AS unread
    FROM public.whatsapp_messages m
    WHERE m.instance_name = ANY(p_instance_names)
      AND m.direction = 'inbound' AND m.read_at IS NULL
    GROUP BY m.instance_name, m.phone
  )
  SELECT
    l.phone,
    COALESCE(NULLIF(l.contact_name, ''), ct.full_name, '')::text AS contact_name,
    COALESCE(l.contact_id::text, '')                             AS contact_id,
    COALESCE(l.lead_id::text, '')                                AS lead_id,
    l.last_message_text, l.last_message_at, l.last_direction, l.instance_name,
    COALESCE(u.unread, 0) AS unread_count,
    0::bigint             AS message_count
  FROM latest l
  LEFT JOIN unread          u  ON u.instance_name = l.instance_name AND u.phone = l.phone
  LEFT JOIN public.contacts ct ON ct.id = l.contact_id
  ORDER BY l.last_message_at DESC;
$new$;
