import { useState, useRef, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Phone, Mic, Square, Loader2, Sparkles, Info, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
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
}

type Phase = 'idle' | 'recording' | 'processing' | 'done';

const CALL_FIELD_KEYS: (keyof ActivityCallFields)[] = [
  'what_was_done', 'current_status', 'next_steps', 'solicitacao', 'resposta_juizo', 'notes',
];

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

export function ActivityCallRecorder({ context, onFields }: Props) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [seconds, setSeconds] = useState(0);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      try { mediaRecorderRef.current?.stop(); } catch { /* noop */ }
    };
  }, []);

  const fmt = (s: number) =>
    `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;

  const startRecording = useCallback(async () => {
    setError(null);
    setTranscript('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
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

      const { data, error: fnErr } = await cloudFunctions.invoke('transcribe-activity-call', {
        body: { audio_url, activity_context: context },
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
  }, [context, onFields]);

  const stopRecording = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') { setPhase('idle'); return; }
    const mime = recorder.mimeType;
    recorder.onstop = () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunksRef.current, { type: mime });
      if (blob.size < 1000) {
        toast.error('Gravação muito curta.');
        setPhase('idle');
        return;
      }
      processAudio(blob, mime);
    };
    try { recorder.stop(); } catch { /* noop */ }
  }, [processAudio]);

  const reset = useCallback(() => {
    setPhase('idle');
    setSeconds(0);
    setTranscript('');
    setError(null);
  }, []);

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
            <Button variant="outline" className="w-full gap-2" size="sm" onClick={reset}>
              <RotateCcw className="h-4 w-4" /> Gravar novamente
            </Button>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
