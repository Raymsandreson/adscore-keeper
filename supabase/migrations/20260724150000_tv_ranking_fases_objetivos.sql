-- Telão /tv/atividades — critérios FASES e OBJETIVOS entram no ranking.
--
-- Nova ordenação (regra de negócio): 1º FASES → 2º OBJETIVOS → 3º PASSOS →
-- 4º itens do checklist-doc → 5º concluídas → 6º menos atrasadas → 7º mais tempo
-- ativo → 8º menos ocioso → 9º resposta no chat. Motivo: passo é facilmente
-- inflável (marcar 1 item em muitos processos); o que faz o processo AVANÇAR é
-- fechar objetivos e, por consequência, fases.
--
-- Derivação (SEM mexer no caminho de escrita — tudo read-only na RPC):
--   - Cada `checklist_item_checked` grava entity_id = lead_checklist_instances.id.
--   - OBJETIVO concluído por pessoa = instância `is_completed` com completed_at no
--     período, atribuída ao ÚLTIMO que marcou passo nela (inst_last).
--   - FASE concluída por pessoa = (lead, board, stage) com TODOS os checklists
--     concluídos e o último caindo no período; atribuída a quem fechou o último.
--
-- Byte-safe: lê a definição vigente da 4-arg e injeta as CTEs + colunas via
-- replaces pontuais. Tudo que já funciona (chat, tempo, doc_itens, meta, filtros
-- de time/grupo, agregação por nome) fica intacto.
--
-- Rollback: re-rodar a 20260724130000 (versão sem fases/objetivos).
-- Aplicada no Externo (WhatsJUD, kmedldlepwiityjsdahz) via MCP.

do $mig$
declare
  d text;
begin
  select pg_get_functiondef('public.tv_atividades_ranking(timestamptz,uuid,text,text)'::regprocedure) into d;

  -- (1) CTEs novas antes de `merged`.
  d := replace(d, 'merged as (', $ctes$inst_last as (
  select ual.entity_id as instance_id,
    (array_agg(ual.user_id order by ual.created_at desc))[1] as cloud_user
  from user_activity_log ual
  where ual.action_type = 'checklist_item_checked'
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
merged as ($ctes$);

  -- (2) merged: ext_user considera também objetivos/fases.
  d := replace(d,
    'coalesce(a.ext_user, ps.ext_user, ch.ext_user, t.ext_user, di.ext_user) as ext_user,',
    'coalesce(a.ext_user, ps.ext_user, ch.ext_user, t.ext_user, di.ext_user, ob.ext_user, fs.ext_user) as ext_user,');

  -- (3) merged: colunas objetivos/fases.
  d := replace(d,
    '    coalesce(ps.passos, 0) as passos,',
    '    coalesce(ps.passos, 0) as passos,' || E'\n' ||
    '    coalesce(ob.objetivos, 0) as objetivos,' || E'\n' ||
    '    coalesce(fs.fases, 0) as fases,');

  -- (4) merged: joins objetivos/fases.
  d := replace(d,
    '  full outer join doc_itens di on di.ext_user = coalesce(a.ext_user, ps.ext_user, ch.ext_user, t.ext_user)',
    '  full outer join doc_itens di on di.ext_user = coalesce(a.ext_user, ps.ext_user, ch.ext_user, t.ext_user)' || E'\n' ||
    '  full outer join objetivos ob on ob.ext_user = coalesce(a.ext_user, ps.ext_user, ch.ext_user, t.ext_user, di.ext_user)' || E'\n' ||
    '  full outer join fases fs on fs.ext_user = coalesce(a.ext_user, ps.ext_user, ch.ext_user, t.ext_user, di.ext_user, ob.ext_user)');

  -- (5) named: repassa objetivos/fases.
  d := replace(d,
    '    f.passos, f.doc_itens, f.concluidas, f.atrasadas, f.avaliadas, f.satisfeitos,',
    '    f.passos, f.objetivos, f.fases, f.doc_itens, f.concluidas, f.atrasadas, f.avaliadas, f.satisfeitos,');

  -- (6) by_name: soma objetivos/fases.
  d := replace(d,
    '    sum(passos)::int as passos,',
    '    sum(passos)::int as passos,' || E'\n' ||
    '    sum(objetivos)::int as objetivos,' || E'\n' ||
    '    sum(fases)::int as fases,');

  -- (7) ranked: expõe objetivos/fases.
  d := replace(d,
    '    nome, passos,' || E'\n' || '    greatest(doc_itens, 0) as doc_itens,',
    '    nome, passos, objetivos, fases,' || E'\n' || '    greatest(doc_itens, 0) as doc_itens,');

  -- (8) ranked: entra no ranking quem só tem fase/objetivo também.
  d := replace(d,
    '  where passos > 0 or concluidas > 0 or atrasadas > 0',
    '  where fases > 0 or objetivos > 0 or passos > 0 or concluidas > 0 or atrasadas > 0');

  -- (9) ordenação: fases → objetivos → passos → resto.
  d := replace(d,
    '      jsonb_agg(row_to_json(r) order by' || E'\n' || '        r.passos desc, r.doc_itens desc, r.concluidas desc, r.atrasadas asc,',
    '      jsonb_agg(row_to_json(r) order by' || E'\n' || '        r.fases desc, r.objetivos desc, r.passos desc, r.doc_itens desc, r.concluidas desc, r.atrasadas asc,');

  execute d;
end $mig$;
