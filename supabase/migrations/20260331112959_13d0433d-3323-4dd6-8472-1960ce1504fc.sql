-- Sync Luana's profile in external DB with phone and default WhatsApp instance
-- This is needed so notification edge functions can find her contact info
UPDATE profiles 
SET phone = '5586999275467', 
    default_instance_id = 'e9513270-45ec-4f09-9cb5-28d7defb4386'
WHERE user_id = '1589c873-0550-418b-b828-f290e852d5d5';