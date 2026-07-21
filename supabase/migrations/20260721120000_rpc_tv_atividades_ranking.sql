-- Página /tv/atividades (telão): ranking de assessores por atividade, ao vivo.
--
-- Regra de ordenação (definida pelo negócio):
--   1º PASSOS dados (desc)  →  2º CONCLUÍDAS (desc)  →  3º menos ATRASADAS (asc)
--
-- security definer é NECESSÁRIO: a sessão do Externo é anônima e a RLS de
-- user_activity_log só libera o próprio user_id (`user_id = auth.uid()`), então
-- o anon não conseguiria ler os "passos" de todos. A função roda como owner,
-- lê o agregado e devolve só números — nenhuma linha crua/PII sai daqui.
--
-- Namespaces de UUID: os "passos" vêm de user_activity_log.user_id (auth do
-- CLOUD) e as atividades de lead_activities.assigned_to (auth do EXTERNO). O
-- join usa auth_uuid_mapping (cloud_uuid → ext_uuid) para casar a mesma pessoa.
-- Depois agregamos por NOME (btrim) porque há assessores com mais de um id
-- (ex.: Maria Lydia com 2 contas) que precisam somar numa linha só.
--
-- Janela: p_since governa passos, concluídas e aprovação. "Atrasadas" é estado
-- atual (prazo vencido e não concluída), não janelado. O rodapé (trabalhando/
-- ocioso/aproveitamento) é sempre dos últimos 7 dias, do cronômetro.

create or replace function public.tv_atividades_ranking(
  p_since timestamptz default date_trunc('week', now()),
  p_team_id uuid default null
) returns jsonb
language sql
security definer
set search_path = public
stable
as $$
with
passos as (
  select coalesce(m.ext_uuid, ual.user_id) as ext_user, count(*)::int as passos
  from user_activity_log ual
  left join auth_uuid_mapping m on m.cloud_uuid = ual.user_id
  where ual.action_type = 'checklist_item_checked'
    and ual.created_at >= p_since
  group by 1
),
acts as (
  select assigned_to as ext_user,
    max(assigned_to_name) as nome,
    count(*) filter (where status = 'concluida' and completed_at >= p_since)::int as concluidas,
    count(*) filter (where status <> 'concluida' and deadline < current_date)::int as atrasadas,
    count(*) filter (where feedback_outcome is not null and feedback_rated_at >= p_since)::int as avaliadas,
    count(*) filter (where feedback_outcome = 'satisfeito' and feedback_rated_at >= p_since)::int as satisfeitos
  from lead_activities
  where deleted_at is null and assigned_to is not null
  group by assigned_to
),
merged as (
  select
    coalesce(a.ext_user, ps.ext_user) as ext_user,
    a.nome,
    coalesce(ps.passos, 0) as passos,
    coalesce(a.concluidas, 0) as concluidas,
    coalesce(a.atrasadas, 0) as atrasadas,
    coalesce(a.avaliadas, 0) as avaliadas,
    coalesce(a.satisfeitos, 0) as satisfeitos
  from acts a
  full outer join passos ps on ps.ext_user = a.ext_user
),
filtered as (
  select mrg.*
  from merged mrg
  where p_team_id is null
     or mrg.ext_user in (select tm.user_id from team_members tm where tm.team_id = p_team_id)
),
named as (
  select
    btrim(coalesce(pr.full_name, f.nome)) as nome,
    f.passos, f.concluidas, f.atrasadas, f.avaliadas, f.satisfeitos
  from filtered f
  left join profiles pr on pr.user_id = f.ext_user
),
by_name as (
  -- Só assessores de verdade: nome com espaço (nome + sobrenome) e sem dígitos.
  -- Isso descarta contas de sistema/admin cujo "nome" é um username (ex.:
  -- "raymsandresonadv", "analyne.sousa71").
  select
    nome,
    sum(passos)::int as passos,
    sum(concluidas)::int as concluidas,
    sum(atrasadas)::int as atrasadas,
    sum(avaliadas)::int as avaliadas,
    sum(satisfeitos)::int as satisfeitos
  from named
  where nome ~ '\s' and nome !~ '[0-9]'
  group by nome
),
ranked as (
  select
    nome, passos, concluidas, atrasadas,
    case when avaliadas > 0 then round(100.0 * satisfeitos / avaliadas)::int end as aprov_pct
  from by_name
  where passos > 0 or concluidas > 0 or atrasadas > 0
),
resumo as (
  select
    round(coalesce(sum(active_seconds), 0) / 3600.0)::int as trabalhando_h,
    round(coalesce(sum(idle_seconds), 0) / 3600.0)::int as ocioso_h,
    case when coalesce(sum(active_seconds), 0) + coalesce(sum(idle_seconds), 0) > 0
      then round(100.0 * sum(active_seconds) / (sum(active_seconds) + sum(idle_seconds)))::int
    end as aproveitamento_pct
  from activity_time_entries
  where started_at >= now() - interval '7 days'
)
select jsonb_build_object(
  'ranking', (
    select coalesce(
      jsonb_agg(row_to_json(r) order by r.passos desc, r.concluidas desc, r.atrasadas asc, r.nome asc),
      '[]'::jsonb
    )
    from ranked r
  ),
  'resumo', (select row_to_json(resumo) from resumo),
  'gerado_em', now()
);
$$;

grant execute on function public.tv_atividades_ranking(timestamptz, uuid) to anon, authenticated;
