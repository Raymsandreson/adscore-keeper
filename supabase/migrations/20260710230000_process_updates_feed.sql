-- Feed de atualizações processuais para o sino (ProcessUpdatesBell).
-- Alimentado pela edge sync-process-compromissos a cada sync de movimentações.
-- Aplicar no Supabase EXTERNO (kmedldlepwiityjsdahz).
--
-- Rollback:
--   drop table if exists public.process_updates;

create table if not exists public.process_updates (
  id uuid primary key default gen_random_uuid(),
  process_id uuid not null references public.lead_processes(id) on delete cascade,
  lead_id uuid,
  case_id uuid,
  numero_cnj text,
  processo_titulo text,
  categoria text not null check (categoria in ('decisao_merito','audiencia','pericia','prazo','despacho','movimentacao')),
  titulo text not null,
  descricao text,
  data_movimentacao date,
  escavador_movimentacao_id text,
  conteudo_hash text not null,
  created_at timestamptz not null default now()
);

-- Dedupe idempotente entre re-syncs (mesmo padrão de process_movements).
create unique index if not exists process_updates_process_hash_uidx
  on public.process_updates (process_id, conteudo_hash);

-- O sino lista por recência; filtro por categoria é client-side sobre o limite.
create index if not exists process_updates_created_at_idx
  on public.process_updates (created_at desc);

alter table public.process_updates enable row level security;

-- Leitura para usuários autenticados (sessão anônima do frontend conta como
-- authenticated). Escrita só via service role (edge functions) — sem policy.
create policy "Authenticated users can view process updates"
  on public.process_updates for select
  to authenticated
  using (auth.uid() is not null);

-- Realtime para o sino atualizar sem polling.
alter publication supabase_realtime add table public.process_updates;
