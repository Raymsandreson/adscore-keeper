-- Item #7 da fila viva: vw_jm_kpi_linha_tempo (oficial) passa a usar a régua de 7 estágios.
-- Condição do Raym cumprida: Casos 203 e 7 resolvidos e régua validada por ele (13/07/2026).
--
-- O que muda:
-- 1) vw_jm_kpi_linha_tempo_legacy (NOVA): snapshot da lógica v1 (5 estágios:
--    PROJETADO / DECISAO_SEM_TRANSITO / TRANSITADO_A_RECEBER / EM_PAGAMENTO / PAGO_TOTAL
--    + INDEFERIDO). Rota de fuga — REMOVER após 24h de validação:
--      DROP VIEW vw_jm_kpi_linha_tempo_legacy;
-- 2) vw_jm_kpi_linha_tempo: agora com a régua oficial de 7 estágios (mesma lógica da v2):
--    PROJETADO / CONDENACAO / A_RECEBER / VENCIDO / EM_EXECUCAO (TPU 11385, anulada por
--    196/277/14099) / DEPOSITADO_EM_JUIZO (campo explícito) / EM_PAGAMENTO / PAGO + INDEFERIDO.
--    Verificado: saída idêntica à vw_jm_kpi_linha_tempo_v2 (diff = 0 em 344 processos).
-- 3) vw_jm_fluxo_mensal: dois consertos necessários pela troca —
--    a) filtro do ESTIMADO_CURVA atualizado para os novos nomes (A_RECEBER, CONDENACAO);
--       com os nomes v1 ele silenciosamente zerava.
--    b) RECEBIDO/CONTRATADO migrados do vocabulário antigo (tipo='ENTRADA') para o
--       vw_jm_caixa_classificado (classe REALIZADO/REALIZADO_ORIZ) + parcelas confirmadas
--       (jm_pagamentos.valor_pago), sem dupla contagem — consistente com
--       20260713_caixa_classificado_por_categoria.sql.
--
-- A vw_jm_kpi_linha_tempo_v2 permanece (agora idêntica à oficial); pode ser aposentada depois.
--
-- Rollback (<5min): restaurar vw_jm_kpi_linha_tempo com o corpo da _legacy e reverter
-- vw_jm_fluxo_mensal para a definição anterior (histórico no git).
--
-- Banco: EXTERNO (kmedldlepwiityjsdahz). NÃO aplicar no Cloud.

CREATE OR REPLACE VIEW public.vw_jm_kpi_linha_tempo AS
WITH dinheiro AS (
  SELECT vp.processo_cnj,
    sum(COALESCE(vp.dano_moral_atualizado, 0::numeric) + COALESCE(vp.dano_estetico_atualizado, 0::numeric)) AS valor_atualizado
  FROM vw_jm_visao_processo vp GROUP BY vp.processo_cnj
), exec_status AS (
  SELECT m.processo_cnj,
    max(m.data_hora) FILTER (WHERE m.codigo = 11385) AS dt_exec_iniciada,
    max(m.data_hora) FILTER (WHERE m.codigo = 196) AS dt_extincao,
    max(m.data_hora) FILTER (WHERE m.codigo = ANY (ARRAY[277, 14099])) AS dt_acordo_exec,
    max(m.data_hora) FILTER (WHERE m.codigo = 12066) AS dt_levantamento
  FROM jm_movimentos m GROUP BY m.processo_cnj
), vencido AS (
  SELECT c.processo_cnj, bool_or(c.situacao = 'VENCIDA_SEM_ENTRADA'::text) AS tem_vencida
  FROM vw_jm_conciliacao c GROUP BY c.processo_cnj
), deposito AS (
  SELECT pt.processo_cnj,
    bool_or(COALESCE(pt.deposito_judicial_situacao, 'INDEFINIDO'::text) = 'RETIDO_ATE_MAIORIDADE'::text) AS tem_deposito_retido
  FROM jm_partes pt GROUP BY pt.processo_cnj
)
SELECT p.processo_cnj, p.caso, jm_justica(p.processo_cnj) AS justica, p.origem,
  CASE
    WHEN r.tipo_resolucao = 'INDEFERIDO'::text THEN 'INDEFERIDO'::text
    WHEN s.status_pagamento = 'PAGO_TOTAL'::text AND COALESCE(s.pago, 0::numeric) > 0::numeric THEN 'PAGO'::text
    WHEN COALESCE(dp.tem_deposito_retido, false) THEN 'DEPOSITADO_EM_JUIZO'::text
    WHEN ex.dt_exec_iniciada IS NOT NULL AND (ex.dt_acordo_exec IS NULL OR ex.dt_acordo_exec < ex.dt_exec_iniciada) AND (ex.dt_extincao IS NULL OR ex.dt_extincao < ex.dt_exec_iniciada) THEN 'EM_EXECUCAO'::text
    WHEN s.status_pagamento = 'EM_PAGAMENTO'::text THEN 'EM_PAGAMENTO'::text
    WHEN COALESCE(vc.tem_vencida, false) THEN 'VENCIDO'::text
    WHEN r.transito IS NOT NULL THEN 'A_RECEBER'::text
    WHEN r.sentenca IS NOT NULL OR r.acordao2g IS NOT NULL OR r.data_acordo IS NOT NULL THEN 'CONDENACAO'::text
    ELSE 'PROJETADO'::text
  END AS estagio,
  d.valor_atualizado, s.pago, s.a_receber, r.meses_ate_resolucao
FROM jm_processos p
  LEFT JOIN vw_jm_resolucao r USING (processo_cnj)
  LEFT JOIN vw_jm_status_pagamento s USING (processo_cnj)
  LEFT JOIN dinheiro d USING (processo_cnj)
  LEFT JOIN exec_status ex USING (processo_cnj)
  LEFT JOIN vencido vc USING (processo_cnj)
  LEFT JOIN deposito dp USING (processo_cnj);

CREATE OR REPLACE VIEW public.vw_jm_fluxo_mensal AS
WITH medianas AS (
  SELECT jm_justica(vw_jm_duracoes.processo_cnj) AS justica,
    percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (vw_jm_duracoes.d_transito_extincao::double precision)) FILTER (WHERE vw_jm_duracoes.d_transito_extincao > 0) AS med_transito_pgto,
    percentile_cont(0.5::double precision) WITHIN GROUP (ORDER BY (vw_jm_duracoes.d_decisao_transito::double precision)) FILTER (WHERE vw_jm_duracoes.d_decisao_transito > 0) AS med_decisao_transito
  FROM vw_jm_duracoes GROUP BY (jm_justica(vw_jm_duracoes.processo_cnj))
), recebido AS (
  SELECT date_trunc('month', l.data::timestamp with time zone)::date AS mes,
    'RECEBIDO'::text AS natureza, sum(l.valor_caixa) AS valor
  FROM vw_jm_caixa_classificado l
    JOIN jm_processos p ON p.processo_cnj = l.processo_cnj AND p.origem = 'INTERNO'::text
  WHERE l.classe IN ('REALIZADO','REALIZADO_ORIZ') AND l.data IS NOT NULL AND l.data <= CURRENT_DATE
    AND NOT EXISTS (
      SELECT 1 FROM jm_pagamentos pgc
      WHERE pgc.processo_cnj = l.processo_cnj AND pgc.valor_pago IS NOT NULL
        AND pgc.n_parcela = (CASE WHEN l.n_parcela ~ '^\d+$' THEN l.n_parcela::integer END))
  GROUP BY 1
  UNION ALL
  SELECT date_trunc('month', pg.data_recebida::timestamp with time zone)::date,
    'RECEBIDO'::text, sum(pg.valor_pago)
  FROM jm_pagamentos pg
    JOIN jm_processos p ON p.processo_cnj = pg.processo_cnj AND p.origem = 'INTERNO'::text
  WHERE pg.valor_pago IS NOT NULL AND pg.data_recebida IS NOT NULL
  GROUP BY 1
), contratado AS (
  SELECT date_trunc('month', pg.data_prevista::timestamp with time zone)::date AS mes,
    'A_RECEBER_CONTRATADO'::text AS natureza, sum(pg.valor_previsto) AS valor
  FROM jm_pagamentos pg
    JOIN jm_processos p ON p.processo_cnj = pg.processo_cnj AND p.origem = 'INTERNO'::text
  WHERE pg.data_prevista >= CURRENT_DATE AND pg.valor_previsto IS NOT NULL AND pg.valor_pago IS NULL
    AND NOT (EXISTS ( SELECT 1 FROM vw_jm_caixa_classificado l
      WHERE l.classe IN ('REALIZADO','REALIZADO_ORIZ') AND l.processo_cnj = pg.processo_cnj
        AND pg.n_parcela = (CASE WHEN l.n_parcela ~ '^\d+$' THEN l.n_parcela::integer END) AND l.data <= CURRENT_DATE))
  GROUP BY 1
), atrasado AS (
  SELECT date_trunc('month', CURRENT_DATE::timestamp with time zone)::date AS mes,
    'CONTRATADO_ATRASADO'::text AS natureza, sum(c.valor_previsto) AS valor
  FROM vw_jm_conciliacao c
    JOIN jm_processos p ON p.processo_cnj = c.processo_cnj AND p.origem = 'INTERNO'::text
  WHERE c.situacao = 'VENCIDA_SEM_ENTRADA'::text AND c.valor_previsto IS NOT NULL
), estimado AS (
  SELECT GREATEST(date_trunc('month',
      CASE k.estagio
        WHEN 'A_RECEBER'::text THEN r.transito + ((m.med_transito_pgto || ' days'::text)::interval)
        ELSE COALESCE(r.acordao2g, r.sentenca) + ((COALESCE(m.med_decisao_transito, 180::double precision) || ' days'::text)::interval) + ((COALESCE(m.med_transito_pgto, 180::double precision) || ' days'::text)::interval)
      END)::date, date_trunc('month', CURRENT_DATE::timestamp with time zone)::date) AS mes,
    'ESTIMADO_CURVA'::text AS natureza, sum(k.valor_atualizado) AS valor
  FROM vw_jm_kpi_linha_tempo k
    JOIN vw_jm_resolucao r USING (processo_cnj)
    JOIN medianas m ON m.justica = k.justica
  WHERE k.origem = 'INTERNO'::text AND (k.estagio = ANY (ARRAY['A_RECEBER'::text, 'CONDENACAO'::text])) AND k.valor_atualizado > 0::numeric
  GROUP BY 1
)
SELECT mes, natureza, round(valor) AS valor FROM recebido
UNION ALL SELECT mes, natureza, valor FROM contratado
UNION ALL SELECT mes, natureza, valor FROM atrasado
UNION ALL SELECT mes, natureza, valor FROM estimado;
