
-- Fix: Update Edilan campaign link with correct campaign_id from actual messages
UPDATE whatsapp_agent_campaign_links 
SET campaign_id = '120238758570000705'
WHERE id = '0a7b41bd-4e22-464f-8b84-1bb5025c3106'
AND campaign_id = '120238596830560705';
