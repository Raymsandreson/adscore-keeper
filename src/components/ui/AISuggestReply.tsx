import { useState, useEffect, useCallback } from 'react';
import { Loader2, Sparkles, MessageSquarePlus, RefreshCw, ClipboardList, CheckCircle2 } from 'lucide-react';
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

/** Estado da conversa usado para decidir se há resposta pendente. */
export interface ReplyState {
  /** true = a última mensagem é do cliente (há algo a responder). */
  pending: boolean;
  /** Texto da última mensagem enviada pelo atendente (para evitar repetição). */
  lastOutboundText: string;
  /** Texto da última mensagem do cliente (âncora do que responder). */
  lastClientText: string;
}

interface Props {
  /** Transcrição da conversa (contexto). Recalculada a cada abertura. */
  buildContext: () => string;
  /** Estado da conversa (pendência + última mensagem enviada). */
  getState?: () => ReplyState;
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
  /**
   * Persona da sugestão.
   * 'client' (padrão) = atendente respondendo um cliente pelo WhatsApp.
   * 'team' = colega respondendo outro colega no chat interno da equipe.
   */
  mode?: 'client' | 'team';
}

export function AISuggestReply({
  buildContext,
  getState,
  onApply,
  disabled,
  buttonClassName,
  targetMessage,
  open: controlledOpen,
  onOpenChange,
  hideTrigger,
  mode = 'client',
}: Props) {
  const isTeam = mode === 'team';
  // Palavras conforme a persona: quem é o interlocutor e quem sou "Eu".
  const counterpart = isTeam ? 'colega' : 'cliente'; // a quem estou respondendo
  const me = isTeam ? 'você' : 'atendente'; // quem sou "Eu" na transcrição
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
  const [lastOutbound, setLastOutbound] = useState('');
  const [lastClient, setLastClient] = useState('');
  const [noPending, setNoPending] = useState(false);
  // Pendências da conversa (para nada se perder).
  const [pendencias, setPendencias] = useState('');
  const [loadingPend, setLoadingPend] = useState(false);

  const generate = useCallback(async (ctx: string, toneKey: string, extra: string, target?: string, already?: string, clientMsg?: string) => {
    if (!ctx.trim()) {
      toast.error('Sem histórico de conversa para basear a sugestão.');
      return;
    }
    setLoading(true);
    try {
      const tonePrompt = TONES[toneKey]?.prompt || 'tom cordial e profissional';
      // Âncora: a última fala do interlocutor é o que deve ser respondido (quando não há alvo explícito).
      const anchorLine = !target?.trim() && clientMsg?.trim()
        ? ` A ÚLTIMA mensagem enviada pelo ${counterpart} foi: "${clientMsg.trim()}". Sua resposta DEVE reagir diretamente a essa fala do ${counterpart}, e não a mensagens anteriores já respondidas.`
        : '';
      const targetLine = target?.trim()
        ? ` O ${me} quer responder ESPECIFICAMENTE a esta mensagem do ${counterpart}: "${target.trim()}". Foque a resposta nela; use o restante da conversa apenas como contexto.`
        : '';
      // Evita que a IA reescreva/parafraseie a última mensagem que "Eu" já enviei.
      const alreadyLine = already?.trim() && already.trim() !== target?.trim()
        ? ` ATENÇÃO: o ${me} JÁ enviou recentemente esta mensagem — NÃO a repita nem a reescreva com outras palavras: "${already.trim()}". Escreva apenas a CONTINUAÇÃO, respondendo ao que o ${counterpart} falou depois disso.`
        : '';
      const extraLine = extra.trim()
        ? ` Instrução adicional do ${me}: ${extra.trim()}.`
        : '';
      const custom_prompt = isTeam
        ? (
          `Você é um membro da equipe de um escritório de advocacia trocando mensagens com um COLEGA no chat interno da equipe. ` +
          `Abaixo está o histórico da conversa (Eu = você; o nome antes de cada fala é o colega que a enviou). ` +
          `Escreva APENAS a próxima mensagem que você deve enviar ao colega, em ${tonePrompt}, ` +
          `em português brasileiro, natural e direto, como se fala entre colegas de trabalho. ` +
          `Responda ao que o colega falou por último e ainda não foi respondido. ` +
          `Não escreva saudações repetidas se a conversa já começou, não invente fatos. ` +
          `Responda só com o texto da mensagem, sem aspas.` +
          `${anchorLine}${targetLine}${alreadyLine}${extraLine}`
        )
        : (
          `Você é o atendente de um escritório de advocacia previdenciário respondendo um cliente pelo WhatsApp. ` +
          `Abaixo está o histórico da conversa (Eu = atendente, Cliente = a pessoa atendida). ` +
          `Escreva APENAS a próxima mensagem que o atendente deve enviar como resposta, em ${tonePrompt}, ` +
          `em português brasileiro, natural e claro. Responda ao que o CLIENTE falou por último e ainda não foi respondido. ` +
          `Não escreva saudações repetidas se a conversa já começou, ` +
          `não invente fatos jurídicos nem prometa prazos ou valores. Responda só com o texto da mensagem, sem aspas.` +
          `${anchorLine}${targetLine}${alreadyLine}${extraLine}`
        );

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

  const loadPendencias = useCallback(async (ctx: string) => {
    if (!ctx.trim()) return;
    setLoadingPend(true);
    try {
      const custom_prompt = isTeam
        ? (
          `Analise o histórico desta conversa do chat interno da equipe (Eu e um colega). ` +
          `Liste de forma objetiva, em tópicos curtos, as PENDÊNCIAS em aberto para você não perder nada: ` +
          `(1) perguntas do colega ainda sem resposta; ` +
          `(2) tarefas ou informações que foram pedidas/prometidas e ainda faltam; ` +
          `(3) próximos passos combinados. ` +
          `Se não houver nenhuma pendência, responda exatamente: "Nenhuma pendência em aberto." ` +
          `Não invente nada que não esteja na conversa.`
        )
        : (
          `Analise o histórico desta conversa de WhatsApp entre atendente (Eu) e cliente. ` +
          `Liste de forma objetiva, em tópicos curtos, as PENDÊNCIAS em aberto para o atendente não perder nada: ` +
          `(1) perguntas do cliente ainda sem resposta; ` +
          `(2) documentos ou informações que foram pedidos/prometidos e ainda faltam; ` +
          `(3) próximos passos combinados. ` +
          `Se não houver nenhuma pendência, responda exatamente: "Nenhuma pendência em aberto." ` +
          `Não invente nada que não esteja na conversa.`
        );
      const { data, error } = await supabase.functions.invoke('ai-text-editor', {
        body: { text: ctx, action: 'custom', custom_prompt },
      });
      if (error) throw error;
      const opts: string[] = Array.isArray(data?.options) ? data.options.filter(Boolean) : [];
      setPendencias(opts[0] || 'Nenhuma pendência em aberto.');
    } catch (e: any) {
      console.error('AISuggestReply pendencias error:', e);
      toast.error('Erro ao analisar pendências');
    } finally {
      setLoadingPend(false);
    }
  }, []);

  // Ao abrir (interno ou controlado) ou mudar a mensagem-alvo, recalcula contexto.
  useEffect(() => {
    if (!open) return;
    const ctx = buildContext();
    setContext(ctx);
    setOptions([]);
    setDraft('');
    setInstruction('');
    setPendencias('');
    const st = getState?.();
    const already = st?.lastOutboundText || '';
    const client = st?.lastClientText || '';
    setLastOutbound(already);
    setLastClient(client);
    // Se NÃO é resposta a uma mensagem específica e a última mensagem foi do atendente,
    // não há resposta pendente — avisa e mostra as pendências em vez de sugerir cegamente.
    if (!targetMessage && st && !st.pending) {
      setNoPending(true);
      loadPendencias(ctx);
    } else {
      setNoPending(false);
      generate(ctx, tone, '', targetMessage, already, client);
    }
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

  const generateAnyway = () => {
    setNoPending(false);
    generate(context, tone, '', targetMessage, lastOutbound, lastClient);
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

          {/* Estado "sem pendência de resposta" — a última mensagem foi do atendente. */}
          {noPending ? (
            <div className="space-y-3">
              <div className="flex items-start gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium text-emerald-800 dark:text-emerald-300">Sem resposta pendente</p>
                  <p className="text-xs text-muted-foreground">
                    A última mensagem da conversa foi <strong>sua</strong> — o {counterpart} ainda não respondeu.
                    Veja abaixo o que ficou em aberto para não perder nada.
                  </p>
                </div>
              </div>

              <div className="rounded-md border bg-muted/30 p-3 text-sm">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground mb-1.5">
                  <ClipboardList className="h-3.5 w-3.5" /> Pendências da conversa
                </div>
                {loadingPend ? (
                  <div className="flex items-center gap-2 text-muted-foreground text-xs py-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Analisando...
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap text-[13px]">{pendencias || '—'}</p>
                )}
              </div>

              <div className="flex justify-between gap-2 pt-1">
                <Button variant="outline" size="sm" disabled={loadingPend} onClick={() => loadPendencias(context)}>
                  {loadingPend ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                  Reanalisar
                </Button>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Fechar</Button>
                  <Button size="sm" onClick={generateAnyway}>Sugerir mesmo assim</Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Tom */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground whitespace-nowrap">Tom:</span>
                <Select
                  value={tone}
                  onValueChange={(v) => {
                    setTone(v);
                    generate(context, v, instruction, targetMessage, lastOutbound, lastClient);
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
                      generate(context, tone, instruction, targetMessage, lastOutbound, lastClient);
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
                  onClick={() => generate(context, tone, instruction, targetMessage, lastOutbound, lastClient)}
                >
                  {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                  <span className="ml-1">Reformular</span>
                </Button>
              </div>

              {/* Pendências sob demanda */}
              {pendencias && (
                <div className="rounded-md border bg-muted/30 p-3 text-sm">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground mb-1.5">
                    <ClipboardList className="h-3.5 w-3.5" /> Pendências da conversa
                  </div>
                  <p className="whitespace-pre-wrap text-[13px]">{pendencias}</p>
                </div>
              )}

              <div className="flex justify-between gap-2 pt-2">
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" disabled={loading} onClick={() => generate(context, tone, '', targetMessage, lastOutbound, lastClient)}>
                    Gerar novamente
                  </Button>
                  <Button variant="ghost" size="sm" disabled={loadingPend} onClick={() => loadPendencias(context)}>
                    {loadingPend ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <ClipboardList className="h-3 w-3 mr-1" />}
                    Pendências
                  </Button>
                </div>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancelar</Button>
                  <Button size="sm" disabled={loading || !draft.trim()} onClick={handleApply}>
                    Usar no campo
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
