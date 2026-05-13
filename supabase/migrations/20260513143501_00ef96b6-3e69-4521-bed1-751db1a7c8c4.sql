ALTER TABLE public.user_timeblock_settings REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.user_timeblock_settings;