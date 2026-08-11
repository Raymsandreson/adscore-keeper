-- =============================================================================
-- v3 da carteira: + POP, advogado e responsável. Substitui a view de
-- 20260811190000 (que fica no histórico como v2).
--
-- DISTINCT ON NO CADASTRO — obrigatório: 26 números de processo aparecem
-- repetidos em lead_processes, um deles 4 vezes. Sem isso o join multiplica a
-- carteira inteira: a primeira medição deu 11.304 linhas para 344 processos.
-- Foi o número absurdo que denunciou; um join ingênuo aqui infla tudo em silêncio.
--
-- ADVOGADO: sai de lead_processes.envolvidos[].advogados[] do polo ATIVO — que
-- é onde o nosso cliente está. Traz nome e OAB.
--
-- RESPONSÁVEL: leads.processual_responsible_id (2.456 preenchidos) com o
-- responsible_user_id do processo (262) como degrau seguinte. O responsável
-- mora no LEAD, não no processo.
--
-- COBERTURA REAL (11/08/2026): 400 linhas com POP, 292 com responsável, apenas
-- 68 com advogado — `envolvidos` só está preenchido em parte dos processos.
-- A coluna aparece vazia na maioria, e isso é dado que falta, não erro da view.
--
-- Também expõe fase/objetivo/passo DIGITADOS em jm_processos, que existiam
-- antes da régua automática — servem para comparar o que a equipe anotava à mão
-- com o que o marco detecta sozinho.
-- =============================================================================
create or replace view public.vw_pop_carteira_por_fase as
with board as (
  select id from public.kanban_boards
   where name = 'Trabalhistas judicial — marcos (rascunho)' limit 1
),
cadastro as (
  select distinct on (regexp_replace(coalesce(lp.process_number,''),'[^0-9]','','g'))
         regexp_replace(coalesce(lp.process_number,''),'[^0-9]','','g') as cnj_num,
         lp.id as process_id, lp.lead_id, lp.workflow_id, lp.workflow_name,
         lp.responsible_user_id, lp.envolvidos
  from public.lead_processes lp
  where lp.deleted_at is null and lp.process_number is not null
  order by regexp_replace(coalesce(lp.process_number,''),'[^0-9]','','g'), lp.created_at nulls last
),
advogado as (
  select c.cnj_num, (adv->>'nome') as advogado_nome,
         ((adv->'oabs'->0->>'numero') || '/' || coalesce(adv->'oabs'->0->>'uf','')) as advogado_oab
  from cadastro c
  cross join lateral jsonb_array_elements(coalesce(c.envolvidos,'[]'::jsonb)) e
  cross join lateral jsonb_array_elements(coalesce(e->'advogados','[]'::jsonb)) adv
  where e->>'polo' = 'ATIVO'
),
advogado_1 as (
  select distinct on (cnj_num) cnj_num, advogado_nome, advogado_oab
  from advogado order by cnj_num, advogado_nome
),
valor_vigente as (
  select distinct on (v.processo_cnj, v.cliente)
         v.processo_cnj, v.cliente,
         coalesce(v.dano_moral,0) + coalesce(v.dano_estetico,0) as valor,
         v.hs_pct, d.data_decisao, d.tipo_evento
  from public.jm_valores v
  left join public.jm_decisoes d on d.dec_id = v.dec_id
  order by v.processo_cnj, v.cliente, d.data_decisao desc nulls last
),
detectados as (
  select d.*, regexp_replace(d.processo_cnj,'[^0-9]','','g') as cnj_num,
         pm.atravessa_fases, pm.estagio_financeiro_sugerido
  from public.vw_pop_marcos_detectados d
  join public.pop_marcos pm on pm.chave = d.marco_chave and pm.board_id = d.board_id
  where d.board_id = (select id from board)
),
marco_atual as (
  select distinct on (cnj_num)
         cnj_num, marco_chave, rotulo as marco_rotulo, ordem, stage_id,
         data_detectada, estagio_financeiro_sugerido
  from detectados where not atravessa_fases
  order by cnj_num, ordem desc, data_detectada desc
),
travessias as (
  select cnj_num,
         bool_or(marco_chave = 'acordo_homologado') as tem_acordo,
         bool_or(marco_chave = 'suspensao')         as suspenso,
         min(data_detectada) filter (where marco_chave = 'acordo_homologado') as acordo_em
  from detectados where atravessa_fases group by 1
),
pago as (
  select processo_cnj, cliente, sum(coalesce(valor_pago,0)) as total_pago
  from public.jm_pagamentos where data_recebida is not null group by 1,2
)
select
  p.processo_cnj, p.caso, p.status as status_jurimetria,
  p.fase as fase_digitada, p.objetivo as objetivo_digitado, p.passo as passo_digitado,
  p.empresa, p.natureza, p.uf_proc,
  vv.cliente, vv.valor as valor_condenacao, vv.hs_pct,
  vv.data_decisao, vv.tipo_evento,
  coalesce(pg.total_pago, 0) as valor_pago,
  ma.marco_chave, ma.marco_rotulo, ma.ordem as marco_ordem, ma.stage_id,
  ma.data_detectada as marco_em,
  coalesce(tv.tem_acordo, false) as tem_acordo,
  coalesce(tv.suspenso, false)   as suspenso,
  tv.acordo_em,
  cad.workflow_id, cad.workflow_name as pop_nome,
  adv.advogado_nome, adv.advogado_oab,
  coalesce(pr.full_name, pp.full_name) as responsavel_nome,
  case
    when coalesce(pg.total_pago,0) > 0              then 'PAGO'
    when coalesce(tv.tem_acordo,false)              then 'A_RECEBER'
    when ma.estagio_financeiro_sugerido is not null then ma.estagio_financeiro_sugerido
    when vv.valor > 0                                then 'CONDENACAO'
    else 'PROJETADO'
  end as estagio_financeiro
from public.jm_processos p
left join valor_vigente vv on vv.processo_cnj = p.processo_cnj
left join pago pg on pg.processo_cnj = p.processo_cnj and pg.cliente = vv.cliente
left join marco_atual ma on ma.cnj_num = regexp_replace(p.processo_cnj,'[^0-9]','','g')
left join travessias tv  on tv.cnj_num = regexp_replace(p.processo_cnj,'[^0-9]','','g')
left join cadastro cad   on cad.cnj_num = regexp_replace(p.processo_cnj,'[^0-9]','','g')
left join advogado_1 adv on adv.cnj_num = regexp_replace(p.processo_cnj,'[^0-9]','','g')
left join public.leads l on l.id = cad.lead_id
left join public.profiles pr on pr.user_id = l.processual_responsible_id
left join public.profiles pp on pp.id = cad.responsible_user_id;

comment on view public.vw_pop_carteira_por_fase is
  'Jurimetria da carteira: processo x cliente com fase atual, POP, advogado, responsavel, estagio financeiro e valor pela ULTIMA decisao. Somar jm_valores direto infla 2,6x.';
