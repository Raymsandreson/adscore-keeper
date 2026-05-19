ALTER TABLE public.whatsapp_groups_cache REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_groups_cache;