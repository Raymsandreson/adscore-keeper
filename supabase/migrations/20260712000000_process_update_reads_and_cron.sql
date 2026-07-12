-- Sino v2: leitura por usuário + varredura diária automática.
-- Aplicar no Supabase EXTERNO (kmedldlepwiityjsdahz).
--
-- Rollback:
--   select cron.unschedule('sync-process-compromissos-daily');
--   drop table if exists public.process_update_reads;

-- Lido/não-lido POR USUÁRIO (user_id = profile do Externo, remapeado no client).
create table if not exists public.process_update_reads (
  update_id uuid not null references public.process_updates(id) on delete cascade,
  user_id uuid not null,
  read_at timestamptz not null default now(),
  primary key (update_id, user_id)
);

create index if not exists process_update_reads_user_idx
  on public.process_update_reads (user_id);

alter table public.process_update_reads enable row level security;

-- Mesmo padrão permissivo das demais tabelas de negócio (sessão anônima
-- autenticada; o user_id vem remapeado do app, não do auth.uid()).
create policy "Authenticated users can view update reads"
  on public.process_update_reads for select
  to authenticated
  using (auth.uid() is not null);

create policy "Authenticated users can mark updates read"
  on public.process_update_reads for insert
  to authenticated
  with check (auth.uid() is not null);

-- Varredura diária do detector de compromissos + feed do sino.
-- 08:00 UTC = 05:00 Brasília. A anon key abaixo é pública (mesma do frontend).
select cron.schedule(
  'sync-process-compromissos-daily',
  '0 8 * * *',
  $$
  select net.http_post(
    url := 'https://kmedldlepwiityjsdahz.supabase.co/functions/v1/sync-process-compromissos',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImttZWRsZGxlcHdpaXR5anNkYWh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4OTExOTAsImV4cCI6MjA5MDQ2NzE5MH0.s51bWtABFjJGfGyuPFWr5Tp8CzbxPD5eieFUqUVuQTs'
    ),
    body := '{"sweep": true, "limit": 500}'::jsonb,
    timeout_milliseconds := 240000
  )
  $$
);
