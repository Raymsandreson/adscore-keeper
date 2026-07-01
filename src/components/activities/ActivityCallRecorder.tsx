import { useState, useRef, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Phone, Mic, Square, Loader2, Sparkles, Info, RotateCcw, Download } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { externalSupabase } from '@/integrations/supabase/external-client';
import { remapToExternal } from '@/integrations/supabase/uuid-remap';
import { cloudFunctions } from '@/lib/functionRouter';

export interface ActivityCallContext {
  title?: string;
  type?: string;
  lead_name?: string;
  contact_name?: string;
  process_title?: string;
  current_status?: string;
  what_was_done?: string;
  next_steps?: string;
  solicitacao?: string;
  resposta_juizo?: string;
  notes?: string;
  workflow?: { step_label?: string; phase_label?: string; objective_label?: string; next_step?: string };
}

export interface ActivityCallFields {
  what_was_done?: string;
  current_status?: string;
  next_steps?: string;
  solicitacao?: string;
  resposta_juizo?: string;
  notes?: string;
}

interface Props {
  context: ActivityCallContext;
  onFields: (fields: ActivityCallFields) => void;
  /** IDs para a IA buscar contexto (histórico do processo + mensagens da atividade). */
  activityId?: string | null;
  leadId?: string | null;
  caseId?: string | null;
  processId?: string | null;
}

type Phase = 'idle' | 'recording' | 'processing' | 'done';

const CALL_FIELD_KEYS: (keyof ActivityCallFields)[] = [
  'what_was_done', 'current_status', 'next_steps', 'solicitacao', 'resposta_juizo', 'notes',
];

/** Força o download de um arquivo (cross-origin via blob; fallback abre em nova aba). */
async function downloadRecording(url: string, filename = 'gravacao-ligacao.webm') {
  try {
    const resp = await fetch(url);
    const blob = await resp.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  } catch {
    window.open(url, '_blank');
  }
}

/** Remove tags HTML para enviar texto limpo como contexto para a IA. */
export function stripHtmlToText(html: string): string {
  return (html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Converte o texto puro retornado pela IA em HTML válido para o RichTextEditor. */
export function callFieldTextToHtml(text: string): string {
  const clean = (text || '').trim();
  if (!clean) return '';
  return clean
    .split(/\n+/)
    .map((line) => {
      const esc = line.trim().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return esc ? `<p>${esc}</p>` : '';
    })
    .filter(Boolean)
    .join('');
}

export function ActivityCallRecorder({ context, onFields, activityId, leadId, caseId, processId }: Props) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [seconds, setSeconds] = useState(0);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [silent, setSilent] = useState(false);
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  const [recordingMime, setRecordingMime] = useState<string | null>(null);
  const [attaching, setAttaching] = useState(false);
  const [attached, setAttached] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Visualizador de áudio (Web Audio API) — mostra a "frequência da voz" ao gravar.
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastSoundRef = useRef(0);
  const silentRef = useRef(false);

  const teardownAudio = useCallback(() => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    analyserRef.current = null;
    try { audioCtxRef.current?.close(); } catch { /* noop */ }
    audioCtxRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      try { mediaRecorderRef.current?.stop(); } catch { /* noop */ }
      teardownAudio();
    };
  }, [teardownAudio]);

  const fmt = (s: number) =>
    `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;

  const startRecording = useCallback(async () => {
    setError(null);
    setTranscript('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Medidor de nível de áudio (opcional — só feedback visual).
      try {
        const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
        const audioCtx = new AudioCtx();
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        audioCtxRef.current = audioCtx;
        analyserRef.current = analyser;
        setSilent(false);
        silentRef.current = false;
        lastSoundRef.current = performance.now();
      } catch { /* visualizador é opcional */ }

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : 'audio/mp4';
      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.start(1000);
      setSeconds(0);
      timerRef.current = setInterval(() => setSeconds((p) => p + 1), 1000);
      setPhase('recording');
    } catch (e) {
      console.error('Mic access error', e);
      toast.error('Não foi possível acessar o microfone. Verifique a permissão do navegador.');
    }
  }, []);

  // Desenha as barras de frequência enquanto grava e detecta ausência de som.
  useEffect(() => {
    if (phase !== 'recording') return;
    const analyser = analyserRef.current;
    const canvas = canvasRef.current;
    if (!analyser || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const bufferLength = analyser.frequencyBinCount;
    const data = new Uint8Array(bufferLength);
    const bars = 32;
    const step = Math.max(1, Math.floor(bufferLength / bars));

    const draw = () => {
      rafRef.current = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(data);

      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      const barWidth = w / bars;
      let sum = 0;
      for (let i = 0; i < bars; i++) {
        const value = data[i * step] / 255;
        sum += data[i * step];
        const barHeight = Math.max(2, value * h);
        ctx.fillStyle = `rgb(${Math.round(34 + value * 200)}, ${Math.round(197 - value * 70)}, 94)`;
        ctx.fillRect(i * barWidth, h - barHeight, barWidth - 1, barHeight);
      }

      // Detecta silêncio: se a média ficar baixa por >4s, avisa que não há captação.
      const avg = sum / bars;
      const now = performance.now();
      if (avg > 6) lastSoundRef.current = now;
      const isSilent = now - lastSoundRef.current > 4000;
      if (isSilent !== silentRef.current) {
        silentRef.current = isSilent;
        setSilent(isSilent);
      }
    };
    draw();

    return () => {
      if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    };
  }, [phase]);

  const processAudio = useCallback(async (blob: Blob, mime: string) => {
    setPhase('processing');
    try {
      const ext = mime.includes('webm') ? 'webm' : 'mp4';
      const path = `call-recordings/activity_call_${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('activity-chat')
        .upload(path, blob, { contentType: mime });
      if (upErr) throw upErr;

      const { data: urlData } = supabase.storage.from('activity-chat').getPublicUrl(path);
      const audio_url = urlData.publicUrl;
      setRecordingUrl(audio_url);
      setRecordingMime(mime);
      setAttached(false);

      // Busca contexto extra para a IA combinar (histórico do processo + mensagens da atividade).
      let previousActivities: any[] = [];
      let chatMessages: any[] = [];
      try {
        if (processId || caseId || leadId) {
          let q = externalSupabase
            .from('lead_activities')
            .select('id, title, activity_type, status, what_was_done, current_status_notes, next_steps, deadline, created_at')
            .order('created_at', { ascending: false })
            .limit(8);
          if (processId) q = q.eq('process_id', processId);
          else if (caseId) q = q.eq('case_id', caseId);
          else q = q.eq('lead_id', leadId as string);
          if (activityId) q = q.neq('id', activityId);
          const { data: acts } = await q;
          previousActivities = (acts || []).map((a: any) => ({
            title: a.title,
            status: a.status,
            type: a.activity_type,
            what_was_done: stripHtmlToText(a.what_was_done || ''),
            current_status: stripHtmlToText(a.current_status_notes || ''),
            next_steps: stripHtmlToText(a.next_steps || ''),
            date: a.created_at ? String(a.created_at).slice(0, 10) : undefined,
          }));
        }
        if (activityId) {
          const { data: msgs } = await externalSupabase
            .from('activity_chat_messages')
            .select('content, sender_name, message_type, created_at')
            .eq('activity_id', activityId)
            .is('deleted_at', null)
            .order('created_at', { ascending: true })
            .limit(40);
          chatMessages = (msgs || [])
            .filter((m: any) => m.message_type !== 'ai_suggestion')
            .map((m: any) => ({
              sender: m.sender_name,
              type: m.message_type,
              content: stripHtmlToText(m.content || ''),
              date: m.created_at ? String(m.created_at).slice(0, 16).replace('T', ' ') : undefined,
            }));
        }
      } catch (ctxErr) {
        console.warn('[ActivityCallRecorder] contexto extra falhou (segue sem ele):', ctxErr);
      }

      const fullContext = { ...context, previous_activities: previousActivities, chat_messages: chatMessages };

      const { data, error: fnErr } = await cloudFunctions.invoke('transcribe-activity-call', {
        body: { audio_url, activity_context: fullContext },
      });
      if (fnErr) throw fnErr;
      if (!data?.success) throw new Error(data?.error || 'Falha ao processar a ligação');

      setTranscript(data.transcript || '');

      const raw = data.fields || {};
      const applied: ActivityCallFields = {};
      for (const k of CALL_FIELD_KEYS) {
        const v = raw[k];
        if (v && String(v).trim()) applied[k] = String(v).trim();
      }
      onFields(applied);

      setPhase('done');
      const count = Object.keys(applied).length;
      toast.success(
        count > 0
          ? `IA preencheu ${count} campo(s) com base na ligação — revise antes de salvar.`
          : 'Transcrição pronta, mas a IA não identificou campos para preencher.'
      );
    } catch (e: any) {
      console.error('processAudio error', e);
      setError(e?.message || 'Erro ao processar a ligação');
      setPhase('done');
      toast.error(e?.message || 'Erro ao processar a ligação');
    }
  }, [context, onFields, activityId, leadId, caseId, processId]);

  const stopRecording = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') { teardownAudio(); setPhase('idle'); return; }
    const mime = recorder.mimeType;
    recorder.onstop = () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      teardownAudio();
      const blob = new Blob(chunksRef.current, { type: mime });
      if (blob.size < 1000) {
        toast.error('Gravação muito curta.');
        setPhase('idle');
        return;
      }
      processAudio(blob, mime);
    };
    try { recorder.stop(); } catch { /* noop */ }
  }, [processAudio, teardownAudio]);

  const reset = useCallback(() => {
    teardownAudio();
    setPhase('idle');
    setSeconds(0);
    setTranscript('');
    setError(null);
    setSilent(false);
    silentRef.current = false;
    setRecordingUrl(null);
  }, [teardownAudio]);

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o && phase === 'done') reset(); }}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs gap-1 text-green-700 border-green-200 hover:bg-green-50 dark:text-green-400 dark:border-green-800 dark:hover:bg-green-900/20"
          title="Gravar ligação e preencher a atividade automaticamente"
        >
          <Phone className="h-3 w-3" /><Mic className="h-3 w-3" /> Gravar ligação
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-3 space-y-3">
        <div className="flex items-center gap-2">
          <Phone className="h-4 w-4 text-green-600" />
          <span className="text-sm font-semibold">Gravar ligação → preencher atividade</span>
        </div>

        {phase === 'idle' && (
          <>
            <div className="flex items-start gap-1.5 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 p-2">
              <Info className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
              <span className="text-[11px] text-amber-700 dark:text-amber-300">
                Deixe a ligação no <strong>viva-voz</strong> perto do microfone para captar os dois lados.
                Informe o interlocutor de que a conversa será registrada.
              </span>
            </div>
            <Button className="w-full gap-2" size="sm" onClick={startRecording}>
              <Mic className="h-4 w-4" /> Iniciar gravação
            </Button>
          </>
        )}

        {phase === 'recording' && (
          <>
            <div className="flex items-center justify-center gap-2 py-2">
              <span className="h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse" />
              <span className="font-mono text-lg">{fmt(seconds)}</span>
            </div>
            {/* Visualizador da frequência da voz — confirma que o microfone está captando. */}
            <canvas
              ref={canvasRef}
              width={288}
              height={44}
              className="w-full h-11 rounded bg-muted/40 border"
            />
            {silent ? (
              <div className="flex items-start gap-1.5 rounded-md bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50 p-2">
                <Info className="h-3.5 w-3.5 text-red-600 shrink-0 mt-0.5" />
                <span className="text-[11px] text-red-700 dark:text-red-300">
                  Nenhum som detectado. Aproxime o microfone, aumente o volume do viva-voz ou fale mais alto.
                </span>
              </div>
            ) : (
              <p className="text-[11px] text-center text-muted-foreground">🎤 Captando áudio… fale normalmente</p>
            )}
            <Button variant="destructive" className="w-full gap-2" size="sm" onClick={stopRecording}>
              <Square className="h-4 w-4" /> Parar e processar
            </Button>
          </>
        )}

        {phase === 'processing' && (
          <div className="flex flex-col items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>Transcrevendo e preenchendo os campos…</span>
          </div>
        )}

        {phase === 'done' && (
          <>
            {error ? (
              <p className="text-xs text-destructive">{error}</p>
            ) : (
              <div className="flex items-center gap-1.5 text-xs text-green-700 dark:text-green-400">
                <Sparkles className="h-3.5 w-3.5" /> Campos preenchidos — revise antes de salvar.
              </div>
            )}
            {transcript && (
              <div>
                <p className="text-[11px] font-medium text-muted-foreground mb-1">Transcrição da ligação:</p>
                <ScrollArea className="max-h-40 rounded border p-2">
                  <p className="text-xs whitespace-pre-wrap">{transcript}</p>
                </ScrollArea>
              </div>
            )}
            {recordingUrl && (
              <Button
                variant="outline"
                className="w-full gap-2"
                size="sm"
                onClick={() => downloadRecording(recordingUrl, `gravacao-ligacao-${seconds}s.webm`)}
              >
                <Download className="h-4 w-4" /> Baixar gravação
              </Button>
            )}
            <Button variant="outline" className="w-full gap-2" size="sm" onClick={reset}>
              <RotateCcw className="h-4 w-4" /> Gravar novamente
            </Button>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
