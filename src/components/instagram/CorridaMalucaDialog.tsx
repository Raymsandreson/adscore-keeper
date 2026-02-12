import React, { useState } from 'react';
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
import { Car, Copy, RefreshCw, MessageCircle, Share2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

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

interface CorridaMalucaDialogProps {
  rankings: RankingEntry[];
  weekStart?: Date;
  weekEnd?: Date;
  settings?: {
    points_per_mention: number;
    points_per_comment: number;
  };
}

export const CorridaMalucaDialog: React.FC<CorridaMalucaDialogProps> = ({
  rankings,
  weekStart = new Date(),
  weekEnd = new Date(),
  settings = { points_per_mention: 1, points_per_comment: 1 },
}) => {
  const [open, setOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState('');

  const generateMessage = async () => {
    if (rankings.length === 0) {
      toast.error('Nenhum ranking disponível para gerar a narração');
      return;
    }

    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-corrida-maluca', {
        body: {
          rankings,
          weekStart: format(weekStart, 'dd/MM/yyyy', { locale: ptBR }),
          weekEnd: format(weekEnd, 'dd/MM/yyyy', { locale: ptBR }),
          settings,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setMessage(data.message || '');
      toast.success('Narração gerada! 🏎️🏁');
    } catch (error: any) {
      console.error('Erro ao gerar narração:', error);
      toast.error('Erro ao gerar a narração da Corrida Maluca');
    } finally {
      setGenerating(false);
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
      <DialogContent className="sm:max-w-[600px] max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            🏎️🏁 Corrida Maluca do Engajamento
          </DialogTitle>
          <DialogDescription>
            Gere uma narração estilo Galvão Bueno & Arnaldo para enviar no WhatsApp
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-4 overflow-y-auto">
          {!message ? (
            <div className="flex flex-col items-center justify-center py-8 gap-4">
              <div className="text-6xl">🏎️💨</div>
              <p className="text-muted-foreground text-center text-sm">
                Clique para gerar a narração emocionante da corrida com {rankings.length} participantes
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
                className="min-h-[300px] text-sm leading-relaxed"
              />
              <div className="flex gap-2 flex-wrap">
                <Button onClick={copyToClipboard} variant="outline" size="sm" className="gap-2">
                  <Copy className="w-4 h-4" />
                  Copiar
                </Button>
                <Button onClick={shareWhatsApp} size="sm" className="gap-2 bg-green-600 hover:bg-green-700 text-white">
                  <Share2 className="w-4 h-4" />
                  Enviar no WhatsApp
                </Button>
                <Button
                  onClick={generateMessage}
                  variant="outline"
                  size="sm"
                  disabled={generating}
                  className="gap-2"
                >
                  <RefreshCw className={`w-4 h-4 ${generating ? 'animate-spin' : ''}`} />
                  Gerar outra
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
