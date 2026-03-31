
-- Composite index for the conversation summaries query (covers partition + sort)
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_phone_instance_created
ON public.whatsapp_messages (instance_name, phone, created_at DESC);

-- Drop duplicate index
DROP INDEX IF EXISTS idx_whatsapp_messages_instance;

-- Rewrite the function to be much more efficient
CREATE OR REPLACE FUNCTION public.get_conversation_summaries(p_instance_names text[])
 RETURNS TABLE(phone text, contact_name text, contact_id text, lead_id text, last_message_text text, last_message_at timestamp with time zone, last_direction text, instance_name text, unread_count bigint, message_count bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH latest AS (
    SELECT DISTINCT ON (m.phone, m.instance_name)
      m.phone,
      m.contact_name,
      m.contact_id::text,
      m.lead_id::text,
      m.message_text,
      m.created_at,
      m.direction,
      m.instance_name
    FROM whatsapp_messages m
    WHERE m.instance_name = ANY(p_instance_names)
    ORDER BY m.phone, m.instance_name, m.created_at DESC
  ),
  counts AS (
    SELECT 
      m.phone,
      m.instance_name,
      COUNT(*) as msg_count,
      COUNT(*) FILTER (WHERE m.direction = 'inbound' AND m.read_at IS NULL) as unread
    FROM whatsapp_messages m
    WHERE m.instance_name = ANY(p_instance_names)
    GROUP BY m.phone, m.instance_name
  )
  SELECT 
    l.phone,
    COALESCE(
      l.contact_name,
      ct.full_name
    ) as contact_name,
    COALESCE(l.contact_id, ct.id::text) as contact_id,
    l.lead_id,
    l.message_text as last_message_text,
    l.created_at as last_message_at,
    l.direction as last_direction,
    l.instance_name,
    COALESCE(c.unread, 0) as unread_count,
    COALESCE(c.msg_count, 0) as message_count
  FROM latest l
  LEFT JOIN counts c ON c.phone = l.phone AND c.instance_name = l.instance_name
  LEFT JOIN LATERAL (
    SELECT ct2.id::text, ct2.full_name 
    FROM contacts ct2 
    WHERE ct2.phone IS NOT NULL 
      AND RIGHT(REGEXP_REPLACE(ct2.phone, '\D', '', 'g'), 8) = RIGHT(REGEXP_REPLACE(l.phone, '\D', '', 'g'), 8)
    LIMIT 1
  ) ct ON true
  ORDER BY l.created_at DESC;
$function$;
