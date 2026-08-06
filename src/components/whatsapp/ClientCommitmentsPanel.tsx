import { useEffect, useMemo, useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  ClipboardCheck, Check, Bell, X, RotateCcw, Trash2, AlertTriangle, Loader2,
  MessageSquareQuote, Sparkles, RefreshCw, ThumbsDown, Plus, FileText, AlertCircle,
  CalendarPlus,
} from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { type ClientCommitment } from '@/hooks/useClientCommitments';
import {
  buildReminderText, isCommitmentOpen, isCommitmentOverdue, isSameCommitmentTitle,
} from '@/lib/clientCommitments';

export interface TeamOption {
  user_id: string;
  full_name: string | null;
}

export interface CommitmentDraft {
  sourceMessageId?: string | null;
  sourceMessageText?: string | null;
}

interface Props {
  openState: boolean;
  onOpenChange: (v: boolean) => void;
  clientName: string;
  open: ClientCommitment[];
  done: ClientCommitment[];
  loading: boolean;
  /** IA lendo a conversa agora. */
  analyzing: boolean;
  /** Resumo do contexto escrito pela IA. */
  summary?: string | null;
  /** Motivo da última falha de leitura, se houve. */
  analyzeError?: string | null;
  /** Rascunho vindo de "Virou pendência" numa bolha da conversa. */
  draft?: CommitmentDraft | null;
  onDraftConsumed?: () => void;
  /** Relê a conversa inteira ignorando o cache. */
  onAnalyze: (force?: boolean) => Promise<{ success: boolean; created: number; closed?: number; cached?: boolean; error?: string }>;
  onCreate: (input: {
    title: string;
    kind: string;
    dueDate?: string | null;
    notes?: string | null;
    sourceMessageId?: string | null;
    sourceMessageText?: string | null;
  }) => Promise<unknown>;
  onDone: (id: string, resolver?: { userId?: string | null; name?: string | null }) => Promise<unknown>;
  /** Equipe, para escolher quem resolveu. Sem lista, conclui direto. */
  teamOptions?: TeamOption[];
  /**
   * Quem falou com o cliente por último nesta conversa (prefixo `*Nome:*`).
   * Vira a opção pré-selecionada no "quem resolveu".
   */
  suggestedResolver?: TeamOption | null;
  onGiveUp: (id: string) => Promise<unknown>;
  /** "Não era pendência" — a IA errou. */
  onDismiss: (id: string) => Promise<unknown>;
  onReopen: (id: string) => Promise<unknown>;
  onRemind: (item: ClientCommitment) => Promise<unknown>;
  onRemove: (id: string) => Promise<unknown>;
  /** Escreve a cobrança no campo de mensagem da conversa (não envia). */
  onDraftMessage?: (text: string) => void;
  /** Abre o formulário de atividade já preenchido a partir da pendência. */
  onCreateActivity?: (item: ClientCommitment) => void;
  /** Mostrar esta tela sozinha ao entrar numa conversa com pendência em aberto. */
  alertEnabled?: boolean;
  onAlertEnabledChange?: (v: boolean) => void;
}

function ItemCard({
  item, clientName, onDone, onGiveUp, onDismiss, onReopen, onRemind, onRemove, onDraftMessage,
  onCreateActivity, onAskResolver,
}: {
  item: ClientCommitment;
  clientName: string;
  onDone: Props['onDone'];
  onGiveUp: Props['onGiveUp'];
  onDismiss: Props['onDismiss'];
  onReopen: Props['onReopen'];
  onRemind: Props['onRemind'];
  onRemove: Props['onRemove'];
  onDraftMessage?: Props['onDraftMessage'];
  onCreateActivity?: Props['onCreateActivity'];
  /** Sem lista de equipe o botão conclui direto; com lista, pergunta antes. */
  onAskResolver?: (item: ClientCommitment) => void;
}) {
  const [busy, setBusy] = useState(false);
  const isOpen = isCommitmentOpen(item.status);
  const isOverdue = isCommitmentOverdue(item);
  const fromAI = item.origin === 'ia';

  const run = async (fn: () => Promise<unknown>, okMsg?: string) => {
    setBusy(true);
    try {
      await fn();
      if (okMsg) toast.success(okMsg);
    } catch {
      toast.error('Não consegui salvar. Tente de novo.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cn(
      'rounded-lg border p-3 space-y-2',
      isOverdue ? 'border-destructive/40 bg-destructive/5' : 'bg-card',
      !isOpen && 'opacity-70'
    )}>
      <div className="min-w-0 flex-1">
        <p className={cn('text-sm font-medium break-words', !isOpen && 'line-through')}>
          {item.title}
        </p>

        <p className="text-[11px] text-muted-foreground mt-0.5 flex flex-wrap items-center gap-1">
          {fromAI ? (
            <span className="inline-flex items-center gap-1 text-primary">
              <Sparkles className="h-3 w-3" /> detectada na conversa
            </span>
          ) : (
            <span>registrada por {item.created_by_name || 'alguém da equipe'}</span>
          )}
          <span>· {formatDistanceToNow(new Date(item.promised_at), { addSuffix: true, locale: ptBR })}</span>
          {item.kind && item.kind !== 'outro' && <span>· {item.kind}</span>}
          {item.reminder_count > 0 && <span>· cobrado {item.reminder_count}x</span>}
        </p>

        {item.due_date && (
          <p className={cn(
            'text-[11px] mt-0.5 inline-flex items-center gap-1',
            isOverdue ? 'text-destructive font-medium' : 'text-muted-foreground'
          )}>
            {isOverdue && <AlertTriangle className="h-3 w-3" />}
            prazo {format(new Date(`${item.due_date}T12:00:00`), 'dd/MM/yyyy', { locale: ptBR })}
          </p>
        )}

        {item.status === 'feito' && item.done_at && (
          <p className="text-[11px] text-emerald-600 mt-0.5">
            feito {formatDistanceToNow(new Date(item.done_at), { addSuffix: true, locale: ptBR })}
            {item.done_by_name ? ` · marcado por ${item.done_by_name}` : ''}
          </p>
        )}
        {item.status === 'desistiu' && (
          <p className="text-[11px] text-muted-foreground mt-0.5">cliente desistiu</p>
        )}

        {item.source_message_text && (
          <p className="mt-1.5 text-[11px] text-muted-foreground border-l-2 border-primary/40 pl-2 italic break-words">
            <MessageSquareQuote className="h-3 w-3 inline mr-1" />
            “{item.source_message_text}”
          </p>
        )}
        {item.notes && (
          <p className="mt-1 text-[11px] text-muted-foreground break-words">{item.notes}</p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        {isOpen ? (
          <>
            <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1"
              disabled={busy}
              onClick={() => (onAskResolver
                ? onAskResolver(item)
                : run(() => onDone(item.id), 'Marcada como feita'))}>
              <Check className="h-3 w-3" /> Feito
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1"
              disabled={busy}
              onClick={async () => {
                await run(() => onRemind(item));
                onDraftMessage?.(buildReminderText(item, clientName));
                toast.success('Cobrança escrita no campo de mensagem — revise antes de enviar');
              }}>
              <Bell className="h-3 w-3" /> Cobrar
            </Button>
            {onCreateActivity && (
              <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1"
                title="Abrir uma atividade do escritório para tratar desta pendência"
                disabled={busy}
                onClick={() => onCreateActivity(item)}>
                <CalendarPlus className="h-3 w-3" /> Atividade
              </Button>
            )}
            <Button size="sm" variant="ghost" className="h-7 text-[11px] gap-1 text-muted-foreground"
              disabled={busy}
              onClick={() => run(() => onGiveUp(item.id), 'Marcada como desistência')}>
              <X className="h-3 w-3" /> Desistiu
            </Button>
            {fromAI && (
              <Button size="sm" variant="ghost" className="h-7 text-[11px] gap-1 text-muted-foreground"
                title="A IA entendeu errado — some da lista e ela não registra de novo"
                disabled={busy}
                onClick={() => run(() => onDismiss(item.id), 'Ok, não era pendência')}>
                <ThumbsDown className="h-3 w-3" /> Não era
              </Button>
            )}
          </>
        ) : (
          <Button size="sm" variant="ghost" className="h-7 text-[11px] gap-1"
            disabled={busy}
            onClick={() => run(() => onReopen(item.id), 'Pendência reaberta')}>
            <RotateCcw className="h-3 w-3" /> Reabrir
          </Button>
        )}
        <Button size="sm" variant="ghost" className="h-7 text-[11px] gap-1 text-destructive ml-auto"
          disabled={busy}
          onClick={() => run(() => onRemove(item.id), 'Pendência excluída')}>
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

export function ClientCommitmentsPanel({
  openState, onOpenChange, clientName, open, done, loading, analyzing, summary, analyzeError,
  draft, onDraftConsumed, onAnalyze, onCreate, onDone, onGiveUp, onDismiss,
  onReopen, onRemind, onRemove, onDraftMessage, onCreateActivity,
  alertEnabled, onAlertEnabledChange, teamOptions, suggestedResolver,
}: Props) {
  const [showManual, setShowManual] = useState(false);
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  // Resolvidas começam abertas: o valor está justamente em ver o que o cliente
  // já entregou sem ter que caçar na conversa.
  const [showDone, setShowDone] = useState(true);
  /** Pendência esperando a resposta de "quem resolveu". */
  const [resolvendo, setResolvendo] = useState<ClientCommitment | null>(null);
  const [resolverId, setResolverId] = useState<string>('');
  const [salvandoResolver, setSalvandoResolver] = useState(false);

  const temEquipe = Array.isArray(teamOptions) && teamOptions.length > 0;

  const abrirResolver = (item: ClientCommitment) => {
    // Pré-seleciona quem falou com o cliente por último; sem identificação,
    // abre vazio e obriga a escolher — chutar aqui estraga o histórico.
    setResolverId(suggestedResolver?.user_id || '');
    setResolvendo(item);
  };

  const confirmarResolver = async () => {
    if (!resolvendo || !resolverId) return;
    const escolhido = (teamOptions || []).find((m) => m.user_id === resolverId);
    setSalvandoResolver(true);
    try {
      await onDone(resolvendo.id, { userId: resolverId, name: escolhido?.full_name || null });
      toast.success(`Resolvida por ${escolhido?.full_name || 'equipe'}`);
      setResolvendo(null);
    } catch {
      toast.error('Não consegui salvar. Tente de novo.');
    } finally {
      setSalvandoResolver(false);
    }
  };

  // "Pendência" numa bolha: abre o registro manual já com a mensagem citada.
  useEffect(() => {
    if (!draft) return;
    setShowManual(true);
  }, [draft]);

  const canSave = title.trim().length >= 3 && !saving;

  /** Registrar à mão o que a IA já achou vira pendência repetida na tela. */
  const duplicataDe = useMemo(() => {
    const t = title.trim();
    if (t.length < 3) return null;
    return [...open, ...done].find((i) => isSameCommitmentTitle(i.title, t)) || null;
  }, [title, open, done]);

  const handleCreate = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await onCreate({
        title,
        kind: 'outro',
        dueDate: dueDate || null,
        notes: notes.trim() || null,
        sourceMessageId: draft?.sourceMessageId || null,
        sourceMessageText: draft?.sourceMessageText || null,
      });
      setTitle('');
      setDueDate('');
      setNotes('');
      setShowManual(false);
      onDraftConsumed?.();
      toast.success('Pendência registrada');
    } catch {
      toast.error('Não consegui registrar a pendência');
    } finally {
      setSaving(false);
    }
  };

  const overdueCount = useMemo(() => open.filter((i) => isCommitmentOverdue(i)).length, [open]);

  const handleReanalyze = async () => {
    const r = await onAnalyze(true);
    if (!r.success) {
      // Mostra o motivo: sem isso "não consegui" servia tanto para deploy fora
      // do ar quanto para falha da IA, e ninguém sabia o que fazer.
      return toast.error(r.error ? `Não consegui ler a conversa: ${r.error}` : 'Não consegui ler a conversa agora');
    }
    const partes: string[] = [];
    if (r.created > 0) partes.push(`${r.created} pendência(s) nova(s)`);
    if ((r.closed || 0) > 0) partes.push(`${r.closed} já resolvida(s)`);
    toast.success(partes.length > 0 ? `Li a conversa: ${partes.join(' e ')}` : 'Reli a conversa — nada de novo por aqui');
  };

  return (
    <>
    <Sheet open={openState} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col">
        <SheetHeader className="p-4 pb-3">
          <SheetTitle className="flex items-center gap-2 text-base">
            <ClipboardCheck className="h-4 w-4 text-amber-600" />
            Pendências do cliente
          </SheetTitle>
          <SheetDescription className="text-xs">
            O que <strong>{clientName}</strong> ficou de fazer, lido da conversa pela IA.
            {open.length > 0 && ` ${open.length} em aberto`}
            {overdueCount > 0 ? ` · ${overdueCount} vencida(s)` : ''}
          </SheetDescription>
        </SheetHeader>

        <Separator />

        <ScrollArea className="flex-1">
          <div className="p-4 space-y-4">
            {analyzeError && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
                <p className="text-[11px] text-destructive flex items-start gap-1.5">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-px" />
                  <span>
                    <strong>Não consegui ler a conversa.</strong> {analyzeError}
                  </span>
                </p>
              </div>
            )}

            {summary && (
              <div className="rounded-lg border bg-muted/30 p-3">
                <p className="text-[11px] font-medium text-muted-foreground flex items-center gap-1.5 mb-1">
                  <FileText className="h-3.5 w-3.5" /> Resumo da conversa
                  <Sparkles className="h-2.5 w-2.5 text-primary" />
                </p>
                <p className="text-xs leading-relaxed whitespace-pre-wrap break-words">{summary}</p>
              </div>
            )}

            {(analyzing || loading) && (
              <p className="text-xs text-muted-foreground text-center py-3 inline-flex items-center gap-2 w-full justify-center">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {analyzing ? 'Lendo a conversa…' : 'Carregando…'}
              </p>
            )}

            {/* Em aberto */}
            {open.length > 0 && (
              <div className="space-y-2">
                {open.map((item) => (
                  <ItemCard
                    key={item.id}
                    item={item}
                    clientName={clientName}
                    onDone={onDone}
                    onGiveUp={onGiveUp}
                    onDismiss={onDismiss}
                    onReopen={onReopen}
                    onRemind={onRemind}
                    onRemove={onRemove}
                    onCreateActivity={onCreateActivity}
                    onAskResolver={temEquipe ? abrirResolver : undefined}
                    onDraftMessage={(t) => { onDraftMessage?.(t); onOpenChange(false); }}
                  />
                ))}
              </div>
            )}

            {open.length === 0 && !loading && !analyzing && (
              <p className="text-xs text-muted-foreground text-center py-2">
                A IA não achou nada em aberto nesta conversa.
              </p>
            )}

            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1 flex-1"
                disabled={analyzing}
                onClick={handleReanalyze}>
                {analyzing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                Reler a conversa
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-[11px] gap-1 text-muted-foreground"
                onClick={() => setShowManual((v) => !v)}>
                <Plus className="h-3 w-3" /> Adicionar à mão
              </Button>
            </div>

            {/* Registro manual — exceção, não o caminho principal */}
            {showManual && (
              <div className="rounded-lg border p-3 space-y-2.5 bg-muted/30">
                {draft?.sourceMessageText && (
                  <p className="text-[11px] text-muted-foreground border-l-2 border-primary/50 pl-2 italic break-words">
                    <MessageSquareQuote className="h-3 w-3 inline mr-1" />
                    {draft.sourceMessageText.slice(0, 300)}
                  </p>
                )}

                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="O que ele ficou de fazer"
                  className="h-8 text-sm"
                />

                <div className="flex items-center gap-2">
                  <label className="text-[11px] text-muted-foreground shrink-0">Prazo</label>
                  <Input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>

                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Observação (opcional)"
                  className="text-sm min-h-[52px]"
                />

                {duplicataDe && (
                  <p className="text-[11px] text-amber-700 dark:text-amber-400 flex items-start gap-1">
                    <AlertTriangle className="h-3 w-3 shrink-0 mt-px" />
                    Já existe uma pendência parecida: “{duplicataDe.title}”.
                  </p>
                )}

                <Button size="sm" className="w-full h-8 text-xs" disabled={!canSave} onClick={handleCreate}>
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
                  Registrar
                </Button>
              </div>
            )}

            {onAlertEnabledChange && (
              <label className="flex items-center gap-2 text-[11px] text-muted-foreground cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="h-3 w-3 accent-primary"
                  checked={alertEnabled !== false}
                  onChange={(e) => onAlertEnabledChange(e.target.checked)}
                />
                Avisar ao abrir uma conversa com pendência em aberto
              </label>
            )}

            {/* Resolvidas */}
            {done.length > 0 && (
              <div className="space-y-2">
                <button
                  className="text-xs font-medium text-muted-foreground hover:text-foreground"
                  onClick={() => setShowDone((v) => !v)}
                >
                  {showDone ? '▾' : '▸'} Já resolvidas ({done.length})
                </button>
                {showDone && done.map((item) => (
                  <ItemCard
                    key={item.id}
                    item={item}
                    clientName={clientName}
                    onDone={onDone}
                    onGiveUp={onGiveUp}
                    onDismiss={onDismiss}
                    onReopen={onReopen}
                    onRemind={onRemind}
                    onRemove={onRemove}
                    onCreateActivity={onCreateActivity}
                    onDraftMessage={onDraftMessage}
                  />
                ))}
              </div>
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>

    {/* Quem resolveu — a instância é compartilhada, então quem clica nem sempre
        é quem tratou o cliente. Vem pré-selecionado com quem falou por último
        na conversa (prefixo "*Nome:*" da mensagem enviada). */}
    <Dialog open={!!resolvendo} onOpenChange={(v) => { if (!v) setResolvendo(null); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">Quem resolveu?</DialogTitle>
          <DialogDescription className="text-xs">
            {resolvendo?.title}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Select value={resolverId} onValueChange={setResolverId}>
            <SelectTrigger className="h-9 text-sm">
              <SelectValue placeholder="Escolha quem tratou com o cliente" />
            </SelectTrigger>
            <SelectContent>
              {(teamOptions || []).map((m) => (
                <SelectItem key={m.user_id} value={m.user_id} className="text-sm">
                  {m.full_name || 'Sem nome'}
                  {suggestedResolver?.user_id === m.user_id ? ' · falou por último' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <p className="text-[11px] text-muted-foreground">
            {suggestedResolver
              ? `Sugerido pela conversa: ${suggestedResolver.full_name || '—'}.`
              : 'Ninguém identificado nas mensagens desta conversa — escolha na lista.'}
          </p>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" size="sm" onClick={() => setResolvendo(null)}>Cancelar</Button>
          <Button size="sm" disabled={!resolverId || salvandoResolver} onClick={confirmarResolver}>
            {salvandoResolver ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Check className="h-3.5 w-3.5 mr-1" />}
            Marcar como feita
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
