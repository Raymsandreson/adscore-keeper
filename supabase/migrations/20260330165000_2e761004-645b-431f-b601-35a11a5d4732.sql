
-- Clean duplicate pending calls from queue (keep only most recent per phone)
DELETE FROM whatsapp_call_queue 
WHERE id NOT IN (
  SELECT DISTINCT ON (phone, instance_name) id 
  FROM whatsapp_call_queue 
  WHERE status = 'pending'
  ORDER BY phone, instance_name, created_at DESC
) AND status = 'pending';
