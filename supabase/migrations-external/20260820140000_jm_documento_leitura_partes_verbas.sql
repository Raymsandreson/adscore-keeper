-- =============================================================================
-- A leitura de peça passa a extrair valor POR PARTE e POR VERBA.
-- Banco alvo: EXTERNO kmedldlepwiityjsdahz. APLICADA em 20/08/2026.
--
-- POR QUE: o prompt v1 devolvia UM total de condenação. A carteira precisa saber
-- de QUEM é cada valor e de QUE verba ele veio — dano moral, dano estético, base
-- do pensionamento, horas extras, adicionais, retroativo. Um número global não
-- responde "quanto é do cliente e quanto é nosso", que é a pergunta da carteira.
--
-- O prompt v2 (`jm-ler-peca`) foi escrito a partir do que o Raym já usava à mão
-- para alimentar a planilha: uma linha por parte reclamante, só a parte
-- DISPOSITIVA da decisão, listas taxativas, e a regra de não completar com dado
-- de outra peça.
--
-- jsonb em vez de tabelas filhas: a lista de verbas é aberta por natureza (cada
-- ramo tem as suas, e a justiça comum tem retroativo que a trabalhista não tem).
-- Normalizar agora congelaria um vocabulário que ainda vai mudar — a primeira
-- rodada já mostrou que `PAIS` não serve quando a decisão nomeia mãe e pai
-- separadamente. Quando a régua estabilizar, vira tabela.
--
-- `prompt_versao` existe para poder comparar duas safras de leitura e saber o
-- que reprocessar quando o prompt mudar. Sem ela, leitura velha e nova ficam
-- indistinguíveis na mesma tabela.
--
-- REVERSÃO (aditiva, nenhum dado pré-existente é tocado):
--   drop index if exists public.idx_jm_doc_leitura_com_partes;
--   alter table public.jm_documento_leitura
--     drop column if exists partes,
--     drop column if exists processo,
--     drop column if exists cronograma,
--     drop column if exists prompt_versao;
-- =============================================================================

alter table public.jm_documento_leitura
  add column if not exists partes      jsonb,
  add column if not exists processo    jsonb,
  add column if not exists cronograma  jsonb,
  add column if not exists prompt_versao text;

comment on column public.jm_documento_leitura.partes is
  'Lista de partes autoras com suas verbas: [{nome, parentesco, nascimento, meses_pensionamento, verbas:[{tipo, descricao, valor, periodicidade}]}]. Vazia quando a peça não abre valor por parte.';
comment on column public.jm_documento_leitura.processo is
  'Dados do processo que a peça informa: decisao_tipo, forma_pagamento, hs_pct, termo_inicial_jcm, data_acidente, orgao_julgador, empresa_re, dados da vítima.';
comment on column public.jm_documento_leitura.cronograma is
  'Parcelas que a peça FIXA (acordo parcelado, pensão): [{n_parcela, data_prevista, valor, beneficiario}]. É promessa, não pagamento.';
comment on column public.jm_documento_leitura.prompt_versao is
  'Versão do prompt que produziu esta leitura. Sem isso não dá para comparar duas safras de leitura nem saber o que reprocessar.';

-- Achar rápido as leituras que trouxeram verba, que são as que alimentam a carteira.
create index if not exists idx_jm_doc_leitura_com_partes
  on public.jm_documento_leitura using gin (partes)
  where partes is not null;
