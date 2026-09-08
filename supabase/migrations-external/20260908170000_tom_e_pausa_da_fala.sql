-- =============================================================================
-- Tom e pausa da fala — as outras duas alavancas que faltavam
--
-- A velocidade já mora na voz desde 07/09/2026 (migration 20260907200000). Ela
-- resolveu "a Keilane soa apressada", mas não resolve as outras duas queixas
-- que aparecem quando alguém escuta uma nota de voz do escritório:
--
--   "a voz fala tudo emendado"        → falta PAUSA
--   "soa uma robô lendo um formulário" → falta TOM
--
-- Como velocidade, as duas são propriedade DA VOZ, não do sistema: a mesma
-- pausa de 0,6s que dá respiro numa voz corrida soa arrastada numa voz que já
-- é pausada por natureza. Por isso ficam em `custom_voices`, ao lado de
-- `velocidade_fala`, e não num ajuste global.
--
-- -----------------------------------------------------------------------------
-- O QUE A API REALMENTE ACEITA (e o que ela NÃO aceita)
--
-- Fonte: elevenlabs/skills, text-to-speech/references/voice-settings.md — a
-- mesma fonte citada na migration da velocidade. Os campos de `voice_settings`
-- são exatamente cinco:
--
--   stability         0.0 - 1.0  (padrão 0.5)
--   similarity_boost  0.0 - 1.0  (padrão 0.75)
--   style             0.0 - 1.0  (padrão 0.0, "v2+ e v3 apenas")
--   speed             0.25 - 4.0 (padrão 1.0)
--   use_speaker_boost bool
--
-- NÃO EXISTE `pitch`. Se alguém pedir "deixa a voz mais grave", a resposta
-- honesta é: a ElevenLabs não expõe isso — a altura da voz é da GRAVAÇÃO que
-- clonou a voz, e só se muda regravando. O que dá para mudar é a
-- EXPRESSIVIDADE, e ela é a combinação de dois campos:
--
--   `stability` alto  = fala firme, pouca variação  → sério, formal
--   `stability` baixo = mais variação emocional     → caloroso, expressivo
--   `style`           = exagera o jeito próprio da voz
--
-- Por isso "tom" aqui são DUAS colunas, não uma. Guardar os números (e não o
-- nome do preset) é de propósito: preset é rótulo de tela e pode ser
-- renomeado; o que a API recebeu tem que ficar registrado como número, senão
-- mudar um preset amanhã reescreve o passado de todas as vozes.
--
-- -----------------------------------------------------------------------------
-- PAUSA NÃO É PARÂMETRO — É TAG NO TEXTO
--
-- A ElevenLabs não tem campo de pausa em `voice_settings`. O jeito de pausar é
-- a tag `<break time="0.6s" />` no meio do texto, com teto documentado de 3s.
--
-- ATENÇÃO, e está escrito aqui porque é o jeito de isto dar errado: esta parte
-- veio de FONTE SECUNDÁRIA. A doc oficial da ElevenLabs (elevenlabs.io e
-- help.elevenlabs.io) estava bloqueada por egress no ambiente onde isto foi
-- escrito, e o repositório oficial de skills não cobre pausas. Se o modelo não
-- interpretar a tag, ele LÊ a tag em voz alta — o cliente ouviria "break time
-- zero vírgula seis s". Duas travas contra isso:
--
--   1. O padrão é 0 (zero) = nenhuma tag é inserida. Nada muda sozinho para
--      voz nenhuma; só passa a existir tag se alguém escolher na tela.
--   2. Isto é rascunho: o áudio toca no painel e só sai com aprovação humana.
--      A primeira escuta com pausa ligada confirma ou derruba a hipótese.
--
-- Onde a pausa entra: em cada QUEBRA DE LINHA da resposta. É onde quem
-- escreveu já quis um respiro — não é heurística nossa adivinhando prosódia.
--
-- CUSTO: a ElevenLabs cobra por caractere de entrada, e a tag tem ~22
-- caracteres. Uma resposta média (333 caracteres) com 4 quebras de linha passa
-- a custar ~88 caracteres a mais, ~26%. Em cima de um piloto de dezenas de
-- áudios por dia, é ruído. Ficaria relevante em escala de milhares/dia.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. As três alavancas, na VOZ
-- ---------------------------------------------------------------------------

alter table public.custom_voices
  add column if not exists estabilidade_fala numeric(3,2);

alter table public.custom_voices
  drop constraint if exists custom_voices_estabilidade_fala_check;

alter table public.custom_voices
  add constraint custom_voices_estabilidade_fala_check
  check (estabilidade_fala is null or (estabilidade_fala >= 0 and estabilidade_fala <= 1));

comment on column public.custom_voices.estabilidade_fala is
  'ElevenLabs voice_settings.stability desta voz (0 a 1). Alto = fala firme e '
  'pouco variada; baixo = mais variação emocional. NULO = padrão do sistema (0.60).';

alter table public.custom_voices
  add column if not exists estilo_fala numeric(3,2);

alter table public.custom_voices
  drop constraint if exists custom_voices_estilo_fala_check;

alter table public.custom_voices
  add constraint custom_voices_estilo_fala_check
  check (estilo_fala is null or (estilo_fala >= 0 and estilo_fala <= 1));

comment on column public.custom_voices.estilo_fala is
  'ElevenLabs voice_settings.style desta voz (0 a 1). Exagera o jeito proprio '
  'da voz. NULO = padrao do sistema (0.30).';

-- Milissegundos, e não segundos fracionários, para não repetir o problema de
-- `numeric` com arredondamento em coisa que é discreta por natureza. O teto de
-- 3000 é o que a ElevenLabs documenta para `<break time>`; acima disso a tag é
-- recusada ou truncada, e nenhum dos dois é comportamento que queremos
-- descobrir em produção.
alter table public.custom_voices
  add column if not exists pausa_fala_ms integer not null default 0;

alter table public.custom_voices
  drop constraint if exists custom_voices_pausa_fala_ms_check;

alter table public.custom_voices
  add constraint custom_voices_pausa_fala_ms_check
  check (pausa_fala_ms >= 0 and pausa_fala_ms <= 3000);

comment on column public.custom_voices.pausa_fala_ms is
  'Pausa inserida em cada quebra de linha da resposta, em milissegundos, via '
  'tag <break time="Xs" /> no texto enviado a ElevenLabs. 0 = nenhuma tag e '
  'nenhuma alteracao no texto (o padrao). Teto de 3000 e o limite da tag.';

-- ---------------------------------------------------------------------------
-- 2. Com que ajustes ESTE áudio foi gravado
--
-- Mesmo motivo de `audio_velocidade`: sem isto, mexer nos ajustes da voz
-- reescreve o passado. Os áudios antigos continuam soando como soavam, mas a
-- tela diria os valores novos — e quem compara "antes e depois" para escolher
-- o tom precisa saber o que está ouvindo, senão a comparação não vale nada.
-- ---------------------------------------------------------------------------

alter table public.dom_respostas_pendentes
  add column if not exists audio_estabilidade numeric(3,2);

alter table public.dom_respostas_pendentes
  add column if not exists audio_estilo numeric(3,2);

alter table public.dom_respostas_pendentes
  add column if not exists audio_pausa_ms integer;

comment on column public.dom_respostas_pendentes.audio_estabilidade is
  'stability usada para gerar ESTE audio. Nulo em audio gerado antes de '
  '08/09/2026, que saiu na constante antiga de 0.60.';

comment on column public.dom_respostas_pendentes.audio_estilo is
  'style usado para gerar ESTE audio. Nulo em audio gerado antes de '
  '08/09/2026, que saiu na constante antiga de 0.30.';

comment on column public.dom_respostas_pendentes.audio_pausa_ms is
  'Pausa por quebra de linha usada para gerar ESTE audio, em ms. Nulo em audio '
  'gerado antes de 08/09/2026, que nao tinha pausa nenhuma (equivale a 0).';
