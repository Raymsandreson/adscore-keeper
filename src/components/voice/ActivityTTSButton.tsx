import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Volume2, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface ActivityTTSButtonProps {
  messageText: string;
}

export function ActivityTTSButton({ messageText }: ActivityTTSButtonProps) {
  const [generating, setGenerating] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  const generateAudio = async () => {
    if (!messageText.trim()) {
      toast.error('Nenhuma mensagem para gerar áudio');
      return;
    }

    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke('elevenlabs-tts', {
        body: { text: messageText },
      });

      if (error) throw error;
      if (data?.audio_url) {
        setAudioUrl(data.audio_url);
        // Copy audio URL to clipboard
        await navigator.clipboard.writeText(data.audio_url);
        toast.success('Áudio gerado! URL copiada para área de transferência. Cole no WhatsApp junto com a mensagem.');
      } else {
        throw new Error('Nenhum áudio gerado');
      }
    } catch (e: any) {
      toast.error(e.message || 'Erro ao gerar áudio');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-2"
        onClick={generateAudio}
        disabled={generating || !messageText.trim()}
      >
        {generating ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Volume2 className="h-4 w-4" />
        )}
        {generating ? 'Gerando áudio...' : 'Gerar áudio'}
      </Button>
      {audioUrl && (
        <div className="flex items-center gap-2">
          <audio controls src={audioUrl} className="h-8" />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              navigator.clipboard.writeText(audioUrl);
              toast.success('URL do áudio copiada!');
            }}
          >
            Copiar URL
          </Button>
        </div>
      )}
    </div>
  );
}
