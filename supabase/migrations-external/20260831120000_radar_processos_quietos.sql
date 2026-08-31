-- =============================================================================
-- Radar de processos quietos — infraestrutura de banco (Supabase EXTERNO
-- kmedldlepwiityjsdahz). Par da edge radar-processos-quietos.
--
-- Motivação (medida em 30/08/2026, caso 1017247-47.2025.4.01.3100): a juntada
-- de réplica de 03/08 só chegou ao banco em 30/08 porque o cache do Escavador
-- estava parado em 08/07 e nada no sistema re-consultava processo quieto nem
-- pedia atualização paga. 591 processos tinham atividade aberta; 335 com
-- movimentação parada 20+ dias; 254 com prazo ≤7 dias e movimentação velha.
--
-- ROLLBACK (<5 min):
--   select cron.unschedule('radar-processos-quietos');
--   drop function if exists public.radar_processos_quentes(int,int,int);
--   drop function if exists public.radar_mov_mais_nova(uuid[]);
--   drop table if exists public.radar_atualizacoes;
-- =============================================================================

-- Rastro de cada solicitação PAGA de atualização no tribunal: dá o cooldown
-- (não pedir de novo cedo demais) e a auditoria de custo (créditos cobrados).
create table if not exists public.radar_atualizacoes (
  id bigint generated always as identity primary key,
  process_id uuid not null,
  processo_cnj text not null,
  -- email_recente | prazo_proximo | mov_estagnada
  motivo text not null,
  -- movimentação mais nova SALVA no momento do pedido; o follow-up compara com
  -- ela para saber se a atualização trouxe coisa nova
  mov_mais_nova_antes date,
  -- SOLICITADO -> ATUALIZADO (movimentação avançou) | SEM_MUDANCA (7 dias sem
  -- avanço) | ERRO (a API recusou o pedido)
  status text not null default 'SOLICITADO'
    check (status in ('SOLICITADO','ATUALIZADO','SEM_MUDANCA','ERRO')),
  creditos integer,
  resposta jsonb,
  solicitado_em timestamptz not null default now(),
  verificado_em timestamptz
);

create index if not exists radar_atualizacoes_cnj_idx
  on public.radar_atualizacoes (processo_cnj, solicitado_em desc);
create index if not exists radar_atualizacoes_status_idx
  on public.radar_atualizacoes (status, solicitado_em)
  where status = 'SOLICITADO';

-- Sem policy de propósito: só a service role (edge) escreve e lê.
alter table public.radar_atualizacoes enable row level security;

-- Processos "quentes": atividade aberta + CNJ válido, em três motivos por
-- ordem de urgência. mov_mais_nova é max() sobre o array salvo — não confia
-- na ordem do jsonb.
create or replace function public.radar_processos_quentes(
  p_stale_dias int default 20,
  p_prazo_dias int default 7,
  p_max int default 40
) returns table (
  process_id uuid,
  processo_cnj text,
  mov_mais_nova date,
  prazo_proximo date,
  motivo text
) language sql stable as $$
  with procs as (
    select lp.id, lp.process_number,
           (select max((m->>'data')::date)
              from jsonb_array_elements(coalesce(lp.movimentacoes, '[]'::jsonb)) m
             where (m->>'data') ~ '^\d{4}-\d{2}-\d{2}') as mov_mais_nova
    from lead_processes lp
    where lp.deleted_at is null
      and lp.process_number ~ '^\d{7}-?\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}$'
      and exists (select 1 from lead_activities la
                   where la.process_id = lp.id
                     and la.status not in ('concluida','cancelada'))
  ),
  ativ as (
    select la.process_id,
           min(la.deadline) filter (where la.deadline >= current_date) as prazo_proximo
    from lead_activities la
    where la.status not in ('concluida','cancelada')
    group by 1
  ),
  emails as (
    select pe.process_number, max(pe.received_at::date) as ultimo_email
    from processual_emails pe
    where pe.deleted_at is null
      and pe.received_at >= now() - interval '2 days'
    group by 1
  ),
  classif as (
    select p.id, p.process_number, p.mov_mais_nova, a.prazo_proximo,
      case
        when e.ultimo_email is not null
             and (p.mov_mais_nova is null or p.mov_mais_nova < e.ultimo_email - 1)
          then 'email_recente'
        when a.prazo_proximo is not null
             and a.prazo_proximo <= current_date + p_prazo_dias
             and (p.mov_mais_nova is null or p.mov_mais_nova < current_date - 7)
          then 'prazo_proximo'
        when p.mov_mais_nova is null or p.mov_mais_nova < current_date - p_stale_dias
          then 'mov_estagnada'
      end as motivo
    from procs p
    left join ativ a on a.process_id = p.id
    left join emails e on e.process_number = p.process_number
  )
  select id, process_number, mov_mais_nova, prazo_proximo, motivo
  from classif
  where motivo is not null
  order by
    case motivo when 'email_recente' then 0 when 'prazo_proximo' then 1 else 2 end,
    coalesce(prazo_proximo, 'infinity'::date),
    mov_mais_nova asc nulls first
  limit p_max;
$$;

-- Movimentação mais nova salva por processo (para o antes/depois do radar).
create or replace function public.radar_mov_mais_nova(p_ids uuid[])
returns table (process_id uuid, processo_cnj text, mov_mais_nova date)
language sql stable as $$
  select lp.id, lp.process_number,
         (select max((m->>'data')::date)
            from jsonb_array_elements(coalesce(lp.movimentacoes, '[]'::jsonb)) m
           where (m->>'data') ~ '^\d{4}-\d{2}-\d{2}')
  from lead_processes lp
  where lp.id = any(p_ids);
$$;

-- 2x/dia: a rodada das 09h UTC pede as atualizações pagas; a das 17h UTC colhe
-- o resultado (follow-up) e cria os prazos no mesmo dia.
select cron.schedule(
  'radar-processos-quietos',
  '0 9,17 * * *',
  $$
  select net.http_post(
    url := 'https://kmedldlepwiityjsdahz.supabase.co/functions/v1/radar-processos-quietos',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImttZWRsZGxlcHdpaXR5anNkYWh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4OTExOTAsImV4cCI6MjA5MDQ2NzE5MH0.s51bWtABFjJGfGyuPFWr5Tp8CzbxPD5eieFUqUVuQTs'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 300000
  );
  $$
);
