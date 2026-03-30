import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Sparkles, Send, Check, RotateCcw, X } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  currentPrompt: string;
  onApply: (prompt: string) => void;
  onClose: () => void;
}

const GENERATE_URL = `https://gliigkupoebmlbwyvijp.supabase.co/functions/v1/generate-agent-prompt`;

export function AIPromptGenerator({ currentPrompt, onApply, onClose }: Props) {
  const [description, setDescription] = useState('');
  const [generatedPrompt, setGeneratedPrompt] = useState('');
  const [refinementInput, setRefinementInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [chatHistory, setChatHistory] = useState<{ role: 'user' | 'ai'; text: string }[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory]);

  const streamResponse = async (body: Record<string, string>) => {
    setIsGenerating(true);
    let fullText = '';

    try {
      const resp = await fetch(GENERATE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'Erro desconhecido' }));
        throw new Error(err.error || `Erro ${resp.status}`);
      }

      if (!resp.body) throw new Error('No stream body');

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let newlineIdx: number;
        while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
          let line = buffer.slice(0, newlineIdx);
          buffer = buffer.slice(newlineIdx + 1);
          if (line.endsWith('\r')) line = line.slice(0, -1);
          if (!line.startsWith('data: ')) continue;

          const jsonStr = line.slice(6).trim();
          if (jsonStr === '[DONE]') break;

          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              fullText += content;
              setGeneratedPrompt(fullText);
            }
          } catch {
            buffer = line + '\n' + buffer;
            break;
          }
        }
      }

      if (buffer.trim()) {
        for (let raw of buffer.split('\n')) {
          if (!raw || !raw.startsWith('data: ')) continue;
          const jsonStr = raw.slice(6).trim();
          if (jsonStr === '[DONE]') continue;
          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              fullText += content;
              setGeneratedPrompt(fullText);
            }
          } catch {}
        }
      }
    } catch (err: any) {
      toast.error(err.message || 'Erro ao gerar prompt');
    } finally {
      setIsGenerating(false);
    }

    return fullText;
  };

  const handleGenerate = async () => {
    if (!description.trim()) {
      toast.error('Descreva o que o agente deve fazer');
      return;
    }

    setChatHistory([{ role: 'user', text: description }]);
    setGeneratedPrompt('');

    const result = await streamResponse({ description: description.trim() });
    if (result) {
      setChatHistory(prev => [...prev, { role: 'ai', text: '✅ Prompt gerado! Revise e refine se necessário.' }]);
    }
  };

  const handleRefine = async () => {
    if (!refinementInput.trim() || !generatedPrompt) return;

    const instruction = refinementInput.trim();
    setChatHistory(prev => [...prev, { role: 'user', text: instruction }]);
    setRefinementInput('');

    const result = await streamResponse({
      description: description.trim(),
      refinement: instruction,
      current_prompt: generatedPrompt,
    });

    if (result) {
      setChatHistory(prev => [...prev, { role: 'ai', text: '✅ Prompt atualizado!' }]);
    }
  };

  return (
    <Card className="border-primary/30">
      <CardContent className="p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">Gerar Prompt com IA</span>
          </div>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>

        {!generatedPrompt && !isGenerating && (
          <div className="space-y-2">
            <Input
              placeholder="Descreva o agente (ex: Atendente jurídico especializado em acidentes de trabalho, tom profissional...)"
              value={description}
              onChange={e => setDescription(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleGenerate()}
              className="text-sm"
              autoFocus
            />
            <Button size="sm" onClick={handleGenerate} disabled={!description.trim()} className="w-full">
              <Sparkles className="h-3.5 w-3.5 mr-1" />
              Gerar Prompt
            </Button>
          </div>
        )}

        {isGenerating && !generatedPrompt && (
          <div className="flex items-center gap-2 py-4 justify-center text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Gerando prompt...</span>
          </div>
        )}

        {generatedPrompt && (
          <>
            <Textarea
              value={generatedPrompt}
              onChange={e => setGeneratedPrompt(e.target.value)}
              rows={10}
              className="text-xs resize-y font-mono leading-relaxed"
            />

            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span>{generatedPrompt.length} caracteres</span>
              {isGenerating && (
                <span className="flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" /> Gerando...
                </span>
              )}
            </div>

            {chatHistory.length > 0 && (
              <div className="max-h-24 overflow-y-auto space-y-1 border rounded-md p-2 bg-muted/30">
                {chatHistory.map((msg, i) => (
                  <div key={i} className={`text-[10px] ${msg.role === 'user' ? 'text-primary font-medium' : 'text-muted-foreground'}`}>
                    {msg.role === 'user' ? '👤 ' : '🤖 '}{msg.text}
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>
            )}

            {!isGenerating && (
              <div className="flex gap-2">
                <Input
                  placeholder="Refine: mais formal, adicione horário de atendimento, foque em qualificação..."
                  value={refinementInput}
                  onChange={e => setRefinementInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleRefine()}
                  className="text-sm flex-1"
                />
                <Button size="icon" variant="outline" className="shrink-0" onClick={handleRefine} disabled={!refinementInput.trim()}>
                  <Send className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}

            {!isGenerating && (
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="flex-1" onClick={() => { setGeneratedPrompt(''); setChatHistory([]); }}>
                  <RotateCcw className="h-3.5 w-3.5 mr-1" />
                  Recomeçar
                </Button>
                <Button size="sm" className="flex-1" onClick={() => { onApply(generatedPrompt.trim()); onClose(); toast.success('Prompt aplicado!'); }}>
                  <Check className="h-3.5 w-3.5 mr-1" />
                  Usar este Prompt
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
