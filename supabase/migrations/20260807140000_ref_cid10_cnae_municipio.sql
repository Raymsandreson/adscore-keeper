-- =============================================================================
-- Tabelas de referencia para destruncar as descricoes de cat_inss_registros.
--
-- O PROBLEMA: a origem trunca todo texto em 20 caracteres, e o codigo ainda
-- ocupa parte desse espaco. Medido nos 619.529 registros:
--
--   cnae_descricao  max 20 chars   "Atividades de atendi"
--   cid_descricao   max 14 chars   "Ferim de Dedos"
--   cbo_descricao   max 13 chars   "Tec. de Enfer"
--   municipio_nome  max 13 chars
--
-- Nao da para agrupar, filtrar nem apresentar isso. A descricao integra sai do
-- join pelo codigo, que a origem preserva.
--
-- CHAVES DE JOIN — a CAT usa codigos SEM digito verificador, entao a chave e o
-- prefixo do codigo oficial. Verificado que o prefixo e unico nas duas fontes
-- (zero colisao em 673 classes CNAE e 5.571 municipios):
--
--   cnae_codigo "8610"   -> classe IBGE "86101"    (left(id,4))
--   municipio   "316860" -> IBGE "3168606"         (left(id,6))  Teofilo Otoni
--   cid_codigo  "S610"   -> subcategoria "S610"    (direto)
--   cid_codigo  "S61"    -> categoria "S61"        (direto)
--
-- Por isso ref_cnae e ref_municipio_ibge tem DUAS colunas de codigo: a chave de
-- join (prefixo, que e a PK) e o codigo oficial completo, para exportacao e
-- cruzamento com outras bases.
--
-- COBERTURA MEDIDA contra os codigos distintos da base:
--   CNAE  660 de 689 codigos (95,8%), 619.193 de 619.529 linhas (99,95%).
--         Os 29 orfaos somam 336 linhas e ja vem com descricao NULA na propria
--         origem — sao codigos legados (CNAE 1.0) e lixo ("8888"). Nao ha o que
--         recuperar deles.
--   CBO   ja coberto por cbo_professions: 2.119 de 2.209 codigos, 617.635 de
--         619.529 linhas (99,7%). Nao criamos tabela nova.
--
-- FONTES (baixadas pelo scripts/import-referencias-cat.mjs):
--   CID-10  DATASUS  www2.datasus.gov.br/cid10/V2008/downloads/CID10CSV.zip
--   CNAE    IBGE     servicodados.ibge.gov.br/api/v2/cnae/classes
--   IBGE    IBGE     servicodados.ibge.gov.br/api/v1/localidades/municipios
--
-- Dado publico de referencia, sem nada pessoal. RLS ligado assim mesmo, no
-- padrao do projeto: leitura para authenticated, escrita so por service_role.
--
-- ROLLBACK: drop table ref_cid10, ref_cnae, ref_municipio_ibge;
-- =============================================================================

create table if not exists public.ref_cid10 (
  codigo      text primary key,
  nivel       text not null check (nivel in ('categoria', 'subcategoria')),
  categoria   text not null,
  descricao   text not null,
  causa_obito boolean,
  restr_sexo  text
);
comment on table public.ref_cid10 is
  'CID-10 do DATASUS (2008). Categorias (3 chars, "S61") e subcategorias (4 chars, "S610") na mesma tabela, distinguidas por nivel. Junta direto com cat_inss_registros.cid_codigo, que traz os dois formatos.';
comment on column public.ref_cid10.categoria is
  'Os 3 primeiros chars, para agrupar subcategorias sob a categoria (S610, S611, S618 -> S61).';

create index if not exists idx_ref_cid10_categoria on public.ref_cid10 (categoria);

create table if not exists public.ref_cnae (
  codigo            text primary key,
  codigo_classe     text not null,
  descricao         text not null,
  grupo_codigo      text,
  grupo_descricao   text,
  divisao_codigo    text,
  divisao_descricao text,
  secao_codigo      text,
  secao_descricao   text
);
comment on table public.ref_cnae is
  'Classes da CNAE 2.0 (IBGE). A PK "codigo" e o prefixo de 4 digitos usado pela CAT; codigo_classe e a classe oficial de 5 digitos. Traz a hierarquia completa (grupo, divisao, secao) para agregacao por setor.';
comment on column public.ref_cnae.codigo is
  'Prefixo de 4 digitos, sem digito verificador — o formato que a CAT usa. Unico: zero colisao nas 673 classes.';

create index if not exists idx_ref_cnae_secao   on public.ref_cnae (secao_codigo);
create index if not exists idx_ref_cnae_divisao on public.ref_cnae (divisao_codigo);

create table if not exists public.ref_municipio_ibge (
  codigo       text primary key,
  codigo_ibge  text not null unique,
  nome         text not null,
  uf_sigla     text not null,
  uf_nome      text not null,
  regiao_sigla text not null,
  regiao_nome  text not null
);
comment on table public.ref_municipio_ibge is
  'Municipios do IBGE. A PK "codigo" e o prefixo de 6 digitos usado pela CAT; codigo_ibge e o codigo oficial de 7 digitos, com verificador. Resolve o nome truncado em 13 chars e da a sigla da UF, que a CAT so traz por extenso.';

create index if not exists idx_ref_municipio_uf on public.ref_municipio_ibge (uf_sigla);

alter table public.ref_cid10           enable row level security;
alter table public.ref_cnae            enable row level security;
alter table public.ref_municipio_ibge  enable row level security;

create policy "ref_cid10 leitura"          on public.ref_cid10          for select to authenticated using (true);
create policy "ref_cnae leitura"           on public.ref_cnae           for select to authenticated using (true);
create policy "ref_municipio_ibge leitura" on public.ref_municipio_ibge for select to authenticated using (true);
