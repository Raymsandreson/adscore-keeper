import { useState, useRef, useCallback, useEffect } from 'react';
import { useIncomingCallDetector } from '@/hooks/useIncomingCallDetector';
import { supabase } from '@/integrations/supabase/client';
import { useAuthContext } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PhoneIncoming, PhoneOutgoing, Mic, Square, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';

// v2 - force clean rebuild after hook refactor
export function IncomingCallBanner() {
  const { user } = useAuthContext();
  const { activeCall, dismiss } = useIncomingCallDetector();
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [autoStarted, setAutoStarted] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lastAutoStartCallId = useRef<string | null>(null);

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

      recorder.start(1000);
      setIsRecording(true);
      setRecordingTime(0);

      timerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);

      toast.info('🔴 Gravação automática iniciada para esta chamada.');
    } catch (err) {
      console.error('Mic access error:', err);
      // Even without mic, show the banner with timer
      setIsRecording(true);
      setRecordingTime(0);
      timerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
      toast.warning('Chamada detectada. Microfone indisponível — gravação de áudio não ativa.');
    }
  }, []);

  // AUTO-START recording disabled — user can start manually via the mic button
  // useEffect(() => {
  //   if (activeCall && !isRecording && !processing && !autoStarted && activeCall.call_id !== lastAutoStartCallId.current) {
  //     lastAutoStartCallId.current = activeCall.call_id;
  //     setAutoStarted(true);
  //     startRecording();
  //   }
  // }, [activeCall, isRecording, processing, autoStarted, startRecording]);

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
    const currentCall = activeCall;
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
      const callId = currentCall?.call_id ?? `local_${Date.now()}`;
      const fileName = `call_${callId}_${Date.now()}.${ext}`;

      try {
        const { error: uploadError } = await supabase.storage
          .from('activity-chat')
          .upload(`call-recordings/${fileName}`, blob, { contentType: currentMime });

        if (uploadError) throw uploadError;

        const { data: urlData } = supabase.storage
          .from('activity-chat')
          .getPublicUrl(`call-recordings/${fileName}`);

        const audioUrl = urlData.publicUrl;

        const { error: upsertError } = await supabase
          .from('call_records')
          .insert({
            user_id: currentUser.id,
            call_type: currentCall?.from_me ? 'realizada' : 'recebida',
            call_result: 'atendeu',
            duration_seconds: currentDuration,
            contact_phone: currentCall?.phone ?? null,
            contact_name: currentCall?.contact_name ?? null,
            audio_url: audioUrl,
            audio_file_name: fileName,
            phone_used: 'whatsapp_cloud',
            notes: 'Gravação automática da chamada WhatsApp.',
            tags: ['whatsapp', 'cloud_api', 'gravacao_automatica'],
          });

        if (upsertError) throw upsertError;

        cloudFunctions.invoke('analyze-activity-chat', {
          body: { action: 'transcribe_call', audio_url: audioUrl, call_id: callId, phone: currentCall?.phone },
        }).catch(() => {});

        toast.success('Chamada gravada e salva com sucesso!');
      } catch (err) {
        console.error('Error saving recording:', err);
        toast.error('Erro ao salvar gravação');
      }

      setIsRecording(false);
      setProcessing(false);
      dismiss();
    };

    try {
      recorder.stop();
    } catch (err) {
      console.error('Error stopping recorder:', err);
      setIsRecording(false);
      setProcessing(false);
    }
  }, [user, activeCall, recordingTime, dismiss]);

  // Auto-STOP recording when call ends (desligou)
  useEffect(() => {
    if (!activeCall && autoStarted) {
      setAutoStarted(false);
      if (isRecording && !processing) {
        stopRecording();
      }
    }
  }, [activeCall, autoStarted, isRecording, processing, stopRecording]);

  if (!activeCall && !isRecording) return null;

  const isInbound = !activeCall?.from_me;
  const formatTime = (s: number) => `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[9999] animate-in slide-in-from-top-5 duration-300">
      <Card className="px-4 py-3 shadow-2xl border-2 border-red-500 bg-red-500/5 flex items-center gap-3 min-w-[320px] max-w-[480px]">
        {/* Call icon */}
        <div className="rounded-full p-2 animate-pulse bg-red-500/20">
          {isInbound ? (
            <PhoneIncoming className="h-5 w-5 text-red-500" />
          ) : (
            <PhoneOutgoing className="h-5 w-5 text-red-500" />
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
            {activeCall?.instance_name && (
              <Badge variant="secondary" className="text-[10px] shrink-0">
                📱 {activeCall.instance_name}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-red-500 font-mono">
            <Mic className="h-3 w-3" />
            <span className="inline-block w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            {isRecording ? `Gravando ${formatTime(recordingTime)}` : 'Iniciando gravação...'}
          </div>
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
          ) : null}
        </div>
      </Card>
    </div>
  );
}
