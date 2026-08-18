-- =============================================================================
-- jm_partes ganha o VALOR de cada parte: condenação, cota do cliente e honorário.
-- Banco alvo: Supabase EXTERNO kmedldlepwiityjsdahz.
--
-- DE ONDE VEM: aba "Tab. Aux" da planilha Jurimetria/indenização — uma linha por
-- PARTE (1.028 em 18/08/2026, 287 processos), com a condenação já corrigida e o
-- honorário calculado na mesma linha. É a fonte que responde "quanto é do
-- cliente e quanto é nosso", pergunta que o app vinha remendando desde 15/08.
--
-- O caso 10 (0000408-22.2017.5.22.0110) mostra o que isso destrava — cada uma
-- das 7 partes, na planilha:
--     condenação R$ 28.571,43 = cota R$ 20.000,00 + honorário contratual
--     R$ 8.571,43
-- Nenhum desses três números existia no banco: `jm_valores` só tinha o dano
-- moral (28.571,43) e `hs_pct` zerado.
--
-- POR QUE EM `jm_partes` E NÃO EM `jm_valores`: granularidade. `jm_valores` é uma
-- linha por (DECISÃO × parte) com valor NOMINAL — a mesma parte aparece na
-- sentença e nos embargos, e é por isso que somar aquilo direto infla ~2,6x.
-- A Tab. Aux é uma linha por PARTE, com o valor VIGENTE já corrigido. Essa é a
-- granularidade de `jm_partes` (1.222 linhas, uma por parte), então é ali que
-- cabe sem inventar tabela nem duplicar chave.
--
-- SNAPSHOT, NÃO CÁLCULO: os valores vêm corrigidos pela planilha até a data que
-- ELA usou. O app NÃO recalcula em cima disto (a correção viva continua sendo a
-- de `jm_indices`, aplicada sobre o nominal). `valores_importados_em` diz de
-- quando é a foto — sem isso, número velho vira número errado sem aviso.
--
-- REVERSÃO: alter table public.jm_partes
--             drop column condenacao_cjcm, drop column cota_parte_cjcm, ...
-- =============================================================================

alter table public.jm_partes
  add column if not exists condenacao_cjcm       numeric,
  add column if not exists cota_parte_cjcm       numeric,
  add column if not exists cota_parte_vista_cjcm numeric,
  add column if not exists hc_vista              numeric,
  add column if not exists hc_parcelado          numeric,
  add column if not exists hs                    numeric,
  add column if not exists status_pagamento      text,
  add column if not exists fase_atual            text,
  add column if not exists valores_importados_em timestamptz;

comment on column public.jm_partes.condenacao_cjcm is
  'Tab. Aux: TOTAL DA CONDENACAO CJCM — o que o processo vale para esta parte, ja corrigido pela planilha. Cota do cliente + honorarios.';
comment on column public.jm_partes.cota_parte_cjcm is
  'Tab. Aux: TOTAL PARTE CJCM — a cota liquida do CLIENTE, corrigida. Nao e receita do escritorio.';
comment on column public.jm_partes.cota_parte_vista_cjcm is
  'Tab. Aux: TOTAL A VISTA PARTE CJCM — a parte da cota do cliente paga a vista.';
comment on column public.jm_partes.hc_vista is
  'Tab. Aux: HONORARIOS CONTRATUAIS A VISTA — do escritorio.';
comment on column public.jm_partes.hc_parcelado is
  'Tab. Aux: HONORARIOS CONTRATUAIS PARCELADO — do escritorio.';
comment on column public.jm_partes.hs is
  'Tab. Aux: HONORARIOS SUCUMBENCIAIS — do escritorio.';
comment on column public.jm_partes.status_pagamento is
  'Tab. Aux: Status Pagamento (Pago / A receber / Projetado / Perdido). Normalizado em MAIUSCULA na importacao: a planilha mistura "Projetado" e "PROJETADO" e agrupar por texto cru partia a contagem em duas.';
comment on column public.jm_partes.fase_atual is
  'Tab. Aux: Fase Atual (ex. "Recurso Instancia Superior", "CONCLUSAO").';
comment on column public.jm_partes.valores_importados_em is
  'Quando estes valores foram trazidos da planilha. Eles ja vem CORRIGIDOS pela data que a planilha usou — o app nao recalcula em cima. Numero velho sem data vira numero errado sem aviso.';

-- A carteira e o extrato filtram por parte com valor; indice parcial porque a
-- maioria das linhas continua sem (1.222 partes, 1.028 com valor hoje).
create index if not exists idx_jm_partes_com_valor
  on public.jm_partes (processo_cnj)
  where condenacao_cjcm is not null;
