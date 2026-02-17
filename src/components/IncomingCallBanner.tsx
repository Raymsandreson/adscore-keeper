import { useState, useRef, useCallback, useEffect } from 'react';
import { useIncomingCallDetector } from '@/hooks/useIncomingCallDetector';
import { supabase } from '@/integrations/supabase/client';
import { useAuthContext } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Phone, PhoneIncoming, PhoneOutgoing, Mic, MicOff, X, Square, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export function IncomingCallBanner() {
  const { user } = useAuthContext();
  const { activeCall, dismiss } = useIncomingCallDetector();
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [processing, setProcessing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    };
  }, []);

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

      recorder.start(1000); // 1s chunks
      setIsRecording(true);
      setRecordingTime(0);

      timerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);

      toast.success('Gravação iniciada!');
    } catch (err) {
      console.error('Mic access error:', err);
      toast.error('Não foi possível acessar o microfone');
    }
  }, []);

  const stopRecording = useCallback(async () => {
    if (!mediaRecorderRef.current || !user || !activeCall) return;

    setProcessing(true);
    if (timerRef.current) clearInterval(timerRef.current);

    return new Promise<void>((resolve) => {
      mediaRecorderRef.current!.onstop = async () => {
        // Stop mic
        streamRef.current?.getTracks().forEach(t => t.stop());

        const blob = new Blob(chunksRef.current, { type: mediaRecorderRef.current!.mimeType });
        const ext = mediaRecorderRef.current!.mimeType.includes('webm') ? 'webm' : 'mp4';
        const fileName = `call_${activeCall.call_id}_${Date.now()}.${ext}`;

        try {
          // Upload audio
          const { data: uploadData, error: uploadError } = await supabase.storage
            .from('activity-chat')
            .upload(`call-recordings/${fileName}`, blob, {
              contentType: mediaRecorderRef.current!.mimeType,
            });

          if (uploadError) throw uploadError;

          const { data: urlData } = supabase.storage
            .from('activity-chat')
            .getPublicUrl(`call-recordings/${fileName}`);

          const audioUrl = urlData.publicUrl;

          // Create/update call record with audio
          const { error: upsertError } = await supabase
            .from('call_records')
            .insert({
              user_id: user.id,
              call_type: activeCall.from_me ? 'realizada' : 'recebida',
              call_result: 'atendeu',
              duration_seconds: recordingTime,
              contact_phone: activeCall.phone,
              contact_name: activeCall.contact_name,
              audio_url: audioUrl,
              audio_file_name: fileName,
              phone_used: 'whatsapp_cloud',
              notes: `Gravação local da chamada WhatsApp Cloud.`,
              tags: ['whatsapp', 'cloud_api', 'gravacao_local'],
            });

          if (upsertError) throw upsertError;

          // Trigger AI transcription via edge function
          try {
            await supabase.functions.invoke('analyze-activity-chat', {
              body: {
                action: 'transcribe_call',
                audio_url: audioUrl,
                call_id: activeCall.call_id,
                phone: activeCall.phone,
              },
            });
          } catch {
            // Non-critical - transcription can happen later
          }

          toast.success('Chamada gravada e salva com sucesso!');
        } catch (err) {
          console.error('Error saving recording:', err);
          toast.error('Erro ao salvar gravação');
        }

        setIsRecording(false);
        setProcessing(false);
        dismiss();
        resolve();
      };

      mediaRecorderRef.current!.stop();
    });
  }, [user, activeCall, recordingTime, dismiss]);

  if (!activeCall && !isRecording) return null;

  const isInbound = !activeCall?.from_me;
  const formatTime = (s: number) => `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[9999] animate-in slide-in-from-top-5 duration-300">
      <Card className={cn(
        "px-4 py-3 shadow-2xl border-2 flex items-center gap-3 min-w-[320px] max-w-[480px]",
        isRecording ? "border-red-500 bg-red-500/5" : "border-primary bg-primary/5"
      )}>
        {/* Call icon */}
        <div className={cn(
          "rounded-full p-2 animate-pulse",
          isRecording ? "bg-red-500/20" : "bg-primary/20"
        )}>
          {isInbound ? (
            <PhoneIncoming className={cn("h-5 w-5", isRecording ? "text-red-500" : "text-primary")} />
          ) : (
            <PhoneOutgoing className={cn("h-5 w-5", isRecording ? "text-red-500" : "text-primary")} />
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold truncate">
              {activeCall?.contact_name || activeCall?.phone || 'Chamada'}
            </span>
            <Badge variant="outline" className="text-[10px] shrink-0">
              {isInbound ? 'Recebida' : 'Realizada'}
            </Badge>
          </div>
          {isRecording ? (
            <div className="flex items-center gap-2 text-xs text-red-500 font-mono">
              <span className="inline-block w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              Gravando {formatTime(recordingTime)}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Toque para gravar esta chamada</p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5">
          {processing ? (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          ) : isRecording ? (
            <Button size="sm" variant="destructive" onClick={stopRecording} className="gap-1.5">
              <Square className="h-3.5 w-3.5" />
              Parar
            </Button>
          ) : (
            <Button size="sm" onClick={startRecording} className="gap-1.5">
              <Mic className="h-3.5 w-3.5" />
              Gravar
            </Button>
          )}
          {!isRecording && !processing && (
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={dismiss}>
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}
