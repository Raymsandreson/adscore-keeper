import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Sparkles, Send, Check, RotateCcw, X, MessageSquare, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import ReactMarkdown from 'react-markdown';

interface Props {
  currentPrompt: string;
  onApply: (prompt: string) => void;
  onClose: () => void;
  hideHeader?: boolean;
}

const GENERATE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-agent-prompt`;

interface ChatMsg {
  role: 'user' | 'assistant';
  content: string;
}

export function PromptBuilderChat({ currentPrompt, onApply, onClose, hideHeader }: Props) {
  const [mode, setMode] = useState<'generate' | 'build'>('build');
  
  // Generate mode state
  const [description, setDescription] = useState('');
  const [generatedPrompt, setGeneratedPrompt] = useState('');
  const [refinementInput, setRefinementInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  // Build mode state
  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [builtPrompt, setBuiltPrompt] = useState('');

  const chatEndRef = useRef<HTMLDivElement>(null);
  const buildChatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    buildChatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, generatedPrompt]);

  const streamResponse = async (body: Record<string, any>, onToken: (text: string) => void): Promise<string> => {
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
              onToken(fullText);
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
            if (content) { fullText += content; onToken(fullText); }
          } catch {}
        }
      }
    } catch (err: any) {
      toast.error(err.message || 'Erro ao gerar prompt');
    }
    return fullText;
  };

  // ---- GENERATE MODE ----
  const handleGenerate = async () => {
    if (!description.trim()) { toast.error('Descreva o que o agente deve fazer'); return; }
    setIsGenerating(true);
    setGeneratedPrompt('');
    const result = await streamResponse(
      { description: description.trim(), mode: 'generate' },
      (text) => setGeneratedPrompt(text)
    );
    setIsGenerating(false);
  };

  const handleRefine = async () => {
    if (!refinementInput.trim() || !generatedPrompt) return;
    setIsGenerating(true);
    const result = await streamResponse(
      { description: description.trim(), refinement: refinementInput.trim(), current_prompt: generatedPrompt, mode: 'generate' },
      (text) => setGeneratedPrompt(text)
    );
    setRefinementInput('');
    setIsGenerating(false);
  };

  // ---- BUILD MODE ----
  const handleBuildChat = async () => {
    if (!chatInput.trim()) return;
    const userMsg = chatInput.trim();
    const newMessages: ChatMsg[] = [...chatMessages, { role: 'user', content: userMsg }];
    setChatMessages(newMessages);
    setChatInput('');
    setIsChatLoading(true);

    let assistantText = '';
    setChatMessages([...newMessages, { role: 'assistant', content: '' }]);

    const result = await streamResponse(
      {
        mode: 'build',
        chat_history: newMessages,
        current_prompt: currentPrompt || builtPrompt || '',
      },
      (text) => {
        assistantText = text;
        setChatMessages([...newMessages, { role: 'assistant', content: text }]);
      }
    );

    // Check if response contains a prompt block
    const promptMatch = result.match(/```prompt\n([\s\S]*?)```/);
    if (promptMatch) {
      setBuiltPrompt(promptMatch[1].trim());
    }

    setIsChatLoading(false);
  };

  const startBuildChat = () => {
    if (chatMessages.length === 0) {
      const welcomeMsg: ChatMsg = {
        role: 'assistant',
        content: `Olá! 👋 Vou te ajudar a construir o prompt do seu agente passo a passo.

Para começar, me diga:
1. **Qual é o objetivo principal** desse agente? (Ex: qualificar leads, atender clientes, agendar consultas)
2. **Qual o tom de voz** desejado? (Ex: profissional, amigável, formal)
3. **O agente atende em qual área?** (Ex: jurídico, saúde, vendas)

Ou se preferir, descreva livremente o que precisa e eu vou guiando! 🚀`
      };
      setChatMessages([welcomeMsg]);
    }
  };

  useEffect(() => {
    if (mode === 'build' && chatMessages.length === 0) {
      startBuildChat();
    }
  }, [mode]);

  return (
    <Card className="border-primary/30">
      <CardContent className="p-3 space-y-3">
        {!hideHeader && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">Assistente de Prompt IA</span>
            </div>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}

        <Tabs value={mode} onValueChange={(v) => setMode(v as 'generate' | 'build')}>
          <TabsList className="grid w-full grid-cols-2 h-8">
            <TabsTrigger value="build" className="text-xs gap-1">
              <MessageSquare className="h-3 w-3" />
              Construir com IA
            </TabsTrigger>
            <TabsTrigger value="generate" className="text-xs gap-1">
              <Wand2 className="h-3 w-3" />
              Gerar Pronto
            </TabsTrigger>
          </TabsList>

          {/* BUILD MODE */}
          <TabsContent value="build" className="space-y-2 mt-2">
            <ScrollArea className="h-[300px] border rounded-md p-3 bg-muted/20">
              <div className="space-y-3">
                {chatMessages.map((msg, i) => (
                  <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] rounded-lg px-3 py-2 text-xs ${
                      msg.role === 'user'
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-card border'
                    }`}>
                      {msg.role === 'assistant' ? (
                        <div className="prose prose-xs dark:prose-invert max-w-none [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5">
                          <ReactMarkdown>{msg.content || '...'}</ReactMarkdown>
                        </div>
                      ) : (
                        <p>{msg.content}</p>
                      )}
                    </div>
                  </div>
                ))}
                {isChatLoading && chatMessages[chatMessages.length - 1]?.role !== 'assistant' && (
                  <div className="flex justify-start">
                    <div className="bg-card border rounded-lg px-3 py-2 text-xs flex items-center gap-1.5 text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" /> Pensando...
                    </div>
                  </div>
                )}
                <div ref={buildChatEndRef} />
              </div>
            </ScrollArea>

            <div className="flex gap-2">
              <Input
                placeholder="Descreva o que precisa, pergunte sobre campos, ações, comandos..."
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleBuildChat()}
                className="text-xs flex-1"
                disabled={isChatLoading}
              />
              <Button size="icon" variant="outline" className="shrink-0 h-9 w-9" onClick={handleBuildChat} disabled={!chatInput.trim() || isChatLoading}>
                <Send className="h-3.5 w-3.5" />
              </Button>
            </div>

            {builtPrompt && (
              <div className="space-y-2 border-t pt-2">
                <p className="text-[10px] font-medium text-muted-foreground">📋 Prompt gerado pela IA:</p>
                <Textarea
                  value={builtPrompt}
                  onChange={e => setBuiltPrompt(e.target.value)}
                  rows={6}
                  className="text-xs resize-y font-mono leading-relaxed"
                />
                <div className="flex gap-2">
                  <Button size="sm" className="flex-1" onClick={() => { onApply(builtPrompt.trim()); onClose(); toast.success('Prompt aplicado!'); }}>
                    <Check className="h-3.5 w-3.5 mr-1" /> Usar este Prompt
                  </Button>
                </div>
              </div>
            )}
          </TabsContent>

          {/* GENERATE MODE */}
          <TabsContent value="generate" className="space-y-2 mt-2">
            {!generatedPrompt && !isGenerating && (
              <div className="space-y-2">
                <Input
                  placeholder="Descreva o agente (ex: Atendente jurídico especializado em acidentes de trabalho...)"
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleGenerate()}
                  className="text-sm"
                  autoFocus
                />
                <Button size="sm" onClick={handleGenerate} disabled={!description.trim()} className="w-full">
                  <Wand2 className="h-3.5 w-3.5 mr-1" /> Gerar Prompt Completo
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
                  {isGenerating && <span className="flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Gerando...</span>}
                </div>

                {!isGenerating && (
                  <div className="flex gap-2">
                    <Input
                      placeholder="Refine: mais formal, adicione horário, foque em qualificação..."
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
                    <Button variant="outline" size="sm" className="flex-1" onClick={() => { setGeneratedPrompt(''); }}>
                      <RotateCcw className="h-3.5 w-3.5 mr-1" /> Recomeçar
                    </Button>
                    <Button size="sm" className="flex-1" onClick={() => { onApply(generatedPrompt.trim()); onClose(); toast.success('Prompt aplicado!'); }}>
                      <Check className="h-3.5 w-3.5 mr-1" /> Usar este Prompt
                    </Button>
                  </div>
                )}
              </>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
