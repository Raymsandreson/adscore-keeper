-- =============================================================================
-- CARTEIRA DO POP — trazer o NOME DO LEAD (o caso a que o processo pertence).
-- Banco alvo: Supabase EXTERNO kmedldlepwiityjsdahz.
--
-- Pedido do usuário (15/08/2026): na carteira e na conferência, saber de qual
-- caso/lead é cada processo. Hoje a linha mostra só CNJ e título do processo —
-- o título é o que a equipe digitou ("Processo", "PA M", "Indenização"), e em
-- vários casos não identifica ninguém.
--
-- FONTE: `leads.lead_name` do próprio Externo. Medido antes de escolher
-- (15/08/2026): o snapshot está vivo (updated_at do mesmo dia), 19.973 dos
-- 19.974 leads têm nome, e 713 de 713 processos deste POP com lead chegam a um
-- nome. Não precisa ir ao Cloud — a RPC já fazia `left join public.leads`.
--
-- DUAS COLUNAS, porque o CNJ pode ter ficha repetida:
--   `lead_nome`   — o lead da ficha canônica, o que a linha mostra;
--   `leads_nomes` — TODOS os leads do CNJ. Em 6 dos 17 grupos duplicados as
--                   fichas irmãs são de leads DIFERENTES, e mostrar só um deles
--                   esconderia metade da história de quem é o caso.
--
-- Nada mais muda: a dedup por CNJ, o valor por parte e o cálculo de custo
-- continuam idênticos aos de 20260815120000.
--
-- LGPD: `lead_name` é nome de cliente e já circula nas telas do app sob login.
-- Esta função continua exigindo sessão autenticada (grant a authenticated/anon
-- com a mesma RLS do resto), e o nome NÃO vai para log nenhum.
--
-- REVERSÃO: re-executar 20260815120000_pop_carteira_marcos_dedup_cnj.sql. O
-- front precisa voltar junto — ele passa a ler `lead_nome`/`leads_nomes`.
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
  -- NOVAS: de quem é este processo.
  lead_nome        text,
  leads_nomes      text[]
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
           p.cadastros, p.leads, p.leads_nomes,
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
    pp.leads_nomes
  from por_processo pp
  left join valor_vigente vv on vv.cnj_num = pp.cnj_num
  left join pago pg on pg.cnj_num = pp.cnj_num and pg.cliente = vv.cliente
  left join public.leads l on l.id = pp.lead_id
  order by pp.ordem desc nulls last, pp.data_detectada desc nulls last, pp.cnj_num, vv.cliente;
$$;

grant execute on function public.pop_carteira_marcos(uuid) to authenticated, anon, service_role;

comment on function public.pop_carteira_marcos(uuid) is
  'Carteira do POP na granularidade (CNJ x parte): UMA ficha canonica por CNJ (dedup do valor inflado), marco atual, dias no marco, valor vigente (ultima decisao por parte), pago, estagio financeiro, sucesso, custo do lead, o grupo do CNJ (cadastros_do_cnj, leads_do_cnj) e de quem e o processo (lead_nome, leads_nomes).';
