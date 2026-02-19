-- Remove unique constraint that prevents multiple time blocks per activity type per user
-- The constraint user_timeblock_settings_user_id_activity_type_key blocks multi-block support
ALTER TABLE public.user_timeblock_settings 
DROP CONSTRAINT IF EXISTS user_timeblock_settings_user_id_activity_type_key;