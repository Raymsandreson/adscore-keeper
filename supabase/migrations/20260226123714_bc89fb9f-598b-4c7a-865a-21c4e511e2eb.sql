
DELETE FROM whatsapp_messages 
WHERE id IN (
  SELECT id FROM (
    SELECT id, external_message_id, ROW_NUMBER() OVER (PARTITION BY external_message_id ORDER BY created_at ASC) as rn
    FROM whatsapp_messages
    WHERE external_message_id IS NOT NULL
  ) sub
  WHERE rn > 1
);
