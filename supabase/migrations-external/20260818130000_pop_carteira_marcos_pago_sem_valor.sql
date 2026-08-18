-- =============================================================================
-- CARTEIRA DO POP — parcela RECEBIDA sem valor importado conta como PAGO.
-- Banco alvo: Supabase EXTERNO kmedldlepwiityjsdahz.
--
-- BUG (encontrado em 18/08/2026, caso 0000408-22.2017.5.22.0110): a importação
-- da planilha trouxe 344 parcelas com data_recebida/status=RECEBIDA mas
-- valor_pago NULL (10 CNJs). A régua do estágio era `sum(valor_pago) > 0`, então
-- esses clientes caíam em A_RECEBER — e o front, achando que o dinheiro estava
-- por vir, corrigia pela SELIC um valor que já caiu na conta em 2017.
--
-- A correção, no CTE `pago`: além do total, contar parcelas recebidas e
-- pendentes por (cnj, cliente). Estágio PAGO quando há valor pago OU quando
-- todas as parcelas do cliente foram recebidas (recebidas > 0 e pendentes = 0),
-- mesmo sem valor digitado. "Recebeu" e "quanto recebeu" são perguntas
-- separadas: valor nulo não desclassifica o fato do recebimento.
--
-- Nada mais muda em relação a 20260815220000 (safra do índice preservada).
--
-- REVERSÃO: re-executar 20260815220000_pop_carteira_marcos_safra_indice.sql.
-- =============================================================================

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
  jcm_indice          text,
  jcm_termo_inicial   date,
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
  -- A SAFRA VIGENTE de cada (índice, competência): a de maior `referencia`.
  -- Sem isto, cada safra nova multiplicaria as linhas da carteira.
  indice_vigente as (
    select distinct on (i.indice, i.competencia)
           i.indice, i.competencia, i.coeficiente, i.referencia
    from public.jm_indices i
    order by i.indice, i.competencia, i.referencia desc
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
    -- "Recebeu" e "quanto recebeu" são perguntas separadas: 344 parcelas vieram
    -- da planilha com data_recebida mas sem valor_pago. total_pago soma o que
    -- tem valor; recebidas/pendentes decidem o ESTÁGIO sem depender do valor.
    select regexp_replace(pg.processo_cnj, '[^0-9]', '', 'g') as cnj_num,
           pg.cliente,
           sum(coalesce(pg.valor_pago, 0)) filter (where pg.data_recebida is not null) as total_pago,
           count(*) filter (where pg.data_recebida is not null) as recebidas,
           count(*) filter (where pg.data_recebida is null)     as pendentes
    from public.jm_pagamentos pg
    group by 1, 2
  ),
  por_processo as (
    select p.id, p.lead_id, p.process_number, p.cnj_num, p.title,
           p.cadastros, p.leads, p.leads_nomes,
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
      when coalesce(pg.total_pago, 0) > 0
        or (coalesce(pg.recebidas, 0) > 0 and coalesce(pg.pendentes, 0) = 0) then 'PAGO'
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
    case when idx.coeficiente is not null then pp.indice_do_ramo end as jcm_indice,
    vv.termo                      as jcm_termo_inicial,
    coalesce(vv.termo_estimado, false) as jcm_termo_estimado,
    idx.coeficiente               as jcm_coeficiente,
    idx.referencia                as jcm_referencia
  from por_processo pp
  left join valor_vigente vv on vv.cnj_num = pp.cnj_num
  left join pago pg on pg.cnj_num = pp.cnj_num and pg.cliente = vv.cliente
  left join public.leads l on l.id = pp.lead_id
  left join indice_vigente idx
         on idx.indice = pp.indice_do_ramo
        and idx.competencia = date_trunc('month', vv.termo)::date
  order by pp.ordem desc nulls last, pp.data_detectada desc nulls last, pp.cnj_num, vv.cliente;
$$;

grant execute on function public.pop_carteira_marcos(uuid) to authenticated, anon, service_role;

comment on function public.pop_carteira_marcos(uuid) is
  'Carteira do POP na granularidade (CNJ x parte): ficha canonica por CNJ, marco atual, valor vigente, pago, estagio (parcela recebida sem valor importado conta como PAGO), sucesso, custo do lead, nome do caso, e insumos de correcao monetaria (safra vigente do indice) para o front calcular o atualizado — que NAO se aplica a parte ja PAGA.';
