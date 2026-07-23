-- Telão /tv/atividades: adiciona os ITENS MARCADOS DO CHECKLIST (sub-itens do
-- passo, o docChecklist) como 2º critério de ordenação do ranking.
--
-- Ordem NOVA:
--   1º passos       desc  (item de topo = passo, inalterado)
--   2º doc_itens    desc  (NOVO — sub-itens do checklist, líquido marc.-desmarc.)
--   3º concluidas   desc  (atos concluídos — era o 2º)
--   4º atrasadas    asc
--   5º ativo_seg    desc
--   6º ocioso_seg   asc
--   7º chat_resp_seg asc nulls last
--   8º nome         asc
--
-- doc_itens vem de user_activity_log (action_type dos sub-itens, migration irmã
-- 20260723210000): conta LÍQUIDO = marcações não-retroativas MENOS desmarcações
-- na janela p_since ("não ignorar desmarcação"). greatest(...,0) evita negativo.
--
-- Base: definição VIVA lida via pg_get_functiondef (inclui regime/home_office e
-- work_date). Só o que muda: CTE doc_itens, join em merged, coluna propagada até
-- ranked, e a linha nova no ORDER BY. Nada de passos/concluidas/atrasadas/tempo/
-- chat/visibilidade foi alterado — o filtro de quem aparece continua
-- (passos>0 or concluidas>0 or atrasadas>0), então quem SÓ marcou sub-item
-- (sem passo/concluída/atrasada) segue sem aparecer, como antes.
--
-- Rollback: re-rodar a definição anterior (20260721210000_home_office_ranking.sql
-- + patch de work_date 20260722191000), ou reaplicar via pg_get_functiondef a
-- versão sem doc_itens.

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
regime as (
  -- org_user_status.user_id usa o UUID do Cloud → mapeia pro ext como as demais CTEs.
  select coalesce(m.ext_uuid, s.user_id) as ext_user, bool_or(s.home_office) as home_office
  from org_user_status s
  left join auth_uuid_mapping m on m.cloud_uuid = s.user_id
  group by 1
),
passos as (
  select coalesce(m.ext_uuid, ual.user_id) as ext_user, count(*)::int as passos
  from user_activity_log ual
  left join auth_uuid_mapping m on m.cloud_uuid = ual.user_id
  where ual.action_type = 'checklist_item_checked'
    and ual.created_at >= p_since
    and coalesce(ual.metadata->>'retroactive', 'false') <> 'true'
  group by 1
),
doc_itens as (
  -- Sub-itens do checklist do passo (docChecklist). Líquido: marcações
  -- não-retroativas menos desmarcações na janela.
  select coalesce(m.ext_uuid, ual.user_id) as ext_user,
    (count(*) filter (where ual.action_type = 'checklist_doc_item_checked'
                        and coalesce(ual.metadata->>'retroactive', 'false') <> 'true')
     - count(*) filter (where ual.action_type = 'checklist_doc_item_unchecked')
    )::int as doc_itens
  from user_activity_log ual
  left join auth_uuid_mapping m on m.cloud_uuid = ual.user_id
  where ual.action_type in ('checklist_doc_item_checked', 'checklist_doc_item_unchecked')
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
  where work_date >= (p_since at time zone 'America/Sao_Paulo')::date
  group by 1
),
merged as (
  select
    coalesce(a.ext_user, ps.ext_user, ch.ext_user, t.ext_user, di.ext_user) as ext_user,
    a.nome,
    coalesce(ps.passos, 0) as passos,
    coalesce(di.doc_itens, 0) as doc_itens,
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
  full outer join doc_itens di on di.ext_user = coalesce(a.ext_user, ps.ext_user, ch.ext_user, t.ext_user)
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
    f.passos, f.doc_itens, f.concluidas, f.atrasadas, f.avaliadas, f.satisfeitos,
    f.chat_total_seg, f.chat_n, f.ativo_seg, f.ocioso_seg,
    coalesce(rg.home_office, false) as home_office
  from filtered f
  left join profiles pr on pr.user_id = f.ext_user
  left join gestores g on p_grupo = 'gerencial' and g.ext_user = f.ext_user
  left join regime rg on rg.ext_user = f.ext_user
),
by_name as (
  select
    nome,
    sum(passos)::int as passos,
    sum(doc_itens)::int as doc_itens,
    sum(concluidas)::int as concluidas,
    sum(atrasadas)::int as atrasadas,
    sum(avaliadas)::int as avaliadas,
    sum(satisfeitos)::int as satisfeitos,
    sum(chat_total_seg)::bigint as chat_total_seg,
    sum(chat_n)::int as chat_n,
    sum(ativo_seg)::bigint as ativo_seg,
    sum(ocioso_seg)::bigint as ocioso_seg,
    bool_or(home_office) as home_office
  from named
  where nome ~ '\s' and nome !~ '[0-9]'
  group by nome
),
ranked as (
  select
    nome, passos,
    greatest(doc_itens, 0) as doc_itens,
    concluidas, atrasadas,
    case when avaliadas > 0 then round(100.0 * satisfeitos / avaliadas)::int end as aprov_pct,
    case when chat_n > 0 then round(chat_total_seg::numeric / chat_n)::int end as chat_resp_seg,
    ativo_seg, ocioso_seg, home_office
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
  where work_date >= ((now() - interval '7 days') at time zone 'America/Sao_Paulo')::date
)
select jsonb_build_object(
  'ranking', (
    select coalesce(
      jsonb_agg(row_to_json(r) order by
        r.passos desc, r.doc_itens desc, r.concluidas desc, r.atrasadas asc,
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
