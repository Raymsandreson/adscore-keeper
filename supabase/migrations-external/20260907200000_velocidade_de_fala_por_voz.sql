-- =============================================================================
-- Velocidade de fala por VOZ, e não uma constante escondida no código
--
-- O PROBLEMA
-- `speed: 1.1` estava escrito à mão dentro da dom-rascunho (e em mais cinco
-- lugares). Ninguém fora do código conseguia mexer, e o número era o mesmo para
-- todas as vozes — o que é errado na raiz: cada voz clonada tem o ritmo de fala
-- da pessoa que a gravou. A Keilane a 1,1x soa apressada; outra voz na mesma
-- 1,1x pode soar natural, e uma terceira pode precisar de 1,15x para não
-- arrastar. Velocidade é propriedade DA VOZ, não do sistema.
--
-- Por isso a coluna mora em `custom_voices` e não num ajuste global.
--
-- O INTERVALO
-- A API REST da ElevenLabs aceita 0.25 a 4.0 (fonte: o próprio repositório de
-- skills da ElevenLabs, text-to-speech/references/voice-settings.md; a
-- plataforma de Agents é mais restrita, 0.7 a 1.2 — nós usamos a REST). O CHECK
-- aqui é 0.5 a 1.5 de propósito: fora disso não é ajuste de naturalidade, é voz
-- de desenho animado ou de câmera lenta, e o objetivo é soar humano.
--
-- NULO = usa o padrão do sistema (1,1x). Voz nova continua se comportando como
-- se comportava antes desta migration — nada muda sem alguém escolher.
-- =============================================================================

alter table public.custom_voices
  add column if not exists velocidade_fala numeric(3,2);

alter table public.custom_voices
  drop constraint if exists custom_voices_velocidade_fala_check;

alter table public.custom_voices
  add constraint custom_voices_velocidade_fala_check
  check (velocidade_fala is null or (velocidade_fala >= 0.5 and velocidade_fala <= 1.5));

comment on column public.custom_voices.velocidade_fala is
  'Velocidade de fala desta voz no TTS (ElevenLabs voice_settings.speed). '
  '1.00 = ritmo natural da voz; abaixo desacelera, acima acelera. '
  'NULO = usa o padrão do sistema (1.1). Faixa aceita: 0.5 a 1.5.';

-- Em que velocidade ESTE áudio foi gravado.
--
-- Sem isto, mudar a velocidade da voz reescreve o passado: os áudios antigos
-- continuam soando como soavam, mas a tela diria a velocidade nova. Quem
-- compara "antes e depois" para escolher o ritmo precisa saber o que está
-- ouvindo — senão a comparação não vale nada.
alter table public.dom_respostas_pendentes
  add column if not exists audio_velocidade numeric(3,2);

comment on column public.dom_respostas_pendentes.audio_velocidade is
  'Velocidade usada para gerar ESTE áudio. Nulo em áudio gerado antes de '
  '07/09/2026, que saiu na constante antiga de 1.1.';

-- A Keilane é a voz do Dom hoje e é a que soou apressada. 1.00 tira a
-- aceleração de 10% que estava no código — é 10% mais devagar do que o áudio
-- que existe hoje. O valor é para ser ajustado no ouvido, pela tela.
update public.custom_voices
   set velocidade_fala = 1.00, updated_at = now()
 where id = '9a754b30-e5dd-4d4a-bcd6-8761c0766e52';
