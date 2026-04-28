CREATE TABLE IF NOT EXISTS public.migration_progress (
  table_name text PRIMARY KEY,
  ordering int NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  last_id text,
  total_read int NOT NULL DEFAULT 0,
  total_upserted int NOT NULL DEFAULT 0,
  batches int NOT NULL DEFAULT 0,
  attempts int NOT NULL DEFAULT 0,
  last_error text,
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_migration_progress_status ON public.migration_progress(status, ordering);

ALTER TABLE public.migration_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins_view_migration_progress" ON public.migration_progress
  FOR SELECT USING (public.is_admin(auth.uid()));