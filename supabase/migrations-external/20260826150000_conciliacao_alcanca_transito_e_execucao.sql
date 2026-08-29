-- ============================================================================
-- RUN IN: Supabase EXTERNO (kmedldlepwiityjsdahz) — NAO no Cloud
-- ============================================================================
-- APLICADA em 26/08/2026.
-- ============================================================================
-- O Raym: "deveria aparecer tambem os processos que transitaram em julgado ou
-- que estao em execucao, pq isso impacta e normalmente o Escavador nao pega as
-- pecas que informam os valores de cada parte e honorarios respectivos".
--
-- O motivo e o certo, e e o mesmo que fez o caso 88 mentir por meses: nesses
-- estagios o valor por parte JA EXISTE nos autos — na planilha de liquidacao
-- homologada, nos calculos da execucao — mas mora em peca RESTRITA. O acervo
-- publico traz a sentenca e o despacho; nao traz a planilha que diz quanto cada
-- parte recebe.
--
-- Sao justamente os processos onde a carteira tem mais chance de estar errada e
-- ninguem sabe: ha decisao, ha valor, e o valor lancado nunca foi conferido
-- contra documento nenhum.
--
-- ESCOPO NOVO: acordo homologado, liquidacao, transito em julgado, execucao
-- iniciada. Medido no POP "Trabalhistas judicial — marcos":
--
--   estagio      processos   com cota lancada
--   TRANSITO           104                 10
--   EXECUCAO            89                 41
--   ACORDO              42                 17
--   total              235                 68
--
-- Ou seja: 167 dos 235 nao tem cota lancada. Nao e ruido — e o tamanho real do
-- que nunca foi conferido.
--
-- `estagio` guarda o mais avancado, e execucao vem primeiro na escada porque e
-- onde o valor por parte ja esta calculado nos autos.
--
-- A tela agrupa em tres: "precisam de conferencia" (aberto), "sem cota" e
-- "conferem" (recolhidos). Sem isso os 167 sem cota, que mostram R$ 0,00 de
-- diferenca, afundariam os que pedem acao.
--
-- REVERSAO: recriar a view com `where m.marco_chave = 'acordo_homologado'`
-- apenas, e sem as colunas tem_* / estagio.
-- ============================================================================

drop view if exists public.vw_jm_conciliacao_acordos;

create view public.vw_jm_conciliacao_acordos as
with alvo as (
  select m.board_id, m.process_id,
         bool_or(m.marco_chave='acordo_homologado') as tem_acordo,
         bool_or(m.marco_chave='liquidacao')        as tem_liquidacao,
         bool_or(m.marco_chave='transito_julgado')  as tem_transito,
         bool_or(m.marco_chave='execucao_iniciada') as tem_execucao,
         max(m.data_detectada) filter (where m.marco_chave='acordo_homologado') as data_acordo,
         max(m.data_detectada) as data_marco
    from public.process_pop_marcos m
   where m.marco_chave in ('acordo_homologado','liquidacao','transito_julgado','execucao_iniciada')
   group by m.board_id, m.process_id
), somas as (
  select regexp_replace(coalesce(processo_cnj,''),'\D','','g') as cnj_num,
         sum(valor_caixa) filter (where categoria ilike 'indeniza%'
              and coalesce(observacao,'') !~* 'multa pelo descump')            as cliente,
         sum(valor_caixa) filter (where (categoria ilike 'honor%' or categoria ilike 'atrasado%')
              and coalesce(pessoa,'') <> 'HS'
              and coalesce(observacao,'') !~* 'multa pelo descump')            as hc,
         sum(valor_caixa) filter (where coalesce(pessoa,'') = 'HS')            as hs,
         sum(valor_caixa) filter (where coalesce(observacao,'') ~* 'multa pelo descump') as multa
    from public.jm_lancamentos group by 1
)
select a.board_id, a.process_id, lp.process_number as cnj, lp.title as titulo,
       coalesce(a.data_acordo, a.data_marco) as data_acordo,
       a.tem_acordo, a.tem_liquidacao, a.tem_transito, a.tem_execucao,
       -- Execução primeiro: é onde o valor por parte já está calculado nos autos.
       case when a.tem_execucao then 'EXECUCAO'
            when a.tem_transito then 'TRANSITO'
            when a.tem_acordo   then 'ACORDO'
            else 'LIQUIDACAO' end as estagio,
       coalesce(s.cliente, 0) as cliente,
       coalesce(s.hc, 0)      as hc,
       coalesce(s.hs, 0)      as hs,
       coalesce(s.multa, 0)   as multa
  from alvo a
  join public.lead_processes lp on lp.id = a.process_id and lp.process_number is not null
  left join somas s on s.cnj_num = regexp_replace(lp.process_number,'\D','','g');

comment on view public.vw_jm_conciliacao_acordos is
  'Uma linha por processo com valor a conferir: acordo homologado, liquidacao, transito em julgado ou execucao iniciada. Trazidos juntos a pedido do Raym (26/08): nesses estagios o valor por parte esta na planilha de liquidacao ou nos calculos da execucao, que sao peca restrita e o Escavador raramente traz.';
