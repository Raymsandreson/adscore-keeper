-- Tempo de resposta do CHAT INTERNO (team_messages) no ranking /tv/atividades.
--
-- Métrica nova: média de tempo que o assessor leva pra responder mensagem no
-- chat interno da equipe. "Resposta" = mensagem cujo remetente difere do
-- remetente da mensagem imediatamente anterior na MESMA conversa; o tempo é a
-- diferença entre os created_at. Respostas com mais de 8h de espera ficam de
-- fora (overnight/fim de semana): nos dados reais a mediana é ~4min, mas 41
-- respostas overnight puxavam a média crua pra ~19h.
--
-- Entra como ÚLTIMO critério de desempate do ranking:
--   1º PASSOS (desc) → 2º CONCLUÍDAS (desc) → 3º menos ATRASADAS (asc)
--   → 4º menor média de resposta no chat (asc, sem dado vai por último) → nome
--
-- team_messages.sender_id usa UUID do auth do CLOUD (igual user_activity_log),
-- então mapeia via auth_uuid_mapping (cloud_uuid → ext_uuid), como a CTE
-- `passos`. A soma/contagem sobe até by_name pra média ponderada por nome
-- (assessor com 2 contas soma numa linha só).

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
chat as (
  -- lag() precisa rodar sobre TODAS as mensagens da conversa; o filtro de
  -- período (p_since) só se aplica à mensagem-resposta.
  select coalesce(map.ext_uuid, r.sender_id) as ext_user,
    sum(r.seg)::bigint as chat_total_seg,
    count(*)::int as chat_n
  from (
    select s.sender_id, s.created_at,
      extract(epoch from (s.created_at - s.prev_at)) as seg
    from (
      select sender_id, created_at,
        lag(sender_id) over (partition by conversation_id order by created_at) as prev_sender,
        lag(created_at) over (partition by conversation_id order by created_at) as prev_at
      from team_messages
    ) s
    where s.prev_sender is not null and s.prev_sender <> s.sender_id
  ) r
  left join auth_uuid_mapping map on map.cloud_uuid = r.sender_id
  where r.created_at >= p_since
    and r.seg <= 8 * 3600
  group by 1
),
merged as (
  select
    coalesce(a.ext_user, ps.ext_user, ch.ext_user) as ext_user,
    a.nome,
    coalesce(ps.passos, 0) as passos,
    coalesce(a.concluidas, 0) as concluidas,
    coalesce(a.atrasadas, 0) as atrasadas,
    coalesce(a.avaliadas, 0) as avaliadas,
    coalesce(a.satisfeitos, 0) as satisfeitos,
    coalesce(ch.chat_total_seg, 0) as chat_total_seg,
    coalesce(ch.chat_n, 0) as chat_n
  from acts a
  full outer join passos ps on ps.ext_user = a.ext_user
  full outer join chat ch on ch.ext_user = coalesce(a.ext_user, ps.ext_user)
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
    f.passos, f.concluidas, f.atrasadas, f.avaliadas, f.satisfeitos,
    f.chat_total_seg, f.chat_n
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
    sum(satisfeitos)::int as satisfeitos,
    sum(chat_total_seg)::bigint as chat_total_seg,
    sum(chat_n)::int as chat_n
  from named
  where nome ~ '\s' and nome !~ '[0-9]'
  group by nome
),
ranked as (
  select
    nome, passos, concluidas, atrasadas,
    case when avaliadas > 0 then round(100.0 * satisfeitos / avaliadas)::int end as aprov_pct,
    case when chat_n > 0 then round(chat_total_seg::numeric / chat_n)::int end as chat_resp_seg
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
      jsonb_agg(row_to_json(r) order by r.passos desc, r.concluidas desc, r.atrasadas asc, r.chat_resp_seg asc nulls last, r.nome asc),
      '[]'::jsonb
    )
    from ranked r
  ),
  'resumo', (select row_to_json(resumo) from resumo),
  'gerado_em', now()
);
$$;

grant execute on function public.tv_atividades_ranking(timestamptz, uuid) to anon, authenticated;

-- Média pessoal de resposta no chat interno (badge no painel do chat).
-- Mesma regra da CTE `chat` acima: resposta = remetente diferente do anterior
-- na conversa, teto de 8h. security definer pelo mesmo motivo da RPC do
-- ranking (sessão do Externo é anônima); devolve só um número agregado.
create or replace function public.team_chat_my_response_avg(
  _user_id uuid,
  _days int default 30
) returns integer
language sql
security definer
set search_path = public
stable
as $$
  select round(avg(r.seg))::int
  from (
    select s.sender_id, s.created_at,
      extract(epoch from (s.created_at - s.prev_at)) as seg
    from (
      select sender_id, created_at,
        lag(sender_id) over (partition by conversation_id order by created_at) as prev_sender,
        lag(created_at) over (partition by conversation_id order by created_at) as prev_at
      from team_messages
    ) s
    where s.prev_sender is not null and s.prev_sender <> s.sender_id
  ) r
  where r.sender_id = _user_id
    and r.created_at >= now() - make_interval(days => _days)
    and r.seg <= 8 * 3600;
$$;

grant execute on function public.team_chat_my_response_avg(uuid, int) to anon, authenticated;
