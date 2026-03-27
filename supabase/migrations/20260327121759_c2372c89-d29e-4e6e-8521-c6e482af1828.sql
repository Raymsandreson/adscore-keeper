
CREATE OR REPLACE FUNCTION public.get_conversation_summaries(p_instance_names text[])
RETURNS TABLE (
  phone text,
  contact_name text,
  contact_id uuid,
  lead_id uuid,
  last_message_text text,
  last_message_at timestamptz,
  last_direction text,
  instance_name text,
  unread_count bigint,
  message_count bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
  WITH ranked AS (
    SELECT 
      m.phone,
      m.contact_name,
      m.contact_id,
      m.lead_id,
      m.message_text,
      m.created_at,
      m.direction,
      m.instance_name,
      m.read_at,
      ROW_NUMBER() OVER (PARTITION BY m.phone, m.instance_name ORDER BY m.created_at DESC) as rn
    FROM whatsapp_messages m
    WHERE m.instance_name = ANY(p_instance_names)
  ),
  latest AS (
    SELECT * FROM ranked WHERE rn = 1
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
    l.contact_name,
    l.contact_id,
    l.lead_id,
    l.message_text as last_message_text,
    l.created_at as last_message_at,
    l.direction as last_direction,
    l.instance_name,
    COALESCE(c.unread, 0) as unread_count,
    COALESCE(c.msg_count, 0) as message_count
  FROM latest l
  LEFT JOIN counts c ON c.phone = l.phone AND c.instance_name = l.instance_name
  ORDER BY l.created_at DESC;
$$;
