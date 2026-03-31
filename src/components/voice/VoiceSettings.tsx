import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Mic, Play, Pause, Upload, Check, Loader2, Volume2, Trash2, Square, Circle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';

interface VoicePreset {
  id: string;
  name: string;
  gender: string;
  lang: string;
}

interface CustomVoice {
  id: string;
  elevenlabs_voice_id: string | null;
  name: string;
  status: string;
  created_at: string;
}

interface VoicePref {
  voice_type: string;
  voice_id: string;
  voice_name: string;
}

export function VoiceSettings() {
  const [presets, setPresets] = useState<VoicePreset[]>([]);
  const [customVoices, setCustomVoices] = useState<CustomVoice[]>([]);
  const [preference, setPreference] = useState<VoicePref | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const [cloneName, setCloneName] = useState('');
  const [cloneFiles, setCloneFiles] = useState<File[]>([]);
  const [cloning, setCloning] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordedBlobs, setRecordedBlobs] = useState<{ blob: Blob; name: string }[]>([]);
  const [recordingTime, setRecordingTime] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const getUserId = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.user?.id;
  };

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      const chunks: BlobPart[] = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        const name = `gravacao_${recordedBlobs.length + 1}.webm`;
        setRecordedBlobs(prev => [...prev, { blob, name }]);
        stream.getTracks().forEach(t => t.stop());
        setRecordingTime(0);
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();
      setRecording(true);
      setRecordingTime(0);
      recordingTimerRef.current = setInterval(() => setRecordingTime(t => t + 1), 1000);
    } catch {
      toast.error('Não foi possível acessar o microfone');
    }
  }, [recordedBlobs.length]);

  const stopRecording = useCallback(() => {
    mediaRecorderRef.current?.stop();
    setRecording(false);
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  }, []);

  const removeRecording = (index: number) => {
    setRecordedBlobs(prev => prev.filter((_, i) => i !== index));
  };

  useEffect(() => {
    loadVoices();
  }, []);

  const loadVoices = async () => {
    try {
      const uid = await getUserId();
      const { data, error } = await cloudFunctions.invoke('elevenlabs-voice-clone', {
        body: { action: 'list_presets', user_id: uid },
      });
      if (error) throw error;
      setPresets(data.presets || []);
      setCustomVoices(data.custom_voices || []);
      setPreference(data.preference);
    } catch (e) {
      console.error('Error loading voices:', e);
      toast.error('Erro ao carregar vozes');
    } finally {
      setLoading(false);
    }
  };

  const selectVoice = async (voiceType: string, voiceId: string, voiceName: string) => {
    setSaving(true);
    try {
      const uid = await getUserId();
      const { error } = await cloudFunctions.invoke('elevenlabs-voice-clone', {
        body: { action: 'set_preference', voice_type: voiceType, voice_id: voiceId, voice_name: voiceName, user_id: uid },
      });
      if (error) throw error;
      setPreference({ voice_type: voiceType, voice_id: voiceId, voice_name: voiceName });
      toast.success(`Voz "${voiceName}" selecionada!`);
    } catch (e) {
      toast.error('Erro ao salvar preferência');
    } finally {
      setSaving(false);
    }
  };

  const deleteVoice = async (recordId: string, elevenlabsVoiceId: string | null) => {
    if (!confirm('Tem certeza que deseja excluir esta voz?')) return;
    try {
      const { error } = await cloudFunctions.invoke('elevenlabs-voice-clone', {
        body: { action: 'delete', record_id: recordId, voice_id: elevenlabsVoiceId },
      });
      if (error) throw error;
      toast.success('Voz excluída!');
      if (preference?.voice_id === elevenlabsVoiceId) setPreference(null);
      loadVoices();
    } catch {
      toast.error('Erro ao excluir voz');
    }
  };

  const previewVoice = async (voiceId: string) => {
    if (previewingId === voiceId) {
      audioRef.current?.pause();
      setPreviewingId(null);
      return;
    }

    setPreviewingId(voiceId);
    try {
      const response = await fetch(
        `https://gliigkupoebmlbwyvijp.supabase.co/functions/v1/elevenlabs-voice-clone`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
          },
          body: JSON.stringify({ action: 'preview', voice_id: voiceId }),
        }
      );

      if (!response.ok) throw new Error('Preview failed');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);

      if (audioRef.current) {
        audioRef.current.pause();
        URL.revokeObjectURL(audioRef.current.src);
      }

      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => setPreviewingId(null);
      await audio.play();
    } catch (e) {
      toast.error('Erro ao reproduzir prévia');
      setPreviewingId(null);
    }
  };

  const allFiles = [...cloneFiles, ...recordedBlobs.map(r => new File([r.blob], r.name, { type: r.blob.type }))];

  const handleClone = async () => {
    if (!cloneName.trim() || allFiles.length === 0) {
      toast.error('Informe um nome e envie ou grave pelo menos um áudio');
      return;
    }

    setCloning(true);
    try {
      // Upload files to storage first
      const sampleUrls: string[] = [];
      for (const file of allFiles) {
        const fileName = `voice-samples/${Date.now()}-${file.name}`;
        const { error: uploadErr } = await supabase.storage
          .from('whatsapp-media')
          .upload(fileName, file, { contentType: file.type });

        if (uploadErr) throw uploadErr;
        const { data: urlData } = supabase.storage.from('whatsapp-media').getPublicUrl(fileName);
        if (urlData?.publicUrl) sampleUrls.push(urlData.publicUrl);
      }

      const { data, error } = await cloudFunctions.invoke('elevenlabs-voice-clone', {
        body: { action: 'clone', name: cloneName, sample_urls: sampleUrls },
      });

      if (error) throw error;
      toast.success('Voz clonada com sucesso!');
      setCloneName('');
      setCloneFiles([]);
      setRecordedBlobs([]);
      loadVoices();
    } catch (e: any) {
      toast.error(e.message || 'Erro ao clonar voz');
    } finally {
      setCloning(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Current selection */}
      {preference && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-4 flex items-center gap-3">
            <Volume2 className="h-5 w-5 text-primary shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium">Voz atual: <span className="text-primary">{preference.voice_name}</span></p>
              <p className="text-xs text-muted-foreground">Tipo: {preference.voice_type === 'cloned' ? 'Clonada' : 'Preset'}</p>
            </div>
            <Button size="sm" variant="outline" onClick={() => previewVoice(preference.voice_id)}>
              {previewingId === preference.voice_id ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Preset voices */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Vozes Disponíveis</CardTitle>
          <CardDescription>Escolha uma voz pré-configurada para as mensagens do WhatsJUD</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {presets.map((voice) => (
              <div
                key={voice.id}
                className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                  preference?.voice_id === voice.id
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/40 hover:bg-muted/50'
                }`}
                onClick={() => selectVoice('preset', voice.id, voice.name)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{voice.name}</span>
                    <Badge variant="outline" className="text-[10px] h-4 px-1">
                      {voice.gender === 'female' ? '♀' : '♂'} {voice.lang}
                    </Badge>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0"
                    onClick={(e) => { e.stopPropagation(); previewVoice(voice.id); }}
                  >
                    {previewingId === voice.id ? (
                      <Pause className="h-3 w-3" />
                    ) : (
                      <Play className="h-3 w-3" />
                    )}
                  </Button>
                  {preference?.voice_id === voice.id && (
                    <Check className="h-4 w-4 text-primary" />
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Custom cloned voices */}
      {customVoices.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Suas Vozes Clonadas</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {customVoices.map((voice) => (
              <div
                key={voice.id}
                className={`flex items-center gap-3 p-3 rounded-lg border ${
                  voice.status === 'ready' ? 'cursor-pointer hover:border-primary/40' : 'opacity-60'
                } ${preference?.voice_id === voice.elevenlabs_voice_id ? 'border-primary bg-primary/5' : 'border-border'}`}
                onClick={() => {
                  if (voice.status === 'ready' && voice.elevenlabs_voice_id) {
                    selectVoice('cloned', voice.elevenlabs_voice_id, voice.name);
                  }
                }}
              >
                <Mic className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="flex-1">
                  <span className="text-sm font-medium">{voice.name}</span>
                  <Badge variant={voice.status === 'ready' ? 'default' : voice.status === 'failed' ? 'destructive' : 'secondary'} className="ml-2 text-[10px]">
                    {voice.status === 'ready' ? 'Pronta' : voice.status === 'processing' ? 'Processando...' : voice.status === 'failed' ? 'Falhou' : 'Pendente'}
                  </Badge>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {voice.status === 'ready' && voice.elevenlabs_voice_id && (
                    <>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0"
                        onClick={(e) => { e.stopPropagation(); previewVoice(voice.elevenlabs_voice_id!); }}>
                        {previewingId === voice.elevenlabs_voice_id ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                      </Button>
                      {preference?.voice_id === voice.elevenlabs_voice_id && <Check className="h-4 w-4 text-primary" />}
                    </>
                  )}
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                    onClick={(e) => { e.stopPropagation(); deleteVoice(voice.id, voice.elevenlabs_voice_id); }}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Clone new voice */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Mic className="h-4 w-4" />
            Clonar Sua Voz
          </CardTitle>
          <CardDescription>
            Grave ou envie amostras de áudio com sua voz falando naturalmente. Quanto mais amostras, melhor a qualidade.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Nome da voz</Label>
            <Input
              value={cloneName}
              onChange={(e) => setCloneName(e.target.value)}
              placeholder="Ex: Minha voz"
              className="mt-1"
            />
          </div>

          {/* Recorder */}
          <div>
            <Label>Gravar áudio</Label>
            <div className="mt-1 flex items-center gap-2">
              {recording ? (
                <>
                  <Button variant="destructive" size="sm" onClick={stopRecording} className="gap-2">
                    <Square className="h-3 w-3" /> Parar ({recordingTime}s)
                  </Button>
                  <span className="flex items-center gap-1 text-xs text-destructive animate-pulse">
                    <Circle className="h-2 w-2 fill-current" /> Gravando...
                  </span>
                </>
              ) : (
                <Button variant="outline" size="sm" onClick={startRecording} className="gap-2">
                  <Mic className="h-3 w-3" /> Gravar amostra
                </Button>
              )}
            </div>
            {recordedBlobs.length > 0 && (
              <div className="mt-2 space-y-1">
                {recordedBlobs.map((r, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs bg-muted/50 rounded px-2 py-1">
                    <Mic className="h-3 w-3 text-muted-foreground" />
                    <span className="flex-1">{r.name}</span>
                    <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={() => removeRecording(i)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <Separator />

          {/* File upload */}
          <div>
            <Label>Ou envie arquivos (MP3, WAV, M4A)</Label>
            <div className="mt-1 flex items-center gap-2">
              <Input
                type="file"
                accept="audio/*"
                multiple
                onChange={(e) => setCloneFiles(Array.from(e.target.files || []))}
                className="flex-1"
              />
            </div>
            {cloneFiles.length > 0 && (
              <p className="text-xs text-muted-foreground mt-1">
                {cloneFiles.length} arquivo(s) selecionado(s)
              </p>
            )}
          </div>

          {allFiles.length > 0 && (
            <p className="text-xs text-primary font-medium">
              Total: {allFiles.length} amostra(s) pronta(s)
            </p>
          )}

          <Button onClick={handleClone} disabled={cloning || !cloneName.trim() || allFiles.length === 0} className="gap-2">
            {cloning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {cloning ? 'Clonando...' : 'Clonar Voz'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
