
-- Backfill campaign_id on CTWA messages (direct CTWA context)
UPDATE whatsapp_messages SET 
  campaign_id = '120239587561710705',
  campaign_name = '[AUX. MATERNIDADE][LUCAS DO RIO VERDE]'
WHERE metadata::text ILIKE '%ctwaClid%' 
  AND (campaign_id IS NULL OR campaign_id = '');
