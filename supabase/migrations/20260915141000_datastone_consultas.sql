-- Registro de consultas à Data Stone — cache pago e trilha de custo.
--
-- POR QUE ESTA TABELA É REQUISITO, NÃO OTIMIZAÇÃO:
-- a Data Stone só dá carência de 24h nas consultas por documento (`/persons/`
-- por CPF). A busca que vamos usar de fato — `/persons/search/` por telefone —
-- NÃO tem carência: repetir a mesma consulta cobra 1 crédito de novo. Sem
-- guardar a resposta, um reprocessamento acidental da fila paga tudo outra vez.
--
-- Também é a única trilha de custo que teremos: a API debita crédito sem nos
-- avisar por chamada, e `GET /balance` só mostra o saldo do momento.
--
-- Por que não reaproveitar lead_enrichment_log: aquela tabela (20.955 linhas) é
-- do enriquecimento por IA em cima de conversa de WhatsApp. Não tem provedor,
-- custo, nem documento consultado, e misturar as duas semânticas faria o
-- extrato de gasto ficar irrecuperável.
--
-- Reversível: `drop table public.datastone_consultas;` — nada mais depende dela.

create table if not exists public.datastone_consultas (
  id uuid primary key default gen_random_uuid(),

  endpoint text not null,
  chave_tipo text not null check (chave_tipo in ('telefone', 'cpf', 'nome', 'outro')),
  -- Hash da chave normalizada: é por ele que o cache procura. O valor em claro
  -- já vive em leads.lead_phone / leads.cpf; repeti-lo aqui só ampliaria a
  -- superfície de dado pessoal sem ganho.
  chave_hash text not null,
  -- Versão legível para conferência humana (***.***.***-12 / 55869****8888).
  chave_mascarada text,

  lead_id uuid,
  status integer not null,
  creditos integer not null default 0,
  encontrou boolean not null default false,

  -- Resposta crua. É o que torna o cache possível — sem ela, não há o que
  -- devolver sem pagar de novo.
  resposta jsonb,

  -- Veredito do confronto entre o nome retornado e o nome do lead.
  -- 'ok' é o único que autoriza gravar no lead; os outros ficam para conferência.
  nome_confere text check (nome_confere in ('ok', 'conflito', 'sem_base')),
  gravou boolean not null default false,

  solicitado_por uuid,
  created_at timestamptz not null default now(),
  -- Dado pessoal de terceiro não fica para sempre. O expurgo é por esta coluna.
  expira_em timestamptz not null default (now() + interval '180 days')
);

-- Cache: a busca quente é "já consultei esta chave?".
create index if not exists idx_datastone_consultas_chave
  on public.datastone_consultas (chave_hash, created_at desc);

-- Fila e ficha do lead.
create index if not exists idx_datastone_consultas_lead
  on public.datastone_consultas (lead_id)
  where lead_id is not null;

-- Orçamento diário e extrato de custo: contagem por dia.
create index if not exists idx_datastone_consultas_created
  on public.datastone_consultas (created_at desc);

-- RLS LIGADA E SEM POLICY: só service role entra. É deliberado — a tabela
-- guarda CPF, nome da mãe e endereço de pessoas que ainda não são clientes.
-- Quando alguma tela precisar ler o extrato, a policy entra nomeando o papel,
-- nunca `TO public`.
alter table public.datastone_consultas enable row level security;

comment on table public.datastone_consultas is
  'Consultas à API Data Stone: cache (a busca por telefone não tem carência, repetir cobra de novo), custo em créditos e veredito do match de nome. RLS sem policy = só service role.';
comment on column public.datastone_consultas.chave_hash is
  'sha256 da chave normalizada (telefone só dígitos, CPF só dígitos). É por onde o cache procura.';
comment on column public.datastone_consultas.creditos is
  'Créditos debitados nesta chamada. Única trilha de custo que temos — a API não notifica débito.';
comment on column public.datastone_consultas.nome_confere is
  'ok | conflito | sem_base. Só ok autoriza gravar no lead; telefone é chave forte mas número reciclado existe.';
comment on column public.datastone_consultas.expira_em is
  'Prazo de expurgo do payload pessoal. Vencido, a linha some ou tem a resposta esvaziada.';
