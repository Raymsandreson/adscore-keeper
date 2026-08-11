-- =============================================================================
-- Carteira por fase do POP: onde cada processo está e quanto vale ali.
--
-- -----------------------------------------------------------------------------
-- A ARMADILHA QUE ESTA VIEW EVITA — R$ 51,6 MILHÕES DE DUPLA CONTAGEM
-- -----------------------------------------------------------------------------
-- jm_valores tem UMA LINHA POR (decisão x cliente). Cada decisão que confirma o
-- valor cria linha nova para a mesma pessoa: MARIA aparece com R$ 550.000 na
-- sentença e R$ 550.000 nos embargos — é o MESMO dinheiro, dito duas vezes.
--
--   soma bruta de jm_valores .................... R$ 83.228.467
--   última decisão de cada cliente .............. R$ 31.622.209
--
-- 2,6x inflado. Qualquer painel que faça sum(dano_moral + dano_estetico) sem o
-- distinct on está mentindo, e mentindo para cima — o pior lado para um número
-- que vai para relatório de fundo.
--
-- -----------------------------------------------------------------------------
-- MARCO QUE ATRAVESSA NÃO DEFINE FASE
-- -----------------------------------------------------------------------------
-- Primeira versão pegava "o marco de maior ordem" e pronto. Acordo (26) e
-- Suspensão (27) têm a maior ordem da régua, então venciam sempre e apareciam
-- como fase atual de 61 processos — escondendo onde eles estavam de verdade.
-- Um acordo homologado no TST não põe o processo numa fase "acordo": ele
-- continua no TST, com um acordo. Viraram coluna (tem_acordo, suspenso).
--
-- -----------------------------------------------------------------------------
-- O QUE ESTE NÚMERO É E O QUE NÃO É
-- -----------------------------------------------------------------------------
-- É o valor da CONDENAÇÃO fixado para cada cliente (dano moral + estético).
-- NÃO separa cota do cliente de honorário do escritório — o honorário sai daí
-- por hs_pct e pelo contrato, e é outra conta. Enquanto isso não estiver
-- resolvido, leia como "quanto o processo vale", não "quanto entra no caixa".
--
-- Granularidade (processo x cliente), como manda a régua v4: litisconsórcio tem
-- um valor por pessoa. Ao agrupar, PROCESSOS contam distintos e VALORES somam.
-- =============================================================================
create or replace view public.vw_pop_carteira_por_fase as
with board as (
  select id from public.kanban_boards
   where name = 'Trabalhistas judicial — marcos (rascunho)' limit 1
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
  join public.pop_marcos pm
    on pm.chave = d.marco_chave and pm.board_id = d.board_id
  where d.board_id = (select id from board)
),
marco_atual as (
  select distinct on (cnj_num)
         cnj_num, marco_chave, rotulo as marco_rotulo, ordem, stage_id,
         data_detectada, estagio_financeiro_sugerido
  from detectados
  where not atravessa_fases
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
  vv.cliente, vv.valor as valor_condenacao, vv.hs_pct,
  vv.data_decisao, vv.tipo_evento,
  coalesce(pg.total_pago, 0) as valor_pago,
  ma.marco_chave, ma.marco_rotulo, ma.ordem as marco_ordem, ma.stage_id,
  ma.data_detectada as marco_em,
  coalesce(tv.tem_acordo, false) as tem_acordo,
  coalesce(tv.suspenso, false)   as suspenso,
  tv.acordo_em,
  -- Dinheiro que entrou é fato consumado e vence o marco. Acordo homologado tem
  -- valor e data, então é A_RECEBER mesmo com a fase noutro lugar.
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
left join travessias tv  on tv.cnj_num = regexp_replace(p.processo_cnj,'[^0-9]','','g');

comment on view public.vw_pop_carteira_por_fase is
  'Processo x cliente: fase atual (so marcos que sao fase), acordo/suspensao como coluna, estagio financeiro e valor pela ULTIMA decisao do cliente. Somar jm_valores direto infla 2,6x.';
