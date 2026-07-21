-- Tempo de resposta do chat interno: só conta PRIVADO ou MENÇÃO em grupo.
--
-- Antes, qualquer mensagem em qualquer conversa contava como "resposta"
-- quando o remetente anterior era outra pessoa — inclusive no Chat Geral,
-- onde ninguém é obrigado a responder tudo. Regra nova:
--
--   • Conversa PRIVADA (team_conversations.type = 'direct'): igual antes —
--     resposta = mensagem cujo remetente difere do da mensagem anterior.
--   • GRUPO (type = 'group'): só conta quando a pessoa foi @mencionada
--     (team_chat_mentions). O tempo é da mensagem que mencionou até a
--     PRIMEIRA mensagem da pessoa mencionada naquela conversa depois disso.
--
-- Teto de 8h e janela p_since continuam iguais. Não há dupla contagem:
-- o ramo de menção filtra type = 'group' e o ramo de lag filtra 'direct'.
--
-- A versão VIVA da RPC do ranking é a de 3 args (p_since, p_team_id, p_grupo)
-- — o /tv/atividades sempre passa p_grupo. A sobrecarga antiga de 2 args
-- ainda existe no banco (ninguém chama; remoção fica pra depois, regra do
-- _legacy 24h). Este arquivo atualiza a de 3 args e a média pessoal.

create or replace function public.tv_atividades_ranking(
  p_since timestamptz default date_trunc('week', now()),
  p_team_id uuid default null,
  p_grupo text default null
) returns jsonb
language sql
security definer
set search_path = public
stable
as $$
with
gestores as (
  select coalesce(m.ext_uuid, g.user_id) as ext_user, max(g.nome) as nome
  from (
    select manager_user_id as user_id, manager_name as nome
    from team_managers where manager_user_id is not null
    union
    select user_id, name from org_directors
  ) g
  left join auth_uuid_mapping m on m.cloud_uuid = g.user_id
  group by 1
),
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
  select coalesce(map.ext_uuid, r.sender_id) as ext_user,
    sum(r.seg)::bigint as chat_total_seg,
    count(*)::int as chat_n
  from (
    -- PRIVADO: lag() sobre todas as mensagens da conversa; o filtro de
    -- período (p_since) só se aplica à mensagem-resposta.
    select s.sender_id, s.created_at,
      extract(epoch from (s.created_at - s.prev_at)) as seg
    from (
      select tm.sender_id, tm.created_at,
        lag(tm.sender_id) over (partition by tm.conversation_id order by tm.created_at) as prev_sender,
        lag(tm.created_at) over (partition by tm.conversation_id order by tm.created_at) as prev_at
      from team_messages tm
      join team_conversations tc on tc.id = tm.conversation_id
      where tc.type = 'direct'
    ) s
    where s.prev_sender is not null and s.prev_sender <> s.sender_id
    union all
    -- GRUPO: só quem foi @mencionado; tempo até a primeira mensagem da
    -- pessoa naquela conversa após a menção.
    select men.mentioned_user_id as sender_id, reply.created_at,
      extract(epoch from (reply.created_at - m.created_at)) as seg
    from team_chat_mentions men
    join team_messages m on m.id = men.message_id
    join team_conversations tc on tc.id = m.conversation_id and tc.type = 'group'
    cross join lateral (
      select r2.created_at
      from team_messages r2
      where r2.conversation_id = m.conversation_id
        and r2.sender_id = men.mentioned_user_id
        and r2.created_at > m.created_at
      order by r2.created_at
      limit 1
    ) reply
    where men.mentioned_user_id is not null
      and m.sender_id <> men.mentioned_user_id
  ) r
  left join auth_uuid_mapping map on map.cloud_uuid = r.sender_id
  where r.created_at >= p_since
    and r.seg <= 8 * 3600
  group by 1
),
tempo as (
  select user_id as ext_user,
    sum(active_seconds)::bigint as ativo_seg,
    sum(idle_seconds)::bigint as ocioso_seg
  from activity_time_entries
  where started_at >= p_since
  group by 1
),
merged as (
  select
    coalesce(a.ext_user, ps.ext_user, ch.ext_user, t.ext_user) as ext_user,
    a.nome,
    coalesce(ps.passos, 0) as passos,
    coalesce(a.concluidas, 0) as concluidas,
    coalesce(a.atrasadas, 0) as atrasadas,
    coalesce(a.avaliadas, 0) as avaliadas,
    coalesce(a.satisfeitos, 0) as satisfeitos,
    coalesce(ch.chat_total_seg, 0) as chat_total_seg,
    coalesce(ch.chat_n, 0) as chat_n,
    coalesce(t.ativo_seg, 0) as ativo_seg,
    coalesce(t.ocioso_seg, 0) as ocioso_seg
  from acts a
  full outer join passos ps on ps.ext_user = a.ext_user
  full outer join chat ch on ch.ext_user = coalesce(a.ext_user, ps.ext_user)
  full outer join tempo t on t.ext_user = coalesce(a.ext_user, ps.ext_user, ch.ext_user)
),
filtered as (
  select mrg.*
  from merged mrg
  where (p_team_id is null
     or mrg.ext_user in (select tm.user_id from team_members tm where tm.team_id = p_team_id))
    and (p_grupo is distinct from 'gerencial'
     or mrg.ext_user in (select gs.ext_user from gestores gs))
),
named as (
  select
    btrim(coalesce(g.nome, pr.full_name, f.nome)) as nome,
    f.passos, f.concluidas, f.atrasadas, f.avaliadas, f.satisfeitos,
    f.chat_total_seg, f.chat_n, f.ativo_seg, f.ocioso_seg
  from filtered f
  left join profiles pr on pr.user_id = f.ext_user
  left join gestores g on p_grupo = 'gerencial' and g.ext_user = f.ext_user
),
by_name as (
  -- Só assessores de verdade: nome com espaço (nome + sobrenome) e sem dígitos.
  select
    nome,
    sum(passos)::int as passos,
    sum(concluidas)::int as concluidas,
    sum(atrasadas)::int as atrasadas,
    sum(avaliadas)::int as avaliadas,
    sum(satisfeitos)::int as satisfeitos,
    sum(chat_total_seg)::bigint as chat_total_seg,
    sum(chat_n)::int as chat_n,
    sum(ativo_seg)::bigint as ativo_seg,
    sum(ocioso_seg)::bigint as ocioso_seg
  from named
  where nome ~ '\s' and nome !~ '[0-9]'
  group by nome
),
ranked as (
  select
    nome, passos, concluidas, atrasadas,
    case when avaliadas > 0 then round(100.0 * satisfeitos / avaliadas)::int end as aprov_pct,
    case when chat_n > 0 then round(chat_total_seg::numeric / chat_n)::int end as chat_resp_seg,
    ativo_seg, ocioso_seg
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
      jsonb_agg(row_to_json(r) order by
        r.passos desc, r.concluidas desc, r.atrasadas asc,
        r.ativo_seg desc, r.ocioso_seg asc,
        r.chat_resp_seg asc nulls last,
        r.nome asc),
      '[]'::jsonb
    )
    from ranked r
  ),
  'resumo', (select row_to_json(resumo) from resumo),
  'gerado_em', now()
);
$$;

grant execute on function public.tv_atividades_ranking(timestamptz, uuid, text) to anon, authenticated;

-- Média pessoal de resposta (badge do painel do chat) — mesma regra nova.
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
      select tm.sender_id, tm.created_at,
        lag(tm.sender_id) over (partition by tm.conversation_id order by tm.created_at) as prev_sender,
        lag(tm.created_at) over (partition by tm.conversation_id order by tm.created_at) as prev_at
      from team_messages tm
      join team_conversations tc on tc.id = tm.conversation_id
      where tc.type = 'direct'
    ) s
    where s.prev_sender is not null and s.prev_sender <> s.sender_id
    union all
    select men.mentioned_user_id as sender_id, reply.created_at,
      extract(epoch from (reply.created_at - m.created_at)) as seg
    from team_chat_mentions men
    join team_messages m on m.id = men.message_id
    join team_conversations tc on tc.id = m.conversation_id and tc.type = 'group'
    cross join lateral (
      select r2.created_at
      from team_messages r2
      where r2.conversation_id = m.conversation_id
        and r2.sender_id = men.mentioned_user_id
        and r2.created_at > m.created_at
      order by r2.created_at
      limit 1
    ) reply
    where men.mentioned_user_id is not null
      and m.sender_id <> men.mentioned_user_id
  ) r
  where r.sender_id = _user_id
    and r.created_at >= now() - make_interval(days => _days)
    and r.seg <= 8 * 3600;
$$;

grant execute on function public.team_chat_my_response_avg(uuid, int) to anon, authenticated;
