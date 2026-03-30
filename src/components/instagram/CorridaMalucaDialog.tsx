import React, { useState, useRef, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Car, Copy, RefreshCw, MessageCircle, Share2, Send } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';

interface RankingEntry {
  id?: string;
  username: string;
  user_id?: string | null;
  profile_picture_url?: string | null;
  mentions_count?: number;
  comments_count?: number;
  leads_created?: number;
  stage_changes?: number;
  leads_progressed?: number;
  total_points: number;
  badge_level?: string;
  rank_position?: number | null;
  previous_rank_position?: number | null;
  week_start?: string;
  week_end?: string;
}

interface MemberContext {
  username: string;
  teams: string[];
  routine: string[];
}

interface CorridaMalucaDialogProps {
  rankings: RankingEntry[];
  weekStart?: Date;
  weekEnd?: Date;
  settings?: {
    points_per_mention: number;
    points_per_comment: number;
  };
  memberContexts?: MemberContext[];
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export const CorridaMalucaDialog: React.FC<CorridaMalucaDialogProps> = ({
  rankings,
  weekStart = new Date(),
  weekEnd = new Date(),
  settings = { points_per_mention: 1, points_per_comment: 1 },
  memberContexts,
}) => {
  const [open, setOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState('');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [refining, setRefining] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const generateMessage = async () => {
    if (rankings.length === 0) {
      toast.error('Nenhum ranking disponível para gerar a narração');
      return;
    }

    setGenerating(true);
    setChatMessages([]);
    try {
      const { data, error } = await cloudFunctions.invoke('generate-corrida-maluca', {
        body: {
          rankings,
          weekStart: format(weekStart, 'dd/MM/yyyy', { locale: ptBR }),
          weekEnd: format(weekEnd, 'dd/MM/yyyy', { locale: ptBR }),
          settings,
          memberContexts,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const generated = data.message || '';
      setMessage(generated);
      setChatMessages([{ role: 'assistant', content: generated }]);
      toast.success('Narração gerada! 🏎️🏁');
    } catch (error: any) {
      console.error('Erro ao gerar narração:', error);
      toast.error('Erro ao gerar a narração da Corrida Maluca');
    } finally {
      setGenerating(false);
    }
  };

  const sendChatMessage = async () => {
    const trimmed = chatInput.trim();
    if (!trimmed || refining) return;

    const userMsg: ChatMessage = { role: 'user', content: trimmed };
    const updatedChat = [...chatMessages, userMsg];
    setChatMessages(updatedChat);
    setChatInput('');
    setRefining(true);

    try {
      const { data, error } = await cloudFunctions.invoke('generate-corrida-maluca', {
        body: {
          rankings,
          weekStart: format(weekStart, 'dd/MM/yyyy', { locale: ptBR }),
          weekEnd: format(weekEnd, 'dd/MM/yyyy', { locale: ptBR }),
          settings,
          memberContexts,
          refineRequest: trimmed,
          currentMessage: message,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const refined = data.message || '';
      setMessage(refined);
      setChatMessages(prev => [...prev, { role: 'assistant', content: refined }]);
      toast.success('Mensagem ajustada! ✏️');
    } catch (error: any) {
      console.error('Erro ao refinar:', error);
      toast.error('Erro ao ajustar a mensagem');
    } finally {
      setRefining(false);
    }
  };

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(message);
      toast.success('Mensagem copiada! Cole no WhatsApp 📱');
    } catch {
      toast.error('Erro ao copiar mensagem');
    }
  };

  const shareWhatsApp = () => {
    const encoded = encodeURIComponent(message);
    window.open(`https://wa.me/?text=${encoded}`, '_blank');
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Car className="w-4 h-4" />
          Corrida Maluca
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[650px] max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            🏎️🏁 Corrida Maluca do WhatsJUD
          </DialogTitle>
          <DialogDescription>
            Gere uma narração e refine com o chat
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 flex flex-col gap-3 overflow-hidden min-h-0">
          {!message ? (
            <div className="flex flex-col items-center justify-center py-8 gap-4">
              <div className="text-6xl">🏎️💨</div>
              <p className="text-muted-foreground text-center text-sm">
                Clique para gerar a narração com {rankings.length} participantes
              </p>
              <Button
                onClick={generateMessage}
                disabled={generating || rankings.length === 0}
                className="gap-2"
                size="lg"
              >
                {generating ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Narrando...
                  </>
                ) : (
                  <>
                    <MessageCircle className="w-4 h-4" />
                    Gerar Narração
                  </>
                )}
              </Button>
            </div>
          ) : (
            <>
              <Textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                className="min-h-[180px] max-h-[220px] text-sm leading-relaxed"
              />
              <div className="flex gap-2 flex-wrap">
                <Button onClick={copyToClipboard} variant="outline" size="sm" className="gap-2">
                  <Copy className="w-4 h-4" />
                  Copiar
                </Button>
                <Button onClick={shareWhatsApp} size="sm" className="gap-2 bg-green-600 hover:bg-green-700 text-white">
                  <Share2 className="w-4 h-4" />
                  WhatsApp
                </Button>
                <Button
                  onClick={generateMessage}
                  variant="outline"
                  size="sm"
                  disabled={generating}
                  className="gap-2"
                >
                  <RefreshCw className={`w-4 h-4 ${generating ? 'animate-spin' : ''}`} />
                  Nova
                </Button>
              </div>

              {/* Chat para refinar */}
              <div className="border rounded-lg flex flex-col min-h-0 max-h-[200px]">
                <div className="px-3 py-1.5 border-b bg-muted/50 text-xs font-medium text-muted-foreground">
                  💬 Peça ajustes na mensagem
                </div>
                <ScrollArea className="flex-1 px-3 py-2">
                  {chatMessages.filter(m => m.role === 'user').map((msg, i) => (
                    <div key={i} className="mb-2 flex justify-end">
                      <div className="bg-primary text-primary-foreground text-xs rounded-lg px-3 py-1.5 max-w-[80%]">
                        {msg.content}
                      </div>
                    </div>
                  ))}
                  {refining && (
                    <div className="mb-2 flex justify-start">
                      <div className="bg-muted text-muted-foreground text-xs rounded-lg px-3 py-1.5">
                        Ajustando... ✏️
                      </div>
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </ScrollArea>
                <div className="flex gap-2 p-2 border-t">
                  <Input
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendChatMessage()}
                    placeholder="Ex: Mais engraçado, menos emojis..."
                    className="text-xs h-8"
                    disabled={refining}
                  />
                  <Button
                    onClick={sendChatMessage}
                    size="sm"
                    disabled={refining || !chatInput.trim()}
                    className="h-8 w-8 p-0"
                  >
                    <Send className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
