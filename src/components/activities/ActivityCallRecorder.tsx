import { useState, useRef, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Phone, Mic, Square, Loader2, Sparkles, Info, RotateCcw, Download, Send, Volume2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { externalSupabase } from '@/integrations/supabase/external-client';
import { remapToExternal } from '@/integrations/supabase/uuid-remap';
import { cloudFunctions } from '@/lib/functionRouter';
import { sendVoiceToWa } from '@/lib/whatsappVoiceSend';

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
  /** Metadados atuais — permitem que o áudio os corrija ("muda o prazo pra sexta"). */
  deadline?: string;
  notification_date?: string;
  priority?: string;
  status?: string;
  assessor_name?: string;
  /** Co-assessores atuais da atividade (além do principal). */
  co_assessor_names?: string[];
  /** Nomes dos assessores da equipe (para a IA mapear "passa pro Fulano"). */
  team_members?: string[];
  /** Tipos de atividade válidos no seletor ({ key, label }) — a IA escolhe o mais adequado. */
  activity_types?: { key: string; label: string }[];
  workflow?: { step_label?: string; phase_label?: string; objective_label?: string; next_step?: string };
}

export interface ActivityCallFields {
  what_was_done?: string;
  current_status?: string;
  next_steps?: string;
  solicitacao?: string;
  resposta_juizo?: string;
  notes?: string;
  // Campos de texto podem vir como '' quando o áudio mandou APAGAR o conteúdo.
  title?: string;
  deadline?: string;
  notification_date?: string;
  priority?: string;
  status?: string;
  assessor_name?: string;
  /** Todos os responsáveis ditos no áudio (primeiro = principal). */
  assessor_names?: string[];
  /** Tipo mais adequado ao conteúdo, escolhido pela IA entre os tipos válidos. */
  activity_type?: string;
}

interface Props {
  context: ActivityCallContext;
  onFields: (fields: ActivityCallFields) => void;
  /** IDs para a IA buscar contexto (histórico do processo + mensagens da atividade). */
  activityId?: string | null;
  leadId?: string | null;
  caseId?: string | null;
  processId?: string | null;
  /** JID do grupo WhatsApp vinculado (para envio rápido do áudio ao grupo). */
  groupJid?: string | null;
  /** Telefone do lead (fallback quando não há grupo). */
  leadPhone?: string | null;
  /**
   * Emitido quando o áudio termina de subir pro storage e está pronto pra ser reenviado.
   * O pai (ActivitiesPage) usa isso pra mostrar o botão "Enviar áudio no WA" ao lado
   * do botão "Vincular WA" — permitindo mandar o áudio sem reabrir o popover.
   */
  onRecordingReady?: (info: { url: string; seconds: number } | null) => void;
  /** Controle externo de abertura (ex: dropdown menu pai). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Classe CSS adicional para o botão trigger (ex: sr-only quando controlado por menu pai). */
  triggerClassName?: string;
}

type Phase = 'idle' | 'recording' | 'processing' | 'done';

/** Fonte de captura: microfone (externo), áudio interno do dispositivo, ou os dois mixados. */
type AudioSource = 'mic' | 'system' | 'both';

/**
 * Áudio interno depende de getDisplayMedia (compartilhar tela/aba com áudio).
 * Disponível em Chrome/Edge de desktop; navegadores mobile não expõem essa API.
 */
const supportsSystemAudio =
  typeof navigator !== 'undefined' &&
  !!navigator.mediaDevices &&
  typeof (navigator.mediaDevices as any).getDisplayMedia === 'function';

const SOURCE_LABELS: Record<AudioSource, string> = {
  mic: 'Microfone',
  system: 'Áudio interno',
  both: 'Microfone + interno',
};

// assessor_names (array) fica de fora dos loops de string e é tratado à parte.
type StringCallField = Exclude<keyof ActivityCallFields, 'assessor_names'>;

const CALL_FIELD_KEYS: StringCallField[] = [
  'what_was_done', 'current_status', 'next_steps', 'solicitacao', 'resposta_juizo', 'notes',
];

const META_FIELD_KEYS: StringCallField[] = [
  'title', 'deadline', 'notification_date', 'priority', 'status', 'assessor_name', 'activity_type',
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

export function ActivityCallRecorder({ context, onFields, activityId, leadId, caseId, processId, groupJid, leadPhone, onRecordingReady, open: openProp, onOpenChange, triggerClassName }: Props) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = openProp !== undefined ? openProp : internalOpen;
  const setOpen = (v: boolean) => {
    if (openProp === undefined) setInternalOpen(v);
    onOpenChange?.(v);
  };
  const [phase, setPhase] = useState<Phase>('idle');
  const [source, setSource] = useState<AudioSource>('mic');
  const [seconds, setSeconds] = useState(0);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [silent, setSilent] = useState(false);
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  const [sendingToWa, setSendingToWa] = useState(false);
  const [sentToWa, setSentToWa] = useState(false);
  // Falha na etapa de preenchimento pela IA (a transcrição em si deu certo).
  const [fillError, setFillError] = useState<string | null>(null);
  const [appliedCount, setAppliedCount] = useState(0);
  const [refilling, setRefilling] = useState(false);
  // Pergunta de esclarecimento da IA + resposta do usuário (quando a ligação não basta).
  const [question, setQuestion] = useState<string | null>(null);
  const [answerText, setAnswerText] = useState('');
  // Contexto enviado à IA, guardado pra reusar no "Tentar preencher novamente".
  const lastContextRef = useRef<Record<string, unknown> | null>(null);
  // Gravações de áudio já anexadas à atividade (permitem reprocessar sem gravar de novo).
  const [pastRecordings, setPastRecordings] = useState<{ id: string; file_url: string; file_name: string | null; created_at: string | null }[]>([]);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  // Stream do getDisplayMedia (áudio interno) — precisa ser parado separadamente (inclui track de vídeo).
  const displayStreamRef = useRef<MediaStream | null>(null);
  // Permite que o handler de "parou de compartilhar" (registrado no start) chame o stop mais recente.
  const stopRecordingRef = useRef<(() => void) | null>(null);
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
      displayStreamRef.current?.getTracks().forEach((t) => t.stop());
      try { mediaRecorderRef.current?.stop(); } catch { /* noop */ }
      teardownAudio();
    };
  }, [teardownAudio]);

  const fmt = (s: number) =>
    `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;

  const startRecording = useCallback(async () => {
    setError(null);
    setTranscript('');
    let micStream: MediaStream | null = null;
    let displayStream: MediaStream | null = null;
    try {
      if (source !== 'system') {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }
      if (source !== 'mic') {
        // Áudio interno: o navegador só entrega junto de uma captura de tela/aba.
        // O usuário PRECISA marcar "Compartilhar áudio" na janela de seleção.
        displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        if (displayStream.getAudioTracks().length === 0) {
          displayStream.getTracks().forEach((t) => t.stop());
          throw new Error('NO_SYSTEM_AUDIO');
        }
        displayStreamRef.current = displayStream;
        // Se o usuário encerrar o compartilhamento pela UI do navegador, finaliza a gravação.
        displayStream.getTracks().forEach((t) => {
          t.onended = () => { stopRecordingRef.current?.(); };
        });
      }
      streamRef.current = micStream;

      // Stream que vai pro MediaRecorder: mic direto, ou mix via Web Audio API.
      let recordStream: MediaStream;
      if (source === 'mic') {
        recordStream = micStream!;
      } else {
        const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
        const audioCtx = new AudioCtx();
        audioCtxRef.current = audioCtx;
        const dest = audioCtx.createMediaStreamDestination();
        if (micStream) audioCtx.createMediaStreamSource(micStream).connect(dest);
        audioCtx
          .createMediaStreamSource(new MediaStream(displayStream!.getAudioTracks()))
          .connect(dest);
        recordStream = dest.stream;
      }

      // Medidor de nível de áudio (opcional — só feedback visual).
      try {
        if (!audioCtxRef.current) {
          const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
          audioCtxRef.current = new AudioCtx();
        }
        const audioCtx = audioCtxRef.current!;
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        audioCtx.createMediaStreamSource(recordStream).connect(analyser);
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
      const recorder = new MediaRecorder(recordStream, { mimeType });
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.start(1000);
      setSeconds(0);
      timerRef.current = setInterval(() => setSeconds((p) => p + 1), 1000);
      setPhase('recording');
    } catch (e: any) {
      micStream?.getTracks().forEach((t) => t.stop());
      displayStream?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      displayStreamRef.current = null;
      teardownAudio();
      console.error('Recording start error', e);
      if (e?.message === 'NO_SYSTEM_AUDIO') {
        toast.error('Nenhum áudio interno compartilhado. Na janela de seleção, escolha a aba/tela e marque "Compartilhar áudio".');
      } else if (e?.name === 'NotAllowedError' && source !== 'mic') {
        toast.error('Compartilhamento de tela/áudio cancelado ou negado.');
      } else {
        toast.error('Não foi possível acessar o microfone. Verifique a permissão do navegador.');
      }
    }
  }, [source, teardownAudio]);

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

  /** Aplica os campos retornados pela IA (textos, apagamentos e metadados). Retorna quantos mudaram. */
  const applyResponseFields = useCallback((raw: Record<string, unknown>): number => {
    const applied: ActivityCallFields = {};
    for (const k of CALL_FIELD_KEYS) {
      const v = raw?.[k];
      if (v && String(v).trim()) applied[k] = String(v).trim();
    }
    // Comandos de "apagar campo" ditos no áudio chegam em clear_fields e viram '' (o pai limpa).
    const toClear = Array.isArray((raw as any)?.clear_fields) ? (raw as any).clear_fields : [];
    for (const k of CALL_FIELD_KEYS) {
      if (toClear.includes(k) && applied[k] === undefined) applied[k] = '';
    }
    for (const k of META_FIELD_KEYS) {
      const v = raw?.[k];
      if (v && String(v).trim()) applied[k] = String(v).trim();
    }
    // Multi-assessor: array de nomes (primeiro = principal).
    const spokenAssessors = Array.isArray((raw as any)?.assessor_names)
      ? ((raw as any).assessor_names as unknown[]).map((n) => String(n || '').trim()).filter(Boolean)
      : [];
    if (spokenAssessors.length > 0) applied.assessor_names = spokenAssessors;
    onFields(applied);
    return Object.keys(applied).length;
  }, [onFields]);

  /** Transcreve (no servidor) e preenche os campos a partir de uma URL de áudio já no storage. */
  const runFill = useCallback(async (audio_url: string) => {
    setPhase('processing');
    try {
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
      lastContextRef.current = fullContext;

      const { data, error: fnErr } = await cloudFunctions.invoke('transcribe-activity-call', {
        body: { audio_url, activity_context: fullContext },
      });
      if (fnErr) throw fnErr;
      if (!data?.success) throw new Error(data?.error || 'Falha ao processar a ligação');

      setTranscript(data.transcript || '');

      const count = applyResponseFields(data.fields || {});

      setPhase('done');
      setAppliedCount(count);
      setFillError(data.fill_error || null);
      setQuestion(data.clarifying_question || null);
      if (data.fill_error) {
        toast.error('Transcrição pronta, mas o preenchimento automático falhou. Use "Tentar preencher novamente".');
      } else if (data.clarifying_question) {
        toast.info('A IA tem uma pergunta antes de concluir — veja no painel.', { duration: 5000 });
      } else {
        toast.success(
          count > 0
            ? `IA preencheu ${count} campo(s) com base na ligação — revise antes de salvar.`
            : 'Transcrição pronta, mas a IA não identificou campos para preencher.'
        );
      }
    } catch (e: any) {
      console.error('runFill error', e);
      setError(e?.message || 'Erro ao processar a ligação');
      setPhase('done');
      toast.error(e?.message || 'Erro ao processar a ligação');
    }
  }, [context, activityId, leadId, caseId, processId, applyResponseFields]);

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
      onRecordingReady?.({ url: audio_url, seconds });

      // Guarda a gravação como anexo de áudio da atividade (consulta/análise posterior).
      if (activityId) {
        try {
          const { data: { user } } = await supabase.auth.getUser();
          const extUserId = await remapToExternal(user?.id || null);
          await externalSupabase.from('activity_attachments').insert({
            activity_id: activityId,
            file_url: audio_url,
            file_name: `Gravação da ligação.${ext}`,
            file_type: mime,
            attachment_type: 'audio',
            created_by: extUserId,
          });
        } catch (attErr) {
          console.warn('[ActivityCallRecorder] não foi possível anexar a gravação:', attErr);
        }
      }

      await runFill(audio_url);
    } catch (e: any) {
      console.error('processAudio error', e);
      setError(e?.message || 'Erro ao processar a ligação');
      setPhase('done');
      toast.error(e?.message || 'Erro ao processar a ligação');
    }
  }, [activityId, onRecordingReady, seconds, runFill]);

  const stopRecording = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') { teardownAudio(); setPhase('idle'); return; }
    const mime = recorder.mimeType;
    recorder.onstop = () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      displayStreamRef.current?.getTracks().forEach((t) => t.stop());
      displayStreamRef.current = null;
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

  useEffect(() => {
    stopRecordingRef.current = stopRecording;
  }, [stopRecording]);

  // Carrega as gravações anteriores da atividade quando o popover abre.
  useEffect(() => {
    if (!open || !activityId) { setPastRecordings([]); return; }
    (async () => {
      try {
        const { data } = await externalSupabase
          .from('activity_attachments')
          .select('id, file_url, file_name, created_at')
          .eq('activity_id', activityId)
          .eq('attachment_type', 'audio')
          .order('created_at', { ascending: false })
          .limit(5);
        setPastRecordings((data as any[]) || []);
      } catch {
        setPastRecordings([]);
      }
    })();
  }, [open, activityId]);

  // Refaz só o preenchimento dos campos reaproveitando a transcrição já pronta
  // (envia audio_url junto por compatibilidade com o servidor antigo).
  const retryFill = useCallback(async () => {
    if (!transcript) return;
    setRefilling(true);
    // Se o usuário respondeu à pergunta da IA, envia a resposta como contexto extra.
    const answer = answerText.trim();
    try {
      const { data, error: fnErr } = await cloudFunctions.invoke('transcribe-activity-call', {
        body: {
          transcript,
          audio_url: recordingUrl,
          activity_context: lastContextRef.current || context,
          ...(answer ? { user_answer: answer } : {}),
        },
      });
      if (fnErr) throw fnErr;
      if (!data?.success) throw new Error(data?.error || 'Falha ao preencher os campos');

      const count = applyResponseFields(data.fields || {});
      setAppliedCount(count);
      setFillError(data.fill_error || null);
      setQuestion(data.clarifying_question || null);
      if (data.fill_error) {
        toast.error(`Preenchimento falhou de novo: ${data.fill_error}`);
      } else if (data.clarifying_question) {
        toast.info('A IA ainda tem uma dúvida — veja no painel.', { duration: 5000 });
      } else {
        if (answer) setAnswerText('');
        toast.success(
          count > 0
            ? `IA preencheu ${count} campo(s) — revise antes de salvar.`
            : 'A IA não identificou campos para preencher nesta transcrição.'
        );
      }
    } catch (e: any) {
      console.error('retryFill error', e);
      toast.error(e?.message || 'Erro ao preencher os campos');
    } finally {
      setRefilling(false);
    }
  }, [transcript, recordingUrl, context, applyResponseFields, answerText]);

  const reset = useCallback(() => {
    teardownAudio();
    setPhase('idle');
    setSeconds(0);
    setTranscript('');
    setError(null);
    setSilent(false);
    silentRef.current = false;
    setRecordingUrl(null);
    setSentToWa(false);
    setFillError(null);
    setAppliedCount(0);
    setQuestion(null);
    setAnswerText('');
    onRecordingReady?.(null);
  }, [teardownAudio, onRecordingReady]);

  const waTarget = groupJid || leadPhone || null;
  const waTargetLabel = groupJid ? 'grupo' : 'contato';

  const sendAudioToWa = useCallback(async () => {
    if (!recordingUrl || !waTarget) return;
    setSendingToWa(true);
    try {
      await sendVoiceToWa(recordingUrl, waTarget, leadId);
      setSentToWa(true);
      toast.success(`Áudio enviado ao ${waTargetLabel} do WhatsApp!`);
    } catch (e: any) {
      console.error('sendAudioToWa error', e);
      toast.error(e?.message || 'Erro ao enviar áudio no WhatsApp');
    } finally {
      setSendingToWa(false);
    }
  }, [recordingUrl, waTarget, waTargetLabel, leadId]);



  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); }}>
      <PopoverTrigger asChild className={triggerClassName}>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs gap-1 text-green-700 border-green-200 hover:bg-green-50 dark:text-green-400 dark:border-green-800 dark:hover:bg-green-900/20"
          title="Grave um áudio para transcrever e preencher a atividade automaticamente"
        >
          <Mic className="h-3 w-3" /> Preenchimento por Áudio
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-3 space-y-3">
        <div className="flex items-center gap-2">
          <Mic className="h-4 w-4 text-green-600" />
          <span className="text-sm font-semibold">Preenchimento por Áudio</span>
        </div>

        {phase === 'idle' && (
          <>
            <div>
              <p className="text-[11px] font-medium text-muted-foreground mb-1">O que gravar?</p>
              <div className="grid grid-cols-3 gap-1">
                <Button
                  type="button"
                  variant={source === 'mic' ? 'default' : 'outline'}
                  size="sm"
                  className="h-auto flex-col gap-0.5 py-1.5 text-[10px]"
                  onClick={() => setSource('mic')}
                >
                  <Mic className="h-3.5 w-3.5" /> Microfone
                </Button>
                <Button
                  type="button"
                  variant={source === 'system' ? 'default' : 'outline'}
                  size="sm"
                  className="h-auto flex-col gap-0.5 py-1.5 text-[10px]"
                  disabled={!supportsSystemAudio}
                  onClick={() => setSource('system')}
                >
                  <Volume2 className="h-3.5 w-3.5" /> Áudio interno
                </Button>
                <Button
                  type="button"
                  variant={source === 'both' ? 'default' : 'outline'}
                  size="sm"
                  className="h-auto flex-col gap-0.5 py-1.5 text-[10px]"
                  disabled={!supportsSystemAudio}
                  onClick={() => setSource('both')}
                >
                  <span className="flex items-center gap-0.5"><Mic className="h-3 w-3" /><Volume2 className="h-3 w-3" /></span>
                  Ambos
                </Button>
              </div>
            </div>

            {!supportsSystemAudio && (
              <div className="flex items-start gap-1.5 rounded-md bg-muted/60 border p-2">
                <Info className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                <span className="text-[11px] text-muted-foreground">
                  <strong>Áudio interno</strong> só está disponível no navegador do computador (Chrome/Edge).
                  No celular, o sistema não permite capturar o som interno — use o viva-voz.
                </span>
              </div>
            )}

            {source === 'mic' ? (
              <div className="flex items-start gap-1.5 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 p-2">
                <Info className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
                <span className="text-[11px] text-amber-700 dark:text-amber-300">
                  Deixe a ligação no <strong>viva-voz</strong> perto do microfone para captar os dois lados.
                  Informe o interlocutor de que a conversa será registrada.
                </span>
              </div>
            ) : (
              <div className="flex items-start gap-1.5 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 p-2">
                <Info className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
                <span className="text-[11px] text-amber-700 dark:text-amber-300">
                  O navegador vai pedir para <strong>compartilhar uma aba ou a tela</strong> — selecione onde o som
                  está tocando e marque <strong>"Compartilhar áudio"</strong>, senão nada será captado.
                  Informe o interlocutor de que a conversa será registrada.
                </span>
              </div>
            )}

            <Button className="w-full gap-2" size="sm" onClick={startRecording}>
              <Mic className="h-4 w-4" /> Iniciar gravação ({SOURCE_LABELS[source]})
            </Button>

            {pastRecordings.length > 0 && (
              <div className="space-y-1 pt-2 border-t">
                <p className="text-[11px] font-medium text-muted-foreground">
                  Ou reaproveite uma gravação desta atividade (você pode ditar correções e depois usar esta opção):
                </p>
                {pastRecordings.map((r) => (
                  <Button
                    key={r.id}
                    variant="outline"
                    size="sm"
                    className="w-full justify-start gap-2 h-8 text-xs"
                    onClick={() => { setRecordingUrl(r.file_url); runFill(r.file_url); }}
                  >
                    <Phone className="h-3.5 w-3.5 shrink-0 text-green-600" />
                    <span className="truncate">
                      {r.file_name || 'Gravação'}
                      {r.created_at ? ` — ${new Date(r.created_at).toLocaleDateString('pt-BR')} ${new Date(r.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : ''}
                    </span>
                  </Button>
                ))}
              </div>
            )}
          </>
        )}

        {phase === 'recording' && (
          <>
            <div className="flex items-center justify-center gap-2 py-2">
              <span className="h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse" />
              <span className="font-mono text-lg">{fmt(seconds)}</span>
              <span className="text-[10px] text-muted-foreground">({SOURCE_LABELS[source]})</span>
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
                  {source === 'mic'
                    ? 'Nenhum som detectado. Aproxime o microfone, aumente o volume do viva-voz ou fale mais alto.'
                    : 'Nenhum som detectado. Confira se marcou "Compartilhar áudio" na aba/tela certa e se o som está tocando.'}
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
            ) : fillError ? (
              <div className="flex items-start gap-1.5 rounded-md bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50 p-2">
                <Info className="h-3.5 w-3.5 text-red-600 shrink-0 mt-0.5" />
                <span className="text-[11px] text-red-700 dark:text-red-300">
                  Transcrição pronta, mas o preenchimento automático falhou: {fillError}
                </span>
              </div>
            ) : appliedCount > 0 ? (
              <div className="flex items-center gap-1.5 text-xs text-green-700 dark:text-green-400">
                <Sparkles className="h-3.5 w-3.5" /> Campos preenchidos — revise antes de salvar.
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                A IA não identificou campos para preencher nesta transcrição.
              </p>
            )}
            {question && (
              <div className="rounded-md border border-amber-300 bg-amber-50 dark:border-amber-800/60 dark:bg-amber-950/30 p-2.5 space-y-1.5">
                <div className="flex items-start gap-1.5">
                  <Info className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
                  <div className="text-[11px] text-amber-800 dark:text-amber-200">
                    <strong>A IA precisa de um esclarecimento:</strong>
                    <p className="mt-0.5">{question}</p>
                  </div>
                </div>
                <textarea
                  value={answerText}
                  onChange={(e) => setAnswerText(e.target.value)}
                  placeholder="Responda aqui e clique em Reenviar…"
                  className="w-full min-h-[56px] rounded border bg-background p-2 text-xs"
                />
                <Button size="sm" className="w-full gap-2" onClick={retryFill} disabled={refilling || !answerText.trim()}>
                  {refilling ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> Reenviando…</>
                  ) : (
                    <><Sparkles className="h-4 w-4" /> Reenviar com a resposta</>
                  )}
                </Button>
              </div>
            )}
            {!error && !question && transcript && (fillError || appliedCount === 0) && (
              <Button
                variant="default"
                className="w-full gap-2"
                size="sm"
                onClick={retryFill}
                disabled={refilling}
              >
                {refilling ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Preenchendo…</>
                ) : (
                  <><Sparkles className="h-4 w-4" /> Tentar preencher novamente</>
                )}
              </Button>
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
            {recordingUrl && waTarget && (
              <Button
                variant="default"
                className="w-full gap-2 bg-green-600 hover:bg-green-700"
                size="sm"
                onClick={sendAudioToWa}
                disabled={sendingToWa || sentToWa}
              >
                {sendingToWa ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Enviando ao {waTargetLabel}…</>
                ) : sentToWa ? (
                  <><Sparkles className="h-4 w-4" /> Áudio enviado ao {waTargetLabel}</>
                ) : (
                  <><Send className="h-4 w-4" /> Enviar áudio no WhatsApp ({waTargetLabel})</>
                )}
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
