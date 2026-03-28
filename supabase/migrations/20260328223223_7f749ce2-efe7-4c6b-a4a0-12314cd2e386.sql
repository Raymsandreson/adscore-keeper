
-- Backfill campaign_id on leads (smaller set ~356 rows)
UPDATE leads SET 
  campaign_id = '120239587561710705',
  source = COALESCE(NULLIF(source, ''), 'ctwa_whatsapp')
WHERE lead_phone IN (
  SELECT DISTINCT phone FROM whatsapp_messages 
  WHERE metadata::text ILIKE '%ctwaClid%' AND direction='inbound'
) AND (campaign_id IS NULL OR campaign_id = '');
