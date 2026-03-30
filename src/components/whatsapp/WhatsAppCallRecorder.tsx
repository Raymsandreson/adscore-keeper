import { useState, useRef, useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuthContext } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Phone, Mic, MicOff, Square, Loader2, PhoneOff, PhoneCall, FileText, Save, Sparkles, User, BookOpen } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';

interface Props {
  phone: string;
  contactName: string | null;
  contactId: string | null;
  leadId: string | null;
  leadName?: string | null;
  instanceId?: string | null;
  instanceName?: string | null;
}

type CallPhase = 'idle' | 'calling' | 'post-call';

export function WhatsAppCallRecorder({ phone, contactName, contactId, leadId, leadName, instanceId, instanceName }: Props) {
  const { user } = useAuthContext();
  const [phase, setPhase] = useState<CallPhase>('idle');
  const [recordingTime, setRecordingTime] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [callRecordId, setCallRecordId] = useState<string | null>(null);

  // Real-time transcription
  const [liveTranscript, setLiveTranscript] = useState('');
  const [sttActive, setSttActive] = useState(false);
  const recognitionRef = useRef<any>(null);

  // Post-call state
  const [summarizing, setSummarizing] = useState(false);
  const [summary, setSummary] = useState('');
  const [savingTo, setSavingTo] = useState<string | null>(null);

  // Recording refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
      recognitionRef.current?.stop();
    };
  }, []);

  const formatTime = (s: number) =>
    `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;

  // Start speech recognition for real-time transcription
  const startSpeechRecognition = useCallback(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.lang = 'pt-BR';
    recognition.continuous = true;
    recognition.interimResults = true;

    let finalText = '';

    recognition.onresult = (event: any) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalText += transcript + ' ';
        } else {
          interim = transcript;
        }
      }
      setLiveTranscript(finalText + (interim ? `[...${interim}]` : ''));
    };

    recognition.onerror = (event: any) => {
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      console.error('STT error:', event.error);
    };

    recognition.onend = () => {
      // Restart if still calling
      if (recognitionRef.current === recognition) {
        try { recognition.start(); } catch {}
      }
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
      setSttActive(true);
    } catch (err) {
      console.error('STT start error:', err);
    }
  }, []);

  const stopSpeechRecognition = useCallback(() => {
    if (recognitionRef.current) {
      const ref = recognitionRef.current;
      recognitionRef.current = null; // prevent restart in onend
      try { ref.stop(); } catch {}
      setSttActive(false);
    }
  }, []);

  const makeCall = useCallback(async (): Promise<string | null> => {
    try {
      const cleanPhone = phone.replace(/\D/g, '');

      const { data, error } = await cloudFunctions.invoke('make-whatsapp-call', {
        body: {
          phone: cleanPhone,
          instance_name: instanceName,
          instance_id: instanceId,
          contact_name: contactName,
          contact_id: contactId,
          lead_id: leadId,
          lead_name: leadName,
        },
      });

      if (error) throw error;

      if (!data?.success) {
        throw new Error(data?.error || 'Erro ao iniciar chamada WhatsApp');
      }

      toast.success(`Ligando para ${contactName || phone} via WhatsApp...`);
      return data.call_record_id || null;
    } catch (err: any) {
      console.error('WhatsApp call error:', err);
      toast.error(err?.message || 'Erro ao ligar via WhatsApp');
      return null;
    }
  }, [phone, contactName, contactId, leadId, leadName, instanceId, instanceName]);

  const startRecording = useCallback(async () => {
    const recordId = await makeCall();
    setCallRecordId(recordId);
    setLiveTranscript('');
    setSummary('');
    setPhase('calling');

    // Start real-time transcription
    startSpeechRecognition();

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

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.start(1000);
      setRecordingTime(0);
      timerRef.current = setInterval(() => setRecordingTime(prev => prev + 1), 1000);
      toast.success('Ligação iniciada! Gravação e transcrição ativas.');
    } catch (err) {
      console.error('Mic access error:', err);
      setRecordingTime(0);
      timerRef.current = setInterval(() => setRecordingTime(prev => prev + 1), 1000);
      toast.info('Ligação iniciada. Gravação indisponível (microfone negado).');
    }
  }, [makeCall, startSpeechRecognition]);

  const stopRecording = useCallback(async (callResult: string = 'atendeu') => {
    if (timerRef.current) clearInterval(timerRef.current);
    stopSpeechRecognition();

    // WhatsApp call ends on the device side, no SDK disconnect needed

    const currentDuration = recordingTime;
    const recorder = mediaRecorderRef.current;
    const hasRecording = recorder && recorder.state !== 'inactive';

    // Update call_record
    if (callRecordId) {
      try {
        await supabase.from('call_records').update({
          call_result: callResult,
          duration_seconds: currentDuration,
        } as any).eq('id', callRecordId);
      } catch {}
    }

    // Save audio if available
    if (hasRecording && user) {
      setProcessing(true);
      const currentMime = recorder.mimeType;
      const currentCallRecordId = callRecordId;

      recorder.onstop = async () => {
        streamRef.current?.getTracks().forEach(t => t.stop());

        const blob = new Blob(chunksRef.current, { type: currentMime });
        const ext = currentMime.includes('webm') ? 'webm' : 'mp4';
        const fileName = `whatsapp_call_${phone}_${Date.now()}.${ext}`;

        try {
          const { error: uploadError } = await supabase.storage
            .from('activity-chat')
            .upload(`call-recordings/${fileName}`, blob, { contentType: currentMime });

          if (uploadError) throw uploadError;

          const { data: urlData } = supabase.storage
            .from('activity-chat')
            .getPublicUrl(`call-recordings/${fileName}`);

          if (currentCallRecordId) {
            await supabase.from('call_records').update({
              audio_url: urlData.publicUrl,
              audio_file_name: fileName,
            } as any).eq('id', currentCallRecordId);
          }
          toast.success('Áudio salvo!');
        } catch (err) {
          console.error('Error saving recording:', err);
        }
        setProcessing(false);
      };

      try { recorder.stop(); } catch {}
    } else {
      streamRef.current?.getTracks().forEach(t => t.stop());
    }

    // Move to post-call phase if we have transcript
    if (liveTranscript.trim() && callResult === 'atendeu') {
      setPhase('post-call');
    } else {
      setPhase('idle');
      setCallRecordId(null);
      if (callRecordId) toast.success('Ligação registrada!');
    }
  }, [user, phone, recordingTime, callRecordId, liveTranscript, stopSpeechRecognition]);

  // AI Summary
  const handleSummarize = useCallback(async () => {
    if (!liveTranscript.trim()) return;
    setSummarizing(true);
    try {
      const { data, error } = await cloudFunctions.invoke('analyze-activity-chat', {
        body: {
          action: 'summarize_text',
          text: liveTranscript,
          context: `Transcrição em tempo real de uma ligação WhatsApp com ${contactName || phone}.${leadName ? ` Lead: ${leadName}` : ''}`,
        },
      });
      if (error) throw error;
      setSummary(data?.summary || data?.content || 'Não foi possível gerar resumo.');
    } catch (err) {
      console.error('Summarize error:', err);
      toast.error('Erro ao gerar resumo');
    } finally {
      setSummarizing(false);
    }
  }, [liveTranscript, contactName, phone, leadName]);

  // Save to contact/lead
  const handleSaveTo = useCallback(async (target: 'contact' | 'lead') => {
    const textToSave = summary || liveTranscript;
    if (!textToSave.trim()) return;

    setSavingTo(target);
    const dateStr = new Date().toLocaleDateString('pt-BR');
    const prefix = `📞 Transcrição da ligação (${dateStr}):\n`;
    const fullText = prefix + textToSave;

    try {
      if (target === 'contact' && contactId) {
        const { data: existing } = await supabase.from('contacts').select('notes').eq('id', contactId).single();
        const currentNotes = existing?.notes || '';
        const newNotes = currentNotes ? `${currentNotes}\n\n${fullText}` : fullText;
        await supabase.from('contacts').update({ notes: newNotes }).eq('id', contactId);
        toast.success('Salvo no contato!');
      } else if (target === 'lead' && leadId) {
        // Save as call_record notes + ai_transcript
        if (callRecordId) {
          await supabase.from('call_records').update({
            ai_transcript: liveTranscript,
            ai_summary: summary || null,
            notes: `Transcrição em tempo real da ligação.${summary ? `\n\nResumo: ${summary}` : ''}`,
          } as any).eq('id', callRecordId);
        }
        toast.success('Salvo no lead!');
      } else {
        toast.error(target === 'contact' ? 'Contato não vinculado' : 'Lead não vinculado');
      }
    } catch (err) {
      console.error('Save error:', err);
      toast.error('Erro ao salvar');
    } finally {
      setSavingTo(null);
    }
  }, [summary, liveTranscript, contactId, leadId, callRecordId]);

  const handleDismissPostCall = () => {
    setPhase('idle');
    setCallRecordId(null);
    setLiveTranscript('');
    setSummary('');
  };

  // POST-CALL PHASE
  if (phase === 'post-call') {
    return (
      <div className="border rounded-lg p-3 space-y-3 bg-card max-w-sm">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Transcrição da ligação</span>
          <Button variant="ghost" size="sm" className="ml-auto h-6 text-xs" onClick={handleDismissPostCall}>
            Fechar
          </Button>
        </div>

        <ScrollArea className="max-h-40 border rounded p-2">
          <p className="text-xs whitespace-pre-wrap">{liveTranscript || 'Nenhuma transcrição capturada.'}</p>
        </ScrollArea>

        {/* Summarize button */}
        <Button
          variant="outline"
          size="sm"
          className="w-full gap-2 text-xs"
          onClick={handleSummarize}
          disabled={summarizing || !liveTranscript.trim()}
        >
          {summarizing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
          {summarizing ? 'Resumindo...' : 'Resumir com IA'}
        </Button>

        {summary && (
          <div className="border rounded p-2 bg-muted/50">
            <p className="text-[11px] font-semibold text-muted-foreground mb-1">Resumo:</p>
            <p className="text-xs whitespace-pre-wrap">{summary}</p>
          </div>
        )}

        {/* Save buttons */}
        <div className="flex gap-2">
          {contactId && (
            <Button
              variant="outline"
              size="sm"
              className="flex-1 gap-1.5 text-xs"
              onClick={() => handleSaveTo('contact')}
              disabled={savingTo !== null}
            >
              {savingTo === 'contact' ? <Loader2 className="h-3 w-3 animate-spin" /> : <User className="h-3 w-3" />}
              Salvar no Contato
            </Button>
          )}
          {leadId && (
            <Button
              variant="outline"
              size="sm"
              className="flex-1 gap-1.5 text-xs"
              onClick={() => handleSaveTo('lead')}
              disabled={savingTo !== null}
            >
              {savingTo === 'lead' ? <Loader2 className="h-3 w-3 animate-spin" /> : <BookOpen className="h-3 w-3" />}
              Salvar no Lead
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (processing) {
    return (
      <Button variant="outline" size="sm" className="text-xs gap-1" disabled>
        <Loader2 className="h-3 w-3 animate-spin" /> Salvando...
      </Button>
    );
  }

  // CALLING PHASE
  if (phase === 'calling') {
    return (
      <div className="space-y-2 max-w-sm">
        <div className="flex items-center gap-1">
          <Badge variant="destructive" className="text-xs animate-pulse font-mono">
            {formatTime(recordingTime)}
          </Badge>
          {sttActive && (
            <Badge variant="secondary" className="text-[10px] gap-1">
              <Mic className="h-2.5 w-2.5 text-red-500 animate-pulse" /> Transcrevendo
            </Badge>
          )}
          <Button
            variant="default"
            size="sm"
            className="text-xs gap-1 h-7 bg-green-600 hover:bg-green-700"
            onClick={() => stopRecording('atendeu')}
            title="Atendeu"
          >
            <PhoneCall className="h-3 w-3" />
            Atendeu
          </Button>
          <Button
            variant="destructive"
            size="sm"
            className="text-xs gap-1 h-7"
            onClick={() => stopRecording('nao_atendeu')}
            title="Não atendeu"
          >
            <PhoneOff className="h-3 w-3" />
          </Button>
        </div>

        {/* Live transcript preview */}
        {liveTranscript && (
          <div className="border rounded p-2 bg-muted/30 max-h-24 overflow-y-auto">
            <p className="text-[11px] text-muted-foreground mb-0.5 font-medium">Transcrição ao vivo:</p>
            <p className="text-xs whitespace-pre-wrap">{liveTranscript}</p>
          </div>
        )}
      </div>
    );
  }

  // IDLE PHASE
  return (
    <Button
      variant="outline"
      size="sm"
      className="text-xs gap-1 text-green-600 border-green-200 hover:bg-green-50 dark:hover:bg-green-900/20"
      onClick={startRecording}
      title="Ligar e gravar"
    >
      <Phone className="h-3 w-3" />
      <Mic className="h-3 w-3" />
    </Button>
  );
}
