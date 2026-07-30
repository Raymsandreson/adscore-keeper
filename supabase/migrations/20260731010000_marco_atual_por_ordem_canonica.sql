-- =============================================================================
-- "Atualmente" passa a usar a ORDEM CANÔNICA do marco, não a data mais recente.
-- Banco alvo: Supabase EXTERNO kmedldlepwiityjsdahz.
--
-- Motivo (evidência de 30/07/2026, processo 0000657-98.2025.5.11.0012):
--   peticao_inicial  ordem 1  08/06/2026  "Distribuído por sorteio"
--   acordao_2grau    ordem 4  29/04/2026
-- A movimentação de 08/06 é a REDISTRIBUIÇÃO no 2º grau (o parser trata qualquer
-- "distribuiç…" como petição inicial). Ordenando por data, o processo aparecia
-- parado na Petição Inicial estando no acórdão. Divergia em 15 processos só no
-- time Processual Trabalhista.
--
-- Critério novo: maior marco_ordem; empate resolvido pela data mais recente.
-- É o mesmo da linha do trem da ficha do processo (src/lib/processStations.ts).
--
-- A view lead_process_current_status NÃO foi alterada — outras telas dependem
-- dela e a mudança precisa ser decidida à parte.
--
-- Rollback: reaplicar as versões destas duas funções da migration
--   20260730233000_team_process_goals_baseline.sql (baseline) e
--   20260731000000_team_process_marco_processos.sql (lista).
-- =============================================================================

create or replace function public.team_process_marco_baseline(p_team_id uuid)
returns table (
  marco_tipo text,
  acumulado integer,
  atual integer
)
language sql
stable
security definer
set search_path = public
as $$
  with marcos(tipo) as (
    select unnest(array[
      'peticao_inicial', 'audiencia_conciliacao', 'pericia', 'audiencia_instrucao',
      'sentenca_1grau', 'acordo', 'acordao_2grau', 'acordao_superior',
      'transito_julgado', 'pagamento'
    ])
  ),
  proc as (
    select process_id from vw_team_process_assignment where team_id = p_team_id
  ),
  -- Marco mais AVANÇADO de cada processo (ordem canônica), não o mais recente.
  atual as (
    select distinct on (pm.process_id) pm.process_id, pm.tipo_movimentacao
    from process_movements pm
    join proc p on p.process_id = pm.process_id
    order by pm.process_id, pm.marco_ordem desc nulls last, pm.data_movimentacao desc
  )
  select
    m.tipo,
    (
      select count(distinct pm.process_id)::integer
      from process_movements pm
      join proc p on p.process_id = pm.process_id
      where pm.tipo_movimentacao = m.tipo
    ),
    (
      select count(*)::integer from atual a where a.tipo_movimentacao = m.tipo
    )
  from marcos m;
$$;

grant execute on function public.team_process_marco_baseline(uuid) to authenticated, anon;

comment on function public.team_process_marco_baseline(uuid) is
  'Por marco: quantos processos do time já registraram o marco (acumulado) e em quantos ele é o marco mais avançado na ordem canônica (atual).';

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
  with atual as (
    select distinct on (pm.process_id)
      pm.process_id, pm.tipo_movimentacao, pm.data_movimentacao, pm.descricao
    from process_movements pm
    join vw_team_process_assignment a on a.process_id = pm.process_id
    where a.team_id = p_team_id
    order by pm.process_id, pm.marco_ordem desc nulls last, pm.data_movimentacao desc
  )
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
    -- 'atual': só se o marco pedido for o mais avançado do processo.
    select at.data_movimentacao, at.descricao
    from atual at
    where p_modo = 'atual'
      and at.process_id = lp.id
      and at.tipo_movimentacao = p_marco
    union all
    -- 'acumulado': a passagem mais recente pelo marco pedido.
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
  'Processos do time por marco. p_modo = ''acumulado'' (já passaram pelo marco) ou ''atual'' (marco mais avançado na ordem canônica).';
