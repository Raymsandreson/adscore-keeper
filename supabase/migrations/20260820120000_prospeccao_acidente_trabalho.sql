-- =============================================================================
-- Prospecção de acidente de trabalho — persistência de candidatos e contatos.
--
-- Guarda o resultado do filtro de `_shared/prospeccaoAcidenteTrabalho.ts`
-- (processo de acidente de trabalho com valor da causa acima do piso), o
-- advogado do polo ativo, o contato dele quando houver, e o log de disparo.
-- Contexto e limites das APIs: docs/sistema/prospeccao-acidente-trabalho.md
--
-- MINIMIZAÇÃO DE DADOS (decisão desta migration, não detalhe de implementação):
-- NÃO existe coluna para o nome do polo ATIVO. O polo ativo aqui é o
-- trabalhador acidentado — pessoa física, vítima, que não é parte nenhuma
-- desta relação comercial. A oferta é feita ao ADVOGADO sobre a carteira dele;
-- para isso bastam CNJ, valor e assunto. Guardar o nome da vítima seria
-- acumular dado pessoal sensível sem finalidade. `polo_passivo` fica porque
-- costuma ser pessoa jurídica (a empresa ré) e é contexto útil da conversa.
-- Se alguém for adicionar `polo_ativo` depois: essa é a decisão que está sendo
-- revertida, e ela tem motivo.
--
-- Pelo mesmo princípio não há tabela para documento de processo. Se o contato
-- vier de procuração nos autos, o PDF NÃO é persistido: extrai-se o bloco de
-- contato do advogado e descarta-se o binário na mesma execução. A procuração
-- carrega CPF, RG e endereço do cliente acidentado.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Processos candidatos
-- -----------------------------------------------------------------------------
create table if not exists public.prospect_processos (
  id             uuid primary key default gen_random_uuid(),
  numero_cnj     text not null unique,
  valor_causa    numeric(15,2) not null check (valor_causa > 0),
  assuntos       text[] not null default '{}',
  polo_passivo   text,                 -- empresa ré (PJ). Ver nota de minimização.
  tribunal       text,
  uf             text,
  data_inicio    date,

  -- De onde veio o candidato, e qual semente o produziu. Serve para medir
  -- rendimento por semente antes de escalar consulta paga no Escavador.
  origem         text not null check (origem in ('escavador_oab', 'escavador_cnpj', 'datajud', 'base_interna')),
  semente        text,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on table public.prospect_processos is
  'Processos de acidente de trabalho acima do piso de valor. Sem nome do polo ativo por minimização de dados (a vítima não é parte da relação comercial).';

-- O filtro sempre varre por faixa de valor e por origem; sem estes índices a
-- listagem faz seq scan assim que a tabela passar de alguns milhares de linhas.
create index if not exists idx_prospect_processos_valor
  on public.prospect_processos (valor_causa desc);
create index if not exists idx_prospect_processos_origem
  on public.prospect_processos (origem, created_at desc);
create index if not exists idx_prospect_processos_uf
  on public.prospect_processos (uf);

-- -----------------------------------------------------------------------------
-- 2. Advogados do polo ativo + estado de LGPD
-- -----------------------------------------------------------------------------
create table if not exists public.prospect_advogados (
  id             uuid primary key default gen_random_uuid(),
  nome           text not null,
  oab_numero     text,
  oab_uf         text,

  -- Contato. NUNCA vem do Escavador: a API não devolve e-mail nem telefone
  -- (ver docs/sistema/prospeccao-acidente-trabalho.md §1.2). Fica nulo até um
  -- enriquecimento explícito preencher, e o disparo ignora quem está nulo.
  email                text,
  telefone             text,
  contato_fonte        text check (contato_fonte in ('procuracao', 'planilha', 'manual', 'fornecedor')),
  contato_obtido_em    timestamptz,

  -- Base legal do tratamento, por prospect. Sem isto o disparo não tem
  -- fundamento documentado — é exigência da LGPD, não burocracia.
  base_legal     text not null default 'legitimo_interesse_b2b',
  finalidade     text not null default 'oferta de linha de credito para escritorio de advocacia',

  -- Descadastro. `opt_out_token` é o que vai no link de um clique do e-mail:
  -- é ele que permite sair sem login. Único e não adivinhável.
  opt_out        boolean not null default false,
  opt_out_em     timestamptz,
  opt_out_token  uuid not null default gen_random_uuid(),

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

comment on column public.prospect_advogados.email is
  'Nulo até enriquecimento explícito — a API do Escavador não devolve contato de advogado.';
comment on column public.prospect_advogados.opt_out_token is
  'Token do link de descadastro de um clique. Não adivinhável, sem exigir login.';

-- Um advogado é único pela OAB. Índice parcial porque OAB pode faltar em
-- registro vindo de fonte pior — nesses casos cai no índice de nome abaixo.
create unique index if not exists uq_prospect_advogados_oab
  on public.prospect_advogados (oab_numero, oab_uf)
  where oab_numero is not null and oab_uf is not null;

create index if not exists idx_prospect_advogados_nome
  on public.prospect_advogados (lower(nome));

create unique index if not exists uq_prospect_advogados_opt_out_token
  on public.prospect_advogados (opt_out_token);

-- O disparo filtra exatamente por "tem e-mail E não saiu". Índice parcial
-- cobre só as linhas elegíveis, que são a minoria enquanto o enriquecimento
-- não roda.
create index if not exists idx_prospect_advogados_elegiveis
  on public.prospect_advogados (id)
  where email is not null and opt_out = false;

-- -----------------------------------------------------------------------------
-- 3. Vínculo processo <-> advogado (N:N)
-- -----------------------------------------------------------------------------
-- Um advogado costuma ter vários processos no recorte, e um processo pode ter
-- mais de um advogado no polo ativo. O volume da carteira dele é justamente o
-- argumento comercial, então o vínculo precisa ser N:N e não uma coluna.
create table if not exists public.prospect_processo_advogado (
  processo_id  uuid not null references public.prospect_processos(id) on delete cascade,
  advogado_id  uuid not null references public.prospect_advogados(id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (processo_id, advogado_id)
);

create index if not exists idx_prospect_proc_adv_advogado
  on public.prospect_processo_advogado (advogado_id);

-- -----------------------------------------------------------------------------
-- 4. Log de disparo
-- -----------------------------------------------------------------------------
-- Existe para três coisas: não mandar duas vezes para a mesma pessoa, provar
-- o que foi enviado e quando (auditoria LGPD), e saber qual versão do texto
-- gerou resposta.
create table if not exists public.prospect_disparos (
  id               uuid primary key default gen_random_uuid(),
  advogado_id      uuid not null references public.prospect_advogados(id) on delete cascade,
  canal            text not null check (canal in ('email', 'whatsapp')),
  template_versao  text not null,
  destino          text not null,     -- e-mail/telefone usado no envio
  status           text not null check (status in ('simulado', 'enviado', 'falhou', 'bloqueado_opt_out', 'bloqueado_sem_contato')),
  provedor_id      text,              -- id do Resend/UazAPI, para rastrear
  erro             text,
  enviado_em       timestamptz not null default now()
);

create index if not exists idx_prospect_disparos_advogado
  on public.prospect_disparos (advogado_id, enviado_em desc);

-- Trava de reenvio no banco, não só no código: um advogado recebe no máximo
-- UM disparo efetivo por canal. Simulação e bloqueio não ocupam a vaga, então
-- dry-run pode rodar quantas vezes quiser.
create unique index if not exists uq_prospect_disparos_um_por_canal
  on public.prospect_disparos (advogado_id, canal)
  where status = 'enviado';

-- -----------------------------------------------------------------------------
-- 5. RLS
-- -----------------------------------------------------------------------------
-- Tabela com dado de terceiro sem RLS é bug crítico (CLAUDE.md). Segue a
-- convenção do repo: acesso a autenticado.
alter table public.prospect_processos          enable row level security;
alter table public.prospect_advogados          enable row level security;
alter table public.prospect_processo_advogado  enable row level security;
alter table public.prospect_disparos           enable row level security;

create policy "Authenticated manage prospect_processos"
  on public.prospect_processos for all to authenticated
  using (true) with check (true);

create policy "Authenticated manage prospect_advogados"
  on public.prospect_advogados for all to authenticated
  using (true) with check (true);

create policy "Authenticated manage prospect_processo_advogado"
  on public.prospect_processo_advogado for all to authenticated
  using (true) with check (true);

-- Log de disparo é registro de auditoria: autenticado lê, mas não reescreve
-- nem apaga. Quem grava é a edge function, com service role, que ignora RLS.
create policy "Authenticated read prospect_disparos"
  on public.prospect_disparos for select to authenticated
  using (true);

-- -----------------------------------------------------------------------------
-- 6. updated_at
-- -----------------------------------------------------------------------------
create or replace function public.tg_prospect_touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_prospect_processos_updated_at on public.prospect_processos;
create trigger trg_prospect_processos_updated_at
  before update on public.prospect_processos
  for each row execute function public.tg_prospect_touch_updated_at();

drop trigger if exists trg_prospect_advogados_updated_at on public.prospect_advogados;
create trigger trg_prospect_advogados_updated_at
  before update on public.prospect_advogados
  for each row execute function public.tg_prospect_touch_updated_at();

-- -----------------------------------------------------------------------------
-- ROLLBACK (rota de fuga — CLAUDE.md exige antes de mexer em schema)
-- -----------------------------------------------------------------------------
-- Tudo aqui é criação nova; nada altera tabela existente. Reverter é:
--
--   drop table if exists public.prospect_disparos cascade;
--   drop table if exists public.prospect_processo_advogado cascade;
--   drop table if exists public.prospect_advogados cascade;
--   drop table if exists public.prospect_processos cascade;
--   drop function if exists public.tg_prospect_touch_updated_at();
--
-- Sem impacto em nenhum fluxo existente: nenhuma tabela em uso é tocada.
