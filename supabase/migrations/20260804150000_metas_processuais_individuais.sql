-- =============================================================================
-- Metas processuais também POR PESSOA (antes só por time).
-- Banco alvo: Supabase EXTERNO kmedldlepwiityjsdahz.
--
-- Decisão do usuário (04/08/2026):
--   - dono do processo = coalesce(lead_processes.responsible_user_id,
--     leads.processual_responsible_id) — o responsável do próprio processo tem
--     precedência sobre o do lead (divergem em 51 processos hoje);
--   - metas de time CONTINUAM existindo; a meta é de um OU de outro, nunca dos dois;
--   - visibilidade inalterada: quem está autenticado vê todas.
--
-- Cobertura medida em 04/08/2026 (1.723 processos vivos):
--   827 atribuídos a um time · 840 com dono individual · 342 com marco detectado
--   (219 desses têm dono). Os 883 sem dono não entram em meta individual — eles
--   só aparecem nas de time, via fallback POP → team_workflow_boards.
--
-- Regra de ouro herdada do bug das duas escalas de marco_ordem (20260803120000):
-- a regra de "de quem é o processo" passa a existir em UM lugar só
-- (vw_process_assignment); vw_team_process_assignment vira uma projeção dela.
--
-- As três RPCs team_* continuam existindo como wrappers das novas — nenhum
-- consumidor atual quebra. Remover só depois de 24h com o front novo em pé.
--
-- Rollback:
--   drop function if exists public.process_owners();
--   drop function if exists public.process_goals_progress(uuid, uuid, date, date);
--   drop function if exists public.process_marco_processos(uuid, uuid, text, text);
--   drop function if exists public.process_marco_baseline(uuid, uuid);
--   -- e reaplicar as versões de team_process_* das migrations 20260731010000
--   -- (baseline e lista) e 20260730233000 (progresso);
--   drop view if exists public.vw_team_process_assignment;
--   drop view if exists public.vw_process_assignment;
--   -- recriar vw_team_process_assignment como em 20260730233000;
--   drop index if exists public.uq_user_process_goals_ativa;
--   drop index if exists public.idx_team_process_goals_user_periodo;
--   alter table public.team_process_goals drop constraint if exists team_process_goals_um_dono;
--   alter table public.team_process_goals drop column if exists user_id, drop column if exists user_name;
--   alter table public.team_process_goals alter column team_id set not null;
--   drop index if exists public.uq_team_process_goals_ativa;
--   create unique index uq_team_process_goals_ativa on public.team_process_goals
--     (team_id, period_start, period_end, coalesce(marco_tipo, '*')) where is_active;
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) Atribuição do processo — fonte única, agora com as duas dimensões.
--    Diferente da view antiga, NÃO filtra team_id not null: um processo pode ter
--    dono individual e nenhum time (182 processos hoje) ou o contrário.
-- -----------------------------------------------------------------------------
create or replace view public.vw_process_assignment
with (security_invoker = on) as
select
  lp.id as process_id,
  lp.lead_id,
  lp.workflow_id,
  coalesce(tm.team_id, twb.team_id) as team_id,
  coalesce(lp.responsible_user_id, l.processual_responsible_id) as user_id
from public.lead_processes lp
join public.leads l on l.id = lp.lead_id
left join public.team_members tm on tm.user_id = l.processual_responsible_id
left join public.team_workflow_boards twb on twb.board_id::text = lp.workflow_id
where lp.deleted_at is null;

revoke all on public.vw_process_assignment from anon, authenticated;

comment on view public.vw_process_assignment is
  'Processo → time e → pessoa. Time: responsável processual do lead em team_members, senão o POP mapeado. Pessoa: responsável do processo, senão o responsável processual do lead. Fonte única — vw_team_process_assignment é uma projeção desta.';

-- Mesma assinatura de colunas da versão anterior: os consumidores não percebem.
create or replace view public.vw_team_process_assignment
with (security_invoker = on) as
select a.process_id, a.lead_id, a.workflow_id, a.team_id
from public.vw_process_assignment a
where a.team_id is not null;

revoke all on public.vw_team_process_assignment from anon, authenticated;

comment on view public.vw_team_process_assignment is
  'Projeção de vw_process_assignment com os processos que têm time. Mantida para não mexer nos consumidores existentes.';

-- -----------------------------------------------------------------------------
-- 2) A meta passa a poder ser de uma pessoa.
--    team_id deixa de ser obrigatório; o CHECK garante exatamente um dono.
-- -----------------------------------------------------------------------------
alter table public.team_process_goals
  add column if not exists user_id uuid,
  add column if not exists user_name text;

alter table public.team_process_goals alter column team_id drop not null;

alter table public.team_process_goals
  drop constraint if exists team_process_goals_um_dono;
alter table public.team_process_goals
  add constraint team_process_goals_um_dono check (num_nonnulls(team_id, user_id) = 1);

comment on column public.team_process_goals.user_id is
  'Dono individual da meta (auth uuid, casa com profiles.user_id). Exclusivo com team_id — o CHECK team_process_goals_um_dono exige exatamente um.';
comment on column public.team_process_goals.user_name is
  'Retrato do nome da pessoa no momento do cadastro (fallback de exibição), igual ao papel de team_name.';

-- Uma meta ativa por dono/período/marco — agora em duas famílias.
drop index if exists public.uq_team_process_goals_ativa;
create unique index uq_team_process_goals_ativa
  on public.team_process_goals (team_id, period_start, period_end, coalesce(marco_tipo, '*'))
  where is_active and team_id is not null;

create unique index if not exists uq_user_process_goals_ativa
  on public.team_process_goals (user_id, period_start, period_end, coalesce(marco_tipo, '*'))
  where is_active and user_id is not null;

create index if not exists idx_team_process_goals_user_periodo
  on public.team_process_goals (user_id, period_start, period_end)
  where is_active;

-- -----------------------------------------------------------------------------
-- 3) Retrato por marco — mesma lógica de antes, agora com os dois recortes.
--    Precedência: pessoa > time. Sem nenhum dos dois, devolve zeros (nunca a
--    carteira inteira da firma por engano).
-- -----------------------------------------------------------------------------
create or replace function public.process_marco_baseline(
  p_team_id uuid default null,
  p_user_id uuid default null
)
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
    select a.process_id
    from vw_process_assignment a
    where case
      when p_user_id is not null then a.user_id = p_user_id
      when p_team_id is not null then a.team_id = p_team_id
      else false
    end
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

grant execute on function public.process_marco_baseline(uuid, uuid) to authenticated, anon;

comment on function public.process_marco_baseline(uuid, uuid) is
  'Por marco: quantos processos do dono já registraram o marco (acumulado) e em quantos ele é o marco mais avançado (atual). Dono = pessoa (p_user_id) ou time (p_team_id); pessoa tem precedência.';

-- -----------------------------------------------------------------------------
-- 4) Drill-down: os processos por trás do número.
--    Mudança de rótulo: "responsavel" passa a ser o dono efetivo do processo
--    (vw_process_assignment.user_id), não mais sempre o do lead — divergiam em
--    51 processos.
-- -----------------------------------------------------------------------------
create or replace function public.process_marco_processos(
  p_team_id uuid default null,
  p_user_id uuid default null,
  p_marco text default null,
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
  with alvo as (
    select a.process_id, a.user_id
    from vw_process_assignment a
    where case
      when p_user_id is not null then a.user_id = p_user_id
      when p_team_id is not null then a.team_id = p_team_id
      else false
    end
  ),
  atual as (
    select distinct on (pm.process_id)
      pm.process_id, pm.tipo_movimentacao, pm.data_movimentacao, pm.descricao
    from process_movements pm
    join alvo t on t.process_id = pm.process_id
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
  from alvo t
  join lead_processes lp on lp.id = t.process_id
  join leads l on l.id = lp.lead_id
  left join profiles pr on pr.user_id = t.user_id
  join lateral (
    -- 'atual': só quando o marco pedido é o mais avançado do processo.
    -- 'acumulado' (padrão): a passagem mais recente pelo marco pedido.
    select at.data_movimentacao, at.descricao
    from atual at
    where p_modo = 'atual'
      and at.process_id = lp.id
      and at.tipo_movimentacao = p_marco
    union all
    select pm.data_movimentacao, pm.descricao
    from process_movements pm
    where p_modo is distinct from 'atual'
      and pm.process_id = lp.id
      and pm.tipo_movimentacao = p_marco
    order by 1 desc
    limit 1
  ) src on true
  order by src.data_movimentacao desc;
$$;

grant execute on function public.process_marco_processos(uuid, uuid, text, text) to authenticated, anon;

comment on function public.process_marco_processos(uuid, uuid, text, text) is
  'Processos do dono (pessoa ou time) por marco. p_modo = ''acumulado'' (já passaram pelo marco) ou ''atual'' (o marco é o mais avançado).';

-- -----------------------------------------------------------------------------
-- 5) Realizado × meta, para as duas famílias.
--    O escopo de cada linha vem da PRÓPRIA meta (g.user_id ou g.team_id); os
--    parâmetros só filtram QUAIS metas listar (null = todas, como antes).
--    processos_no_time = processos do dono — nome mantido para não quebrar o front.
-- -----------------------------------------------------------------------------
create or replace function public.process_goals_progress(
  p_team_id uuid default null,
  p_user_id uuid default null,
  p_period_start date default null,
  p_period_end date default null
)
returns table (
  goal_id uuid,
  owner_kind text,
  team_id uuid,
  team_name text,
  user_id uuid,
  user_name text,
  name text,
  period_type text,
  period_start date,
  period_end date,
  marco_tipo text,
  target_processes integer,
  target_flow_avg_pct numeric,
  baseline_processes integer,
  realizado_processos integer,
  realizado_no_periodo integer,
  fluxo_medio_pct numeric,
  processos_no_time integer,
  processos_com_fluxo integer,
  processos_com_marco integer
)
language sql
stable
security definer
set search_path = public
as $$
  with flow as (
    select
      a.process_id,
      a.team_id,
      a.user_id,
      count(*) filter (where coalesce((it.value->>'checked')::boolean, false))::numeric
        / nullif(count(*), 0) * 100 as pct
    from vw_process_assignment a
    join lead_checklist_instances i
      on i.lead_id = a.lead_id
     and i.board_id::text = a.workflow_id
    join checklist_stage_links l
      on l.board_id = i.board_id
     and l.stage_id = i.stage_id
     and l.checklist_template_id = i.checklist_template_id
    cross join lateral jsonb_array_elements(coalesce(i.items, '[]'::jsonb)) it(value)
    group by a.process_id, a.team_id, a.user_id
  )
  select
    g.id,
    case when g.user_id is not null then 'user' else 'team' end as owner_kind,
    g.team_id,
    coalesce(t.name, g.team_name) as team_name,
    g.user_id,
    coalesce(pr.full_name, g.user_name) as user_name,
    g.name,
    g.period_type,
    g.period_start,
    g.period_end,
    g.marco_tipo,
    g.target_processes,
    g.target_flow_avg_pct,
    g.baseline_processes,
    (
      select count(distinct pm.process_id)::integer
      from process_movements pm
      join vw_process_assignment a on a.process_id = pm.process_id
      where (case when g.user_id is not null then a.user_id = g.user_id else a.team_id = g.team_id end)
        and (g.marco_tipo is null or pm.tipo_movimentacao = g.marco_tipo)
    ) as realizado_processos,
    (
      select count(distinct pm.process_id)::integer
      from process_movements pm
      join vw_process_assignment a on a.process_id = pm.process_id
      where (case when g.user_id is not null then a.user_id = g.user_id else a.team_id = g.team_id end)
        and pm.data_movimentacao::date between g.period_start and g.period_end
        and (g.marco_tipo is null or pm.tipo_movimentacao = g.marco_tipo)
    ) as realizado_no_periodo,
    (
      select round(avg(f.pct), 1) from flow f
      where case when g.user_id is not null then f.user_id = g.user_id else f.team_id = g.team_id end
    ) as fluxo_medio_pct,
    (
      select count(*)::integer from vw_process_assignment a
      where case when g.user_id is not null then a.user_id = g.user_id else a.team_id = g.team_id end
    ) as processos_no_time,
    (
      select count(*)::integer from flow f
      where case when g.user_id is not null then f.user_id = g.user_id else f.team_id = g.team_id end
    ) as processos_com_fluxo,
    (
      select count(distinct pm.process_id)::integer
      from process_movements pm
      join vw_process_assignment a on a.process_id = pm.process_id
      where case when g.user_id is not null then a.user_id = g.user_id else a.team_id = g.team_id end
    ) as processos_com_marco
  from team_process_goals g
  left join teams t on t.id = g.team_id
  left join profiles pr on pr.user_id = g.user_id
  where g.is_active
    and (p_team_id is null or g.team_id = p_team_id)
    and (p_user_id is null or g.user_id = p_user_id)
    and (p_period_start is null or g.period_end >= p_period_start)
    and (p_period_end is null or g.period_start <= p_period_end)
  order by g.period_start desc,
           coalesce(t.name, g.team_name, pr.full_name, g.user_name),
           g.marco_tipo nulls first;
$$;

grant execute on function public.process_goals_progress(uuid, uuid, date, date) to authenticated, anon;

comment on function public.process_goals_progress(uuid, uuid, date, date) is
  'Realizado x meta, de time e de pessoa. owner_kind diz qual. Os parâmetros filtram quais metas listar; o escopo de processos de cada linha vem do dono da própria meta. fluxo_medio_pct é foto do agora (checklist não guarda data por item).';

-- -----------------------------------------------------------------------------
-- 6) Quem pode ter meta individual: só quem tem processo vivo atribuído.
--    Não uso profiles direto — no Externo ele tem 3.6k linhas com clientes junto.
-- -----------------------------------------------------------------------------
create or replace function public.process_owners()
returns table (
  user_id uuid,
  full_name text,
  processos integer,
  processos_com_marco integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    a.user_id,
    coalesce(pr.full_name, '(sem nome)') as full_name,
    count(*)::integer as processos,
    count(*) filter (
      where exists (select 1 from process_movements pm where pm.process_id = a.process_id)
    )::integer as processos_com_marco
  from vw_process_assignment a
  left join profiles pr on pr.user_id = a.user_id
  where a.user_id is not null
  group by a.user_id, pr.full_name
  order by count(*) desc;
$$;

grant execute on function public.process_owners() to authenticated, anon;

comment on function public.process_owners() is
  'Pessoas com processo vivo atribuído (dono = responsável do processo, senão do lead) + quantos têm marco. Alimenta o seletor de dono das metas individuais.';

-- -----------------------------------------------------------------------------
-- 7) Compatibilidade: as três RPCs antigas viram wrappers das novas.
--    Mantidas por 24h após o front novo subir (Regra 4 do CLAUDE.md).
-- -----------------------------------------------------------------------------
create or replace function public.team_process_marco_baseline(p_team_id uuid)
returns table (marco_tipo text, acumulado integer, atual integer)
language sql
stable
security definer
set search_path = public
as $$
  select * from public.process_marco_baseline(p_team_id, null);
$$;

comment on function public.team_process_marco_baseline(uuid) is
  'LEGADO — wrapper de process_marco_baseline(p_team_id, null). Remover depois de 24h com o painel novo em produção.';

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
  select * from public.process_marco_processos(p_team_id, null, p_marco, p_modo);
$$;

comment on function public.team_process_marco_processos(uuid, text, text) is
  'LEGADO — wrapper de process_marco_processos. Remover depois de 24h com o painel novo em produção.';

create or replace function public.team_process_goals_progress(
  p_team_id uuid default null,
  p_period_start date default null,
  p_period_end date default null
)
returns table (
  goal_id uuid,
  team_id uuid,
  team_name text,
  name text,
  period_type text,
  period_start date,
  period_end date,
  marco_tipo text,
  target_processes integer,
  target_flow_avg_pct numeric,
  baseline_processes integer,
  realizado_processos integer,
  realizado_no_periodo integer,
  fluxo_medio_pct numeric,
  processos_no_time integer,
  processos_com_fluxo integer,
  processos_com_marco integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.goal_id, p.team_id, p.team_name, p.name, p.period_type, p.period_start,
    p.period_end, p.marco_tipo, p.target_processes, p.target_flow_avg_pct,
    p.baseline_processes, p.realizado_processos, p.realizado_no_periodo,
    p.fluxo_medio_pct, p.processos_no_time, p.processos_com_fluxo, p.processos_com_marco
  from public.process_goals_progress(p_team_id, null, p_period_start, p_period_end) p
  where p.owner_kind = 'team';
$$;

comment on function public.team_process_goals_progress(uuid, date, date) is
  'LEGADO — wrapper de process_goals_progress restrito às metas de time. Remover depois de 24h com o painel novo em produção.';

comment on table public.team_process_goals is
  'Meta processual de um time OU de uma pessoa (CHECK team_process_goals_um_dono): período + marco alvo (qtd de processos) e/ou % médio de fluxo do POP. Apuração via process_goals_progress.';
