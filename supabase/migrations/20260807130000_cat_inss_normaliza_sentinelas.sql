-- =============================================================================
-- Normaliza sentinelas de ausencia que a carga de 619.529 registros deixou
-- entrar como texto, e corrige um comentario que estava errado.
--
-- O QUE ESCAPOU, e por que (medido em 07/08/2026, sobre a base ja carregada):
--
--   municipio_empregador_nome = 'Ignorado'    19.658
--   uf_empregador             = 'Zerado'      19.629
--   municipio_empregador_nome = '{ñ Class}'      170
--   cbo_descricao             = 'Não Informado'    4  (cbo_codigo "0000000")
--   -----------------------------------------------------------------
--   linhas distintas afetadas                 19.832  (3,2% da base)
--
-- Duas causas distintas no normalizador do scripts/import-cat-inss.mjs:
--
--   1. A comparacao com a lista de sentinelas era sensivel a caixa. O arquivo de
--      janeiro manda "{ñ class}" e os de 202506+ mandam "{ñ Class}" — mesmo
--      sentinela, C maiusculo. Passaram 170.
--   2. "Zerado" (UF) e "Ignorado" (municipio) sequer estavam na lista: so
--      aparecem a partir de 202506, sempre na tripla "000000-Ignorado" + UF
--      "Zerado". O arquivo de janeiro, usado para desenhar o layout, nao tem
--      nenhuma ocorrencia.
--
-- Por que nao e cosmetico: "Zerado" nao e um valor ausente que o SQL ignora, e
-- uma string que entra em group by. Num ranking de UF ele aparece com 19.629
-- linhas, entre Santa Catarina (41.313) e Bahia (16.980) — a setima "UF" do
-- pais. Qualquer analise por regiao sai errada e parece certa.
--
-- As 29 linhas com IBGE "000000" e UF real (Sao Paulo 9, Bahia 4, ...) mantem a
-- UF: ali so a localizacao fina se perdeu. Idem as 170 de "{ñ Class}", que ja
-- vieram com IBGE nulo e UF valida.
--
-- CORRECAO DE DOCUMENTACAO: 20260807120000 registrou que data_afastamento vinha
-- morta, medido nos 7.276/7.276 de 202501. Isso vale so para 202501-202505 (os
-- recortes parciais). A partir de 202506 vem preenchida em 99,3-99,6% das
-- linhas — 544.297 no total. O campo que continua morto e
-- data_despacho_beneficio: 15 linhas em 619.529.
--
-- ROLLBACK (testado, ~19.832 linhas):
--   update public.cat_inss_registros r
--      set uf_empregador = b.uf_empregador,
--          municipio_empregador_ibge = b.municipio_empregador_ibge,
--          municipio_empregador_nome = b.municipio_empregador_nome,
--          cbo_codigo = b.cbo_codigo,
--          cbo_descricao = b.cbo_descricao
--     from public.cat_inss_sentinelas_bkp_20260807 b
--    where r.id = b.id;
-- =============================================================================

-- Rota de fuga: snapshot das 5 colunas tocadas, so nas linhas afetadas.
create table if not exists public.cat_inss_sentinelas_bkp_20260807 as
select id,
       uf_empregador,
       municipio_empregador_ibge,
       municipio_empregador_nome,
       cbo_codigo,
       cbo_descricao
  from public.cat_inss_registros
 where uf_empregador = 'Zerado'
    or municipio_empregador_nome in ('Ignorado', '{ñ Class}')
    or municipio_empregador_ibge ~ '^0+$'
    or cbo_codigo ~ '^0+$'
    or cbo_descricao = 'Não Informado';

alter table public.cat_inss_sentinelas_bkp_20260807 enable row level security;

update public.cat_inss_registros
   set uf_empregador = null
 where uf_empregador = 'Zerado';

update public.cat_inss_registros
   set municipio_empregador_nome = null
 where municipio_empregador_nome in ('Ignorado', '{ñ Class}');

update public.cat_inss_registros
   set municipio_empregador_ibge = null
 where municipio_empregador_ibge ~ '^0+$';

update public.cat_inss_registros
   set cbo_codigo = null,
       cbo_descricao = null
 where cbo_codigo ~ '^0+$'
    or cbo_descricao = 'Não Informado';

comment on column public.cat_inss_registros.uf_empregador is
  'NULL quando a origem manda "Zerado", que vem junto de "000000-Ignorado" no municipio. 19.629 linhas na carga inicial, so a partir de 202506. Nao confundir com ausencia rara: e 3,2% da base.';
comment on column public.cat_inss_registros.municipio_empregador_ibge is
  'Codigo IBGE de 6 digitos. NULL quando a origem manda "000000" (19.658 linhas). Bate com uf_empregador em 7.276/7.276 no arquivo de janeiro — a coluna "UF Munic. Acidente" da origem, descartada na modelagem, nao bate.';
comment on column public.cat_inss_registros.data_afastamento is
  'Preenchida em 99,3-99,6% a partir de 202506 (544.297 linhas). Vem 100% zerada apenas em 202501-202505, que sao recortes parciais. Corrige o que 20260807120000 dava a entender.';
comment on column public.cat_inss_registros.data_despacho_beneficio is
  'Praticamente morta na origem: 15 linhas preenchidas em 619.529. Nao usar como sinal de concessao.';
