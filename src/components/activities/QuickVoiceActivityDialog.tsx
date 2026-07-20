import { useState, useRef, useCallback, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Mic, Square, Loader2, Sparkles, RotateCcw, Save } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { externalSupabase } from '@/integrations/supabase/external-client';
import { cloudFunctions } from '@/lib/functionRouter';
import { useActivityTypes } from '@/hooks/useActivityTypes';
import { useLeadActivities } from '@/hooks/useLeadActivities';
import { useAuthContext } from '@/contexts/AuthContext';
import { callFieldTextToHtml } from '@/components/activities/ActivityCallRecorder';

type Phase = 'idle' | 'recording' | 'processing' | 'preview' | 'saving';

interface DictatedFields {
  title: string;
  activity_type: string;
  priority: string;
  deadline: string;
  lead_name: string;
  what_was_done: string;
  current_status: string;
  next_steps: string;
  notes: string;
}

const EMPTY: DictatedFields = {
  title: '', activity_type: '', priority: 'normal', deadline: '', lead_name: '',
  what_was_done: '', current_status: '', next_steps: '', notes: '',
};

const PRIORITIES = [
  { value: 'baixa', label: 'Baixa' },
  { value: 'normal', label: 'Normal' },
  { value: 'alta', label: 'Alta' },
  { value: 'urgente', label: 'Urgente' },
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Chamado após criar a atividade com sucesso (ex.: fechar prompt de ociosidade). */
  onCreated?: (activityId: string) => void;
}

/**
 * Registro rápido por voz: o assessor dita "o que está fazendo agora", a IA
 * transcreve e estrutura em campos (escolhendo o TIPO mais adequado), mostra um
 * mini-preview editável e cria uma atividade de documentação (interna, atribuída
 * a si mesmo). Serve para documentar o dia — inclusive a partir do prompt de ociosidade.
 */
export function QuickVoiceActivityDialog({ open, onOpenChange, onCreated }: Props) {
  const { user, profile } = useAuthContext();
  const { types } = useActivityTypes();
  const { createActivity } = useLeadActivities();

  const [phase, setPhase] = useState<Phase>('idle');
  const [seconds, setSeconds] = useState(0);
  const [transcript, setTranscript] = useState('');
  const [fields, setFields] = useState<DictatedFields>(EMPTY);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const cleanupStream = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  // Reset ao fechar; para gravação em andamento.
  useEffect(() => {
    if (!open) {
      cleanupStream();
      try { mediaRecorderRef.current?.stop(); } catch { /* noop */ }
      setPhase('idle'); setSeconds(0); setTranscript(''); setFields(EMPTY); setError(null);
    }
  }, [open, cleanupStream]);

  useEffect(() => () => cleanupStream(), [cleanupStream]);

  const fmt = (s: number) => `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;

  const typeOptions = types
    .filter((t) => t.is_active)
    .map((t) => ({ key: t.key, label: t.label }));

  const runDictation = useCallback(async (audio_url: string) => {
    setPhase('processing');
    setError(null);
    try {
      const { data, error: fnErr } = await cloudFunctions.invoke('dictate-activity', {
        body: { audio_url, activity_types: typeOptions },
      });
      if (fnErr) throw fnErr;
      if (!data?.success) throw new Error(data?.error || 'Falha ao processar o ditado');
      setTranscript(data.transcript || '');
      const f = data.fields || {};
      setFields({
        title: f.title || '',
        activity_type: f.activity_type || (typeOptions[0]?.key ?? ''),
        priority: f.priority || 'normal',
        deadline: f.deadline || '',
        lead_name: f.lead_name || '',
        what_was_done: f.what_was_done || '',
        current_status: f.current_status || '',
        next_steps: f.next_steps || '',
        notes: f.notes || '',
      });
      setPhase('preview');
      if (data.fill_error) toast.warning('Transcrição pronta, mas a estruturação falhou parcialmente — revise os campos.');
    } catch (e: any) {
      console.error('[QuickVoiceActivity] runDictation error', e);
      setError(e?.message || 'Erro ao processar o ditado');
      setPhase('preview');
    }
  }, [typeOptions]);

  const processAudio = useCallback(async (blob: Blob, mime: string) => {
    setPhase('processing');
    try {
      const ext = mime.includes('webm') ? 'webm' : 'mp4';
      const path = `dictations/quick_activity_${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('activity-chat')
        .upload(path, blob, { contentType: mime });
      if (upErr) throw upErr;
      const { data: urlData } = supabase.storage.from('activity-chat').getPublicUrl(path);
      await runDictation(urlData.publicUrl);
    } catch (e: any) {
      console.error('[QuickVoiceActivity] processAudio error', e);
      setError(e?.message || 'Erro ao enviar o áudio');
      setPhase('preview');
    }
  }, [runDictation]);

  const startRecording = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.start(1000);
      setSeconds(0);
      timerRef.current = setInterval(() => setSeconds((p) => p + 1), 1000);
      setPhase('recording');
    } catch (e: any) {
      console.error('[QuickVoiceActivity] mic error', e);
      toast.error('Não foi possível acessar o microfone. Verifique a permissão do navegador.');
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') { cleanupStream(); setPhase('idle'); return; }
    const mime = recorder.mimeType;
    recorder.onstop = () => {
      cleanupStream();
      const blob = new Blob(chunksRef.current, { type: mime });
      if (blob.size < 1000) { toast.error('Gravação muito curta.'); setPhase('idle'); return; }
      processAudio(blob, mime);
    };
    try { recorder.stop(); } catch { /* noop */ }
  }, [cleanupStream, processAudio]);

  const handleSave = useCallback(async () => {
    if (!fields.title.trim()) { toast.error('Dê um título à atividade.'); return; }
    setPhase('saving');
    try {
      // Vínculo a lead só em match FORTE (nome idêntico e único) — evita falso positivo.
      let leadId: string | null = null;
      const leadName = fields.lead_name.trim();
      if (leadName) {
        try {
          const { data: leads } = await externalSupabase
            .from('leads')
            .select('id, lead_name')
            .ilike('lead_name', leadName)
            .limit(2);
          if (leads && leads.length === 1) leadId = (leads[0] as any).id;
        } catch { /* segue sem vínculo */ }
      }

      const created: any = await createActivity({
        title: fields.title.trim(),
        activity_type: fields.activity_type || 'tarefa',
        priority: fields.priority || 'normal',
        deadline: fields.deadline || undefined,
        // Documentação pessoal: interna e atribuída a quem ditou. Se casou com um lead, vincula.
        is_management: !leadId,
        lead_id: leadId || undefined,
        lead_name: leadName || undefined,
        assigned_to: user?.id,
        assigned_to_name: profile?.full_name || undefined,
        what_was_done: fields.what_was_done ? callFieldTextToHtml(fields.what_was_done) : undefined,
        current_status_notes: fields.current_status ? callFieldTextToHtml(fields.current_status) : undefined,
        next_steps: fields.next_steps ? callFieldTextToHtml(fields.next_steps) : undefined,
        notes: fields.notes ? callFieldTextToHtml(fields.notes) : undefined,
      } as any);

      if (!created?.id) throw new Error('Atividade não foi criada');
      toast.success('Atividade registrada!');
      onCreated?.(created.id);
      onOpenChange(false);
    } catch (e: any) {
      console.error('[QuickVoiceActivity] save error', e);
      if (e?.message !== 'LINK_REQUIRED') toast.error(e?.message || 'Erro ao salvar a atividade');
      setPhase('preview');
    }
  }, [fields, user, profile, createActivity, onCreated, onOpenChange]);

  const restart = () => { setPhase('idle'); setSeconds(0); setTranscript(''); setFields(EMPTY); setError(null); };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mic className="h-5 w-5 text-primary" /> O que você está fazendo?
          </DialogTitle>
          <DialogDescription>
            Fale o que está fazendo agora. A IA transcreve, escolhe o tipo mais adequado e registra como atividade — para documentar seu dia.
          </DialogDescription>
        </DialogHeader>

        {phase === 'idle' && (
          <div className="flex flex-col items-center gap-3 py-4">
            <Button className="gap-2" size="lg" onClick={startRecording}>
              <Mic className="h-5 w-5" /> Iniciar gravação
            </Button>
            <p className="text-xs text-muted-foreground text-center">
              Ex.: "Estou analisando o processo do cliente João, protocolando o recurso até sexta."
            </p>
          </div>
        )}

        {phase === 'recording' && (
          <div className="flex flex-col items-center gap-3 py-4">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse" />
              <span className="font-mono text-lg">{fmt(seconds)}</span>
            </div>
            <p className="text-xs text-muted-foreground">🎤 Gravando… fale normalmente</p>
            <Button variant="destructive" className="gap-2" onClick={stopRecording}>
              <Square className="h-4 w-4" /> Parar e processar
            </Button>
          </div>
        )}

        {phase === 'processing' && (
          <div className="flex flex-col items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
            <span>Transcrevendo e organizando os campos…</span>
          </div>
        )}

        {(phase === 'preview' || phase === 'saving') && (
          <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
            {error && <p className="text-xs text-destructive">{error}</p>}
            <div className="flex items-center gap-1.5 text-xs text-green-700 dark:text-green-400">
              <Sparkles className="h-3.5 w-3.5" /> Revise e ajuste antes de salvar.
            </div>

            <div>
              <Label className="text-xs">Título</Label>
              <Input value={fields.title} onChange={(e) => setFields((f) => ({ ...f, title: e.target.value }))} className="h-8 text-sm mt-0.5" />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Tipo (sugerido pela IA)</Label>
                <Select value={fields.activity_type} onValueChange={(v) => setFields((f) => ({ ...f, activity_type: v }))}>
                  <SelectTrigger className="h-8 text-xs mt-0.5"><SelectValue placeholder="Tipo" /></SelectTrigger>
                  <SelectContent>
                    {typeOptions.map((t) => <SelectItem key={t.key} value={t.key} className="text-xs">{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Prioridade</Label>
                <Select value={fields.priority} onValueChange={(v) => setFields((f) => ({ ...f, priority: v }))}>
                  <SelectTrigger className="h-8 text-xs mt-0.5"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map((p) => <SelectItem key={p.value} value={p.value} className="text-xs">{p.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {fields.deadline && (
              <div>
                <Label className="text-xs">Prazo</Label>
                <Input type="date" value={fields.deadline} onChange={(e) => setFields((f) => ({ ...f, deadline: e.target.value }))} className="h-8 text-xs mt-0.5" />
              </div>
            )}

            <div>
              <Label className="text-xs">O que está fazendo</Label>
              <Textarea value={fields.what_was_done} onChange={(e) => setFields((f) => ({ ...f, what_was_done: e.target.value }))} rows={2} className="text-sm mt-0.5" />
            </div>
            {fields.current_status && (
              <div>
                <Label className="text-xs">Como está</Label>
                <Textarea value={fields.current_status} onChange={(e) => setFields((f) => ({ ...f, current_status: e.target.value }))} rows={2} className="text-sm mt-0.5" />
              </div>
            )}
            <div>
              <Label className="text-xs">Próximo passo</Label>
              <Textarea value={fields.next_steps} onChange={(e) => setFields((f) => ({ ...f, next_steps: e.target.value }))} rows={2} className="text-sm mt-0.5" />
            </div>

            {fields.lead_name && (
              <p className="text-[11px] text-muted-foreground">
                Cliente citado: <b>{fields.lead_name}</b> — será vinculado se houver correspondência exata.
              </p>
            )}
          </div>
        )}

        {(phase === 'preview' || phase === 'saving') && (
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={restart} disabled={phase === 'saving'} className="gap-1">
              <RotateCcw className="h-4 w-4" /> Gravar de novo
            </Button>
            <Button onClick={handleSave} disabled={phase === 'saving'} className="gap-1">
              {phase === 'saving' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Salvar atividade
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
