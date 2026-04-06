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
      NULLIF(l.contact_name, ''),
      c.full_name,
      ''
    ) as contact_name,
    COALESCE(l.contact_id, '') as contact_id,
    COALESCE(l.lead_id, '') as lead_id,
    l.message_text as last_message_text,
    l.created_at as last_message_at,
    l.direction as last_direction,
    l.instance_name,
    COALESCE(cnt.unread, 0) as unread_count,
    COALESCE(cnt.msg_count, 0) as message_count
  FROM latest l
  LEFT JOIN counts cnt ON cnt.phone = l.phone AND cnt.instance_name = l.instance_name
  LEFT JOIN contacts c ON c.id::text = l.contact_id
  ORDER BY l.created_at DESC;
$function$;