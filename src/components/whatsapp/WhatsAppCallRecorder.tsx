import { useState, useRef, useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuthContext } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Phone, Mic, Square, Loader2, PhoneOff, PhoneCall } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface Props {
  phone: string;
  contactName: string | null;
  contactId: string | null;
  leadId: string | null;
  instanceId?: string | null;
  instanceName?: string | null;
}

export function WhatsAppCallRecorder({ phone, contactName, contactId, leadId, instanceId, instanceName }: Props) {
  const { user } = useAuthContext();
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [callRecordId, setCallRecordId] = useState<string | null>(null);
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

  const makeCall = useCallback(async (): Promise<string | null> => {
    try {
      const { data, error } = await supabase.functions.invoke('make-whatsapp-call', {
        body: { phone, contact_name: contactName, contact_id: contactId, lead_id: leadId, instance_id: instanceId || undefined, instance_name: instanceName || undefined },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Erro ao iniciar chamada');
      toast.success('Chamada WhatsApp iniciada!');
      return data?.call_record_id || null;
    } catch (err) {
      console.error('Error making WhatsApp call:', err);
      toast.error('Erro ao iniciar chamada via WhatsApp');
      // Fallback to tel: protocol
      const cleanPhone = phone.replace(/\D/g, '');
      const telUrl = cleanPhone.startsWith('55') ? `tel:+${cleanPhone}` : `tel:+55${cleanPhone}`;
      const a = document.createElement('a');
      a.href = telUrl;
      a.click();
      return null;
    }
  }, [phone, contactName, contactId, leadId]);

  const startRecording = useCallback(async () => {
    const recordId = await makeCall();
    setCallRecordId(recordId);

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

      toast.success('Ligação iniciada! Gravação ativa.');
    } catch (err) {
      console.error('Mic access error:', err);
      setIsRecording(true);
      setRecordingTime(0);
      timerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
      toast.info('Ligação iniciada. Gravação indisponível (microfone negado).');
    }
  }, [makeCall]);

  const stopRecording = useCallback(async (callResult: string = 'atendeu') => {
    if (timerRef.current) clearInterval(timerRef.current);
    setProcessing(true);

    const currentDuration = recordingTime;
    const recorder = mediaRecorderRef.current;
    const hasRecording = recorder && recorder.state !== 'inactive';

    // Update the call_record with result and duration
    if (callRecordId) {
      try {
        await supabase.from('call_records').update({
          call_result: callResult,
          duration_seconds: currentDuration,
        } as any).eq('id', callRecordId);
      } catch (err) {
        console.error('Error updating call record:', err);
      }
    }

    if (!hasRecording) {
      setIsRecording(false);
      setProcessing(false);
      setCallRecordId(null);
      if (callRecordId) toast.success('Ligação registrada!');
      return;
    }

    const currentUser = user;
    const currentMime = recorder.mimeType;
    const currentCallRecordId = callRecordId;

    recorder.onstop = async () => {
      streamRef.current?.getTracks().forEach(t => t.stop());

      if (!currentUser) {
        setIsRecording(false);
        setProcessing(false);
        setCallRecordId(null);
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

        if (currentCallRecordId) {
          // Update existing record with audio
          await supabase.from('call_records').update({
            audio_url: audioUrl,
            audio_file_name: fileName,
          } as any).eq('id', currentCallRecordId);

          // Trigger transcription
          supabase.functions.invoke('analyze-activity-chat', {
            body: { action: 'transcribe_call', audio_url: audioUrl, call_record_id: currentCallRecordId, phone },
          }).catch(() => {});
        } else {
          // Fallback: create new record if no ID (shouldn't happen normally)
          const { data: insertData } = await supabase
            .from('call_records')
            .insert({
              user_id: currentUser.id,
              call_type: 'realizada',
              call_result: callResult,
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
            })
            .select('id')
            .single();

          if (insertData?.id) {
            supabase.functions.invoke('analyze-activity-chat', {
              body: { action: 'transcribe_call', audio_url: audioUrl, call_record_id: insertData.id, phone },
            }).catch(() => {});
          }
        }

        toast.success('Ligação gravada e salva!');
      } catch (err) {
        console.error('Error saving recording:', err);
        toast.error('Erro ao salvar gravação');
      }

      setIsRecording(false);
      setProcessing(false);
      setCallRecordId(null);
    };

    try {
      recorder.stop();
    } catch (err) {
      console.error('Error stopping recorder:', err);
      setIsRecording(false);
      setProcessing(false);
      setCallRecordId(null);
    }
  }, [user, phone, contactName, contactId, leadId, recordingTime, callRecordId]);

  if (processing) {
    return (
      <Button variant="outline" size="sm" className="text-xs gap-1" disabled>
        <Loader2 className="h-3 w-3 animate-spin" /> Salvando...
      </Button>
    );
  }

  if (isRecording) {
    return (
      <div className="flex items-center gap-1">
        <Badge variant="destructive" className="text-xs animate-pulse font-mono">
          {formatTime(recordingTime)}
        </Badge>
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
          Não atendeu
        </Button>
      </div>
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
