import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Mic, Play, Pause, Upload, Check, Loader2, Volume2, Trash2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

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
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    loadVoices();
  }, []);

  const loadVoices = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('elevenlabs-voice-clone', {
        body: { action: 'list_presets' },
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
      const { error } = await supabase.functions.invoke('elevenlabs-voice-clone', {
        body: { action: 'set_preference', voice_type: voiceType, voice_id: voiceId, voice_name: voiceName },
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

  const previewVoice = async (voiceId: string) => {
    if (previewingId === voiceId) {
      audioRef.current?.pause();
      setPreviewingId(null);
      return;
    }

    setPreviewingId(voiceId);
    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/elevenlabs-voice-clone`,
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

  const handleClone = async () => {
    if (!cloneName.trim() || cloneFiles.length === 0) {
      toast.error('Informe um nome e envie pelo menos um áudio');
      return;
    }

    setCloning(true);
    try {
      // Upload files to storage first
      const sampleUrls: string[] = [];
      for (const file of cloneFiles) {
        const fileName = `voice-samples/${Date.now()}-${file.name}`;
        const { error: uploadErr } = await supabase.storage
          .from('whatsapp-media')
          .upload(fileName, file, { contentType: file.type });

        if (uploadErr) throw uploadErr;
        const { data: urlData } = supabase.storage.from('whatsapp-media').getPublicUrl(fileName);
        if (urlData?.publicUrl) sampleUrls.push(urlData.publicUrl);
      }

      const { data, error } = await supabase.functions.invoke('elevenlabs-voice-clone', {
        body: { action: 'clone', name: cloneName, sample_urls: sampleUrls },
      });

      if (error) throw error;
      toast.success('Voz clonada com sucesso!');
      setCloneName('');
      setCloneFiles([]);
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
                {voice.status === 'ready' && voice.elevenlabs_voice_id && (
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0"
                      onClick={(e) => { e.stopPropagation(); previewVoice(voice.elevenlabs_voice_id!); }}>
                      {previewingId === voice.elevenlabs_voice_id ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                    </Button>
                    {preference?.voice_id === voice.elevenlabs_voice_id && <Check className="h-4 w-4 text-primary" />}
                  </div>
                )}
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
            Envie amostras de áudio (mínimo 1, recomendado 3+) com sua voz falando naturalmente. Quanto mais amostras, melhor a qualidade.
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
          <div>
            <Label>Amostras de áudio (MP3, WAV, M4A)</Label>
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
          <Button onClick={handleClone} disabled={cloning || !cloneName.trim() || cloneFiles.length === 0} className="gap-2">
            {cloning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {cloning ? 'Clonando...' : 'Clonar Voz'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
