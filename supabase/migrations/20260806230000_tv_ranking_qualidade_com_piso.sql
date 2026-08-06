-- Telão: QUALIDADE (média de estrelas do período) passa a pesar ACIMA dos
-- contadores de volume, com piso de amostra.
--
-- Pedido do Raym em 06/08/2026, depois de medirmos a cobertura de avaliação:
-- 10 notas em 30 dias contra 7.097 atividades criadas (0,14%), e 0 das 32
-- pessoas do ranking com nota NO DIA. Por isso o critério não entra "puro":
--
--   1. Amostra mínima: só pontua quem tem >= 3 notas NO PERÍODO do ranking
--      (hoje / semana / mês, o mesmo p_since do resto). Nada de histórico —
--      decisão do Raym: "história não garante futuro".
--   2. Quem não tem amostra fica NEUTRO, não perde posição: recebe a média
--      do grupo (dos que têm amostra) no lugar do próprio valor. Assim ele
--      fica acima de quem foi mal avaliado e abaixo de quem foi bem, e a
--      disputa dele continua sendo decidida pelos critérios de volume.
--      Quando ninguém do time tem amostra, todo mundo empata nesse critério
--      e o ranking segue exatamente como era antes desta migration.
--
-- Ordem depois desta migration:
--   status esperado > fases > objetivos > QUALIDADE (>=3 notas) > passos >
--   itens do checklist > concluídas > menos atrasadas > menos pendências do
--   cliente > maior média ⭐ (desempate fino, sem piso) > menos feedbacks sem
--   avaliar > mais tempo ativo > menos ocioso > resposta no chat > nome.
--
-- A média ⭐ sem piso continua onde estava, como desempate fino — quem tem 1 ou
-- 2 notas não sobe no critério novo, mas ainda desempata lá embaixo.
--
-- Campo novo no JSON: `qualidade` (a média que pontuou, ou null sem amostra).
-- O telão usa esse campo pra dar a medalha 🏅 de melhor avaliação do período.
--
-- ROLLBACK (verificado): reaplicar, sem nenhuma alteração, o arquivo
-- supabase/migrations/20260806190000_tv_ranking_pendencias_cliente.sql — ele
-- contém a versão anterior INTEIRA desta mesma função (create or replace).
-- Só esta função muda aqui; tv_ranking_detalhe não é tocada.
create or replace function public.tv_atividades_ranking(
  p_since timestamptz default date_trunc('week', now()),
  p_team_id uuid default null,
  p_grupo text default null,
  p_granularidade text default 'dia'
)
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $function$
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
    count(*) filter (where feedback_outcome = 'satisfeito' and feedback_rated_at >= p_since)::int as satisfeitos,
    -- ⭐ recebidas no período: soma e nº de notas (a média sai depois da soma
    -- por nome, pra continuar ponderada quando a pessoa tem 2 UUIDs).
    coalesce(sum(feedback_rating) filter (where feedback_rating is not null and feedback_rated_at >= p_since), 0)::int as estrelas_soma,
    count(*) filter (where feedback_rating is not null and feedback_rated_at >= p_since)::int as notas_n
  from lead_activities
  where deleted_at is null and assigned_to is not null
  group by assigned_to
),
-- Feedbacks que a pessoa deveria avaliar e não avaliou (backlog total).
fb_base as (
  select la.id, la.assigned_to, la.observer_ids, la.created_by
  from lead_activities la
  where la.deleted_at is null
    and la.feedback is not null and btrim(la.feedback) <> ''
    and la.feedback_outcome is null
),
fb_pend as (
  select x.obs as ext_user, count(distinct x.id)::int as fb_pendentes
  from (
    select f.id, f.assigned_to, o.obs
    from fb_base f
    cross join lateral (
      -- observador OU criador (mesma regra do funil); union remove o duplo
      -- quando a pessoa é as duas coisas na mesma atividade.
      select unnest(coalesce(f.observer_ids, '{}'::uuid[])) as obs
      union
      select f.created_by
    ) o
  ) x
  where x.obs is not null
    and x.assigned_to is distinct from x.obs   -- sem autofeedback
  group by 1
),
pend_cli as (
  select d.dono as ext_user, count(*)::int as pend_cliente
  from (
    select coalesce(
      -- responsável do processo > responsável processual do lead > último
      -- assessor que trabalhou o lead. Sem nenhum dos três a pendência não
      -- pontua contra ninguém (ver comentário do cabeçalho).
      (select pr.responsible_user_id from lead_processes pr
        where pr.lead_id = c.lead_id and pr.responsible_user_id is not null
        order by pr.created_at desc limit 1),
      (select l.processual_responsible_id from leads l where l.id = c.lead_id),
      (select a.assigned_to from lead_activities a
        where a.lead_id = c.lead_id and a.deleted_at is null and a.assigned_to is not null
        order by a.created_at desc limit 1)
    ) as dono
    from lead_client_commitments c
    where c.status in ('combinado','cobrado')
  ) d
  where d.dono is not null
  group by 1
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
inst_last as (
  select ual.entity_id as instance_id,
    (array_agg(ual.user_id order by ual.created_at desc))[1] as cloud_user
  from user_activity_log ual
  where ual.action_type = 'checklist_item_checked'
    and coalesce(ual.metadata->>'retroactive', 'false') <> 'true'
    and ual.created_at >= p_since
  group by ual.entity_id
),
objetivos as (
  select coalesce(m.ext_uuid, il.cloud_user) as ext_user, count(*)::int as objetivos
  from lead_checklist_instances lci
  join inst_last il on il.instance_id = lci.id
  left join auth_uuid_mapping m on m.cloud_uuid = il.cloud_user
  where lci.is_completed and lci.completed_at >= p_since
  group by 1
),
fase_grupos as (
  select lci.lead_id, lci.board_id, lci.stage_id,
    (array_agg(lci.id order by lci.completed_at desc nulls last))[1] as last_instance
  from lead_checklist_instances lci
  where lci.stage_id is not null
  group by lci.lead_id, lci.board_id, lci.stage_id
  having bool_and(lci.is_completed) and max(lci.completed_at) >= p_since
),
fases as (
  select coalesce(m.ext_uuid, il.cloud_user) as ext_user, count(*)::int as fases
  from fase_grupos fg
  join inst_last il on il.instance_id = fg.last_instance
  left join auth_uuid_mapping m on m.cloud_uuid = il.cloud_user
  group by 1
),
board_kpi as (
  select b.id as board_id, x.expected
  from kanban_boards b
  cross join lateral jsonb_array_elements_text(
    case when jsonb_typeof(b.settings->'resultado_esperado_ids') = 'array'
              and jsonb_array_length(b.settings->'resultado_esperado_ids') > 0
         then b.settings->'resultado_esperado_ids'
         when coalesce(b.settings->>'resultado_esperado_id','') <> ''
         then jsonb_build_array(b.settings->>'resultado_esperado_id')
         else '[]'::jsonb end
  ) as x(expected)
),
resultado_lead as (
  -- 04/08/2026: era date_trunc('month', now()) — agora respeita o período.
  select coalesce(m.ext_uuid, h.changed_by) as ext_user,
         count(distinct h.lead_id)::int as resultado
  from lead_pop_result_history h
  join board_kpi k on k.board_id = h.board_id and k.expected = h.to_result
  left join auth_uuid_mapping m on m.cloud_uuid = h.changed_by
  where coalesce(h.effective_date, (h.changed_at at time zone 'America/Sao_Paulo')::date) >= (p_since at time zone 'America/Sao_Paulo')::date
  group by 1
),
resultado_proc as (
  select p.responsible_user_id as ext_user,
         count(*)::int as resultado
  from lead_processes p
  join board_kpi k on k.board_id::text = p.workflow_id and k.expected = p.resultado_atingido_id
  where p.resultado_atingido_status = 'confirmado'
    and p.responsible_user_id is not null
    and coalesce(p.resultado_atingido_data, (now() at time zone 'America/Sao_Paulo')::date) >= (p_since at time zone 'America/Sao_Paulo')::date
  group by 1
),
resultado as (
  select ext_user, sum(resultado)::int as resultado
  from (select * from resultado_lead union all select * from resultado_proc) u
  group by 1
),
merged as (
  select
    coalesce(a.ext_user, ps.ext_user, ch.ext_user, t.ext_user, di.ext_user, ob.ext_user, fs.ext_user, rs.ext_user, fb.ext_user, pc.ext_user) as ext_user,
    a.nome,
    coalesce(ps.passos, 0) as passos,
    coalesce(ob.objetivos, 0) as objetivos,
    coalesce(rs.resultado, 0) as resultado,
    coalesce(fs.fases, 0) as fases,
    coalesce(di.doc_itens, 0) as doc_itens,
    coalesce(a.concluidas, 0) as concluidas,
    coalesce(a.atrasadas, 0) as atrasadas,
    coalesce(a.avaliadas, 0) as avaliadas,
    coalesce(a.satisfeitos, 0) as satisfeitos,
    coalesce(a.estrelas_soma, 0) as estrelas_soma,
    coalesce(a.notas_n, 0) as notas_n,
    coalesce(fb.fb_pendentes, 0) as fb_pendentes,
    coalesce(pc.pend_cliente, 0) as pend_cliente,
    coalesce(ch.chat_total_seg, 0) as chat_total_seg,
    coalesce(ch.chat_n, 0) as chat_n,
    coalesce(t.ativo_seg, 0) as ativo_seg,
    coalesce(t.ocioso_seg, 0) as ocioso_seg
  from acts a
  full outer join passos ps on ps.ext_user = a.ext_user
  full outer join chat ch on ch.ext_user = coalesce(a.ext_user, ps.ext_user)
  full outer join tempo t on t.ext_user = coalesce(a.ext_user, ps.ext_user, ch.ext_user)
  full outer join doc_itens di on di.ext_user = coalesce(a.ext_user, ps.ext_user, ch.ext_user, t.ext_user)
  full outer join objetivos ob on ob.ext_user = coalesce(a.ext_user, ps.ext_user, ch.ext_user, t.ext_user, di.ext_user)
  full outer join fases fs on fs.ext_user = coalesce(a.ext_user, ps.ext_user, ch.ext_user, t.ext_user, di.ext_user, ob.ext_user)
  full outer join resultado rs on rs.ext_user = coalesce(a.ext_user, ps.ext_user, ch.ext_user, t.ext_user, di.ext_user, ob.ext_user, fs.ext_user)
  full outer join fb_pend fb on fb.ext_user = coalesce(a.ext_user, ps.ext_user, ch.ext_user, t.ext_user, di.ext_user, ob.ext_user, fs.ext_user, rs.ext_user)
  full outer join pend_cli pc on pc.ext_user = coalesce(a.ext_user, ps.ext_user, ch.ext_user, t.ext_user, di.ext_user, ob.ext_user, fs.ext_user, rs.ext_user, fb.ext_user)
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
    f.resultado, f.passos, f.objetivos, f.fases, f.doc_itens, f.concluidas, f.atrasadas, f.avaliadas, f.satisfeitos,
    f.estrelas_soma, f.notas_n, f.fb_pendentes, f.pend_cliente,
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
    sum(objetivos)::int as objetivos,
    sum(resultado)::int as resultado,
    sum(fases)::int as fases,
    sum(doc_itens)::int as doc_itens,
    sum(concluidas)::int as concluidas,
    sum(atrasadas)::int as atrasadas,
    sum(avaliadas)::int as avaliadas,
    sum(satisfeitos)::int as satisfeitos,
    sum(estrelas_soma)::int as estrelas_soma,
    sum(notas_n)::int as notas_n,
    sum(fb_pendentes)::int as fb_pendentes,
    sum(pend_cliente)::int as pend_cliente,
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
    nome, resultado, passos, objetivos, fases,
    greatest(doc_itens, 0) as doc_itens,
    concluidas, atrasadas,
    case when avaliadas > 0 then round(100.0 * satisfeitos / avaliadas)::int end as aprov_pct,
    -- ⭐ média das notas recebidas no período (1 casa); null = sem nota no período.
    case when notas_n > 0 then round(estrelas_soma::numeric / notas_n, 1) end as media_estrelas,
    -- Qualidade que PONTUA no ranking: a mesma média, mas só com amostra
    -- mínima (>= 3 notas no período). Abaixo disso fica null = sem amostra.
    case when notas_n >= 3 then round(estrelas_soma::numeric / notas_n, 1) end as qualidade,
    notas_n,
    fb_pendentes,
    pend_cliente,
    case when chat_n > 0 then round(chat_total_seg::numeric / chat_n)::int end as chat_resp_seg,
    ativo_seg, ocioso_seg, home_office
  from by_name
  where resultado > 0 or fases > 0 or objetivos > 0 or passos > 0 or concluidas > 0 or atrasadas > 0
),
-- Valor NEUTRO de quem não tem amostra: a média do grupo entre os que têm.
-- Assim ninguém perde posição por não ter sido avaliado — fica no meio e a
-- disputa dele segue nos critérios de volume. Sem ninguém com amostra, isto é
-- null, todo mundo empata e o ranking fica idêntico ao de antes.
qualidade_ref as (
  select avg(qualidade) as media_grupo from ranked where qualidade is not null
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
),
meta_by_user as (
  select coalesce(m.ext_uuid, ual.user_id) as ext_user,
         date_trunc(
           case p_granularidade when 'semana' then 'week'
                                when 'mes' then 'month'
                                when 'mês' then 'month'
                                else 'day' end,
           (ual.created_at at time zone 'America/Sao_Paulo')
         ) as bucket,
         count(*)::int as passos
  from user_activity_log ual
  left join auth_uuid_mapping m on m.cloud_uuid = ual.user_id
  where ual.action_type = 'checklist_item_checked'
    and ual.created_at < p_since
    and coalesce(ual.metadata->>'retroactive', 'false') <> 'true'
  group by 1, 2
),
meta_filtered as (
  select mu.*
  from meta_by_user mu
  where (p_team_id is null
     or mu.ext_user in (select tm.user_id from team_members tm where tm.team_id = p_team_id))
    and (p_grupo is distinct from 'gerencial'
     or mu.ext_user in (select gs.ext_user from gestores gs))
),
meta_named as (
  select btrim(coalesce(g.nome, pr.full_name)) as nome, mf.bucket, mf.passos
  from meta_filtered mf
  left join profiles pr on pr.user_id = mf.ext_user
  left join gestores g on p_grupo = 'gerencial' and g.ext_user = mf.ext_user
),
meta_by_name as (
  select nome, bucket, sum(passos)::int as passos
  from meta_named
  where nome ~ '\s' and nome !~ '[0-9]'
  group by nome, bucket
),
meta as (
  select passos, nome from meta_by_name order by passos desc, nome asc limit 1
)
select jsonb_build_object(
  'ranking', (
    select coalesce(
      jsonb_agg(row_to_json(r) order by
        r.resultado desc, r.fases desc, r.objetivos desc,
        -- QUALIDADE acima do volume: quem tem >= 3 notas no período entra com a
        -- própria média; quem não tem entra com a média do grupo (neutro).
        coalesce(r.qualidade, (select media_grupo from qualidade_ref)) desc nulls last,
        r.passos desc, r.doc_itens desc, r.concluidas desc, r.atrasadas asc,
        r.pend_cliente asc,
        r.media_estrelas desc nulls last, r.fb_pendentes asc,
        r.ativo_seg desc, r.ocioso_seg asc,
        r.chat_resp_seg asc nulls last,
        r.nome asc),
      '[]'::jsonb
    )
    from ranked r
  ),
  'resumo', (select row_to_json(resumo) from resumo),
  'meta', coalesce((select jsonb_build_object('passos', passos, 'nome', nome) from meta), jsonb_build_object('passos', 0, 'nome', null)),
  'gerado_em', now()
);
$function$;

grant execute on function public.tv_atividades_ranking(timestamptz, uuid, text, text) to authenticated;
