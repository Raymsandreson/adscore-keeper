
-- Backfill: Tag all CTWA messages from sourceID 120238758570000705 on Prev. Edilan
-- These are from the campaign [AUX. MATER.][NOVOS CRIATIVOS]EDILAN/VIVIANE
UPDATE whatsapp_messages 
SET campaign_id = '120238758570000705',
    campaign_name = '[AUX. MATER.][NOVOS CRIATIVOS]EDILAN/VIVIANE'
WHERE instance_name = 'Prev. Edilan'
  AND metadata::text ILIKE '%120238758570000705%'
  AND (campaign_id IS NULL OR campaign_id = '');

-- Also tag all subsequent messages in those same phone conversations
UPDATE whatsapp_messages 
SET campaign_id = '120238758570000705',
    campaign_name = '[AUX. MATER.][NOVOS CRIATIVOS]EDILAN/VIVIANE'
WHERE instance_name = 'Prev. Edilan'
  AND (campaign_id IS NULL OR campaign_id = '')
  AND phone IN (
    SELECT DISTINCT phone FROM whatsapp_messages 
    WHERE instance_name = 'Prev. Edilan'
    AND metadata::text ILIKE '%120238758570000705%'
  );
