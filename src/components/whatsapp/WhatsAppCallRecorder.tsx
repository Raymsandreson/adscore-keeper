import { useState, useRef, useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuthContext } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Phone, Mic, Square, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface Props {
  phone: string;
  contactName: string | null;
  contactId: string | null;
  leadId: string | null;
}

export function WhatsAppCallRecorder({ phone, contactName, contactId, leadId }: Props) {
  const { user } = useAuthContext();
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [processing, setProcessing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    };
  }, []);

  const formatTime = (s: number) =>
    `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;

  const startRecording = useCallback(async () => {
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
      setIsRecording(true);
      setRecordingTime(0);

      timerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);

      toast.success('Gravação de ligação iniciada!');
    } catch (err) {
      console.error('Mic access error:', err);
      toast.error('Não foi possível acessar o microfone');
    }
  }, []);

  const stopRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') {
      setIsRecording(false);
      setProcessing(false);
      return;
    }

    setProcessing(true);
    if (timerRef.current) clearInterval(timerRef.current);

    const currentUser = user;
    const currentDuration = recordingTime;
    const currentMime = recorder.mimeType;

    recorder.onstop = async () => {
      streamRef.current?.getTracks().forEach(t => t.stop());

      if (!currentUser) {
        setIsRecording(false);
        setProcessing(false);
        return;
      }

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

        const audioUrl = urlData.publicUrl;

        const { error: insertError } = await supabase
          .from('call_records')
          .insert({
            user_id: currentUser.id,
            call_type: 'realizada',
            call_result: 'atendeu',
            duration_seconds: currentDuration,
            contact_phone: phone,
            contact_name: contactName,
            contact_id: contactId,
            lead_id: leadId,
            audio_url: audioUrl,
            audio_file_name: fileName,
            phone_used: 'whatsapp',
            notes: 'Gravação manual via chat WhatsApp.',
            tags: ['whatsapp', 'gravacao_manual'],
          });

        if (insertError) throw insertError;

        // Trigger transcription in background
        supabase.functions.invoke('analyze-activity-chat', {
          body: { action: 'transcribe_call', audio_url: audioUrl, call_id: `whatsapp_${Date.now()}`, phone },
        }).catch(() => {});

        toast.success('Ligação gravada e salva!');
      } catch (err) {
        console.error('Error saving recording:', err);
        toast.error('Erro ao salvar gravação');
      }

      setIsRecording(false);
      setProcessing(false);
    };

    try {
      recorder.stop();
    } catch (err) {
      console.error('Error stopping recorder:', err);
      setIsRecording(false);
      setProcessing(false);
    }
  }, [user, phone, contactName, contactId, leadId, recordingTime]);

  if (processing) {
    return (
      <Button variant="outline" size="sm" className="text-xs gap-1" disabled>
        <Loader2 className="h-3 w-3 animate-spin" /> Salvando...
      </Button>
    );
  }

  if (isRecording) {
    return (
      <Button
        variant="destructive"
        size="sm"
        className="text-xs gap-1.5 animate-pulse"
        onClick={stopRecording}
      >
        <Square className="h-3 w-3" />
        <span className="font-mono">{formatTime(recordingTime)}</span>
        Parar
      </Button>
    );
  }

  return (
    <Button
      variant="outline"
      size="sm"
      className="text-xs gap-1 text-green-600 border-green-200 hover:bg-green-50 dark:hover:bg-green-900/20"
      onClick={startRecording}
      title="Gravar ligação"
    >
      <Phone className="h-3 w-3" />
      <Mic className="h-3 w-3" />
    </Button>
  );
}
