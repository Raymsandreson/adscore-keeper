-- Push de mensagem nova do WhatsApp (notificação nativa no celular).
--
-- Escopo do destinatário (decidido com o Raym em 04/08/2026):
--   1) DONO da instância que recebeu a mensagem  → whatsapp_instances.owner_user_id
--   2) RESPONSÁVEL do processo, quando a mensagem vem de um grupo vinculado a um
--      lead  → lead_whatsapp_groups.group_jid → leads.processual_responsible_id
--              (+ lead_processes.responsible_user_id do mesmo lead)
--
-- Quem envia é a função Railway `whatsapp-push` (service role), chamada em
-- fire-and-forget pelo whatsapp-webhook logo depois de gravar a mensagem.
--
-- Duas armadilhas que este schema resolve (medidas na base real, 04/08/2026):
--   * VOLUME: 2.500 mensagens inbound/24h só na instância "Raym". Um push por
--     mensagem faria a pessoa desligar tudo. Daí a janela de agrupamento por
--     conversa (whatsapp_push_throttle).
--   * DUPLICATA DE GRUPO: a mesma mensagem de grupo é gravada uma vez por
--     instância da casa que participa do grupo (o mesmo "Ok" virou 4 linhas).
--     O external_message_id vem prefixado pelo telefone da instância
--     ("558681595991:AC0DA1DF..."), mas o sufixo após ":" é o ID real da
--     mensagem no WhatsApp e é o MESMO nas 4 linhas. É essa chave canônica que
--     grava em whatsapp_push_seen e mata o duplicado.

-- ---------------------------------------------------------------------------
-- 1) Dono explícito da instância
-- ---------------------------------------------------------------------------
-- Até aqui "dono" só existia como owner_phone (texto). O casamento com
-- profiles.phone resolve apenas 11 das 26 instâncias, porque o perfil guarda o
-- 9º dígito ("5586995590127") e a instância não ("558695590127"). A coluna
-- abaixo passa a ser a fonte da verdade; o backfill aproveita as que casam e o
-- resto é escolhido na tela de Gestão de Instâncias.
alter table public.whatsapp_instances
  add column if not exists owner_user_id uuid;

create index if not exists idx_whatsapp_instances_owner_user
  on public.whatsapp_instances(owner_user_id)
  where owner_user_id is not null;

comment on column public.whatsapp_instances.owner_user_id is
  'Dono da instância (user_id do Cloud auth). Usado pelo push de mensagem nova. '
  'Fonte da verdade — owner_phone/owner_name seguem sendo apenas rótulo.';

-- Normaliza telefone BR ignorando o 9º dígito, para o backfill.
-- 5586995590127 (perfil) e 558695590127 (instância) viram a mesma chave.
create or replace function public.wa_norm_phone_br(p text)
returns text
language sql
immutable
as $$
  with d as (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as x)
  select case
           when length(x) = 13 and substr(x, 5, 1) = '9'
             then substr(x, 1, 4) || substr(x, 6)
           else x
         end
  from d
$$;

update public.whatsapp_instances i
   set owner_user_id = p.user_id
  from public.profiles p
 where i.owner_user_id is null
   and i.owner_phone is not null
   and length(public.wa_norm_phone_br(i.owner_phone)) >= 10
   and public.wa_norm_phone_br(p.phone) = public.wa_norm_phone_br(i.owner_phone);

-- ---------------------------------------------------------------------------
-- 2) Preferências por pessoa
-- ---------------------------------------------------------------------------
create table if not exists public.whatsapp_push_prefs (
  user_id                uuid primary key,
  enabled                boolean  not null default true,
  notify_owned_instance  boolean  not null default true,
  notify_process_groups  boolean  not null default true,
  -- Janela de agrupamento: dentro dela, mensagens novas da MESMA conversa não
  -- geram push novo, só somam na contagem ("Fulano — 3 mensagens novas").
  group_window_minutes   smallint not null default 5,
  -- Silêncio noturno, em hora local (America/Sao_Paulo). Quando start = end o
  -- silêncio fica desligado.
  quiet_start_hour       smallint not null default 22,
  quiet_end_hour         smallint not null default 7,
  weekdays_only          boolean  not null default false,
  -- Conversas silenciadas (telefone ou JID do grupo, só dígitos).
  muted_chats            text[]   not null default '{}',
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint whatsapp_push_prefs_window_ck
    check (group_window_minutes between 0 and 120),
  constraint whatsapp_push_prefs_quiet_start_ck
    check (quiet_start_hour between 0 and 23),
  constraint whatsapp_push_prefs_quiet_end_ck
    check (quiet_end_hour between 0 and 23)
);

alter table public.whatsapp_push_prefs enable row level security;

drop policy if exists wa_push_prefs_select_own on public.whatsapp_push_prefs;
create policy wa_push_prefs_select_own on public.whatsapp_push_prefs
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists wa_push_prefs_insert_own on public.whatsapp_push_prefs;
create policy wa_push_prefs_insert_own on public.whatsapp_push_prefs
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists wa_push_prefs_update_own on public.whatsapp_push_prefs;
create policy wa_push_prefs_update_own on public.whatsapp_push_prefs
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists wa_push_prefs_delete_own on public.whatsapp_push_prefs;
create policy wa_push_prefs_delete_own on public.whatsapp_push_prefs
  for delete to authenticated using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 3) Estado do agrupamento e idempotência
-- ---------------------------------------------------------------------------
-- Uma linha por (pessoa, conversa). conv_key é o telefone do contato ou o JID
-- do grupo — de propósito SEM o instance_name, senão a mesma mensagem de grupo
-- replicada em 4 instâncias abriria 4 janelas diferentes.
create table if not exists public.whatsapp_push_throttle (
  user_id       uuid        not null,
  conv_key      text        not null,
  last_push_at  timestamptz not null default now(),
  pending_count integer     not null default 1,
  updated_at    timestamptz not null default now(),
  primary key (user_id, conv_key)
);

alter table public.whatsapp_push_throttle enable row level security;
-- Sem policy: só a Railway (service role) escreve aqui. O front nunca lê.

-- Idempotência por mensagem: garante que a mesma mensagem do WhatsApp gere no
-- máximo um push por pessoa, mesmo chegando por N instâncias ao mesmo tempo.
create table if not exists public.whatsapp_push_seen (
  user_id  uuid        not null,
  msg_key  text        not null,
  seen_at  timestamptz not null default now(),
  primary key (user_id, msg_key)
);

create index if not exists idx_whatsapp_push_seen_seen_at
  on public.whatsapp_push_seen(seen_at);

alter table public.whatsapp_push_seen enable row level security;
-- Sem policy: idem — só service role.

-- ---------------------------------------------------------------------------
-- 4) Reserva atômica do push
-- ---------------------------------------------------------------------------
-- Decide, em UMA chamada e à prova de corrida, se esta mensagem deve virar push
-- para esta pessoa. As 4 cópias da mensagem de grupo chegam em milissegundos e
-- competem entre si; quem perde o ON CONFLICT apenas soma na contagem.
--
-- Retorna:
--   should_send   → manda o push agora
--   pending_count → quantas mensagens a janela acumulou (1 = primeira)
create or replace function public.wa_push_claim(
  p_user_id  uuid,
  p_conv_key text,
  p_msg_key  text,
  p_window_minutes integer default 5
)
returns table (should_send boolean, pending_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows         integer;
  v_prev_pending integer;
  v_prev_at      timestamptz;
  v_expired      boolean;
begin
  -- (a) Idempotência: a primeira instância a chegar com esta mensagem ganha.
  --     As outras 3 cópias da mesma mensagem de grupo param aqui.
  insert into public.whatsapp_push_seen (user_id, msg_key)
  values (p_user_id, p_msg_key)
  on conflict (user_id, msg_key) do nothing;

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return query select false, 0;
    return;
  end if;

  -- (b) Primeira mensagem já vista desta conversa: notifica na hora.
  insert into public.whatsapp_push_throttle (user_id, conv_key, last_push_at, pending_count)
  values (p_user_id, p_conv_key, now(), 1)
  on conflict (user_id, conv_key) do nothing;

  get diagnostics v_rows = row_count;
  if v_rows > 0 then
    return query select true, 1;
    return;
  end if;

  -- (c) Conversa já conhecida: trava a linha e decide pela janela.
  select t.pending_count, t.last_push_at
    into v_prev_pending, v_prev_at
    from public.whatsapp_push_throttle t
   where t.user_id = p_user_id and t.conv_key = p_conv_key
     for update;

  v_expired := v_prev_at <= now() - make_interval(mins => p_window_minutes);

  update public.whatsapp_push_throttle t
     set pending_count = case when v_expired then 1 else t.pending_count + 1 end,
         last_push_at  = case when v_expired then now() else t.last_push_at end,
         updated_at    = now()
   where t.user_id = p_user_id and t.conv_key = p_conv_key;

  if v_expired then
    -- A janela fechou. Este push representa as mensagens engolidas nela mais
    -- esta — por isso a contagem é o pendente ANTES do reset.
    return query select true, greatest(v_prev_pending, 1);
  else
    return query select false, v_prev_pending + 1;
  end if;
end;
$$;

-- Só a Railway (service_role) chama. O revoke tira de PUBLIC, o que alcança
-- também o service_role — por isso o grant explícito logo abaixo.
revoke all on function public.wa_push_claim(uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.wa_push_claim(uuid, text, text, integer) to service_role;

comment on function public.wa_push_claim(uuid, text, text, integer) is
  'Reserva atômica do push de mensagem nova. Só a Railway (service role) chama.';

-- ---------------------------------------------------------------------------
-- 5) Faxina
-- ---------------------------------------------------------------------------
-- whatsapp_push_seen cresce junto com o volume de mensagens (~9k/dia). Sem
-- expurgo vira tabela gigante sem serventia: passada a janela de agrupamento a
-- linha não decide mais nada. Guarda 2 dias por folga.
create or replace function public.wa_push_cleanup()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  delete from public.whatsapp_push_seen where seen_at < now() - interval '2 days';
  get diagnostics v_deleted = row_count;

  delete from public.whatsapp_push_throttle where last_push_at < now() - interval '2 days';

  return v_deleted;
end;
$$;

revoke all on function public.wa_push_cleanup() from public, anon, authenticated;
grant execute on function public.wa_push_cleanup() to service_role;

-- Agenda a faxina para as 4h de Brasília (07:00 UTC). Idempotente: remove o job
-- antigo antes de recriar, então rodar a migration duas vezes não duplica.
do $cron$
begin
  perform cron.unschedule('wa-push-cleanup');
exception
  when others then null;  -- job ainda não existe
end
$cron$;

select cron.schedule('wa-push-cleanup', '0 7 * * *', $job$select public.wa_push_cleanup()$job$);
