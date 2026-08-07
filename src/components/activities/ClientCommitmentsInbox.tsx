/**
 * Caixa de pendências do cliente — todas as conversas num lugar só.
 *
 * Mesmo formato do funil de feedbacks (Sheet + lista/calendário), porque o
 * problema é o mesmo: dívida espalhada que ninguém vê se não for procurar.
 * Aqui a pendência aparece por data, sem depender de abrir a conversa.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  ClipboardCheck, Check, MessageSquare, ThumbsDown, Loader2, RefreshCw,
  CalendarDays, ListChecks, ChevronLeft, ChevronRight, AlertTriangle, Sparkles, Search,
  CalendarPlus,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { DashboardChatPreview } from '@/components/whatsapp/DashboardChatPreview';
import {
  format, parseISO, startOfMonth, endOfMonth, eachDayOfInterval, addMonths, subMonths, isToday, getDay,
} from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useClientCommitmentsInbox } from '@/hooks/useClientCommitmentsInbox';
import { ensureRemapCache, remapToCloudSync } from '@/integrations/supabase/uuid-remap';
import { isCommitmentOverdue } from '@/lib/clientCommitments';
import {
  groupByBucket, countByDay, countByOwner, commitmentDate, BUCKET_LABEL,
  type InboxCommitment,
} from '@/lib/clientCommitmentsInbox';

interface TeamOption {
  user_id: string;
  full_name: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Equipe, para filtrar por dono e para dizer quem resolveu. */
  teamOptions?: TeamOption[];
  /**
   * Abre o formulário de atividade do escritório já preenchido a partir da
   * pendência. Mesma saída que já existe no painel de dentro da conversa —
   * sem ela, quem varre a caixa tem que redigitar a atividade do zero.
   */
  onCreateActivity?: (item: InboxCommitment) => void;
}

/**
 * Prefixo do valor do filtro quando a escolha é uma pessoa da equipe. Sem ele,
 * um UUID não se distingue dos escopos fixos ('todas', 'minhas', 'sem_dono').
 */
const MEMBRO_PREFIX = 'membro:';

export function ClientCommitmentsInbox({ open, onOpenChange, teamOptions = [], onCreateActivity }: Props) {
  const navigate = useNavigate();
  const { items, loading, reload, markDone, dismiss, meExtId } = useClientCommitmentsInbox({ enabled: open });

  // Calendário é o padrão: a pergunta que a equipe faz é "o que tem pra hoje",
  // e o mês inteiro mostra de cara onde está a dívida acumulada.
  const [view, setView] = useState<'lista' | 'calendario'>('calendario');
  // 'todas' | 'minhas' | 'sem_dono' | `membro:<owner_user_id do Externo>`
  const [escopo, setEscopo] = useState<string>('todas');
  const [busca, setBusca] = useState('');
  const [calMonth, setCalMonth] = useState(new Date());
  const [diaSelecionado, setDiaSelecionado] = useState<string | null>(
    () => new Date().toISOString().slice(0, 10)
  );

  /**
   * Conversa aberta no painel de baixo (Drawer), sem sair da caixa: quem está
   * limpando pendências não pode perder a lista a cada uma que abre.
   */
  const [conversaAberta, setConversaAberta] = useState<InboxCommitment | null>(null);
  const [resolvendo, setResolvendo] = useState<InboxCommitment | null>(null);
  const [resolverId, setResolverId] = useState('');
  const [salvando, setSalvando] = useState(false);

  const nomePorId = useMemo(() => {
    const m: Record<string, string> = {};
    for (const t of teamOptions) if (t.full_name) m[t.user_id] = t.full_name;
    return m;
  }, [teamOptions]);

  // O cache do remap precisa estar quente antes do primeiro render da lista:
  // `resolveNome` é síncrono e, sem cache, cai no caso de identidade.
  useEffect(() => { if (open) void ensureRemapCache(); }, [open]);

  /**
   * `owner_user_id` vem do Externo; `teamOptions` vem do Cloud. Os dois IDs só
   * coincidem para parte da equipe, então procurar direto perde o nome de quem
   * tem UUID diferente nos dois bancos — e a tela dizia "sem responsável" para
   * pendência que TEM dono. Mesma cascata do resolveUserName da ActivitiesPage.
   */
  const resolveNome = useCallback((userId: string | null | undefined) => {
    if (!userId) return null;
    const direto = nomePorId[userId];
    if (direto) return direto;
    const cloudId = remapToCloudSync(userId);
    if (cloudId && cloudId !== userId && nomePorId[cloudId]) return nomePorId[cloudId];
    return null;
  }, [nomePorId]);

  /**
   * A busca vem ANTES do filtro por pessoa de propósito: as contagens do filtro
   * são calculadas sobre esta lista, então escolher um membro não pode zerar o
   * número dos outros — o filtro deixaria de mostrar para onde ir em seguida.
   */
  const porBusca = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return items;
    return items.filter((i) =>
      `${i.title} ${i.lead_name || ''} ${i.phone || ''}`.toLowerCase().includes(termo)
    );
  }, [items, busca]);

  const contagemPorDono = useMemo(() => countByOwner(porBusca), [porBusca]);

  /** Quanto cada opção fixa do filtro tem, para o número aparecer já no menu. */
  const totalAberto = useMemo(
    () => contagemPorDono.reduce((s, c) => s + c.total, 0),
    [contagemPorDono]
  );
  const nMinhas = useMemo(
    () => (meExtId ? contagemPorDono.find((c) => c.ownerId === meExtId)?.total ?? 0 : 0),
    [contagemPorDono, meExtId]
  );
  const nSemDono = useMemo(
    () => contagemPorDono.find((c) => c.ownerId === null)?.total ?? 0,
    [contagemPorDono]
  );
  /** Só quem TEM pendência aparece — listar a equipe inteira com zero é ruído. */
  const membrosComPendencia = useMemo(
    () => contagemPorDono.filter((c) => c.ownerId),
    [contagemPorDono]
  );

  const filtradas = useMemo(() => porBusca.filter((i) => {
    if (escopo === 'minhas') return i.owner_user_id === meExtId;
    if (escopo === 'sem_dono') return !i.owner_user_id;
    if (escopo.startsWith(MEMBRO_PREFIX)) {
      return i.owner_user_id === escopo.slice(MEMBRO_PREFIX.length);
    }
    return true;
  }), [porBusca, escopo, meExtId]);

  const grupos = useMemo(() => groupByBucket(filtradas), [filtradas]);
  const porDia = useMemo(() => countByDay(filtradas), [filtradas]);
  const vencidasN = useMemo(() => filtradas.filter((i) => isCommitmentOverdue(i)).length, [filtradas]);

  const doDiaSelecionado = useMemo(
    () => (diaSelecionado ? filtradas.filter((i) => commitmentDate(i) === diaSelecionado) : []),
    [filtradas, diaSelecionado]
  );

  /**
   * Abre a conversa no painel de baixo. A caixa sai da frente enquanto isso e
   * volta sozinha ao fechar — empilhar o Drawer sobre o Sheet deixaria dois
   * modais disputando foco e trava de rolagem.
   */
  const abrirConversa = (item: InboxCommitment) => {
    if (!item.phone) return toast.error('Pendência sem telefone da conversa');
    setConversaAberta(item);
    onOpenChange(false);
  };

  const fecharConversa = () => {
    setConversaAberta(null);
    // Volta para a lista de onde a pessoa saiu. Reabrir já recarrega (o hook
    // recarrega quando `enabled` volta a ser true), então a pendência
    // resolvida dentro da conversa some sozinha.
    onOpenChange(true);
  };

  /** Saída para a inbox completa, quando a pessoa quer o resto das ferramentas. */
  const irParaWhatsApp = (phone: string) => {
    setConversaAberta(null);
    onOpenChange(false);
    navigate(`/whatsapp?openChat=${encodeURIComponent(phone)}`);
  };

  const abrirResolver = (item: InboxCommitment) => {
    // Pré-seleciona o dono do caso: aqui, fora da conversa, não dá para saber
    // quem falou por último com o cliente.
    // O select lista IDs do Cloud (teamOptions); `owner_user_id` é do Externo.
    // Sem converter, a pré-seleção só acertava quem tem o mesmo UUID nos dois.
    const donoCloud = remapToCloudSync(item.owner_user_id);
    setResolverId(donoCloud && nomePorId[donoCloud] ? donoCloud : '');
    setResolvendo(item);
  };

  const confirmarResolver = async () => {
    if (!resolvendo || !resolverId) return;
    setSalvando(true);
    try {
      await markDone(resolvendo.id, { userId: resolverId, name: nomePorId[resolverId] || null });
      toast.success(`Resolvida por ${nomePorId[resolverId] || 'equipe'}`);
      setResolvendo(null);
    } catch {
      toast.error('Não consegui salvar. Tente de novo.');
    } finally {
      setSalvando(false);
    }
  };

  const calDays = eachDayOfInterval({ start: startOfMonth(calMonth), end: endOfMonth(calMonth) });
  const espacosIniciais = getDay(startOfMonth(calMonth));

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-full sm:max-w-2xl p-0 flex flex-col">
          <SheetHeader className="p-4 pb-2">
            <SheetTitle className="flex items-center gap-2 text-base">
              <ClipboardCheck className="h-4 w-4 text-amber-600" />
              Pendências dos clientes
              {vencidasN > 0 && (
                <Badge variant="destructive" className="text-[10px]">{vencidasN} vencida(s)</Badge>
              )}
            </SheetTitle>
            <SheetDescription className="text-xs">
              O que os clientes ficaram de fazer, de todas as conversas. Sem prazo marcado, a
              pendência entra pela data em que foi combinada.
            </SheetDescription>

            <div className="flex items-center gap-2 flex-wrap pt-2">
              <div className="flex rounded-md border overflow-hidden text-[11px]">
                <button
                  type="button"
                  onClick={() => { setView('lista'); setDiaSelecionado(null); }}
                  className={cn('px-2 py-1 flex items-center gap-1', view === 'lista' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted')}
                >
                  <ListChecks className="h-3 w-3" /> Lista
                </button>
                <button
                  type="button"
                  onClick={() => setView('calendario')}
                  className={cn('px-2 py-1 flex items-center gap-1 border-l', view === 'calendario' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted')}
                >
                  <CalendarDays className="h-3 w-3" /> Calendário
                </button>
              </div>

              <Select value={escopo} onValueChange={setEscopo}>
                <SelectTrigger className="h-7 w-[230px] text-[11px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-[320px]">
                  <SelectItem value="todas" className="text-xs">
                    Todas as pendências ({totalAberto})
                  </SelectItem>
                  <SelectItem value="minhas" className="text-xs">
                    Só as minhas ({nMinhas})
                  </SelectItem>
                  <SelectItem value="sem_dono" className="text-xs">
                    Sem responsável definido ({nSemDono})
                  </SelectItem>

                  {membrosComPendencia.length > 0 && (
                    <>
                      <Separator className="my-1" />
                      <p className="px-2 py-1 text-[10px] font-medium text-muted-foreground">
                        Por responsável
                      </p>
                      {membrosComPendencia.map((c) => {
                        const nome = resolveNome(c.ownerId);
                        return (
                          <SelectItem
                            key={c.ownerId!}
                            value={`${MEMBRO_PREFIX}${c.ownerId}`}
                            className="text-xs"
                          >
                            {/* Sem nome resolvido, o sufixo do id evita fundir
                                duas pessoas diferentes numa linha só. */}
                            {nome || `Não identificado #${c.ownerId!.slice(0, 4)}`} ({c.total})
                            {c.vencidas > 0 && ` · ${c.vencidas} vencida(s)`}
                          </SelectItem>
                        );
                      })}
                    </>
                  )}
                </SelectContent>
              </Select>

              <div className="relative flex-1 min-w-[160px]">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                <Input
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Buscar por cliente ou pendência"
                  className="h-7 pl-7 text-[11px]"
                />
              </div>

              <Button size="sm" variant="ghost" className="h-7 text-[11px] gap-1" onClick={reload} disabled={loading}>
                {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              </Button>
            </div>
          </SheetHeader>

          <Separator />

          <ScrollArea className="flex-1">
            <div className="p-4 space-y-4">
              {loading && items.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-6">Carregando…</p>
              )}

              {!loading && filtradas.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-6">
                  {escopo === 'minhas'
                    ? 'Nenhuma pendência de cliente nos seus casos. 👏'
                    : escopo.startsWith(MEMBRO_PREFIX)
                      ? 'Nenhuma pendência para este responsável.'
                      : 'Nenhuma pendência em aberto.'}
                </p>
              )}

              {view === 'lista' && grupos.map(({ bucket, items: doGrupo }) => (
                <div key={bucket} className="space-y-2">
                  <p className={cn(
                    'text-xs font-semibold',
                    bucket === 'vencidas' ? 'text-destructive' : 'text-muted-foreground'
                  )}>
                    {BUCKET_LABEL[bucket]} ({doGrupo.length})
                  </p>
                  {doGrupo.map((item) => (
                    <InboxCard
                      key={item.id}
                      item={item}
                      donoNome={resolveNome(item.owner_user_id)}
                      onAbrirConversa={abrirConversa}
                      onResolver={abrirResolver}
                      onCreateActivity={onCreateActivity}
                      onDismiss={async (id) => {
                        try { await dismiss(id); toast.success('Ok, não era pendência'); }
                        catch { toast.error('Não consegui salvar.'); }
                      }}
                    />
                  ))}
                </div>
              ))}

              {view === 'calendario' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setCalMonth(subMonths(calMonth, 1))}>
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="text-sm font-medium capitalize">
                      {format(calMonth, "MMMM 'de' yyyy", { locale: ptBR })}
                    </span>
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setCalMonth(addMonths(calMonth, 1))}>
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>

                  <div className="grid grid-cols-7 gap-1 text-center">
                    {['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((d, i) => (
                      <span key={i} className="text-[10px] font-medium text-muted-foreground">{d}</span>
                    ))}
                    {Array.from({ length: espacosIniciais }).map((_, i) => <span key={`v${i}`} />)}
                    {calDays.map((d) => {
                      const iso = format(d, 'yyyy-MM-dd');
                      const n = porDia[iso] || 0;
                      const atrasado = n > 0 && iso < new Date().toISOString().slice(0, 10);
                      return (
                        <button
                          key={iso}
                          type="button"
                          onClick={() => setDiaSelecionado(iso === diaSelecionado ? null : iso)}
                          className={cn(
                            'aspect-square rounded text-[11px] flex flex-col items-center justify-center border transition-colors',
                            n === 0 && 'text-muted-foreground/50 border-transparent',
                            n > 0 && !atrasado && 'bg-amber-50 border-amber-200 text-amber-900 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-900',
                            atrasado && 'bg-destructive/10 border-destructive/40 text-destructive font-semibold',
                            isToday(d) && 'ring-1 ring-primary',
                            iso === diaSelecionado && 'ring-2 ring-primary'
                          )}
                        >
                          <span>{format(d, 'd')}</span>
                          {n > 0 && <span className="text-[9px] font-bold">{n}</span>}
                        </button>
                      );
                    })}
                  </div>

                  {diaSelecionado && (
                    <div className="space-y-2 pt-2">
                      <p className="text-xs font-semibold text-muted-foreground">
                        {format(parseISO(diaSelecionado), "dd 'de' MMMM", { locale: ptBR })} — {doDiaSelecionado.length} pendência(s)
                      </p>
                      {doDiaSelecionado.map((item) => (
                        <InboxCard
                          key={item.id}
                          item={item}
                          donoNome={resolveNome(item.owner_user_id)}
                          onAbrirConversa={abrirConversa}
                          onResolver={abrirResolver}
                          onCreateActivity={onCreateActivity}
                          onDismiss={async (id) => {
                            try { await dismiss(id); toast.success('Ok, não era pendência'); }
                            catch { toast.error('Não consegui salvar.'); }
                          }}
                        />
                      ))}
                    </div>
                  )}

                  {!diaSelecionado && (
                    <p className="text-[11px] text-muted-foreground text-center">
                      Clique num dia para ver as pendências dele.
                    </p>
                  )}
                </div>
              )}
            </div>
          </ScrollArea>
        </SheetContent>
      </Sheet>

      {conversaAberta && (
        <DashboardChatPreview
          open={!!conversaAberta}
          onOpenChange={(v) => { if (!v) fecharConversa(); }}
          phone={conversaAberta.phone}
          contactName={conversaAberta.lead_name}
          instanceName={conversaAberta.instance_name}
          hasLead={!!conversaAberta.lead_id}
          hasContact={!!conversaAberta.contact_id}
          wasResponded={false}
          responseTimeMinutes={null}
          onOpenChat={irParaWhatsApp}
          onConversationUpdated={reload}
        />
      )}

      <Dialog open={!!resolvendo} onOpenChange={(v) => { if (!v) setResolvendo(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">Quem resolveu?</DialogTitle>
            <DialogDescription className="text-xs">{resolvendo?.title}</DialogDescription>
          </DialogHeader>

          <Select value={resolverId} onValueChange={setResolverId}>
            <SelectTrigger className="h-9 text-sm">
              <SelectValue placeholder="Escolha quem tratou com o cliente" />
            </SelectTrigger>
            <SelectContent>
              {teamOptions.filter((m) => m.full_name).map((m) => (
                <SelectItem key={m.user_id} value={m.user_id} className="text-sm">
                  {m.full_name}
                  {resolvendo?.owner_user_id === m.user_id ? ' · responsável pelo caso' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <DialogFooter className="gap-2">
            <Button variant="ghost" size="sm" onClick={() => setResolvendo(null)}>Cancelar</Button>
            <Button size="sm" disabled={!resolverId || salvando} onClick={confirmarResolver}>
              {salvando ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Check className="h-3.5 w-3.5 mr-1" />}
              Marcar como feita
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function InboxCard({
  item, donoNome, onAbrirConversa, onResolver, onDismiss, onCreateActivity,
}: {
  item: InboxCommitment;
  donoNome: string | null;
  onAbrirConversa: (i: InboxCommitment) => void;
  onResolver: (i: InboxCommitment) => void;
  onDismiss: (id: string) => Promise<void>;
  onCreateActivity?: (i: InboxCommitment) => void;
}) {
  const [busy, setBusy] = useState(false);
  const vencida = isCommitmentOverdue(item);
  const data = commitmentDate(item);

  return (
    <div className={cn(
      'rounded-lg border p-3 space-y-2',
      vencida ? 'border-destructive/40 bg-destructive/5' : 'bg-card'
    )}>
      <div className="min-w-0">
        <p className="text-sm font-medium break-words">{item.title}</p>

        <p className="text-[11px] text-muted-foreground mt-0.5 flex flex-wrap items-center gap-1">
          <span className="font-medium text-foreground/70">{item.lead_name || item.phone}</span>
          {item.origin === 'ia' && (
            <span className="inline-flex items-center gap-1 text-primary">
              <Sparkles className="h-3 w-3" /> detectada na conversa
            </span>
          )}
          {/* Dono sem nome resolvido ≠ pendência órfã. Dizer "sem responsável"
              nesse caso mandava a equipe procurar dono que já existia. */}
          <span>
            · {donoNome
              ? `responsável: ${donoNome}`
              : item.owner_user_id ? 'responsável não identificado' : 'sem responsável definido'}
          </span>
          {item.reminder_count > 0 && <span>· cobrado {item.reminder_count}x</span>}
        </p>

        <p className={cn(
          'text-[11px] mt-0.5 inline-flex items-center gap-1',
          vencida ? 'text-destructive font-medium' : 'text-muted-foreground'
        )}>
          {vencida && <AlertTriangle className="h-3 w-3" />}
          {item.due_date ? 'prazo ' : 'combinado em '}
          {data ? format(parseISO(data), 'dd/MM/yyyy', { locale: ptBR }) : '—'}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1" onClick={() => onResolver(item)}>
          <Check className="h-3 w-3" /> Feito
        </Button>
        <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1" onClick={() => onAbrirConversa(item)}>
          <MessageSquare className="h-3 w-3" /> Abrir conversa
        </Button>
        {onCreateActivity && (
          <Button
            size="sm" variant="outline" className="h-7 text-[11px] gap-1"
            title="Abrir uma atividade do escritório para tratar desta pendência"
            onClick={() => onCreateActivity(item)}
          >
            <CalendarPlus className="h-3 w-3" /> Gerar atividade
          </Button>
        )}
        {item.origin === 'ia' && (
          <Button
            size="sm" variant="ghost" className="h-7 text-[11px] gap-1 text-muted-foreground"
            title="A IA entendeu errado — some da lista e ela não registra de novo"
            disabled={busy}
            onClick={async () => { setBusy(true); try { await onDismiss(item.id); } finally { setBusy(false); } }}
          >
            <ThumbsDown className="h-3 w-3" /> Não era
          </Button>
        )}
      </div>
    </div>
  );
}
