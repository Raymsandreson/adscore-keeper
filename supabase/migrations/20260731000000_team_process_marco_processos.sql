-- =============================================================================
-- Drill-down das metas processuais: quais processos estão por trás dos números
-- "Até hoje" (já passaram pelo marco) e "Atualmente" (é o marco mais recente).
-- Banco alvo: Supabase EXTERNO kmedldlepwiityjsdahz.
--
-- Rollback:
--   drop function if exists public.team_process_marco_processos(uuid, text, text);
-- =============================================================================

create or replace function public.team_process_marco_processos(
  p_team_id uuid,
  p_marco text,
  p_modo text default 'acumulado'
)
returns table (
  process_id uuid,
  process_number text,
  title text,
  case_id uuid,
  lead_id uuid,
  lead_name text,
  responsavel text,
  data_movimentacao timestamptz,
  descricao text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    lp.id,
    lp.process_number,
    lp.title,
    lp.case_id,
    lp.lead_id,
    l.lead_name,
    pr.full_name,
    src.data_movimentacao,
    left(src.descricao, 240)
  from vw_team_process_assignment a
  join lead_processes lp on lp.id = a.process_id
  join leads l on l.id = lp.lead_id
  left join profiles pr on pr.user_id = l.processual_responsible_id
  join lateral (
    -- 'atual': só quando o marco pedido é o mais recente do processo.
    -- 'acumulado' (padrão): a passagem mais recente pelo marco pedido.
    select cs.data_movimentacao, cs.descricao
    from lead_process_current_status cs
    where p_modo = 'atual'
      and cs.process_id = lp.id
      and cs.tipo_movimentacao = p_marco
    union all
    select pm.data_movimentacao, pm.descricao
    from process_movements pm
    where p_modo is distinct from 'atual'
      and pm.process_id = lp.id
      and pm.tipo_movimentacao = p_marco
    order by 1 desc
    limit 1
  ) src on true
  where a.team_id = p_team_id
  order by src.data_movimentacao desc;
$$;

grant execute on function public.team_process_marco_processos(uuid, text, text) to authenticated, anon;

comment on function public.team_process_marco_processos(uuid, text, text) is
  'Processos do time por marco. p_modo = ''acumulado'' (já passaram pelo marco) ou ''atual'' (o marco é o estado mais recente).';
