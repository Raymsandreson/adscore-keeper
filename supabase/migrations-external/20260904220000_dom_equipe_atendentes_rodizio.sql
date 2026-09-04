-- Dom — quem é equipe, quem atende, e o rodízio entre atendentes
--
-- APLICAR no projeto EXTERNO (kmedldlepwiityjsdahz).
--
-- 1. NÚMEROS DA EQUIPE
-- Em grupo, a mensagem de um número nosso chega aos OUTROS números nossos como
-- `inbound`. Medido em 04/09/2026 nos 8 grupos do piloto: o remetente com mais
-- mensagens é "Prudêncio Advogados - Assessor de Atendimento" (198 mensagens
-- únicas em 20 dias) — equipe. Sem separar, o Dom passa o dia respondendo os
-- próprios colegas.
--
-- Casar por whatsapp_instances.owner_phone quase resolve, mas tem furo: João
-- Manoel Cavalcante aparece com dois números, e só um está cadastrado como
-- instância. Por isso a lista é TABELA (semeada das instâncias, editável), e
-- não uma regra fixa no código.
--
-- Direção segura do erro: quem não está na lista é tratado como CLIENTE. Errar
-- para o lado de responder um colega é visível e sem dano; errar para o outro
-- lado é ignorar cliente em silêncio.

create table if not exists dom_numeros_equipe (
  phone      text primary key,
  nome       text,
  origem     text not null default 'manual' check (origem in ('instancia', 'manual')),
  ativo      boolean not null default true,
  criado_em  timestamptz not null default now()
);

comment on table dom_numeros_equipe is
  'Números que são da equipe. Mensagem vinda deles em grupo nunca é tratada como pergunta de cliente.';

insert into dom_numeros_equipe (phone, nome, origem)
select distinct regexp_replace(i.owner_phone, '\D', '', 'g'),
       coalesce(i.owner_name, i.instance_name),
       'instancia'
from whatsapp_instances i
where i.owner_phone is not null
  and length(regexp_replace(i.owner_phone, '\D', '', 'g')) >= 10
on conflict (phone) do nothing;

-- ---------------------------------------------------------------------------
-- 2. ATENDENTES E RODÍZIO
--
-- O rodízio NÃO é inventado aqui: é a mesma mecânica de pick_funnel_assignee
-- (migration 20260606_funnel_round_robin), que já roda em produção
-- distribuindo lead novo. Mesma trava FOR UPDATE SKIP LOCKED, mesma ordem por
-- last_assigned_at. Muda só o escopo: lá é por funil, aqui é por motivo.
-- ---------------------------------------------------------------------------

create table if not exists dom_atendentes (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid,
  nome             text not null,
  whatsapp         text not null,
  escopo           text not null default 'reclamacao'
                   check (escopo in ('reclamacao', 'saida_de_grupo', 'geral')),
  is_active        boolean not null default true,
  position         integer not null default 0,
  last_assigned_at timestamptz,
  criado_em        timestamptz not null default now(),
  unique (escopo, whatsapp)
);

comment on table dom_atendentes is
  'Quem recebe o aviso quando o Dom precisa de humano. Um por linha; o rodízio distribui entre os ativos do mesmo escopo.';
comment on column dom_atendentes.whatsapp is
  'Número que recebe o aviso NO PRIVADO. Só dígitos, com DDI.';

create index if not exists idx_dom_atendentes_escopo
  on dom_atendentes (escopo, is_active, position);

create or replace function public.pick_dom_atendente(p_escopo text)
returns uuid
language plpgsql
set search_path = public
as $fn$
declare
  v_id uuid;
begin
  select id into v_id
  from dom_atendentes
  where escopo = p_escopo and is_active = true
  order by coalesce(last_assigned_at, 'epoch'::timestamptz) asc, position asc, id asc
  limit 1
  for update skip locked;

  -- Sem ninguém no escopo pedido, cai no 'geral' antes de desistir: aviso de
  -- reclamação que não chega em ninguém é pior que aviso no lugar errado.
  if v_id is null and p_escopo <> 'geral' then
    select id into v_id
    from dom_atendentes
    where escopo = 'geral' and is_active = true
    order by coalesce(last_assigned_at, 'epoch'::timestamptz) asc, position asc, id asc
    limit 1
    for update skip locked;
  end if;

  if v_id is null then return null; end if;

  update dom_atendentes set last_assigned_at = now() where id = v_id;
  return v_id;
end
$fn$;

comment on function public.pick_dom_atendente is
  'Rodízio atômico entre atendentes ativos do escopo. Mesma mecânica de pick_funnel_assignee.';

-- ---------------------------------------------------------------------------
-- 3. A FILA GANHA INTENÇÃO E DESTINATÁRIO
-- ---------------------------------------------------------------------------

alter table dom_respostas_pendentes
  add column if not exists intencao       text,
  add column if not exists atendente_id   uuid references dom_atendentes(id),
  add column if not exists notificado_em  timestamptz,
  add column if not exists erro_notificacao text;

create index if not exists idx_dom_pendentes_intencao
  on dom_respostas_pendentes (intencao, criado_em desc);

-- ---------------------------------------------------------------------------
-- 4. RLS
-- ---------------------------------------------------------------------------

alter table dom_numeros_equipe enable row level security;
alter table dom_atendentes     enable row level security;

drop policy if exists dom_numeros_equipe_rw on dom_numeros_equipe;
create policy dom_numeros_equipe_rw on dom_numeros_equipe
  for all to authenticated using (true) with check (true);

drop policy if exists dom_atendentes_rw on dom_atendentes;
create policy dom_atendentes_rw on dom_atendentes
  for all to authenticated using (true) with check (true);

-- ---------------------------------------------------------------------------
-- ROLLBACK
--   drop function if exists public.pick_dom_atendente(text);
--   drop table if exists public.dom_atendentes;
--   drop table if exists public.dom_numeros_equipe;
--   alter table dom_respostas_pendentes
--     drop column if exists intencao, drop column if exists atendente_id,
--     drop column if exists notificado_em, drop column if exists erro_notificacao;
-- ---------------------------------------------------------------------------
