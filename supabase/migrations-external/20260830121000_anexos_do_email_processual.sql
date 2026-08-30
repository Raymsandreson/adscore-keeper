-- =============================================================================
-- Fase 2 (anexos) da tarefa de 30/08/2026 — pré-requisito para o MTE.
-- Banco alvo: Supabase EXTERNO (kmedldlepwiityjsdahz).
--
-- Nos e-mails do MTE o ato está no PDF, não no corpo ("Saudações, para
-- ciência" + Despacho_2688783.pdf). O gmail-processual-sync passa a salvar os
-- anexos dos remetentes de governo no bucket privado `processual-anexos`; o
-- texto é extraído reaproveitando a jm-ler-peca (modo anexo — mesma função,
-- mesma chave, mesmo Gemini) e gravado aqui; a sync-email-push varre os
-- identificadores TAMBÉM sobre esse texto.
--
-- ORDEM DE ROLLOUT: migration → deploy jm-ler-peca (modo anexo) → deploy do
-- Railway com captura de anexos. Cada peça é inócua sem a seguinte.
--
-- ROLLBACK:
--   drop table if exists public.processual_email_anexos;
--   delete from storage.buckets where id = 'processual-anexos';
--   (os objetos do bucket precisam ser removidos antes do delete do bucket)
-- =============================================================================

-- Bucket PRIVADO: peça de processo administrativo é dado de cliente. Leitura
-- só com service role (mesmo desenho do jm-autos).
insert into storage.buckets (id, name, public)
values ('processual-anexos', 'processual-anexos', false)
on conflict (id) do nothing;

create table if not exists public.processual_email_anexos (
  id                bigint generated always as identity primary key,
  gmail_message_id  text not null,
  filename          text,
  mime_type         text,
  size_bytes        integer,
  storage_path      text not null,
  -- Texto extraído do PDF/imagem pela jm-ler-peca (modo anexo). Nulo enquanto
  -- a extração não rodou — a sync-email-push só varre o que já tem texto.
  texto_extraido    text,
  texto_extraido_at timestamptz,
  created_at        timestamptz not null default now(),
  unique (gmail_message_id, storage_path)
);

comment on table public.processual_email_anexos is
  'Anexos dos e-mails de processual_emails (só remetentes de governo — MTE/SEI/MPT/INSS). Arquivo no bucket privado processual-anexos; texto_extraido alimenta a varredura de identificadores da sync-email-push.';

create index if not exists processual_email_anexos_msg_idx
  on public.processual_email_anexos (gmail_message_id);

alter table public.processual_email_anexos enable row level security;

-- Front (authenticated) só lê metadados/texto; escrita é do Railway e da
-- jm-ler-peca com service role, que ignora RLS.
create policy processual_email_anexos_read
  on public.processual_email_anexos for select to authenticated using (true);
