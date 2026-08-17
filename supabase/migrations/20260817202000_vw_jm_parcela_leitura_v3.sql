-- =============================================================================
-- v3 (17/08/2026): a régua do dinheiro passa a CONSUMIR a leitura das peças.
--
-- A v2 decidia por movimento do DataJud e por TÍTULO de documento
-- (`titulo ~* 'idpj|desconsider'`). Com as 232 peças lidas por `jm-ler-peca`,
-- existe agora o que a peça DIZ, não só como ela se chama — e casar por título é
-- exatamente a armadilha que já custou caro aqui (medido: das 18 peças com
-- "comprovante/alvará" no título, a maioria é comprovante de RESIDÊNCIA, de
-- POSTAGEM e AR dos Correios).
--
-- Precedência, do fato mais forte para o mais fraco:
--   PAGO                     lançamento conciliado (fato contábil)
--   A_RECEBER                parcela ainda no futuro
--   PAGO_LIDO                peça de comprovante/alvará/extinção por quitação
--   INADIMPLENCIA_LIDA       peça em que o exequente noticia descumprimento
--   QUITADO_PRESUMIDO        movimento 196/22 posterior ao vencimento
--   INADIMPLENCIA_CONFIRMADA título de IDPJ/desconsideração (regra da v2, mantida
--                            como rede: pega processo cuja peça ainda não foi lida)
--   PRECISA_LER              resto
--
-- HEURÍSTICA DE CUSTAS, e o risco dela: "intimado a comprovar o recolhimento das
-- custas" é inadimplência do PROCESSO, não da parcela do cliente — 2 dos 5
-- processos que a IA marcou como inadimplentes falam só disso. A peça é
-- descartada quando o resumo fala de custas/IR e NÃO fala de acordo, parcela,
-- IDPJ, desconsideração ou penhora. É casamento por texto, com a fragilidade que
-- isso tem: vale para desqualificar, nunca para classificar sozinho. O processo
-- 0000249-26.2020.5.14.0004 continua inadimplente porque as OUTRAS duas peças
-- dele noticiam descumprimento de acordo.
--
-- Efeito medido: INADIMPLENCIA 15 → 30 parcelas; PRECISA_LER 297 → 282. O valor
-- de PRECISA_LER não muda (R$ 583.622,06) porque as 15 parcelas que saíram têm
-- valor_previsto nulo.
-- =============================================================================
create or replace view public.vw_jm_parcela_leitura as
with lanc as (
  select parte_id, n_parcela::integer as parcela,
         sum(valor_caixa) as valor_lancado, min(data) as data_lancamento
  from jm_lancamentos
  where parte_id is not null
    -- 'INDENIZAÇÃO' exato: `ilike 'indeniza%'` pegava "Indenização a receber" e
    -- fazia o caso 88 sair com 11 parcelas pagas que não existiam.
    and upper(trim(both from categoria)) = 'INDENIZAÇÃO'
    and n_parcela ~ '^[0-9]+$'
  group by 1, 2
),
peca as (
  select regexp_replace(l.processo_cnj, '\D', '', 'g') as cnj_num,
         l.especie, l.inadimplencia, l.resumo,
         coalesce(l.data_evento, d.data_documento) as quando
  from jm_documento_leitura l
  join jm_documentos d on d.id = l.documento_id
)
select pg.id as pagamento_id,
  pg.processo_cnj,
  regexp_replace(pg.processo_cnj, '\D', '', 'g') as cnj_num,
  pg.parte_id,
  pg.cliente,
  pg.n_parcela,
  pg.data_prevista,
  pg.status as status_planilha,
  pg.valor_previsto,
  l.valor_lancado,
  l.data_lancamento,
  case
    when l.parte_id is not null then 'PAGO'
    when pg.data_prevista > current_date then 'A_RECEBER'
    when exists (
      select 1 from peca p
      where p.cnj_num = regexp_replace(pg.processo_cnj, '\D', '', 'g')
        and p.especie in ('COMPROVANTE_PAGAMENTO','ALVARA','EXTINCAO_QUITACAO')
        and coalesce(p.quando, current_date) >= pg.data_prevista
    ) then 'PAGO_LIDO'
    when exists (
      select 1 from peca p
      where p.cnj_num = regexp_replace(pg.processo_cnj, '\D', '', 'g')
        and p.inadimplencia
        and not (p.resumo ~* 'custas|imposto de renda'
                 and p.resumo !~* 'acordo|parcela|IDPJ|desconsider|penhora')
        and coalesce(p.quando, current_date) > pg.data_prevista
    ) then 'INADIMPLENCIA_LIDA'
    when exists (
      select 1 from jm_movimentos m
      where regexp_replace(m.processo_cnj, '\D', '', 'g') = regexp_replace(pg.processo_cnj, '\D', '', 'g')
        and m.codigo = any (array[196, 22])
        and m.data_hora::date > pg.data_prevista
    ) then 'QUITADO_PRESUMIDO'
    when exists (
      select 1 from jm_documentos d
      where regexp_replace(d.processo_cnj, '\D', '', 'g') = regexp_replace(pg.processo_cnj, '\D', '', 'g')
        and d.titulo ~* 'idpj|desconsider'
        and coalesce(d.data_documento, current_date) > pg.data_prevista
    ) then 'INADIMPLENCIA_CONFIRMADA'
    else 'PRECISA_LER'
  end as leitura,
  case
    when l.parte_id is not null then 'lançamento conciliado'
    when pg.data_prevista > current_date then 'parcela futura'
    else 'ver coluna leitura'
  end as base_da_leitura
from jm_pagamentos pg
left join lanc l on l.parte_id = pg.parte_id and l.parcela = pg.n_parcela;
