-- Remove duplicates keeping the oldest row per external_message_id
DELETE FROM whatsapp_messages a
USING whatsapp_messages b
WHERE a.external_message_id = b.external_message_id
  AND a.external_message_id IS NOT NULL
  AND a.id > b.id;

-- Add unique index to prevent future duplicates
CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_messages_external_id_unique 
ON whatsapp_messages (external_message_id) 
WHERE external_message_id IS NOT NULL;