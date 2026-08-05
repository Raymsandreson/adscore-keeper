import { useEffect, useMemo, useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  ClipboardCheck, Check, Bell, X, RotateCcw, Trash2, AlertTriangle, Loader2, MessageSquareQuote,
} from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  COMMITMENT_KINDS, kindMeta,
  type ClientCommitment, type CommitmentKind,
} from '@/hooks/useClientCommitments';
import { buildReminderText, isCommitmentOpen, isCommitmentOverdue } from '@/lib/clientCommitments';

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
  /** Rascunho vindo de "Virou pendência" numa bolha da conversa. */
  draft?: CommitmentDraft | null;
  onDraftConsumed?: () => void;
  onCreate: (input: {
    title: string;
    kind: CommitmentKind;
    dueDate?: string | null;
    notes?: string | null;
    sourceMessageId?: string | null;
    sourceMessageText?: string | null;
  }) => Promise<unknown>;
  onDone: (id: string) => Promise<unknown>;
  onGiveUp: (id: string) => Promise<unknown>;
  onReopen: (id: string) => Promise<unknown>;
  onRemind: (item: ClientCommitment) => Promise<unknown>;
  onRemove: (id: string) => Promise<unknown>;
  /** Escreve a cobrança no campo de mensagem da conversa (não envia). */
  onDraftMessage?: (text: string) => void;
}

function ItemCard({
  item, clientName, onDone, onGiveUp, onReopen, onRemind, onRemove, onDraftMessage,
}: {
  item: ClientCommitment;
  clientName: string;
  onDone: Props['onDone'];
  onGiveUp: Props['onGiveUp'];
  onReopen: Props['onReopen'];
  onRemind: Props['onRemind'];
  onRemove: Props['onRemove'];
  onDraftMessage?: Props['onDraftMessage'];
}) {
  const [busy, setBusy] = useState(false);
  const meta = kindMeta(item.kind);
  const isOpen = isCommitmentOpen(item.status);
  const isOverdue = isCommitmentOverdue(item);

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
      <div className="flex items-start gap-2">
        <span className="text-base leading-none mt-0.5">{meta.emoji}</span>
        <div className="min-w-0 flex-1">
          <p className={cn('text-sm font-medium break-words', !isOpen && 'line-through')}>
            {item.title}
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            combinado {formatDistanceToNow(new Date(item.promised_at), { addSuffix: true, locale: ptBR })}
            {item.created_by_name ? ` · por ${item.created_by_name}` : ''}
            {item.reminder_count > 0 ? ` · cobrado ${item.reminder_count}x` : ''}
          </p>
          {item.due_date && (
            <p className={cn(
              'text-[11px] mt-0.5 inline-flex items-center gap-1',
              isOverdue ? 'text-destructive font-medium' : 'text-muted-foreground'
            )}>
              {isOverdue && <AlertTriangle className="h-3 w-3" />}
              prazo {format(new Date(`${item.due_date}T12:00:00`), "dd/MM/yyyy", { locale: ptBR })}
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
            <p className="mt-1.5 text-[11px] text-muted-foreground border-l-2 border-muted pl-2 italic break-words">
              <MessageSquareQuote className="h-3 w-3 inline mr-1" />
              {item.source_message_text}
            </p>
          )}
          {item.notes && (
            <p className="mt-1 text-[11px] text-muted-foreground break-words">{item.notes}</p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        {isOpen ? (
          <>
            <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1"
              disabled={busy}
              onClick={() => run(() => onDone(item.id), 'Pendência marcada como feita')}>
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
            <Button size="sm" variant="ghost" className="h-7 text-[11px] gap-1 text-muted-foreground"
              disabled={busy}
              onClick={() => run(() => onGiveUp(item.id), 'Marcada como desistência')}>
              <X className="h-3 w-3" /> Desistiu
            </Button>
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
  openState, onOpenChange, clientName, open, done, loading,
  draft, onDraftConsumed, onCreate, onDone, onGiveUp, onReopen, onRemind, onRemove, onDraftMessage,
}: Props) {
  const [kind, setKind] = useState<CommitmentKind>('avaliacao_google');
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [showDone, setShowDone] = useState(false);

  // "Virou pendência" numa bolha: abre já com a mensagem citada.
  useEffect(() => {
    if (!draft) return;
    setNotes('');
    setDueDate('');
    if (!title) {
      setKind('outro');
      setTitle('');
    }
  }, [draft]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickKind = (k: CommitmentKind) => {
    setKind(k);
    const suggestion = kindMeta(k).suggestion;
    if (suggestion && (!title.trim() || COMMITMENT_KINDS.some((c) => c.suggestion === title))) {
      setTitle(suggestion);
    }
  };

  const canSave = title.trim().length >= 3 && !saving;

  const handleCreate = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await onCreate({
        title,
        kind,
        dueDate: dueDate || null,
        notes: notes.trim() || null,
        sourceMessageId: draft?.sourceMessageId || null,
        sourceMessageText: draft?.sourceMessageText || null,
      });
      setTitle('');
      setDueDate('');
      setNotes('');
      onDraftConsumed?.();
      toast.success('Pendência registrada');
    } catch {
      toast.error('Não consegui registrar a pendência');
    } finally {
      setSaving(false);
    }
  };

  const overdueCount = useMemo(() => open.filter((i) => isCommitmentOverdue(i)).length, [open]);

  return (
    <Sheet open={openState} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col">
        <SheetHeader className="p-4 pb-3">
          <SheetTitle className="flex items-center gap-2 text-base">
            <ClipboardCheck className="h-4 w-4 text-amber-600" />
            Pendências do cliente
          </SheetTitle>
          <SheetDescription className="text-xs">
            O que <strong>{clientName}</strong> ficou de fazer. {open.length} em aberto
            {overdueCount > 0 ? ` · ${overdueCount} vencida(s)` : ''}.
          </SheetDescription>
        </SheetHeader>

        <Separator />

        <ScrollArea className="flex-1">
          <div className="p-4 space-y-4">
            {/* Registrar nova */}
            <div className="rounded-lg border p-3 space-y-2.5 bg-muted/30">
              <p className="text-xs font-medium">Registrar pendência</p>

              {draft?.sourceMessageText && (
                <p className="text-[11px] text-muted-foreground border-l-2 border-primary/50 pl-2 italic break-words">
                  <MessageSquareQuote className="h-3 w-3 inline mr-1" />
                  {draft.sourceMessageText.slice(0, 300)}
                </p>
              )}

              <div className="flex flex-wrap gap-1">
                {COMMITMENT_KINDS.map((k) => (
                  <button
                    key={k.value}
                    type="button"
                    onClick={() => pickKind(k.value)}
                    className={cn(
                      'text-[11px] px-2 py-1 rounded-full border transition-colors',
                      kind === k.value
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'hover:bg-accent'
                    )}
                  >
                    {k.emoji} {k.label}
                  </button>
                ))}
              </div>

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

              <Button size="sm" className="w-full h-8 text-xs" disabled={!canSave} onClick={handleCreate}>
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
                Registrar
              </Button>
            </div>

            {loading && open.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-4">Carregando…</p>
            )}

            {/* Em aberto */}
            {open.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Em aberto ({open.length})</p>
                {open.map((item) => (
                  <ItemCard
                    key={item.id}
                    item={item}
                    clientName={clientName}
                    onDone={onDone}
                    onGiveUp={onGiveUp}
                    onReopen={onReopen}
                    onRemind={onRemind}
                    onRemove={onRemove}
                    onDraftMessage={(t) => { onDraftMessage?.(t); onOpenChange(false); }}
                  />
                ))}
              </div>
            )}

            {open.length === 0 && !loading && (
              <p className="text-xs text-muted-foreground text-center py-2">
                Nada em aberto com este cliente.
              </p>
            )}

            {/* Resolvidas */}
            {done.length > 0 && (
              <div className="space-y-2">
                <button
                  className="text-xs font-medium text-muted-foreground hover:text-foreground"
                  onClick={() => setShowDone((v) => !v)}
                >
                  {showDone ? '▾' : '▸'} Resolvidas ({done.length})
                </button>
                {showDone && done.map((item) => (
                  <ItemCard
                    key={item.id}
                    item={item}
                    clientName={clientName}
                    onDone={onDone}
                    onGiveUp={onGiveUp}
                    onReopen={onReopen}
                    onRemind={onRemind}
                    onRemove={onRemove}
                    onDraftMessage={onDraftMessage}
                  />
                ))}
              </div>
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
