-- Vocabulário do livro-caixa por CATEGORIA (taxonomia do Raym, 13/07/2026) + fix Caso 203.
--
-- Problema: as views de pagamento (vw_jm_status_pagamento, vw_jm_conciliacao) tratavam
-- tipo='ENTRADA' como "recebido". Mas na planilha o que separa pago de futuro é a CATEGORIA:
--   Honorários / Indenização            = efetivamente recebido (realizado)
--   Honorários/Indenização "a receber"  = futuro; data < hoje => vencido
--   Honorários Adiantados Oriz          = recebido antecipado com deságio (soma no realizado, rastreável)
--   Honorários Adv Parceiro             = parte de advogado parceiro (fora da receita; relatório próprio p/ IR)
--   Indenização comprada                = cessão própria (planilha Prudencio Capital) — desconsiderada aqui
-- Com tipo=ENTRADA, ~R$2,2M de "a receber" e R$191k de "comprada" inflavam o realizado
-- (ex.: Caso 87 aparecia PAGO com R$262k de honorários A RECEBER).
--
-- Também: a cota do cliente (Indenização) não era ENTRADA, então pagamento de cliente era invisível
-- — Caso 203 ficava VENCIDO mesmo com as 4 parcelas pagas.
--
-- O que esta migration faz (3 views; tabelas intactas):
-- 1) vw_jm_caixa_classificado (NOVA): jm_lancamentos + coluna classe
--    (REALIZADO | REALIZADO_ORIZ | A_RECEBER | PARCEIRO | COMPRADA | OUTROS), por ILIKE na categoria
--    (tolera variações de grafia: "Adiantados oriz"/"Oriz", "Adv Parceiro"/"adv parceiro").
-- 2) vw_jm_status_pagamento: "pago" = classe REALIZADO/REALIZADO_ORIZ + parcelas confirmadas
--    (jm_pagamentos.valor_pago NOT NULL), sem dupla contagem (lançamento de parcela já confirmada não resoma).
-- 3) vw_jm_conciliacao: idem; novo status PAGA_CONFIRMADA quando valor_pago preenchido.
--
-- Pagamento confirmado (valor_pago) foi o gatilho escolhido de propósito: NÃO marca como paga a
-- parcela-fantasma do Caso 7 (RECEBIDA sem valor) — que segue pendente para o item #4 da fila.
--
-- Relatório do parceiro (IR):
--   SELECT * FROM vw_jm_caixa_classificado WHERE classe='PARCEIRO';
--
-- Rollback: restaurar as definições anteriores das 2 views (histórico no git) e
--   DROP VIEW vw_jm_caixa_classificado;
--
-- Banco: EXTERNO (kmedldlepwiityjsdahz). NÃO aplicar no Cloud.

CREATE OR REPLACE VIEW public.vw_jm_caixa_classificado AS
SELECT l.*,
  CASE
    WHEN l.categoria ILIKE '%comprada%'      THEN 'COMPRADA'
    WHEN l.categoria ILIKE '%adv%parceiro%'  THEN 'PARCEIRO'
    WHEN l.categoria ILIKE '%a receber%'     THEN 'A_RECEBER'
    WHEN l.categoria ILIKE 'honor%adiantad%' THEN 'REALIZADO_ORIZ'
    WHEN l.categoria ILIKE 'honor%'          THEN 'REALIZADO'
    WHEN l.categoria ILIKE 'indeniza%'       THEN 'REALIZADO'
    ELSE 'OUTROS'
  END AS classe
FROM public.jm_lancamentos l;

CREATE OR REPLACE VIEW public.vw_jm_status_pagamento AS
WITH ent AS (
  SELECT c.processo_cnj, sum(c.valor_caixa) AS pago
  FROM vw_jm_caixa_classificado c
  WHERE c.classe IN ('REALIZADO','REALIZADO_ORIZ') AND c.processo_cnj IS NOT NULL AND c.processo_cnj <> ''::text
    AND NOT EXISTS (
      SELECT 1 FROM jm_pagamentos pgc
      WHERE pgc.processo_cnj = c.processo_cnj AND pgc.valor_pago IS NOT NULL
        AND pgc.n_parcela = (CASE WHEN c.n_parcela ~ '^\d+$' THEN c.n_parcela::integer END))
  GROUP BY c.processo_cnj
), pagconf AS (
  SELECT jm_pagamentos.processo_cnj, sum(jm_pagamentos.valor_pago) AS pago_conf
  FROM jm_pagamentos WHERE jm_pagamentos.valor_pago IS NOT NULL
  GROUP BY jm_pagamentos.processo_cnj
), parc AS (
  SELECT pg.processo_cnj,
    count(*) AS n_parcelas,
    count(*) FILTER (WHERE pg.valor_pago IS NULL AND NOT (EXISTS (
       SELECT 1 FROM vw_jm_caixa_classificado l2
       WHERE l2.classe IN ('REALIZADO','REALIZADO_ORIZ') AND l2.processo_cnj = pg.processo_cnj
         AND pg.n_parcela = (CASE WHEN l2.n_parcela ~ '^\d+$' THEN l2.n_parcela::integer END)))) AS abertas,
    sum(pg.valor_previsto) FILTER (WHERE pg.valor_pago IS NULL AND NOT (EXISTS (
       SELECT 1 FROM vw_jm_caixa_classificado l2
       WHERE l2.classe IN ('REALIZADO','REALIZADO_ORIZ') AND l2.processo_cnj = pg.processo_cnj
         AND pg.n_parcela = (CASE WHEN l2.n_parcela ~ '^\d+$' THEN l2.n_parcela::integer END)))) AS a_receber
  FROM jm_pagamentos pg GROUP BY pg.processo_cnj
)
SELECT p.processo_cnj,
  COALESCE(e.pago, 0::numeric) + COALESCE(pcf.pago_conf, 0::numeric) AS pago,
  COALESCE(pc.a_receber, 0::numeric) AS a_receber,
  CASE
    WHEN COALESCE(pc.abertas, 0::bigint) = 0 AND (COALESCE(pc.n_parcelas, 0::bigint) > 0 OR COALESCE(e.pago, 0::numeric) + COALESCE(pcf.pago_conf,0::numeric) > 0::numeric) THEN 'PAGO_TOTAL'::text
    WHEN COALESCE(e.pago, 0::numeric) + COALESCE(pcf.pago_conf,0::numeric) > 0::numeric THEN 'EM_PAGAMENTO'::text
    ELSE 'NAO_RECEBIDO'::text
  END AS status_pagamento
FROM jm_processos p
  LEFT JOIN ent e USING (processo_cnj)
  LEFT JOIN pagconf pcf USING (processo_cnj)
  LEFT JOIN parc pc USING (processo_cnj);

CREATE OR REPLACE VIEW public.vw_jm_conciliacao AS
WITH npartes AS (
  SELECT jm_pagamentos.processo_cnj,
    count(DISTINCT jm_pagamentos.parte_id) AS n_partes,
    count(DISTINCT jm_pagamentos.parte_id) > 1 AS multi_parte
  FROM jm_pagamentos GROUP BY jm_pagamentos.processo_cnj
), cobertura AS (
  SELECT min(jm_lancamentos.data) AS inicio FROM jm_lancamentos WHERE jm_lancamentos.data IS NOT NULL
)
SELECT p.id, p.processo_cnj, p.parte_id, p.cliente, p.n_parcela, p.data_prevista, p.valor_previsto, p.valor_origem, p.acordo_id,
  CASE
    WHEN p.valor_pago IS NOT NULL THEN 'PAGA_CONFIRMADA'::text
    WHEN (EXISTS ( SELECT 1 FROM vw_jm_caixa_classificado l
       WHERE l.classe IN ('REALIZADO','REALIZADO_ORIZ') AND l.processo_cnj = p.processo_cnj AND l.n_parcela ~ '^\d+$'::text AND l.n_parcela::integer = p.n_parcela
         AND (p.valor_origem IS DISTINCT FROM 'CONTRATUAL'::text OR l.valor_caixa >= (p.valor_previsto * 0.5) AND l.valor_caixa <= (p.valor_previsto * np.n_partes::numeric * 1.5)))) THEN
      CASE WHEN np.multi_parte THEN 'PAGA_PROVAVEL_AMBIGUA'::text ELSE 'PAGA_CASADA'::text END
    WHEN p.valor_origem = 'CONTRATUAL'::text AND (EXISTS ( SELECT 1 FROM vw_jm_caixa_classificado l
       WHERE l.classe IN ('REALIZADO','REALIZADO_ORIZ') AND l.processo_cnj = p.processo_cnj AND l.n_parcela ~ '^\d+$'::text AND l.n_parcela::integer = p.n_parcela)) THEN 'ENTRADA_DE_OUTRO_FLUXO'::text
    WHEN p.data_prevista IS NULL THEN 'SEM_DATA_PREVISTA'::text
    WHEN p.data_prevista < (( SELECT cobertura.inicio FROM cobertura)) THEN 'ANTERIOR_COBERTURA_CAIXA'::text
    WHEN p.data_prevista >= CURRENT_DATE THEN 'A_VENCER'::text
    WHEN (EXISTS ( SELECT 1 FROM vw_jm_caixa_classificado l
       WHERE l.classe IN ('REALIZADO','REALIZADO_ORIZ') AND l.processo_cnj = p.processo_cnj AND (l.n_parcela = ''::text OR l.n_parcela !~ '^\d+$'::text) AND l.data >= (p.data_prevista - 45) AND l.data <= (p.data_prevista + 45))) THEN 'POSSIVEL_PAGA_SEM_VINCULO'::text
    ELSE 'VENCIDA_SEM_ENTRADA'::text
  END AS situacao
FROM jm_pagamentos p JOIN npartes np USING (processo_cnj);

-- Registro do acordo do Caso 203 (executado 13/07/2026, idempotente):
--   jm_acordos id=5: INTERCAST S/A, homologacao 2024-11-12 (jm_decisoes D0295),
--   valor_total 80000 (bruto), 4 parcelas; clausulas: honorarios 30% = 24000, cota cliente 56000.
--   jm_pagamentos (4 parcelas Maria Augusta): acordo_id=5, valor_previsto 14000,
--   valor_pago 14000, data_recebida = data_prevista (27/11/24 a 27/02/25) — confirmadas pelo Raym.
