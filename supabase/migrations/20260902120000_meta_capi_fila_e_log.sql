-- =============================================================================
-- Meta CAPI: fila durável + log de auditoria (Externo, 02/09/2026).
--
-- POR QUE EXISTE. Em 02/09/2026 o ping na edge `facebook-capi` devolveu
--   {"error":{"message":"Error validating application. Application has been
--    deleted.","code":190}}
-- O app da Meta que emitia o token foi apagado e a integração parou — sem que
-- ninguém percebesse. O carimbo `leads.capi_purchase_sent_at` só tem 12 linhas,
-- todas de 30–31/07/2026: foi quando o último Purchase saiu de verdade.
--
-- A causa de ter passado batido não é o token: é que o envio era
-- fire-and-forget. `useLeads`, `LeadEditDialog`, `sync-funnel-status-from-sheet`
-- e `auto-enrich-lead` chamavam a edge e jogavam a falha num `console.warn`
-- (o de `auto-enrich-lead` nem no formato certo: manda `{lead_id,event_name}`
-- onde a edge exige `{events:[...]}`, então sempre respondeu 400, engolido por
-- `.catch(()=>{})`). Não havia lugar nenhum onde olhar para saber o que saiu.
--
-- Esta tabela é esse lugar. Toda intenção de conversão vira linha ANTES de
-- tentar rede. Quem despacha é o Railway (`meta-capi-dispatch`), que carimba o
-- resultado aqui. Token morto deixa de ser silêncio: vira uma pilha visível de
-- `failed` com o erro da Meta em `resposta`.
--
-- PII: a fila NÃO guarda e-mail nem telefone em claro. `user_data_hash` recebe
-- o SHA-256 que a Meta receberia; retry usa o hash e não precisa do original.
-- `match_keys` mede qualidade de correspondência sem expor dado do cliente.
-- Sem policy de propósito (padrão de `whatsapp_avatars`): quem lê e escreve é o
-- Railway com service role; a sessão anônima do app não alcança a tabela, e o
-- painel recebe só o agregado.
--
-- ROLLBACK (<5min):
--   drop view if exists public.vw_meta_capi_saude;
--   drop table if exists public.meta_capi_events;
--   drop table if exists public.meta_capi_status;
-- Nada mais depende delas: os disparadores atuais seguem chamando a edge até
-- serem religados em passo separado.
-- =============================================================================

create table if not exists public.meta_capi_events (
  id                    uuid primary key default gen_random_uuid(),

  -- Chave de deduplicação da própria Meta (mesmo event_id 2x = 1 conversão).
  -- UNIQUE aqui torna o enfileiramento idempotente: os dois funis (Pipeline
  -- `converted` e Kanban `closed`) podem enfileirar o mesmo fechamento sem
  -- cobrar o Meta duas vezes.
  event_id              text        not null unique,
  event_name            text        not null,
  lead_id               uuid,

  -- Quem pediu o envio. Sem isso não dá para saber qual caminho está quebrado
  -- quando só uma parte dos eventos falha.
  origem                text        not null,

  status                text        not null default 'pending',
  motivo_skip           text,

  -- SHA-256 dos campos de correspondência (em, ph, fn, ln, external_id),
  -- exatamente como vão para a Meta. Nunca dado em claro.
  user_data_hash        jsonb       not null default '{}'::jsonb,
  match_keys            text[]      not null default '{}',

  custom_data           jsonb       not null default '{}'::jsonb,
  action_source         text        not null default 'system_generated',
  event_time            timestamptz not null default now(),

  -- Valor e de onde ele veio. `valor_origem` é o que permite responder
  -- "esse ROAS é real ou estimado?" sem reabrir o lead.
  valor                 numeric(14,2),
  valor_origem          text,

  tentativas            integer     not null default 0,
  proxima_tentativa_em  timestamptz,
  http_status           integer,
  events_received       integer,
  fbtrace_id            text,
  resposta              jsonb,

  enfileirado_em        timestamptz not null default now(),
  enviado_em            timestamptz,

  constraint meta_capi_events_status_valido
    check (status in ('pending','sent','failed','skipped')),
  constraint meta_capi_events_valor_origem_valido
    check (valor_origem is null or valor_origem in
      ('informado','faixa_produto','padrao','ausente'))
);

alter table public.meta_capi_events enable row level security;

comment on table public.meta_capi_events is
  'Fila e log da Meta Conversions API. Toda conversão vira linha antes de ir à rede; o despachante do Railway carimba o resultado. Service role apenas.';
comment on column public.meta_capi_events.event_id is
  'Chave de dedup da Meta (ex.: "<lead_id>:Purchase"). UNIQUE = enfileirar 2x não cobra 2x.';
comment on column public.meta_capi_events.origem is
  'Caminho que pediu o envio: kanban | pipeline | planilha | auto_enrich | manual | backfill.';
comment on column public.meta_capi_events.user_data_hash is
  'SHA-256 dos campos de correspondência, como a Meta recebe. Sem PII em claro (LGPD).';
comment on column public.meta_capi_events.match_keys is
  'Quais chaves de correspondência foram enviadas (em, ph, fn...). Mede match quality sem expor dado.';
comment on column public.meta_capi_events.motivo_skip is
  'Por que não foi enviado. Principal caso: lead sem e-mail nem telefone — evento que a Meta descartaria.';
comment on column public.meta_capi_events.valor_origem is
  'informado = conversion_value do lead; faixa_produto = média de products_services.price_range; padrao = fallback global; ausente = sem valor.';

-- Drenagem da fila: pending/failed prontos para nova tentativa, mais antigos primeiro.
create index if not exists idx_meta_capi_events_fila
  on public.meta_capi_events (proxima_tentativa_em nulls first, enfileirado_em)
  where status in ('pending','failed');

create index if not exists idx_meta_capi_events_lead
  on public.meta_capi_events (lead_id)
  where lead_id is not null;

create index if not exists idx_meta_capi_events_painel
  on public.meta_capi_events (enfileirado_em desc);

-- ---------------------------------------------------------------------------
-- Saúde da credencial. Linha única: o probe periódico escreve aqui, e o painel
-- lê. É o detector que faltava — com ele, "app deletado" aparece em horas, não
-- em um mês.
-- ---------------------------------------------------------------------------
create table if not exists public.meta_capi_status (
  id                integer     primary key default 1,
  token_valido      boolean,
  dataset_id        text,
  app_id            text,
  erro              text,
  ultimo_probe_em   timestamptz,
  ultimo_sucesso_em timestamptz,
  constraint meta_capi_status_singleton check (id = 1)
);

alter table public.meta_capi_status enable row level security;

comment on table public.meta_capi_status is
  'Estado da credencial da Meta CAPI (linha única). Alimentada pelo probe do Railway; token morto vira alerta em vez de silêncio.';

insert into public.meta_capi_status (id) values (1) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Resumo para o painel: sem PII, agregado por dia e situação.
-- ---------------------------------------------------------------------------
create or replace view public.vw_meta_capi_saude as
select
  date_trunc('day', enfileirado_em)::date       as dia,
  event_name,
  origem,
  status,
  count(*)                                       as eventos,
  count(*) filter (where 'em' = any(match_keys)) as com_email,
  count(*) filter (where 'ph' = any(match_keys)) as com_telefone,
  count(*) filter (where cardinality(match_keys) = 0) as sem_correspondencia,
  count(*) filter (where valor_origem = 'informado')     as valor_real,
  count(*) filter (where valor_origem = 'faixa_produto') as valor_estimado,
  sum(valor)                                     as valor_total
from public.meta_capi_events
group by 1,2,3,4;

comment on view public.vw_meta_capi_saude is
  'Agregado diário da fila CAPI para o painel: volume, correspondência e procedência do valor. Sem dado pessoal.';

-- ---------------------------------------------------------------------------
-- Fechamento da superfície pública.
--
-- Duas armadilhas do Supabase que só aparecem depois de criar a tabela:
--
-- 1. View nasce SECURITY DEFINER. Sem `security_invoker = on` ela executa com o
--    privilégio do dono (postgres) e passa por cima do RLS das tabelas base --
--    ou seja, o RLS acima viraria enfeite para quem consultasse pela view.
--    É a mesma dívida das 28 security_definer_view já catalogadas no Externo.
--
-- 2. As default privileges do projeto dão INSERT/UPDATE/DELETE/TRUNCATE a
--    `anon` e `authenticated` em toda tabela nova do schema public. Hoje o RLS
--    neutraliza; mas grant amplo + uma policy permissiva criada no futuro = furo
--    silencioso. Quem lê e escreve aqui é só o service role do Railway.
--
-- Verificado em 03/09/2026: anon recebe 42501 na fila E na view; service_role lê.
-- ---------------------------------------------------------------------------

alter view public.vw_meta_capi_saude set (security_invoker = on);

revoke all on public.meta_capi_events   from anon, authenticated;
revoke all on public.meta_capi_status   from anon, authenticated;
revoke all on public.vw_meta_capi_saude from anon, authenticated;
