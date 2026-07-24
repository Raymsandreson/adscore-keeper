-- Telão /tv/atividades — RESULTADO ESPERADO do POP vira o 1º critério do ranking.
--
-- Cada board (funil/POP) declara no cadastro sua etapa-alvo de "sucesso" em
-- settings.kpi = { tipo:'etapa', stage_id, rotulo }. O ranking conta quantos leads
-- chegaram nessa etapa NO MÊS (acumulado — mesmo na visão diária, que é o
-- acompanhamento do dia a dia), por pessoa, via lead_stage_history (changed_by +
-- changed_at + to_stage/to_board_id — tabela viva e com autor). Sem tocar no
-- caminho de escrita. Nova ordem: 1º RESULTADO → 2º Fases → 3º Objetivos →
-- 4º Passos → … resto.
--
-- Seguro por padrão: sem KPI configurado, board_kpi é vazio → resultado = 0 pra
-- todos → o ranking cai no comportamento atual. Ao configurar um board, começa a
-- contar (retroativo no mês, porque o stage_history já é confiável).
--
-- Byte-safe: injeta CTEs + colunas na 4-arg vigente; resto intacto.
-- Rollback: re-rodar a 20260724150000.
-- Aplicada no Externo (WhatsJUD, kmedldlepwiityjsdahz) via MCP.

do $mig$
declare
  d text;
begin
  select pg_get_functiondef('public.tv_atividades_ranking(timestamptz,uuid,text,text)'::regprocedure) into d;

  -- (1) CTEs novas antes de `merged`.
  d := replace(d, 'merged as (', $ctes$board_kpi as (
  select b.id as board_id, (b.settings->'kpi'->>'stage_id') as stage_id
  from kanban_boards b
  where (b.settings->'kpi'->>'tipo') = 'etapa'
    and coalesce(b.settings->'kpi'->>'stage_id', '') <> ''
),
resultado as (
  select coalesce(m.ext_uuid, h.changed_by) as ext_user,
         count(distinct h.lead_id)::int as resultado
  from lead_stage_history h
  join board_kpi k on k.board_id = h.to_board_id and k.stage_id = h.to_stage
  left join auth_uuid_mapping m on m.cloud_uuid = h.changed_by
  where h.changed_at >= date_trunc('month', now())
  group by 1
),
merged as ($ctes$);

  -- (2) merged: ext_user considera resultado.
  d := replace(d,
    'coalesce(a.ext_user, ps.ext_user, ch.ext_user, t.ext_user, di.ext_user, ob.ext_user, fs.ext_user) as ext_user,',
    'coalesce(a.ext_user, ps.ext_user, ch.ext_user, t.ext_user, di.ext_user, ob.ext_user, fs.ext_user, rs.ext_user) as ext_user,');

  -- (3) merged: coluna resultado.
  d := replace(d,
    '    coalesce(fs.fases, 0) as fases,',
    '    coalesce(rs.resultado, 0) as resultado,' || E'\n' || '    coalesce(fs.fases, 0) as fases,');

  -- (4) merged: join resultado.
  d := replace(d,
    '  full outer join fases fs on fs.ext_user = coalesce(a.ext_user, ps.ext_user, ch.ext_user, t.ext_user, di.ext_user, ob.ext_user)',
    '  full outer join fases fs on fs.ext_user = coalesce(a.ext_user, ps.ext_user, ch.ext_user, t.ext_user, di.ext_user, ob.ext_user)' || E'\n' ||
    '  full outer join resultado rs on rs.ext_user = coalesce(a.ext_user, ps.ext_user, ch.ext_user, t.ext_user, di.ext_user, ob.ext_user, fs.ext_user)');

  -- (5) named: repassa resultado.
  d := replace(d,
    '    f.passos, f.objetivos, f.fases, f.doc_itens, f.concluidas, f.atrasadas, f.avaliadas, f.satisfeitos,',
    '    f.resultado, f.passos, f.objetivos, f.fases, f.doc_itens, f.concluidas, f.atrasadas, f.avaliadas, f.satisfeitos,');

  -- (6) by_name: soma resultado.
  d := replace(d,
    '    sum(fases)::int as fases,',
    '    sum(resultado)::int as resultado,' || E'\n' || '    sum(fases)::int as fases,');

  -- (7) ranked: expõe resultado.
  d := replace(d,
    '    nome, passos, objetivos, fases,',
    '    nome, resultado, passos, objetivos, fases,');

  -- (8) ranked: entra no ranking quem só tem resultado também.
  d := replace(d,
    '  where fases > 0 or objetivos > 0 or passos > 0 or concluidas > 0 or atrasadas > 0',
    '  where resultado > 0 or fases > 0 or objetivos > 0 or passos > 0 or concluidas > 0 or atrasadas > 0');

  -- (9) ordenação: resultado esperado primeiro.
  d := replace(d,
    '        r.fases desc, r.objetivos desc, r.passos desc, r.doc_itens desc, r.concluidas desc, r.atrasadas asc,',
    '        r.resultado desc, r.fases desc, r.objetivos desc, r.passos desc, r.doc_itens desc, r.concluidas desc, r.atrasadas asc,');

  execute d;
end $mig$;