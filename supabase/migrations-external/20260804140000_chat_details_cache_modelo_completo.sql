-- ============================================================
-- whatsapp_chat_details_cache — modelo Chat completo da UazAPI
-- ============================================================
-- Motivo: a tabela tinha 15 colunas, mas o código (get-group-participants,
-- railway e edge) gravava `lead_field12..16`, que nunca existiram. PostgREST
-- rejeita a linha inteira nesse caso (PGRST204), então NENHUM upsert passava:
-- a última linha gravada era de 2026-05-04 e `lead_field12` entrou no código em
-- 2026-07-31. Resultado prático: o modal de membros refazia todas as chamadas à
-- UazAPI a cada abertura e CPF/RG/endereço nunca chegavam ao front.
--
-- Esta migration alinha a tabela ao modelo Chat documentado no POST
-- /chat/details. `raw` continua existindo como rede para campos que a doc não
-- nomeia — colunas cobrem o que consultamos/indexamos, `raw` cobre o resto.
--
-- ROLLBACK: ver bloco comentado no fim do arquivo.
-- Seguro de repetir: todo ADD COLUMN é IF NOT EXISTS.
-- ============================================================

-- --- identificadores da UazAPI ------------------------------
alter table public.whatsapp_chat_details_cache
  add column if not exists wa_id            text,  -- `id` do payload (id interno do chat)
  add column if not exists wa_fastid        text,  -- "<owner>:<phone>"
  add column if not exists wa_chatid        text,  -- "<phone>@s.whatsapp.net" | "<id>@g.us"
  add column if not exists wa_chatlid       text,  -- "<lid>@lid" (migração LID)
  add column if not exists owner            text;  -- telefone da instância dona do chat

-- --- dados do WhatsApp --------------------------------------
alter table public.whatsapp_chat_details_cache
  add column if not exists image_preview    text,
  add column if not exists wa_name          text,  -- nome público (pushName/verificado)
  add column if not exists wa_contact_name  text,  -- nome salvo na agenda do chip
  add column if not exists wa_archived      boolean,
  add column if not exists wa_is_blocked    boolean,
  add column if not exists wa_is_pinned     boolean,
  add column if not exists wa_unread_count  integer,
  add column if not exists wa_mute_end_time bigint,
  add column if not exists wa_labels        jsonb default '[]'::jsonb;

-- --- grupo ---------------------------------------------------
alter table public.whatsapp_chat_details_cache
  add column if not exists wa_is_group           boolean,
  add column if not exists wa_is_group_admin     boolean,
  add column if not exists wa_is_group_announce  boolean,
  add column if not exists wa_is_group_community boolean,
  add column if not exists wa_is_group_locked    boolean;

-- --- chatbot -------------------------------------------------
alter table public.whatsapp_chat_details_cache
  add column if not exists chatbot_summary          text,
  add column if not exists chatbot_last_trigger_id  text,
  add column if not exists chatbot_disable_until    timestamptz,
  add column if not exists chatbot_status           text;

-- --- lead / CRM ----------------------------------------------
-- lead_field01..20 são campos livres do CRM da UazAPI. O mapeamento em uso
-- nesta base (herdado do import-group-participants) é:
--   12 = CPF, 13 = RG, 14 = Endereço, 15 = Bairro, 16 = CEP
alter table public.whatsapp_chat_details_cache
  add column if not exists lead_assigned_attendant_id text,
  add column if not exists lead_is_ticket_open        boolean,
  add column if not exists lead_field01 text, add column if not exists lead_field02 text,
  add column if not exists lead_field03 text, add column if not exists lead_field04 text,
  add column if not exists lead_field05 text, add column if not exists lead_field06 text,
  add column if not exists lead_field07 text, add column if not exists lead_field08 text,
  add column if not exists lead_field09 text, add column if not exists lead_field10 text,
  add column if not exists lead_field11 text, add column if not exists lead_field12 text,
  add column if not exists lead_field13 text, add column if not exists lead_field14 text,
  add column if not exists lead_field15 text, add column if not exists lead_field16 text,
  add column if not exists lead_field17 text, add column if not exists lead_field18 text,
  add column if not exists lead_field19 text, add column if not exists lead_field20 text;

-- --- controle de sincronização -------------------------------
-- sync_error guarda a última falha por telefone: sem isso um número que a
-- UazAPI não resolve é retentado a cada varredura, para sempre.
alter table public.whatsapp_chat_details_cache
  add column if not exists sync_error      text,
  add column if not exists sync_attempts   integer not null default 0,
  add column if not exists applied_to_contact_at timestamptz;

comment on column public.whatsapp_chat_details_cache.raw is
  'Payload bruto do POST /chat/details. Rede para campos do modelo Chat que ainda não viraram coluna.';

-- --- índices --------------------------------------------------
-- O varredor de stale ordena por fetched_at; sem índice ele faz seq scan na
-- tabela inteira a cada rodada.
create index if not exists idx_chat_details_cache_fetched_at
  on public.whatsapp_chat_details_cache (fetched_at desc);

-- Busca por telefone atravessando instâncias (o mesmo número pode estar em
-- várias): a PK é (instance_name, phone), então `where phone = X` não usa a PK.
create index if not exists idx_chat_details_cache_phone
  on public.whatsapp_chat_details_cache (phone);

-- ============================================================
-- ROLLBACK (colar e rodar se precisar reverter):
--
-- alter table public.whatsapp_chat_details_cache
--   drop column if exists wa_id, drop column if exists wa_fastid,
--   drop column if exists wa_chatid, drop column if exists wa_chatlid,
--   drop column if exists owner, drop column if exists image_preview,
--   drop column if exists wa_name, drop column if exists wa_contact_name,
--   drop column if exists wa_archived, drop column if exists wa_is_blocked,
--   drop column if exists wa_is_pinned, drop column if exists wa_unread_count,
--   drop column if exists wa_mute_end_time, drop column if exists wa_labels,
--   drop column if exists wa_is_group, drop column if exists wa_is_group_admin,
--   drop column if exists wa_is_group_announce, drop column if exists wa_is_group_community,
--   drop column if exists wa_is_group_locked, drop column if exists chatbot_summary,
--   drop column if exists chatbot_last_trigger_id, drop column if exists chatbot_disable_until,
--   drop column if exists chatbot_status, drop column if exists lead_assigned_attendant_id,
--   drop column if exists lead_is_ticket_open, drop column if exists sync_error,
--   drop column if exists sync_attempts, drop column if exists applied_to_contact_at,
--   drop column if exists lead_field01, drop column if exists lead_field02,
--   drop column if exists lead_field03, drop column if exists lead_field04,
--   drop column if exists lead_field05, drop column if exists lead_field06,
--   drop column if exists lead_field07, drop column if exists lead_field08,
--   drop column if exists lead_field09, drop column if exists lead_field10,
--   drop column if exists lead_field11, drop column if exists lead_field12,
--   drop column if exists lead_field13, drop column if exists lead_field14,
--   drop column if exists lead_field15, drop column if exists lead_field16,
--   drop column if exists lead_field17, drop column if exists lead_field18,
--   drop column if exists lead_field19, drop column if exists lead_field20;
-- drop index if exists public.idx_chat_details_cache_fetched_at;
-- drop index if exists public.idx_chat_details_cache_phone;
-- ============================================================
