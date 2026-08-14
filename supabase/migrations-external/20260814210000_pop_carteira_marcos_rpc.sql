-- =============================================================================
-- CARTEIRA DO POP — a régua de marcos com o dinheiro em cima.
-- Banco alvo: Supabase EXTERNO kmedldlepwiityjsdahz.
--
-- Pedido do usuário (14/08/2026): uma aba no POP com "a discriminação da
-- relação dos processos e tempo que cada um está naquele marco", os valores da
-- carteira conforme o estágio financeiro em cada marco e no total, média de
-- tempo, índice de sucesso, custo da carteira (entrada do lead) e rentabilidade.
--
-- O que esta RPC devolve: UMA LINHA POR (processo × cliente) do POP pedido —
-- granularidade do vocabulário FIDC (litisconsórcio tem um valor por pessoa).
-- Processo sem valor lançado vem com cliente null (uma linha), para a contagem
-- de processos não perder ninguém.
--
-- REGRAS DO VOCABULÁRIO que este SQL respeita (skill whatsjud-fluxo-vocabulario):
--   - valor vigente = ÚLTIMA decisão de cada (processo × cliente), via
--     DISTINCT ON — somar jm_valores direto infla 2,6x (MARIA da sentença +
--     MARIA dos embargos é o mesmo dinheiro dito duas vezes);
--   - estágio financeiro pela mesma escada da vw_pop_carteira_por_fase:
--     PAGO (recebido) > A_RECEBER (acordo homologado) > estágio sugerido do
--     marco atual > CONDENACAO (tem valor sem estágio) > PROJETADO;
--   - o número é "quanto o processo vale", NÃO "quanto entra no caixa" — não
--     separa cota do cliente de honorário. O front repete esse aviso na tela.
--
-- ÍNDICE DE SUCESSO — definição embutida (lead_processes.resultado_atingido
-- está zerado na base inteira em 14/08/2026, então não há fonte manual):
--   decidido = marco atual >= ordem da sentença DESTE board (mérito já saiu)
--              OU tem acordo homologado;
--   sucesso  = decidido E (acordo homologado OU algum cliente com valor > 0).
--   ARMADILHA MEDIDA (14/08): dos 239 decididos do POP trabalhista, só 62 têm
--   leitura de decisão em jm_decisoes — "decidido sem valor" quase sempre é
--   FALTA DE LEITURA, não improcedência (56/62 com leitura são sucesso = 90%).
--   Por isso a coluna `tem_leitura`: o índice honesto divide sucessos pelos
--   decididos AVALIÁVEIS (com leitura ou com acordo), nunca pelos 239.
--
-- CUSTO (entrada) = leads.cac, com ad_spend_at_conversion de reserva — lido do
-- snapshot de leads do Externo. Em 14/08/2026 esse snapshot está zerado (324
-- leads do POP trabalhista, soma R$ 0,00); o front busca o valor vivo no Cloud
-- e usa este como fallback. A coluna já viaja aqui para o dia em que o sync
-- carregar o número.
--
-- REVERSÃO: drop function if exists public.pop_carteira_marcos(uuid);
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
  custo_lead       numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with procs as (
    select lp.id, lp.lead_id, lp.process_number, lp.title,
           regexp_replace(coalesce(lp.process_number,''), '[^0-9]', '', 'g') as cnj_num
    from public.lead_processes lp
    where lp.deleted_at is null
      and lp.workflow_id::uuid = p_board_id
      and length(regexp_replace(coalesce(lp.process_number,''), '[^0-9]', '', 'g')) >= 15
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
    -- Última decisão por (processo × cliente). NUNCA somar jm_valores direto.
    select distinct on (v.processo_cnj, v.cliente)
           regexp_replace(v.processo_cnj, '[^0-9]', '', 'g') as cnj_num,
           v.cliente,
           coalesce(v.dano_moral, 0) + coalesce(v.dano_estetico, 0) as valor
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
           ma.marco_chave, ma.rotulo, ma.ordem, ma.data_detectada,
           ma.estagio_financeiro_sugerido,
           coalesce(tv.tem_acordo, false) as tem_acordo,
           coalesce(tv.suspenso, false)   as suspenso,
           aj.ajuizamento_em,
           -- mérito já saiu? (sentença deste board, ou acordo — que encerra)
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
    coalesce(l.cac, l.ad_spend_at_conversion)    as custo_lead
  from por_processo pp
  left join valor_vigente vv on vv.cnj_num = pp.cnj_num
  left join pago pg on pg.cnj_num = pp.cnj_num and pg.cliente = vv.cliente
  left join public.leads l on l.id = pp.lead_id
  order by pp.ordem desc nulls last, pp.data_detectada desc nulls last, pp.cnj_num, vv.cliente;
$$;

grant execute on function public.pop_carteira_marcos(uuid) to authenticated, anon, service_role;

comment on function public.pop_carteira_marcos(uuid) is
  'Carteira do POP na granularidade (processo x cliente): marco atual, dias no marco, valor vigente (ultima decisao), pago, estagio financeiro, sucesso e custo do lead. Fonte da aba Carteira do editor de POP.';
