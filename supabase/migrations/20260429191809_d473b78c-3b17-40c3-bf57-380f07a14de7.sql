UPDATE public.migration_progress
SET status = 'done',
    last_error = 'skipped: TTL 3 days, not critical (option B)',
    finished_at = now(),
    updated_at = now()
WHERE table_name = 'webhook_logs';