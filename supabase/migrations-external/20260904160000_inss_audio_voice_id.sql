-- ============================================================================
-- Qual voz gerou cada áudio do catálogo do INSS
--
-- O catálogo guarda o áudio por assunto (`chave` é UNIQUE) justamente para não
-- pagar geração nova toda vez. Só que isso torna a linha imune à troca de voz:
-- quando `INSS_AUDIO_VOICE_ID` muda no Railway, a linha antiga continua sendo
-- servida e o cliente segue ouvindo a voz velha para sempre — sem erro, sem
-- log, sem nada que denuncie.
--
-- Aconteceu de verdade em 04/09/2026: o roteiro de 'protocolado' (o de maior
-- volume, ~200/mês) tinha sido gerado numa voz feminina de catálogo enquanto
-- todos os áudios gravados são do José. Trocar a voz não corrigiria sozinho.
--
-- Com esta coluna a invalidação é automática: linha de origem 'tts' cuja
-- `voice_id` não é a voz atual conta como ausente, e o código regrava por cima
-- (upsert em `chave`). Linha 'gravado' tem `voice_id` nulo e nunca é
-- invalidada — é voz humana, não depende de modelo nenhum.
--
-- Aditiva e nullable: entra antes do código, como manda a lição do deploy que
-- pede coluna inexistente.
-- ============================================================================

alter table public.inss_audio_mensagens
  add column if not exists voice_id text;

comment on column public.inss_audio_mensagens.voice_id is
  'Voz da ElevenLabs que gerou o áudio. Nulo em origem=gravado (voz humana). Em origem=tts, divergir da voz atual invalida a linha.';
