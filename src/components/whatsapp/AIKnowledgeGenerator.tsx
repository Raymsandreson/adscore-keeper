import { useState, useRef, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Sparkles, Send, Save, RotateCcw, X } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  agentId: string;
  onSaved: () => void;
  onClose: () => void;
}

const GENERATE_URL = `https://gliigkupoebmlbwyvijp.supabase.co/functions/v1/generate-knowledge-content`;

export function AIKnowledgeGenerator({ agentId, onSaved, onClose }: Props) {
  const [topic, setTopic] = useState('');
  const [generatedContent, setGeneratedContent] = useState('');
  const [refinementInput, setRefinementInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [chatHistory, setChatHistory] = useState<{ role: 'user' | 'ai'; text: string }[]>([]);
  const contentRef = useRef<HTMLTextAreaElement>(null);
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
              setGeneratedContent(fullText);
            }
          } catch {
            buffer = line + '\n' + buffer;
            break;
          }
        }
      }

      // Flush remaining
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
              setGeneratedContent(fullText);
            }
          } catch {}
        }
      }
    } catch (err: any) {
      toast.error(err.message || 'Erro ao gerar conteúdo');
    } finally {
      setIsGenerating(false);
    }

    return fullText;
  };

  const handleGenerate = async () => {
    if (!topic.trim()) {
      toast.error('Digite um tema');
      return;
    }

    setChatHistory([{ role: 'user', text: `Gerar base sobre: ${topic}` }]);
    setGeneratedContent('');

    const result = await streamResponse({ topic: topic.trim() });
    if (result) {
      setChatHistory(prev => [...prev, { role: 'ai', text: '✅ Conteúdo gerado! Revise abaixo e refine se necessário.' }]);
    }
  };

  const handleRefine = async () => {
    if (!refinementInput.trim() || !generatedContent) return;

    const instruction = refinementInput.trim();
    setChatHistory(prev => [...prev, { role: 'user', text: instruction }]);
    setRefinementInput('');

    const result = await streamResponse({
      topic: topic.trim(),
      refinement: instruction,
      current_content: generatedContent,
    });

    if (result) {
      setChatHistory(prev => [...prev, { role: 'ai', text: '✅ Conteúdo atualizado!' }]);
    }
  };

  const handleSave = async () => {
    if (!generatedContent.trim()) return;

    setIsSaving(true);
    try {
      const title = topic.trim() || `IA ${new Date().toLocaleDateString('pt-BR')}`;
      const { error } = await supabase
        .from('agent_knowledge_documents')
        .insert({
          agent_id: agentId,
          file_name: `🤖 ${title}`,
          file_url: '',
          file_size: new TextEncoder().encode(generatedContent).length,
          extracted_text: generatedContent.trim(),
          status: 'ready',
        } as any);

      if (error) throw error;

      toast.success('✅ Base de conhecimento salva!');
      onSaved();
      onClose();
    } catch (err: any) {
      toast.error('Erro ao salvar: ' + (err.message || ''));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card className="border-primary/30">
      <CardContent className="p-3 space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">Gerar com IA</span>
          </div>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Topic input */}
        {!generatedContent && !isGenerating && (
          <div className="space-y-2">
            <Input
              placeholder="Digite o tema (ex: Direitos trabalhistas acidente de trabalho, Tabela INSS 2025...)"
              value={topic}
              onChange={e => setTopic(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleGenerate()}
              className="text-sm"
              autoFocus
            />
            <Button size="sm" onClick={handleGenerate} disabled={!topic.trim()} className="w-full">
              <Sparkles className="h-3.5 w-3.5 mr-1" />
              Gerar Base de Conhecimento
            </Button>
          </div>
        )}

        {/* Loading state */}
        {isGenerating && !generatedContent && (
          <div className="flex items-center gap-2 py-4 justify-center text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Gerando conteúdo...</span>
          </div>
        )}

        {/* Generated content preview */}
        {generatedContent && (
          <>
            <Textarea
              ref={contentRef}
              value={generatedContent}
              onChange={e => setGeneratedContent(e.target.value)}
              rows={12}
              className="text-xs resize-y font-mono leading-relaxed"
            />

            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span>{(generatedContent.length / 1000).toFixed(1)}k caracteres</span>
              {isGenerating && (
                <span className="flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" /> Gerando...
                </span>
              )}
            </div>

            {/* Chat refinement */}
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

            {/* Refinement input */}
            {!isGenerating && (
              <div className="flex gap-2">
                <Input
                  placeholder="Refine: adicione tabela de valores, foque em prazos, mais detalhes sobre..."
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

            {/* Action buttons */}
            {!isGenerating && (
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="flex-1" onClick={() => { setGeneratedContent(''); setChatHistory([]); }}>
                  <RotateCcw className="h-3.5 w-3.5 mr-1" />
                  Recomeçar
                </Button>
                <Button size="sm" className="flex-1" onClick={handleSave} disabled={isSaving}>
                  {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Save className="h-3.5 w-3.5 mr-1" />}
                  Salvar na Base
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
