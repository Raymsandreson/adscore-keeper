UPDATE public.migration_progress
SET status = 'done',
    ordering = 99999,
    last_error = 'skipped: TTL 3 days, not critical',
    finished_at = now(),
    updated_at = now()
WHERE table_name = 'webhook_logs';