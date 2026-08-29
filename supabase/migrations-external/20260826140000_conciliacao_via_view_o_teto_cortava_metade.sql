-- ============================================================================
-- RUN IN: Supabase EXTERNO (kmedldlepwiityjsdahz) — NAO no Cloud
-- ============================================================================
-- APLICADA em 26/08/2026.
-- ============================================================================
-- BUG QUE ISTO CONSERTA, achado quando o Raym perguntou qual e o criterio para
-- um processo entrar na conciliacao.
--
-- A tela mostrava 41 acordos. O POP tem 91.
--
-- A causa: o hook lia `process_pop_marcos` cru, filtrado so por board_id, e
-- escolhia o marco `acordo_homologado` no JAVASCRIPT. O POP "Trabalhistas
-- judicial — marcos" tem 2.708 marcos, e o PostgREST corta em 1.000 linhas por
-- padrao. A tela via os mil primeiros, achava 41 acordos ali dentro, e exibia
-- isso como se fosse tudo.
--
-- Nenhum erro aparecia. Metade da carteira de acordos ficava invisivel, e os
-- totais de honorario faltando/sobrando saiam pela metade — numeros que o Raym
-- usaria para decidir cobranca.
--
-- Os lancamentos corriam o mesmo risco: 91 processos com dezenas de linhas cada
-- estouram 1.000 de novo.
--
-- A CORRECAO: agregar no banco. A view devolve UMA linha por acordo, com os
-- lancamentos ja somados por titular. A consulta cai de milhares de linhas para
-- dezenas, e o teto deixa de importar.
--
-- `distinct on (board_id, process_id)` porque um processo pode ter mais de um
-- registro do mesmo marco; fica o mais recente.
--
-- A multa por descumprimento sai das somas de cliente e honorario e vai para
-- coluna propria: ela e devida, mas nao e o acordo (ver 20260825210000).
--
-- LICAO, para nao repetir: filtro que decide QUAIS linhas importam pertence ao
-- servidor. Filtrar no cliente depois de um select sem limite explicito e
-- apostar que o resultado cabe no teto — e quando nao cabe, o erro e silencioso.
--
-- REVERSAO:
--   drop view if exists public.vw_jm_conciliacao_acordos;
-- ============================================================================

create or replace view public.vw_jm_conciliacao_acordos as
with acordos as (
  select distinct on (m.board_id, m.process_id)
         m.board_id, m.process_id, m.data_detectada,
         lp.process_number as cnj, lp.title as titulo,
         regexp_replace(lp.process_number,'\D','','g') as cnj_num
    from public.process_pop_marcos m
    join public.lead_processes lp on lp.id = m.process_id
   where m.marco_chave = 'acordo_homologado'
     and lp.process_number is not null
   order by m.board_id, m.process_id, m.data_detectada desc
), somas as (
  select regexp_replace(coalesce(processo_cnj,''),'\D','','g') as cnj_num,
         sum(valor_caixa) filter (where categoria ilike 'indeniza%'
              and coalesce(observacao,'') !~* 'multa pelo descump')            as cliente,
         sum(valor_caixa) filter (where (categoria ilike 'honor%' or categoria ilike 'atrasado%')
              and coalesce(pessoa,'') <> 'HS'
              and coalesce(observacao,'') !~* 'multa pelo descump')            as hc,
         sum(valor_caixa) filter (where coalesce(pessoa,'') = 'HS')            as hs,
         sum(valor_caixa) filter (where coalesce(observacao,'') ~* 'multa pelo descump') as multa
    from public.jm_lancamentos
   group by 1
)
select a.board_id, a.process_id, a.cnj, a.titulo,
       a.data_detectada as data_acordo,
       coalesce(s.cliente, 0) as cliente,
       coalesce(s.hc, 0)      as hc,
       coalesce(s.hs, 0)      as hs,
       coalesce(s.multa, 0)   as multa
  from acordos a
  left join somas s on s.cnj_num = a.cnj_num;

comment on view public.vw_jm_conciliacao_acordos is
  'Uma linha por acordo homologado do POP, com os lancamentos ja somados por titular. Existe porque o front lia process_pop_marcos cru e o teto de 1000 linhas do PostgREST cortava o board de 2.708 marcos em 41 acordos de 91.';
