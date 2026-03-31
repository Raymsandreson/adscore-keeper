
DROP FUNCTION IF EXISTS public.get_conversation_summaries(text[]);

CREATE FUNCTION public.get_conversation_summaries(p_instance_names text[])
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
LANGUAGE sql STABLE
SET search_path = public
AS $$
  WITH ranked AS (
    SELECT 
      m.phone,
      m.contact_name,
      m.contact_id::text,
      m.lead_id::text,
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
  name_ranked AS (
    SELECT 
      m.phone,
      m.instance_name,
      m.contact_name,
      ROW_NUMBER() OVER (PARTITION BY m.phone, m.instance_name ORDER BY m.created_at DESC) as rn
    FROM whatsapp_messages m
    WHERE m.instance_name = ANY(p_instance_names)
      AND m.contact_name IS NOT NULL
      AND m.contact_name != ''
  ),
  best_names AS (
    SELECT phone, instance_name, contact_name FROM name_ranked WHERE rn = 1
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
      bn.contact_name,
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
  LEFT JOIN best_names bn ON bn.phone = l.phone AND bn.instance_name = l.instance_name
  LEFT JOIN counts c ON c.phone = l.phone AND c.instance_name = l.instance_name
  LEFT JOIN LATERAL (
    SELECT ct2.id::text, ct2.full_name 
    FROM contacts ct2 
    WHERE ct2.phone IS NOT NULL 
      AND RIGHT(REGEXP_REPLACE(ct2.phone, '\D', '', 'g'), 8) = RIGHT(REGEXP_REPLACE(l.phone, '\D', '', 'g'), 8)
    LIMIT 1
  ) ct ON true
  ORDER BY l.created_at DESC;
$$;
