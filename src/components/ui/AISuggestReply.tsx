import { useState, useEffect, useCallback } from 'react';
import { Loader2, Sparkles, MessageSquarePlus, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// Tons disponíveis para a sugestão. label = exibido, prompt = instrução para a IA.
const TONES: Record<string, { label: string; prompt: string }> = {
  cordial: { label: 'Cordial', prompt: 'tom cordial e profissional' },
  formal: { label: 'Formal', prompt: 'tom formal e respeitoso' },
  friendly: { label: 'Amigável', prompt: 'tom amigável e acolhedor' },
  empathetic: { label: 'Empático', prompt: 'tom empático e compreensivo' },
  concise: { label: 'Direto', prompt: 'tom direto e objetivo, sem rodeios' },
  firm: { label: 'Firme', prompt: 'tom firme e assertivo, porém educado' },
};

interface Props {
  /** Transcrição da conversa (contexto). Recalculada a cada abertura. */
  buildContext: () => string;
  /** Aplica o texto escolhido no compositor. Nada é enviado — o usuário revisa e envia. */
  onApply: (text: string) => void;
  disabled?: boolean;
  buttonClassName?: string;
  /** Mensagem específica que o usuário quer responder. A sugestão foca nela. */
  targetMessage?: string;
  /** Modo controlado: quando definido, o pai controla a abertura do dialog. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Esconde o botão gatilho interno (usado quando o pai controla a abertura). */
  hideTrigger?: boolean;
}

export function AISuggestReply({
  buildContext,
  onApply,
  disabled,
  buttonClassName,
  targetMessage,
  open: controlledOpen,
  onOpenChange,
  hideTrigger,
}: Props) {
  const isControlled = controlledOpen !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = (o: boolean) => {
    if (onOpenChange) onOpenChange(o);
    if (!isControlled) setInternalOpen(o);
  };

  const [loading, setLoading] = useState(false);
  const [tone, setTone] = useState<string>('cordial');
  const [instruction, setInstruction] = useState('');
  const [options, setOptions] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [context, setContext] = useState('');

  const generate = useCallback(async (ctx: string, toneKey: string, extra: string, target?: string) => {
    if (!ctx.trim()) {
      toast.error('Sem histórico de conversa para basear a sugestão.');
      return;
    }
    setLoading(true);
    try {
      const tonePrompt = TONES[toneKey]?.prompt || 'tom cordial e profissional';
      const targetLine = target?.trim()
        ? ` O atendente quer responder ESPECIFICAMENTE a esta mensagem do cliente: "${target.trim()}". Foque a resposta nela; use o restante da conversa apenas como contexto.`
        : '';
      const extraLine = extra.trim()
        ? ` Instrução adicional do atendente: ${extra.trim()}.`
        : '';
      const custom_prompt =
        `Você é o atendente de um escritório de advocacia previdenciário respondendo um cliente pelo WhatsApp. ` +
        `Abaixo está o histórico da conversa (Eu = atendente, Cliente = a pessoa atendida). ` +
        `Escreva APENAS a próxima mensagem que o atendente deve enviar como resposta, em ${tonePrompt}, ` +
        `em português brasileiro, natural e claro. Não escreva saudações repetidas se a conversa já começou, ` +
        `não invente fatos jurídicos nem prometa prazos ou valores. Responda só com o texto da mensagem, sem aspas.` +
        `${targetLine}${extraLine}`;

      const { data, error } = await supabase.functions.invoke('ai-text-editor', {
        body: { text: ctx, action: 'custom', custom_prompt },
      });
      if (error) throw error;
      const opts: string[] = Array.isArray(data?.options) ? data.options.filter(Boolean) : [];
      if (!opts.length) {
        toast.error('Nenhuma sugestão retornada. Tente novamente.');
        return;
      }
      setOptions(opts);
      setDraft(opts[0]);
    } catch (e: any) {
      console.error('AISuggestReply error:', e);
      toast.error('Erro ao gerar sugestão com IA');
    } finally {
      setLoading(false);
    }
  }, []);

  // Ao abrir (interno ou controlado) ou mudar a mensagem-alvo, recalcula contexto e gera.
  useEffect(() => {
    if (!open) return;
    const ctx = buildContext();
    setContext(ctx);
    setOptions([]);
    setDraft('');
    setInstruction('');
    generate(ctx, tone, '', targetMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, targetMessage]);

  const handleApply = () => {
    const text = draft.trim();
    if (!text) {
      toast.error('Rascunho vazio.');
      return;
    }
    onApply(text);
    setOpen(false);
    toast.success('Sugestão no campo — revise e envie.');
  };

  return (
    <>
      {!hideTrigger && (
        <button
          type="button"
          disabled={disabled || loading}
          onClick={() => setOpen(true)}
          title="Sugerir resposta com IA (baseada na conversa)"
          className={cn(
            'p-1.5 rounded hover:bg-accent transition-colors flex items-center gap-0.5 text-xs',
            (disabled || loading) && 'opacity-50',
            buttonClassName,
          )}
        >
          <MessageSquarePlus className="h-4 w-4 text-primary" />
        </button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" /> Sugerir resposta
            </DialogTitle>
            <DialogDescription>
              A IA sugere uma resposta com base na conversa. Revise, edite ou peça para reformular.
              Nada é enviado até você clicar em Enviar no chat.
            </DialogDescription>
          </DialogHeader>

          {targetMessage?.trim() && (
            <div className="rounded-md border-l-2 border-primary bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">Respondendo a:</span>{' '}
              <span className="line-clamp-3 whitespace-pre-wrap">{targetMessage.trim()}</span>
            </div>
          )}

          <div className="space-y-3">
            {/* Tom */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground whitespace-nowrap">Tom:</span>
              <Select
                value={tone}
                onValueChange={(v) => {
                  setTone(v);
                  generate(context, v, instruction, targetMessage);
                }}
                disabled={loading}
              >
                <SelectTrigger className="h-8 text-sm w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(TONES).map(([k, { label }]) => (
                    <SelectItem key={k} value={k}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Variações geradas */}
            {options.length > 1 && (
              <div className="flex flex-wrap gap-1.5">
                {options.map((opt, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setDraft(opt)}
                    className={cn(
                      'text-[11px] px-2 py-1 rounded border transition-colors max-w-full truncate',
                      draft === opt ? 'bg-primary/10 border-primary text-primary' : 'hover:bg-accent',
                    )}
                    title={opt}
                  >
                    Opção {i + 1}
                  </button>
                ))}
              </div>
            )}

            {/* Rascunho editável */}
            <div className="relative">
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={loading ? 'Gerando sugestão...' : 'A sugestão aparece aqui — edite à vontade.'}
                className="min-h-[120px] max-h-[300px] text-sm whitespace-pre-wrap"
                disabled={loading}
              />
              {loading && (
                <div className="absolute inset-0 flex items-center justify-center bg-background/60 rounded-md">
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                </div>
              )}
            </div>

            {/* Reformular com instrução */}
            <div className="flex items-center gap-2">
              <Input
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !loading) {
                    e.preventDefault();
                    generate(context, tone, instruction, targetMessage);
                  }
                }}
                placeholder="Peça um ajuste: ex. 'mais curta', 'peça os documentos'..."
                className="h-8 text-sm flex-1"
                disabled={loading}
              />
              <Button
                variant="outline"
                size="sm"
                disabled={loading}
                onClick={() => generate(context, tone, instruction, targetMessage)}
              >
                {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                <span className="ml-1">Reformular</span>
              </Button>
            </div>
          </div>

          <div className="flex justify-between gap-2 pt-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={loading}
              onClick={() => generate(context, tone, '', targetMessage)}
            >
              Gerar novamente
            </Button>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button size="sm" disabled={loading || !draft.trim()} onClick={handleApply}>
                Usar no campo
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
