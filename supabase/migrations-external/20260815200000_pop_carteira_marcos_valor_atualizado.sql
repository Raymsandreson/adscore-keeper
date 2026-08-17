-- =============================================================================
-- CARTEIRA DO POP — valor da condenação ATUALIZADO (juros e correção monetária).
-- Banco alvo: Supabase EXTERNO kmedldlepwiityjsdahz.
--
-- Pedido do usuário (15/08/2026): "atualizar o valor da condenação conforme cada
-- processo" — corrigir cada condenação pelo índice do SEU ramo, a partir do SEU
-- termo inicial. Decidido junto: o atualizado anda AO LADO do nominal, não no
-- lugar dele. A carteira continua somando o nominal (é o que os relatórios FIDC,
-- Tercon e Limine leem hoje); o corrigido é número extra.
--
-- A BASE JÁ ESTAVA PRONTA — esta migration só liga os pontos:
--   `jm_indices`  — SELIC_SIMPLES_JT (1995-01→2026-07, 379 linhas) e
--                   TCM_ESTADUAL (1964-01→2026-07, 742 linhas). O `coeficiente`
--                   é o multiplicador da competência até `referencia`, e a
--                   competência da própria referência vale 1.0.
--   `jm_decisoes.termo_inicial_jcm` — data de início de juros e correção,
--                   preenchida em 435 das 439 decisões.
--
-- ÍNDICE POR RAMO, lido do dígito 14 do CNJ (segmento do Judiciário):
--   5 = Justiça do Trabalho  → SELIC_SIMPLES_JT  (SELIC simples, pós EC 113/2021)
--   8 = Justiça Estadual     → TCM_ESTADUAL
--   qualquer outro           → NULL, não corrige
-- Medido neste POP em 15/08/2026: trabalhista 189 partes (R$ 18.449.833,28) e
-- estadual 34 partes (R$ 1.842.399,97). Os 51 processos de segmento 2/4 (CNJ e
-- Justiça Federal) não têm NENHUM valor lançado, então hoje ninguém fica sem
-- índice — mas quando tiver, o campo vem nulo e a tela diz "sem índice para este
-- ramo" em vez de aplicar um índice errado. A Justiça Federal tem manual próprio
-- de cálculo; inventar TCM_ESTADUAL para ela seria mentira.
--
-- O QUE A RPC DEVOLVE, e o que NÃO devolve: ela entrega os INSUMOS
-- (`jcm_indice`, `jcm_termo_inicial`, `jcm_coeficiente`, `jcm_referencia`) e o
-- front multiplica. De propósito: assim a tela mostra a conta inteira na
-- conferência — valor × coeficiente = atualizado — em vez de um número mágico
-- que ninguém consegue contestar. É a mesma régua do resto desta carteira.
--
-- HONESTIDADE DA DATA: `jcm_referencia` é até quando a tabela corrige (hoje
-- 2026-07-01, enquanto estamos em 15/08/2026). A tela mostra essa data junto do
-- número — "atualizado até jul/2026" — porque um valor corrigido sem dizer até
-- quando não serve para negociar nada.
--
-- Impacto medido antes de aplicar: nominal R$ 20.292.233,25 → atualizado
-- R$ 26.010.426,00 (+28,2%), com 223 de 223 partes com valor cobertas.
--
-- Nada mais muda: dedup por CNJ, valor por parte, custo por lead e nome do caso
-- continuam idênticos aos de 20260815170000.
--
-- REVERSÃO: re-executar 20260815170000_pop_carteira_marcos_lead_nome.sql, com o
-- front voltando junto (ele passa a ler as colunas jcm_*).
-- =============================================================================

drop function if exists public.pop_carteira_marcos(uuid);

create or replace function public.pop_carteira_marcos(p_board_id uuid)
returns table (
  process_id       uuid,
  lead_id          uuid,
  process_number   text,
  cnj_num          text,
  titulo           text,
  cliente          text,
  valor_condenacao numeric,
  valor_pago       numeric,
  marco_chave      text,
  marco_rotulo     text,
  marco_ordem      smallint,
  marco_em         date,
  dias_no_marco    integer,
  ajuizamento_em   date,
  idade_dias       integer,
  tem_acordo       boolean,
  suspenso         boolean,
  estagio_financeiro text,
  decidido         boolean,
  sucesso          boolean,
  tem_leitura      boolean,
  custo_lead       numeric,
  cadastros_do_cnj integer,
  leads_do_cnj     uuid[],
  lead_nome        text,
  leads_nomes      text[],
  -- NOVAS: os insumos da correção. O front faz valor × coeficiente.
  jcm_indice          text,
  jcm_termo_inicial   date,
  /** true = não havia termo_inicial_jcm e caiu na data da decisão. */
  jcm_termo_estimado  boolean,
  jcm_coeficiente     numeric,
  jcm_referencia      date
)
language sql
stable
security definer
set search_path = public
as $$
  with procs_todos as (
    select lp.id, lp.lead_id, lp.process_number, lp.title,
           lp.created_at, lp.updated_at,
           regexp_replace(coalesce(lp.process_number,''), '[^0-9]', '', 'g') as cnj_num
    from public.lead_processes lp
    where lp.deleted_at is null
      and lp.workflow_id::uuid = p_board_id
      and length(regexp_replace(coalesce(lp.process_number,''), '[^0-9]', '', 'g')) >= 15
  ),
  marcos_da_ficha as (
    select m.process_id, count(*) as qtd, max(m.ordem) as maior_ordem
    from public.process_pop_marcos m
    where m.board_id = p_board_id
    group by m.process_id
  ),
  grupo_do_cnj as (
    select t.cnj_num,
           count(*)::integer as cadastros,
           array_remove(array_agg(distinct t.lead_id), null) as leads,
           array_remove(array_agg(distinct nullif(btrim(l.lead_name), '')), null) as leads_nomes
    from procs_todos t
    left join public.leads l on l.id = t.lead_id
    group by t.cnj_num
  ),
  procs as (
    select distinct on (t.cnj_num)
           t.id, t.lead_id, t.process_number, t.title, t.cnj_num,
           g.cadastros, g.leads, g.leads_nomes
    from procs_todos t
    join grupo_do_cnj g on g.cnj_num = t.cnj_num
    left join marcos_da_ficha mf on mf.process_id = t.id
    order by t.cnj_num,
             (mf.process_id is not null) desc,
             mf.maior_ordem desc nulls last,
             mf.qtd desc nulls last,
             t.updated_at desc nulls last,
             t.created_at desc nulls last,
             t.id
  ),
  ordem_sentenca as (
    select pm.ordem from public.pop_marcos pm
    where pm.board_id = p_board_id and pm.chave = 'sentenca' limit 1
  ),
  marco_atual as (
    select distinct on (m.process_id)
           m.process_id, m.marco_chave, m.rotulo, m.ordem, m.data_detectada,
           pm.estagio_financeiro_sugerido
    from public.process_pop_marcos m
    join public.pop_marcos pm on pm.board_id = m.board_id and pm.chave = m.marco_chave
    where m.board_id = p_board_id and not pm.atravessa_fases
    order by m.process_id, m.ordem desc, m.data_detectada desc
  ),
  travessias as (
    select m.process_id,
           bool_or(m.marco_chave = 'acordo_homologado') as tem_acordo,
           bool_or(m.marco_chave = 'suspensao')         as suspenso
    from public.process_pop_marcos m
    where m.board_id = p_board_id
    group by m.process_id
  ),
  ajuizamento as (
    select m.process_id, min(m.data_detectada) as ajuizamento_em
    from public.process_pop_marcos m
    where m.board_id = p_board_id and m.marco_chave = 'ajuizamento'
    group by m.process_id
  ),
  valor_vigente as (
    -- Última decisão por (processo × cliente). Agora carrega também o termo
    -- inicial DELA — corrigir pela data de outra decisão daria número errado.
    select distinct on (v.processo_cnj, v.cliente)
           regexp_replace(v.processo_cnj, '[^0-9]', '', 'g') as cnj_num,
           v.cliente,
           coalesce(v.dano_moral, 0) + coalesce(v.dano_estetico, 0) as valor,
           coalesce(d.termo_inicial_jcm, d.data_decisao) as termo,
           (d.termo_inicial_jcm is null and d.data_decisao is not null) as termo_estimado
    from public.jm_valores v
    left join public.jm_decisoes d on d.dec_id = v.dec_id
    order by v.processo_cnj, v.cliente, d.data_decisao desc nulls last
  ),
  pago as (
    select regexp_replace(pg.processo_cnj, '[^0-9]', '', 'g') as cnj_num,
           pg.cliente,
           sum(coalesce(pg.valor_pago, 0)) as total_pago
    from public.jm_pagamentos pg
    where pg.data_recebida is not null
    group by 1, 2
  ),
  por_processo as (
    select p.id, p.lead_id, p.process_number, p.cnj_num, p.title,
           p.cadastros, p.leads, p.leads_nomes,
           -- Dígito 14 do CNJ = segmento do Judiciário. Define o índice.
           case substring(p.cnj_num from 14 for 1)
             when '5' then 'SELIC_SIMPLES_JT'
             when '8' then 'TCM_ESTADUAL'
             else null
           end as indice_do_ramo,
           ma.marco_chave, ma.rotulo, ma.ordem, ma.data_detectada,
           ma.estagio_financeiro_sugerido,
           coalesce(tv.tem_acordo, false) as tem_acordo,
           coalesce(tv.suspenso, false)   as suspenso,
           aj.ajuizamento_em,
           (coalesce(tv.tem_acordo, false)
             or (ma.ordem is not null
                 and ma.ordem >= coalesce((select ordem from ordem_sentenca), 32767))) as decidido,
           exists (select 1 from valor_vigente vv
                    where vv.cnj_num = p.cnj_num and vv.valor > 0) as tem_valor,
           exists (select 1 from public.jm_decisoes d
                    where regexp_replace(d.processo_cnj, '[^0-9]', '', 'g') = p.cnj_num) as tem_leitura
    from procs p
    left join marco_atual ma on ma.process_id = p.id
    left join travessias tv on tv.process_id = p.id
    left join ajuizamento aj on aj.process_id = p.id
  )
  select
    pp.id                         as process_id,
    pp.lead_id,
    pp.process_number,
    pp.cnj_num,
    pp.title                      as titulo,
    vv.cliente,
    vv.valor                      as valor_condenacao,
    coalesce(pg.total_pago, 0)    as valor_pago,
    pp.marco_chave,
    pp.rotulo                     as marco_rotulo,
    pp.ordem                      as marco_ordem,
    pp.data_detectada             as marco_em,
    case when pp.data_detectada is not null
         then (current_date - pp.data_detectada) end as dias_no_marco,
    pp.ajuizamento_em,
    case when pp.ajuizamento_em is not null
         then (current_date - pp.ajuizamento_em) end as idade_dias,
    pp.tem_acordo,
    pp.suspenso,
    case
      when coalesce(pg.total_pago, 0) > 0        then 'PAGO'
      when pp.tem_acordo                          then 'A_RECEBER'
      when pp.estagio_financeiro_sugerido is not null then pp.estagio_financeiro_sugerido
      when coalesce(vv.valor, 0) > 0              then 'CONDENACAO'
      else 'PROJETADO'
    end as estagio_financeiro,
    pp.decidido,
    (pp.decidido and (pp.tem_acordo or pp.tem_valor)) as sucesso,
    pp.tem_leitura,
    coalesce(l.cac, l.ad_spend_at_conversion)    as custo_lead,
    pp.cadastros                  as cadastros_do_cnj,
    pp.leads                      as leads_do_cnj,
    nullif(btrim(l.lead_name), '') as lead_nome,
    pp.leads_nomes,
    -- Só declara o índice quando ele de fato existe para a competência: dizer
    -- "SELIC" sem ter coeficiente faria a tela prometer correção que não houve.
    case when idx.coeficiente is not null then pp.indice_do_ramo end as jcm_indice,
    vv.termo                      as jcm_termo_inicial,
    coalesce(vv.termo_estimado, false) as jcm_termo_estimado,
    idx.coeficiente               as jcm_coeficiente,
    idx.referencia                as jcm_referencia
  from por_processo pp
  left join valor_vigente vv on vv.cnj_num = pp.cnj_num
  left join pago pg on pg.cnj_num = pp.cnj_num and pg.cliente = vv.cliente
  left join public.leads l on l.id = pp.lead_id
  left join public.jm_indices idx
         on idx.indice = pp.indice_do_ramo
        and idx.competencia = date_trunc('month', vv.termo)::date
  order by pp.ordem desc nulls last, pp.data_detectada desc nulls last, pp.cnj_num, vv.cliente;
$$;

grant execute on function public.pop_carteira_marcos(uuid) to authenticated, anon, service_role;

comment on function public.pop_carteira_marcos(uuid) is
  'Carteira do POP na granularidade (CNJ x parte): ficha canonica por CNJ (dedup do valor inflado), marco atual, valor vigente (ultima decisao por parte), pago, estagio, sucesso, custo do lead, grupo do CNJ, nome do caso, e os insumos de correcao monetaria (jcm_indice/termo/coeficiente/referencia) para o front calcular o valor atualizado ao lado do nominal.';
