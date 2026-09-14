import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Mic, Square } from 'lucide-react';
import { Button } from './button';
import { toast } from 'sonner';
import { authClient } from '@/integrations/supabase';
import { cloudFunctions } from '@/lib/functionRouter';
import { VOICE_AUDIO_CONSTRAINTS, VOICE_RECORDER_BITRATE } from '@/lib/voiceRecording';

/**
 * Botão de DITADO com limpeza de IA — para campos de texto longo.
 *
 * Diferença para o `VoiceInputButton` (que continua existindo e serve a campos
 * curtos): lá quem transcreve é o navegador (`SpeechRecognition`), de graça e
 * na hora, mas o texto sai como foi falado — sem pontuação decente e refém do
 * Chrome. Aqui o áudio é gravado, sobe pro bucket e a transcrição é a mesma do
 * chat da equipe (`transcribe-team-audio`: ElevenLabs Scribe com Gemini de
 * reserva), com `limpar: true` — a IA tira "é...", "tipo", repetição e começo
 * abandonado antes de o texto cair no campo.
 *
 * Metáfora: o `VoiceInputButton` é o bloquinho de recado; este aqui é o
 * ditado para a secretária, que passa a limpo antes de te entregar.
 *
 * O texto SEMPRE cai no campo para conferência — nada é enviado sozinho.
 */
interface VoiceDictateButtonProps {
  /** Recebe o texto já limpo. O chamador decide se concatena ou substitui. */
  onResult: (texto: string) => void;
  /** Uma frase dizendo pra que serve o ditado — orienta o tom da limpeza. */
  contexto?: string;
  disabled?: boolean;
  className?: string;
  /** Avisa o pai em que fase está, para ele ajustar placeholder/rótulos. */
  onPhaseChange?: (fase: 'idle' | 'gravando' | 'transcrevendo') => void;
}

const BUCKET = 'team-chat-media';
/** Abaixo disso é clique sem fala — não vale subir nem pagar transcrição. */
const MIN_BYTES = 1000;

export function VoiceDictateButton({
  onResult,
  contexto,
  disabled,
  className,
  onPhaseChange,
}: VoiceDictateButtonProps) {
  const [gravando, setGravando] = useState(false);
  const [transcrevendo, setTranscrevendo] = useState(false);
  const [segundos, setSegundos] = useState(0);

  const gravadorRef = useRef<MediaRecorder | null>(null);
  const pedacosRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const cronometroRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    onPhaseChange?.(transcrevendo ? 'transcrevendo' : gravando ? 'gravando' : 'idle');
  }, [gravando, transcrevendo, onPhaseChange]);

  const encerrarCaptura = useCallback(() => {
    if (cronometroRef.current) { clearInterval(cronometroRef.current); cronometroRef.current = null; }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  // Sair da tela gravando não pode deixar o microfone ligado.
  useEffect(() => () => {
    if (cronometroRef.current) clearInterval(cronometroRef.current);
    try { if (gravadorRef.current?.state !== 'inactive') gravadorRef.current?.stop(); } catch { /* noop */ }
    streamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  const transcrever = useCallback(async (blob: Blob, mime: string) => {
    setTranscrevendo(true);
    try {
      const ext = mime.includes('mp4') ? 'm4a' : 'webm';
      const contentType = mime.split(';')[0];
      const caminho = `ditados/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: upErr } = await authClient.storage.from(BUCKET).upload(caminho, blob, { contentType });
      if (upErr) { toast.error(`O áudio não subiu: ${upErr.message}`); return; }
      const url = authClient.storage.from(BUCKET).getPublicUrl(caminho).data.publicUrl;

      const { data, error } = await cloudFunctions.invoke<{
        success?: boolean; transcription?: string; error?: string; limpeza_falhou?: string;
      }>('transcribe-team-audio', {
        body: { audio_url: url, audio_mime: contentType, limpar: true, contexto },
      });
      if (error) { toast.error(`Falha ao transcrever: ${error.message || error}`); return; }

      const texto = data?.transcription?.trim();
      if (!texto) {
        toast.error(data?.error || 'Não entendi o áudio. Tente falar mais perto do microfone.');
        return;
      }
      onResult(texto);
      // Limpeza que falhou não é erro fatal (o texto fiel veio), mas quem ditou
      // precisa saber que vai conferir um texto cru, com os "é..." no meio.
      if (data?.limpeza_falhou) toast.warning('Transcrito, mas sem a limpeza da IA — revise o texto.');
      else toast.success('Transcrito e limpo — confira antes de aplicar.');
    } finally {
      setTranscrevendo(false);
    }
  }, [contexto, onResult]);

  const parar = useCallback(() => {
    const gravador = gravadorRef.current;
    if (gravador && gravador.state !== 'inactive') gravador.stop();
  }, []);

  const ditar = useCallback(async () => {
    if (gravando) { parar(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: VOICE_AUDIO_CONSTRAINTS });
      streamRef.current = stream;
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
      const gravador = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: VOICE_RECORDER_BITRATE });
      pedacosRef.current = [];
      gravador.ondataavailable = (e) => { if (e.data.size) pedacosRef.current.push(e.data); };
      gravador.onstop = () => {
        encerrarCaptura();
        setGravando(false);
        setSegundos(0);
        const blob = new Blob(pedacosRef.current, { type: mime });
        if (blob.size < MIN_BYTES) { toast.error('Gravação muito curta.'); return; }
        void transcrever(blob, mime);
      };
      gravadorRef.current = gravador;
      gravador.start();
      setGravando(true);
      setSegundos(0);
      cronometroRef.current = setInterval(() => setSegundos((s) => s + 1), 1000);
    } catch {
      encerrarCaptura();
      toast.error('Não consegui acessar o microfone. Verifique a permissão do navegador.');
    }
  }, [gravando, parar, encerrarCaptura, transcrever]);

  const rotulo = transcrevendo ? 'Transcrevendo e limpando…'
    : gravando ? `Gravando ${segundos}s — clique para parar e transcrever`
    : 'Ditar por voz (a IA transcreve e limpa o texto)';

  return (
    <Button
      type="button"
      variant={gravando ? 'destructive' : 'outline'}
      size="sm"
      className={className}
      onClick={ditar}
      disabled={disabled || transcrevendo}
      title={rotulo}
      aria-label={rotulo}
    >
      {transcrevendo ? <Loader2 className="h-4 w-4 animate-spin" />
        : gravando ? <Square className="h-4 w-4" />
        : <Mic className="h-4 w-4" />}
      <span className="ml-2 text-xs">
        {transcrevendo ? 'Transcrevendo…' : gravando ? `Parar (${segundos}s)` : 'Ditar'}
      </span>
    </Button>
  );
}
