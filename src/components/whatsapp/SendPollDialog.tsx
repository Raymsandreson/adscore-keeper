/**
 * "Enquete" do menu de anexo — igual à enquete do app do WhatsApp: pergunta,
 * 2 a 12 opções e permitir (ou não) múltiplas respostas. Vai pela edge
 * send-whatsapp (UazAPI /send/menu type=poll).
 */
import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { BarChart3, Loader2, Plus, Send, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  AttachSendTarget,
  isCloudChannelInstance,
  sendWhatsAppPoll,
} from '@/lib/whatsappAttachSend';

const MAX_CHOICES = 12;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: AttachSendTarget;
  onSent?: (info: { messageText: string; messageType: 'poll' }) => void;
}

export function SendPollDialog({ open, onOpenChange, target, onSent }: Props) {
  const [question, setQuestion] = useState('');
  const [choices, setChoices] = useState<string[]>(['', '']);
  const [multiple, setMultiple] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open) {
      setQuestion('');
      setChoices(['', '']);
      setMultiple(false);
      setSending(false);
    }
  }, [open]);

  const validChoices = choices.map((c) => c.trim()).filter(Boolean);
  const canSend = question.trim().length > 0 && validChoices.length >= 2 && !sending;

  const setChoice = (i: number, value: string) => {
    setChoices((prev) => prev.map((c, idx) => (idx === i ? value : c)));
  };

  const handleSend = async () => {
    if (!canSend) return;
    if (isCloudChannelInstance(target.instanceName)) {
      toast.error('Envio de enquete não é suportado no canal Cloud API (Meta).');
      return;
    }
    setSending(true);
    try {
      await sendWhatsAppPoll(target, {
        question: question.trim(),
        choices: validChoices,
        selectableCount: multiple ? validChoices.length : 1,
      });
      toast.success('Enquete enviada!');
      onSent?.({
        messageText: `📊 ${question.trim()}\n${validChoices.map((c) => `▢ ${c}`).join('\n')}`,
        messageType: 'poll',
      });
      onOpenChange(false);
    } catch (e: any) {
      console.error('[SendPollDialog] envio falhou', e);
      toast.error('Erro ao enviar enquete: ' + (e?.message || 'Erro desconhecido'));
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" /> Criar enquete
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Pergunta</Label>
            <Input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Qual o melhor horário pra você?"
              className="text-sm"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs">Opções ({validChoices.length}/{MAX_CHOICES})</Label>
            {choices.map((choice, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <Input
                  value={choice}
                  onChange={(e) => setChoice(i, e.target.value)}
                  placeholder={`Opção ${i + 1}`}
                  className="h-8 text-sm"
                />
                {choices.length > 2 && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-muted-foreground"
                    onClick={() => setChoices((prev) => prev.filter((_, idx) => idx !== i))}
                    title="Remover opção"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
            {choices.length < MAX_CHOICES && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => setChoices((prev) => [...prev, ''])}
              >
                <Plus className="h-3.5 w-3.5" /> Adicionar opção
              </Button>
            )}
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <Checkbox checked={multiple} onCheckedChange={(v) => setMultiple(v === true)} />
            Permitir múltiplas respostas
          </label>
          <Button className="w-full bg-green-600 hover:bg-green-700 gap-2" disabled={!canSend} onClick={handleSend}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Enviar enquete
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
