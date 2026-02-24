import { useState, useRef, useCallback } from 'react';
import { Mic, MicOff } from 'lucide-react';
import { Button } from './button';
import { toast } from 'sonner';

interface VoiceInputButtonProps {
  onResult: (text: string) => void;
  append?: boolean;
  className?: string;
}

export function VoiceInputButton({ onResult, append = true, className }: VoiceInputButtonProps) {
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<any>(null);

  const toggle = useCallback(() => {
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast.error('Seu navegador não suporta reconhecimento de voz');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'pt-BR';
    recognition.continuous = true;
    recognition.interimResults = false;

    recognition.onresult = (event: any) => {
      const transcript = Array.from(event.results)
        .map((r: any) => r[0].transcript)
        .join(' ');
      onResult(transcript);
    };

    recognition.onerror = (event: any) => {
      console.error('Speech error', event.error);
      if (event.error !== 'aborted') {
        toast.error('Erro no reconhecimento de voz');
      }
      setListening(false);
    };

    recognition.onend = () => setListening(false);

    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
    toast.info('Ouvindo... fale agora', { duration: 2000 });
  }, [listening, onResult]);

  return (
    <Button
      type="button"
      variant={listening ? 'destructive' : 'outline'}
      size="icon"
      className={`h-8 w-8 shrink-0 ${className || ''}`}
      onClick={toggle}
      title={listening ? 'Parar gravação' : 'Preencher com voz'}
    >
      {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
    </Button>
  );
}
