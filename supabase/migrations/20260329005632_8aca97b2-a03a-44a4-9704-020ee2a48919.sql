
-- Clean up messages from groups that were wrongly tagged with campaign_id
UPDATE whatsapp_messages 
SET campaign_id = NULL, campaign_name = NULL
WHERE campaign_id IS NOT NULL 
AND phone LIKE '120363%';

-- Clean up messages from non-matching instances for campaign [AUX. MATERNIDADE][LUCAS DO RIO VERDE]
-- This campaign belongs to instance "Analyne Oliveira" but fallback assigned it to other instances
UPDATE whatsapp_messages 
SET campaign_id = NULL, campaign_name = NULL
WHERE campaign_id = '120239587561730705'
AND instance_name != 'Analyne Oliveira'
AND instance_name != 'WHATSJUD IA';
