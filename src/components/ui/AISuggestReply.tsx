import { useState, useEffect, useCallback, useRef } from 'react';
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
import {
  TONS as TONES,
  gerarSugestaoDeResposta,
  type EstadoDaResposta,
} from '@/lib/sugestaoDeResposta';

/** Estado da conversa usado para decidir se há resposta pendente. */
export type ReplyState = EstadoDaResposta;

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
  /**
   * O que o CLIENTE ficou de fazer e continua em aberto. Vai junto no prompt
   * para a IA saber de que lado está a obrigação (quem cobra quem) antes de
   * escrever a resposta. Só faz sentido no modo 'client'.
   */
  pendenciasDoCliente?: string[];
  /**
   * Quem é essa pessoa para nós — Relacionamento Conosco, caso ligado e dinheiro
   * registrado entre as partes (`useRelacionamentoDoContato`). Só no modo 'client'.
   */
  contextoDaRelacao?: string[];
  /**
   * O que o processo andou — CNJ, fase e últimas movimentações do tribunal
   * (`useAndamentoDoProcesso`). É o que impede a IA de responder "ainda não
   * temos o número do processo" a quem já tem processo distribuído. Só no
   * modo 'client'.
   */
  andamentoDoProcesso?: string[];
  /**
   * Como o dono da conta escreve NESTA conversa (`montarLinhasDoEstilo`) —
   * exemplos reais das mensagens dele, para a sugestão sair com a voz dele e
   * não em tom de atendimento.
   */
  comoEuEscrevo?: string[];
  /**
   * Abre acima da pilha de avisos (z-120 do sonner). Usado quando a sugestão é
   * pedida de dentro de um popup de notificação — sem isto o diálogo abria
   * atrás do próprio popup que o chamou.
   */
  elevated?: boolean;
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
  pendenciasDoCliente,
  contextoDaRelacao,
  andamentoDoProcesso,
  comoEuEscrevo,
  elevated,
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
  // Começa espelhando o tom da conversa. "Cordial e profissional" como padrão
  // fazia a sugestão sair em tom de atendimento até numa conversa pessoal —
  // quem quiser outro tom troca no seletor ao lado.
  const [tone, setTone] = useState<string>('auto');
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
  // `generate` é memoizado sem deps; sem o ref ele congelaria a lista da
  // primeira renderização e mandaria pendência velha para a IA.
  const pendClienteRef = useRef<string[] | undefined>(pendenciasDoCliente);
  pendClienteRef.current = pendenciasDoCliente;
  const relacaoRef = useRef<string[] | undefined>(contextoDaRelacao);
  relacaoRef.current = contextoDaRelacao;
  const andamentoRef = useRef<string[] | undefined>(andamentoDoProcesso);
  andamentoRef.current = andamentoDoProcesso;
  const estiloRef = useRef<string[] | undefined>(comoEuEscrevo);
  estiloRef.current = comoEuEscrevo;

  const generate = useCallback(async (ctx: string, toneKey: string, extra: string, target?: string, already?: string, clientMsg?: string) => {
    if (!ctx.trim()) {
      toast.error('Sem histórico de conversa para basear a sugestão.');
      return;
    }
    setLoading(true);
    try {
      const opts = await gerarSugestaoDeResposta({
        contexto: ctx,
        modo: mode,
        tom: toneKey,
        instrucao: extra,
        alvo: target,
        jaEnviado: already,
        ultimaDoInterlocutor: clientMsg,
        pendenciasDoCliente: pendClienteRef.current,
        contextoDaRelacao: relacaoRef.current,
        andamentoDoProcesso: andamentoRef.current,
        comoEuEscrevo: estiloRef.current,
      });
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
        <DialogContent
          className={cn('max-w-xl', elevated && 'z-[200]')}
          overlayClassName={elevated ? 'z-[190]' : undefined}
        >
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
