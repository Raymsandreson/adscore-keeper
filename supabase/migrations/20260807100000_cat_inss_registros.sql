-- =============================================================================
-- Tabela para os extratos de dados abertos de CAT do INSS/Dataprev.
-- Arquivo de referencia: CAT.JAN25.ZIP -> D.SDA.PDA.005.CAT.202501.csv (7.276 linhas).
--
-- POR QUE UMA TABELA NOVA, E NAO cat_leads:
--   cat_leads e base ENRIQUECIDA — tem cpf, nome_completo (NOT NULL), endereco,
--   4 celulares e 4 fixos, e existe pra ser trabalhada por telefone
--   (contact_status, assigned_to, cat_lead_contacts).
--   O dado aberto do INSS e ANONIMO: nao traz nome, CPF, NIT nem telefone.
--   useCatLeads.importCatLeads filtra por nome_completo, entao esse arquivo
--   importaria exatamente 0 registros por la. Sao duas bases diferentes:
--   esta aqui e estatistica/prospeccao por EMPRESA; cat_leads e contato com PESSOA.
--
-- LAYOUT DA ORIGEM — tres defeitos medidos no arquivo de 202501:
--
--   1. "UF Munic. Acidente" (coluna 18 do CSV) NAO ESTA AQUI, de proposito.
--      Ela e a UF do empregador com o rotulo trocado por um lookup errado:
--      27 pares distintos em bijecao perfeita com contagens identicas
--      (Maranhao<->Sao Paulo 2.570, Rondonia<->Minas Gerais 741,
--      Roraima<->Parana 579), mais 2.393 "{ñ class}".
--      uf_empregador, essa sim, bate com o codigo IBGE do municipio em 7.276/7.276.
--      NAO reintroduzir a coluna: o dado e errado, nao incompleto.
--
--   2. Todo campo texto vem truncado em 20 caracteres na origem
--      ("Comercio Varejista d", "S61.0 Ferim de Dedos"). Por isso guardamos
--      codigo e descricao separados: a descricao integra sai do join pelo codigo.
--      cbo_codigo ja tem 785 dos 792 codigos cobertos por public.cbo_professions.
--
--   3. data_afastamento e data_despacho_beneficio vieram 7.276/7.276 zeradas
--      ("00/00/0000") nessa competencia. As colunas ficam aqui porque outras
--      competencias podem trazer o dado — mas nao conte com elas.
--
-- SEM IDENTIFICADOR: a origem nao tem numero da CAT. Nao da pra ligar
-- CAT inicial -> reabertura -> comunicacao de obito, nem deduplicar entre meses.
-- A unique (arquivo_origem, linha_num) serve so pra reimportar o mesmo arquivo
-- sem duplicar; nao e chave de negocio.
--
-- ROLLBACK: drop table public.cat_inss_registros;
-- =============================================================================

create table if not exists public.cat_inss_registros (
  id uuid primary key default gen_random_uuid(),

  -- procedencia
  competencia   date not null,          -- 1o dia do mes do arquivo (AAAAMM do nome)
  arquivo_origem text not null,          -- D.SDA.PDA.005.CAT.202501.csv
  linha_num     integer not null,        -- linha no CSV, 1-based apos o cabecalho

  -- datas
  data_acidente           date,
  data_emissao_cat        date,
  data_nascimento         date,
  data_afastamento        date,          -- 100% nula em 202501, ver nota 3
  data_despacho_beneficio date,          -- 100% nula em 202501, ver nota 3

  -- acidente
  agente_causador      text,
  natureza_lesao       text,
  parte_corpo_atingida text,
  tipo_acidente        text,             -- Tipico | Trajeto | Doenca
  indica_obito         boolean,
  sexo                 text,

  -- classificacoes (codigo + descricao truncada em 20 chars)
  cbo_codigo    text,
  cbo_descricao text,
  cid_codigo    text,
  cid_descricao text,
  cnae_codigo   text,
  cnae_descricao text,

  -- empregador
  municipio_empregador_ibge text,         -- 6 digitos, sem DV
  municipio_empregador_nome text,
  uf_empregador             text,
  cnpj_empregador           text,
  tipo_empregador           text,

  -- constantes no recorte de 202501, guardadas pra detectar mudanca de recorte
  emitente_cat         text,              -- 'Empregador'
  origem_cadastramento text,              -- 'Internet'
  filiacao_segurado    text,              -- 'Empregado'
  especie_beneficio    text,              -- 'Pa'

  created_at timestamptz not null default now(),

  constraint cat_inss_registros_arquivo_linha_key unique (arquivo_origem, linha_num)
);

comment on table public.cat_inss_registros is
  'Dados abertos de CAT do INSS/Dataprev, um registro por linha do CSV. Anonimo: sem nome, CPF ou telefone. Para contato com a pessoa, ver cat_leads.';
comment on column public.cat_inss_registros.uf_empregador is
  'UF do municipio do empregador. Unica UF confiavel do arquivo: a coluna "UF Munic. Acidente" da origem e um lookup quebrado e foi descartada.';
comment on column public.cat_inss_registros.data_afastamento is
  'Veio 100% zerada na competencia 202501. Nao assumir preenchimento.';

-- Indices para os filtros previstos: recorte por competencia, prospeccao por
-- empresa/CNAE, prova de NTEP por par CNAE x CID, e recorte geografico.
create index if not exists idx_cat_inss_competencia  on public.cat_inss_registros (competencia);
create index if not exists idx_cat_inss_cnpj         on public.cat_inss_registros (cnpj_empregador);
create index if not exists idx_cat_inss_cnae_cid     on public.cat_inss_registros (cnae_codigo, cid_codigo);
create index if not exists idx_cat_inss_cbo          on public.cat_inss_registros (cbo_codigo);
create index if not exists idx_cat_inss_municipio    on public.cat_inss_registros (municipio_empregador_ibge);
create index if not exists idx_cat_inss_uf_tipo      on public.cat_inss_registros (uf_empregador, tipo_acidente);
create index if not exists idx_cat_inss_data_acid    on public.cat_inss_registros (data_acidente);

-- RLS: leitura so para usuario autenticado. Sem policy de escrita — a carga e
-- feita por scripts/import-cat-inss.mjs com SERVICE_ROLE, que ignora RLS.
-- Nao usar "to public": public inclui anon, e a chave anon vai no bundle do front.
alter table public.cat_inss_registros enable row level security;

create policy "Authenticated pode ler cat_inss_registros"
  on public.cat_inss_registros for select to authenticated using (true);
