
-- Tag subsequent messages in CTWA conversations
UPDATE whatsapp_messages SET 
  campaign_id = '120239587561710705',
  campaign_name = '[AUX. MATERNIDADE][LUCAS DO RIO VERDE]'
WHERE phone IN (
  SELECT DISTINCT phone FROM whatsapp_messages 
  WHERE campaign_id = '120239587561710705'
) AND (campaign_id IS NULL OR campaign_id = '');
