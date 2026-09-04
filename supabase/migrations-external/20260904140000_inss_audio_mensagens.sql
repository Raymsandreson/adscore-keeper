-- ============================================================================
-- Áudio na mensagem automática do INSS
--
-- Duas coisas:
--   1. `inss_audio_mensagens` — catálogo de um áudio por assunto. Guarda tanto
--      o que a equipe gravou (voz humana) quanto o que já foi gerado por TTS,
--      justamente para não pagar geração nova toda vez que o mesmo assunto
--      voltar (pedido do usuário, 04/09/2026).
--   2. `inss_status_history.zap_audio_*` — o que aconteceu com o áudio daquele
--      evento, separado do que aconteceu com o texto. Áudio é acréscimo: ele
--      pode falhar sem que a mensagem tenha falhado, e sem esta coluna a
--      diferença some.
--
-- Ordem de deploy (ver a lição do "deploy que pede coluna inexistente": o
-- PostgREST devolve 400 na query inteira quando falta coluna, não campo nulo):
-- esta migration ADITIVA vai primeiro, o código depois.
-- ============================================================================

create table if not exists public.inss_audio_mensagens (
  id           uuid primary key default gen_random_uuid(),
  -- "<tipo>" ou "<tipo>:<assunto>" — ex.: 'protocolado', 'exigencia:procuracao'.
  -- Quem monta é `chaveDoAudio` em railway-server/src/lib/inss-audio.ts.
  chave        text not null unique,
  audio_url    text not null,
  -- O que o áudio fala. Serve para conferir se ele ainda bate com o texto que
  -- o robô manda -- foi assim que se descobriu, em 04/09/2026, que o áudio do
  -- indeferimento prometia ação judicial enquanto o texto falava em recurso.
  texto_falado text,
  -- 'gravado' = voz da equipe; 'tts' = gerado e guardado aqui para reúso.
  origem       text not null default 'gravado' check (origem in ('gravado','tts')),
  ativo        boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.inss_audio_mensagens is
  'Áudio que acompanha a mensagem automática do INSS no grupo do cliente, um por assunto.';

create index if not exists idx_inss_audio_mensagens_ativo
  on public.inss_audio_mensagens (chave) where ativo;

alter table public.inss_status_history
  add column if not exists zap_audio_status text,
  add column if not exists zap_audio_url    text;

comment on column public.inss_status_history.zap_audio_status is
  'gravado | tts_catalogo | tts_texto | sem_audio | erro[:status] — resultado do áudio, independente do texto.';

-- ---------------------------------------------------------------------------
-- Fechamento da superfície pública.
--
-- Quem lê e escreve este catálogo é só o service role do Railway; o front não
-- toca nele. As default privileges do projeto dão INSERT/UPDATE/DELETE a anon e
-- authenticated em toda tabela nova do schema public, então RLS ligado + revoke
-- explícito, como na fila do CAPI.
-- ---------------------------------------------------------------------------

alter table public.inss_audio_mensagens enable row level security;

revoke all on public.inss_audio_mensagens from anon, authenticated;
