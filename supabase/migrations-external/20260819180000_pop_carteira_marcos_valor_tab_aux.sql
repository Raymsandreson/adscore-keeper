-- =============================================================================
-- A carteira passa a enxergar o valor que já está em `jm_partes` (Tab. Aux).
-- Banco alvo: EXTERNO kmedldlepwiityjsdahz.
--
-- O PROBLEMA, medido em 19/08/2026: a carteira lê o valor só de `jm_valores`
-- (dano moral + estético da última decisão), que cobre 123 CNJs. A `jm_partes`,
-- importada da aba Tab. Aux em 18/08, cobre 186. São **73 processos que estão
-- na carteira, aparecem na lista e valem zero** — não porque não têm valor, mas
-- porque a função lê a tabela que não os tem.
--
-- ARMADILHA CENTRAL, e a razão de este arquivo existir em vez de um join simples:
--   `jm_valores` é NOMINAL       -> a função corrige, multiplicando pelo índice.
--   `jm_partes.condenacao_cjcm` é CJCM = com juros e correção monetária, ou seja
--   JÁ CORRIGIDO pela planilha   -> corrigir de novo infla o número.
-- Isso já aconteceu uma vez nesta base (extrato do processo, 19/08, revertido no
-- mesmo dia). Aqui a origem viaja junto no retorno (`valor_origem`) e o
-- coeficiente vale 1 quando o valor já vem corrigido.
--
-- POR QUE ESCOLHER POR CNJ, E NÃO POR PARTE: as duas tabelas têm listas de
-- clientes que não coincidem. Misturá-las parte a parte multiplicaria linhas e
-- contaria o mesmo processo duas vezes. A regra é: se o CNJ tem valor de
-- decisão, ele vem inteiro de `jm_valores`; senão, vem inteiro de `jm_partes`.
--
-- GANHO: `jm_partes` traz também a separação **cota do cliente × honorário**,
-- que `jm_valores` não tem. Os dois campos novos vêm null quando a origem é a
-- decisão — a tela mostra "sem abertura" em vez de fingir que sabe.
--
-- REVERSÃO: reaplicar 20260818130000_pop_carteira_marcos_pago_sem_valor.sql,
-- que contém a definição anterior inteira. Nenhum dado é alterado por esta
-- migration — ela só troca uma função de leitura.
-- =============================================================================

-- A assinatura ganha colunas, então precisa de drop antes do create.
drop function if exists public.pop_carteira_marcos(uuid);

create or replace function public.pop_carteira_marcos(p_board_id uuid)
returns table (
  process_id uuid, lead_id uuid, process_number text, cnj_num text, titulo text,
  cliente text, valor_condenacao numeric, valor_pago numeric,
  marco_chave text, marco_rotulo text, marco_ordem smallint, marco_em date,
  dias_no_marco integer, ajuizamento_em date, idade_dias integer,
  tem_acordo boolean, suspenso boolean, estagio_financeiro text,
  decidido boolean, sucesso boolean, tem_leitura boolean, custo_lead numeric,
  cadastros_do_cnj integer, leads_do_cnj uuid[], lead_nome text, leads_nomes text[],
  jcm_indice text, jcm_termo_inicial date, jcm_termo_estimado boolean,
  jcm_coeficiente numeric, jcm_referencia date,
  valor_origem text, cota_cliente numeric, honorario_parte numeric
)
language sql
stable security definer
set search_path to 'public'
as $function$
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
  -- FONTE 1: a decisão. Valor NOMINAL — corrige.
  valor_decisao as (
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
  cnjs_da_decisao as (
    select distinct cnj_num from valor_decisao where valor > 0
  ),
  -- FONTE 2: a Tab. Aux. Valor CJCM — JÁ corrigido, não multiplicar por índice.
  -- Só entra em CNJ que a decisão não cobre, para não contar duas vezes.
  valor_tab_aux as (
    select regexp_replace(pa.processo_cnj, '[^0-9]', '', 'g') as cnj_num,
           pa.cliente,
           pa.condenacao_cjcm as valor,
           pa.termo_inicial_jcm as termo,
           false as termo_estimado,
           pa.cota_parte_cjcm as cota,
           coalesce(pa.hc_vista,0) + coalesce(pa.hc_parcelado,0) + coalesce(pa.hs,0) as honorario
    from public.jm_partes pa
    where pa.condenacao_cjcm is not null
      and regexp_replace(pa.processo_cnj, '[^0-9]', '', 'g') not in (select cnj_num from cnjs_da_decisao)
  ),
  valor_vigente as (
    select cnj_num, cliente, valor, termo, termo_estimado,
           'decisao'::text as origem, null::numeric as cota, null::numeric as honorario
    from valor_decisao
    union all
    select cnj_num, cliente, valor, termo, termo_estimado,
           'tab_aux'::text, cota, honorario
    from valor_tab_aux
  ),
  pago as (
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
    -- Valor da Tab. Aux já vem corrigido: o "índice" é a própria planilha, e o
    -- coeficiente é 1. `jcm_referencia` fica null porque a data até a qual a
    -- planilha corrigiu não está registrada em lugar nenhum — dizer uma data
    -- que não se sabe é pior que não dizer.
    case when vv.origem = 'tab_aux' then 'TAB_AUX_CJCM'
         when idx.coeficiente is not null then pp.indice_do_ramo end as jcm_indice,
    vv.termo                      as jcm_termo_inicial,
    coalesce(vv.termo_estimado, false) as jcm_termo_estimado,
    case when vv.origem = 'tab_aux' then 1::numeric
         else idx.coeficiente end as jcm_coeficiente,
    case when vv.origem = 'tab_aux' then null::date
         else idx.referencia end  as jcm_referencia,
    vv.origem                     as valor_origem,
    vv.cota                       as cota_cliente,
    vv.honorario                  as honorario_parte
  from por_processo pp
  left join valor_vigente vv on vv.cnj_num = pp.cnj_num
  left join pago pg on pg.cnj_num = pp.cnj_num and pg.cliente = vv.cliente
  left join public.leads l on l.id = pp.lead_id
  left join indice_vigente idx
         on idx.indice = pp.indice_do_ramo
        and idx.competencia = date_trunc('month', vv.termo)::date
  order by pp.ordem desc nulls last, pp.data_detectada desc nulls last, pp.cnj_num, vv.cliente;
$function$;

comment on function public.pop_carteira_marcos(uuid) is
  'Carteira do quadro, uma linha por (processo, parte). O valor vem de jm_valores '
  '(nominal, corrige) e, nos CNJs que ela não cobre, de jm_partes/Tab. Aux (CJCM, '
  'já corrigido — coeficiente 1). `valor_origem` diz de onde veio.';
