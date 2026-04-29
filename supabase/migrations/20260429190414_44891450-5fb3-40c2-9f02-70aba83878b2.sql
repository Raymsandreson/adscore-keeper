UPDATE public.migration_progress
SET ordering = (SELECT MAX(ordering) FROM public.migration_progress) + 100,
    status = 'pending',
    last_error = NULL,
    updated_at = now()
WHERE table_name IN ('webhook_logs','whatsapp_messages');