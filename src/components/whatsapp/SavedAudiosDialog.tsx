import { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Mic, StopCircle, Send, Trash2, Loader2, FileUp, Play, Pause } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { db } from '@/integrations/supabase';

export interface SavedAudio {
  id: string;
  title: string;
  category: string | null;
  file_path: string;
  public_url: string;
  mime_type: string;
  duration_sec: number | null;
  created_at: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Envia o áudio escolhido como nota de voz (ptt). Retorna sucesso. */
  onSend: (audio: SavedAudio) => Promise<boolean>;
}

// Grava ogg/opus (nota de voz nativa do WhatsApp). UazAPI aceita esse formato no /send/media type=ptt.
const REC_MIME = 'audio/ogg;codecs=opus';

export function SavedAudiosDialog({ open, onOpenChange, onSend }: Props) {
  const [audios, setAudios] = useState<SavedAudio[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);

  // Gravação
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [pendingBlob, setPendingBlob] = useState<Blob | null>(null);
  const [pendingDuration, setPendingDuration] = useState(0);
  const [newTitle, setNewTitle] = useState('');

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadAudios = async () => {
    setLoading(true);
    try {
      const { data, error } = await (db as any)
        .from('saved_audios')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setAudios((data || []) as SavedAudio[]);
    } catch (err: any) {
      toast.error('Erro ao carregar áudios: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) loadAudios();
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (audioElRef.current) audioElRef.current.pause();
    };
  }, [open]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const supported = typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(REC_MIME);
      const mime = supported ? REC_MIME : 'audio/webm';
      const recorder = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        if (intervalRef.current) clearInterval(intervalRef.current);
        const blob = new Blob(chunksRef.current, { type: 'audio/ogg' });
        if (blob.size >= 100) {
          setPendingBlob(blob);
          setPendingDuration(recordingTime);
        }
        setRecordingTime(0);
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      setRecordingTime(0);
      intervalRef.current = setInterval(() => setRecordingTime((t) => t + 1), 1000);
    } catch {
      toast.error('Não foi possível acessar o microfone');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  };

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setPendingBlob(file);
      setPendingDuration(0);
      if (!newTitle) setNewTitle(file.name.replace(/\.[^.]+$/, ''));
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const savePending = async () => {
    if (!pendingBlob) return;
    const title = newTitle.trim();
    if (!title) { toast.error('Dê um título ao áudio'); return; }
    setSaving(true);
    try {
      const isOgg = pendingBlob.type.startsWith('audio/ogg') || pendingBlob.type === '';
      const ext = isOgg ? 'ogg' : (pendingBlob.type.split('/')[1]?.split(';')[0] || 'webm');
      const mimeType = isOgg ? 'audio/ogg' : pendingBlob.type;
      const id = crypto.randomUUID();
      const filePath = `saved-audios/${id}.${ext}`;

      const { error: upErr } = await supabase.storage
        .from('whatsapp-media')
        .upload(filePath, pendingBlob, { contentType: mimeType, upsert: false });
      if (upErr) throw upErr;
      const { data: { publicUrl } } = supabase.storage.from('whatsapp-media').getPublicUrl(filePath);

      const { data: { user } } = await supabase.auth.getUser();
      const { error: insErr } = await (db as any).from('saved_audios').insert({
        id,
        title,
        file_path: filePath,
        public_url: publicUrl,
        mime_type: mimeType,
        duration_sec: pendingDuration || null,
        created_by: user?.id || null,
      });
      if (insErr) throw insErr;

      toast.success('Áudio salvo na biblioteca');
      setPendingBlob(null);
      setPendingDuration(0);
      setNewTitle('');
      loadAudios();
    } catch (err: any) {
      toast.error('Erro ao salvar áudio: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSend = async (audio: SavedAudio) => {
    setSendingId(audio.id);
    try {
      const ok = await onSend(audio);
      if (ok) onOpenChange(false);
    } finally {
      setSendingId(null);
    }
  };

  const handleDelete = async (audio: SavedAudio) => {
    try {
      await supabase.storage.from('whatsapp-media').remove([audio.file_path]);
      const { error } = await (db as any).from('saved_audios').delete().eq('id', audio.id);
      if (error) throw error;
      setAudios((prev) => prev.filter((a) => a.id !== audio.id));
      toast.success('Áudio removido');
    } catch (err: any) {
      toast.error('Erro ao remover: ' + err.message);
    }
  };

  const togglePlay = (audio: SavedAudio) => {
    if (playingId === audio.id) {
      audioElRef.current?.pause();
      setPlayingId(null);
      return;
    }
    if (audioElRef.current) audioElRef.current.pause();
    const el = new Audio(audio.public_url);
    audioElRef.current = el;
    el.onended = () => setPlayingId(null);
    el.play().catch(() => toast.error('Não foi possível reproduzir'));
    setPlayingId(audio.id);
  };

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Áudios salvos</DialogTitle>
        </DialogHeader>

        {/* Gravar / subir novo */}
        <div className="space-y-2 border-b pb-3">
          {pendingBlob ? (
            <div className="space-y-2">
              <Input
                placeholder="Título do áudio (ex: Saudação inicial)"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
              />
              <div className="flex gap-2">
                <Button onClick={savePending} disabled={saving} className="flex-1">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Salvar na biblioteca'}
                </Button>
                <Button variant="outline" onClick={() => { setPendingBlob(null); setNewTitle(''); }} disabled={saving}>
                  Descartar
                </Button>
              </div>
            </div>
          ) : isRecording ? (
            <Button variant="destructive" onClick={stopRecording} className="w-full">
              <StopCircle className="h-4 w-4 mr-2" /> Parar gravação ({fmt(recordingTime)})
            </Button>
          ) : (
            <div className="flex gap-2">
              <Button variant="outline" onClick={startRecording} className="flex-1">
                <Mic className="h-4 w-4 mr-2" /> Gravar novo
              </Button>
              <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
                <FileUp className="h-4 w-4 mr-2" /> Arquivo
              </Button>
              <input ref={fileInputRef} type="file" accept="audio/*" className="hidden" onChange={onPickFile} />
            </div>
          )}
        </div>

        {/* Lista */}
        <ScrollArea className="max-h-72">
          {loading ? (
            <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : audios.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">Nenhum áudio salvo ainda.</p>
          ) : (
            <div className="space-y-1">
              {audios.map((audio) => (
                <div key={audio.id} className="flex items-center gap-2 rounded-md p-2 hover:bg-muted/50">
                  <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => togglePlay(audio)}>
                    {playingId === audio.id ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                  </Button>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{audio.title}</p>
                    {audio.duration_sec ? (
                      <p className="text-xs text-muted-foreground">{fmt(audio.duration_sec)}</p>
                    ) : null}
                  </div>
                  <Button
                    size="sm"
                    onClick={() => handleSend(audio)}
                    disabled={sendingId === audio.id}
                  >
                    {sendingId === audio.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Send className="h-4 w-4 mr-1" /> Enviar</>}
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-destructive" onClick={() => handleDelete(audio)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
