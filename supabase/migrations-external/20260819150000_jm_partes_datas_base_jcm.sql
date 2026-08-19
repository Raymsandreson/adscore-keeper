-- =============================================================================
-- Datas-base da correção monetária, por parte. Banco alvo: EXTERNO kmedldlepwiityjsdahz.
--
-- POR QUE: a atualização de um crédito não começa numa data só. Ela começa no
-- TERMO INICIAL DOS JCM (juros e correção monetária), que a aba Tab. Aux já
-- guarda em 827 das 1.030 linhas — exatamente as que têm valor. Sem essa coluna
-- no banco, o sistema corrigia tudo por uma competência única e não tinha como
-- responder "desde quando este crédito corre".
--
-- Foi omissão da importação anterior (20260818230500), não ausência de dado.
--
-- 26 linhas trazem ano 1899: é a data zerada do Google Sheets (valor 0 formatado
-- como data), não uma data de 1899. Entram como NULL — data que não existe é
-- pior que data ausente, porque ninguém desconfia dela.
--
-- REVERSÃO (aditiva, sem perda de dado pré-existente):
--   drop index if exists public.idx_jm_partes_termo_inicial;
--   alter table public.jm_partes
--     drop column if exists termo_inicial_jcm,
--     drop column if exists ultima_decisao_jcm,
--     drop column if exists decisao_merito;
-- =============================================================================

alter table public.jm_partes
  add column if not exists termo_inicial_jcm  date,
  add column if not exists ultima_decisao_jcm date,
  add column if not exists decisao_merito     text;

comment on column public.jm_partes.termo_inicial_jcm is
  'Termo inicial dos juros e da correção monetária. É a data-base do cálculo: '
  'a correção corre daqui até a referência. Vem de "TERMO INICIAL DOS JCM" da Tab. Aux.';
comment on column public.jm_partes.ultima_decisao_jcm is
  'Data da última decisão que reabriu/atualizou o termo inicial.';
comment on column public.jm_partes.decisao_merito is
  'Estágio da decisão de mérito como está na planilha (texto livre: "EMBARGOS 2º GRAU", etc).';

-- Filtro de quem tem data-base: é por aí que a atualização varre a carteira.
create index if not exists idx_jm_partes_termo_inicial
  on public.jm_partes (termo_inicial_jcm)
  where termo_inicial_jcm is not null;
