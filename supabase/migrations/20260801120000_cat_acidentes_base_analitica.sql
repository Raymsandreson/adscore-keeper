-- Base analítica de CAT (Comunicação de Acidente de Trabalho) — dados abertos INSS/Dataprev
-- Origem: arquivos D.SDA.PDA.005.CAT.AAAAMM.ZIP (36 competências, jun/2023 a mai/2026)
--
-- POR QUE TABELA NOVA E NÃO cat_leads:
--   public.cat_leads (278 linhas) é OPERACIONAL — CAT já enriquecida com CPF, nome,
--   endereço, telefones e resultado de ligação, ligada ao CRM (lead_id, assigned_to).
--   Esta tabela é ANALÍTICA — o dump bruto e completo, sem PII, na ordem de milhões de
--   linhas. Misturar as duas quebraria os índices e as policies de cat_leads.
--   O vínculo entre elas é feito depois por (cnpj_cei_empregador, data_acidente).
--
-- LAYOUT DO CSV DE ORIGEM (verificado em D.SDA.PDA.005.CAT.202512.csv):
--   separador ';', encoding latin-1, 27 colunas, campos padded em 20 chars,
--   datas em dd/mm/aaaa e ausência representada por '00/00/0000'.
--   Cabeçalho repete nomes (CBO;CBO, CID-10;CID-10, CNAE;CNAE) — 1º é código, 2º é descrição.
--   'Data Acidente' aparece 2x (col 2 e col 23) com o mesmo valor; guardamos só uma.

create table if not exists public.cat_acidentes (
  id                          bigserial primary key,

  -- procedência do registro
  competencia                 date        not null,  -- 1º dia do mês do arquivo de origem
  arquivo_origem              text        not null,  -- ex: D.SDA.PDA.005.CAT.202512.csv

  -- dinâmica do acidente
  agente_causador             text,
  natureza_lesao              text,
  parte_corpo_atingida        text,
  tipo_acidente               text,                  -- Típico | Trajeto | Doença
  indica_obito                boolean,

  -- classificações
  cbo_codigo                  text,
  cbo_descricao               text,                  -- truncada em 20 chars na origem
  cid10_codigo                text,
  cid10_descricao             text,                  -- truncada em 20 chars na origem
  cnae_codigo                 text,
  cnae_descricao              text,                  -- truncada em 20 chars na origem

  -- empregador
  cnpj_cei_empregador         text,
  tipo_empregador             text,
  municipio_empregador_codigo text,
  municipio_empregador_nome   text,
  uf_municipio_empregador     text,
  uf_municipio_acidente       text,

  -- segurado (sem PII: a base aberta não traz nome nem CPF)
  sexo                        text,
  data_nascimento             date,
  filiacao_segurado           text,

  -- benefício e trâmite
  emitente_cat                text,
  especie_beneficio           text,
  origem_cadastramento        text,
  data_acidente               date,
  data_afastamento            date,
  data_despacho_beneficio     date,
  data_emissao_cat            date,

  -- derivadas
  cnpj_raiz                   text generated always as (left(cnpj_cei_empregador, 8)) stored,
  ano_acidente                smallint generated always as (extract(year from data_acidente)::smallint) stored,

  -- idempotência: reprocessar o mesmo arquivo não duplica linha
  hash_linha                  text        not null,

  created_at                  timestamptz not null default now()
);

comment on table public.cat_acidentes is
  'Dump analítico das CATs do dados abertos INSS/Dataprev. Sem PII. Carregado por competência mensal a partir dos ZIPs D.SDA.PDA.005.CAT.AAAAMM. Base para detecção de padrões de acidente por empregador (ações coletivas/ACP). Operacional/enriquecido fica em cat_leads.';

comment on column public.cat_acidentes.hash_linha is
  'md5 da linha crua + competência. Unique — garante que recarregar o mesmo arquivo seja no-op.';
comment on column public.cat_acidentes.cbo_descricao is
  'Truncada em 20 chars na origem. Para o texto completo, juntar com public.cbo_professions por cbo_codigo.';
comment on column public.cat_acidentes.uf_municipio_acidente is
  'ATENÇÃO: em amostra da competência 202512 este campo apareceu inconsistente com o município do empregador (ex: município SP com UF acidente "Maranhão"). Validar antes de usar como filtro geográfico primário; preferir municipio_empregador_* .';

-- Índices: toda coluna usada como filtro nas views abaixo tem cobertura.
create unique index if not exists cat_acidentes_hash_uidx
  on public.cat_acidentes (hash_linha);

-- o índice mestre das ações coletivas: mesma empresa + mesma dinâmica
create index if not exists cat_acidentes_padrao_idx
  on public.cat_acidentes (cnpj_cei_empregador, agente_causador, parte_corpo_atingida, natureza_lesao)
  where cnpj_cei_empregador is not null;

create index if not exists cat_acidentes_cnpj_data_idx
  on public.cat_acidentes (cnpj_cei_empregador, data_acidente desc);
create index if not exists cat_acidentes_cnpj_raiz_idx
  on public.cat_acidentes (cnpj_raiz);
create index if not exists cat_acidentes_data_idx
  on public.cat_acidentes (data_acidente);
create index if not exists cat_acidentes_cnae_idx
  on public.cat_acidentes (cnae_codigo);
create index if not exists cat_acidentes_cbo_idx
  on public.cat_acidentes (cbo_codigo);
create index if not exists cat_acidentes_cid_idx
  on public.cat_acidentes (cid10_codigo);
create index if not exists cat_acidentes_municipio_idx
  on public.cat_acidentes (municipio_empregador_codigo);
create index if not exists cat_acidentes_competencia_idx
  on public.cat_acidentes (competencia);
create index if not exists cat_acidentes_obito_idx
  on public.cat_acidentes (cnpj_cei_empregador) where indica_obito;

-- Controle de carga: permite retomar a importação de onde parou.
create table if not exists public.cat_import_runs (
  competencia     date primary key,
  arquivo_origem  text        not null,
  linhas_arquivo  integer,
  linhas_inseridas integer,
  status          text        not null default 'pendente',  -- pendente|processando|ok|erro
  erro            text,
  iniciado_em     timestamptz,
  concluido_em    timestamptz,
  updated_at      timestamptz not null default now()
);

comment on table public.cat_import_runs is
  'Uma linha por competência (arquivo mensal). Fonte da verdade sobre o que já foi carregado em cat_acidentes.';

-- RLS. Não há PII, mas data_nascimento + município + CBO é quase-identificante:
-- leitura só para usuário autenticado; escrita só via service_role (importador).
alter table public.cat_acidentes  enable row level security;
alter table public.cat_import_runs enable row level security;

drop policy if exists cat_acidentes_select_authenticated on public.cat_acidentes;
create policy cat_acidentes_select_authenticated
  on public.cat_acidentes for select
  to authenticated
  using (true);

drop policy if exists cat_import_runs_select_authenticated on public.cat_import_runs;
create policy cat_import_runs_select_authenticated
  on public.cat_import_runs for select
  to authenticated
  using (true);
