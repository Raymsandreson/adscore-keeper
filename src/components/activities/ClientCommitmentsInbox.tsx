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
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  ClipboardCheck, Check, MessageSquare, ThumbsDown, Loader2, RefreshCw,
  CalendarDays, ListChecks, ChevronLeft, ChevronRight, AlertTriangle, Sparkles, Search,
  CalendarPlus, ExternalLink, UserCog, ChevronsUpDown,
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
import { useConversationDisplayNames, conversationDisplayName } from '@/hooks/useConversationDisplayNames';
import { ensureRemapCache, remapToCloudSync, remapToExternal } from '@/integrations/supabase/uuid-remap';
import { isCommitmentOverdue } from '@/lib/clientCommitments';
import { filterAssignableMembers } from '@/lib/assigneeBlocklist';
import {
  groupByBucket, countByDay, countByOwner, commitmentDate, isCommitmentConverted, BUCKET_LABEL,
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
  /**
   * Abre a ficha de uma atividade já existente em aba lateral — o atalho da
   * pendência que virou atividade. Nunca redireciona.
   */
  onOpenActivity?: (activityId: string) => void;
}

/**
 * Prefixo do valor do filtro quando a escolha é uma pessoa da equipe. Sem ele,
 * um UUID não se distingue dos escopos fixos ('todas', 'minhas', 'sem_dono').
 */
const MEMBRO_PREFIX = 'membro:';

/** Filtro das que já viraram atividade do escritório. */
const ESCOPO_CONVERTIDAS = 'convertidas';

export function ClientCommitmentsInbox({
  open, onOpenChange, teamOptions = [], onCreateActivity, onOpenActivity,
}: Props) {
  const navigate = useNavigate();
  const {
    items, loading, reload, markDone, dismiss, setAssignee, meExtId,
  } = useClientCommitmentsInbox({ enabled: open });

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
  const [filtroAberto, setFiltroAberto] = useState(false);
  const [conversaAberta, setConversaAberta] = useState<InboxCommitment | null>(null);
  const [resolvendo, setResolvendo] = useState<InboxCommitment | null>(null);
  const [resolverId, setResolverId] = useState('');
  const [salvando, setSalvando] = useState(false);
  /** Pendência com o "quem cuida disto?" aberto. */
  const [trocandoDono, setTrocandoDono] = useState<InboxCommitment | null>(null);
  const [novoDonoId, setNovoDonoId] = useState('');

  /**
   * Nome da conversa (grupo ou contato). Sem isto a lista mostrava o JID cru
   * do grupo quando a pendência não tinha lead vinculado.
   */
  const nomesResolvidos = useConversationDisplayNames(useMemo(() => items.map((i) => i.phone), [items]));
  const nomeDaConversa = useCallback(
    (i: InboxCommitment) => conversationDisplayName(i.phone, i.lead_name, nomesResolvidos),
    [nomesResolvidos]
  );

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
  const casaBusca = useCallback((i: InboxCommitment) => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return true;
    // O nome do grupo entra na busca: quem procura "Denisson" não sabe o JID.
    const nome = nomeDaConversa(i);
    return `${i.title} ${i.lead_name || ''} ${nome} ${i.phone || ''}`.toLowerCase().includes(termo);
  }, [busca, nomeDaConversa]);

  /**
   * A fila de cobrança: o que ainda não virou atividade. As contagens do filtro
   * saem SEMPRE daqui — se saíssem da lista exibida, entrar em "Viraram
   * atividade" zeraria os números de todo mundo.
   */
  const porBusca = useMemo(
    () => items.filter((i) => !isCommitmentConverted(i) && casaBusca(i)),
    [items, casaBusca]
  );

  const convertidas = useMemo(
    () => items.filter((i) => isCommitmentConverted(i) && casaBusca(i)),
    [items, casaBusca]
  );

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

  /**
   * Nome do dono para o filtro. Sem nome resolvido, o sufixo do id evita fundir
   * duas pessoas diferentes numa linha só.
   */
  const nomeDoDono = useCallback(
    (id: string) => resolveNome(id) || `Não identificado #${id.slice(0, 4)}`,
    [resolveNome]
  );

  /** Opções que não são pessoas — ficam fixas no topo do filtro. */
  const escoposFixos = useMemo(() => [
    { value: 'todas', label: 'Todas as pendências', n: totalAberto },
    { value: 'minhas', label: 'Só as minhas', n: nMinhas },
    { value: 'sem_dono', label: 'Sem responsável definido', n: nSemDono },
    { value: ESCOPO_CONVERTIDAS, label: 'Viraram atividade', n: convertidas.length },
  ], [totalAberto, nMinhas, nSemDono, convertidas.length]);

  const rotuloEscopo = useMemo(() => {
    const fixo = escoposFixos.find((e) => e.value === escopo);
    if (fixo) return `${fixo.label} (${fixo.n})`;
    const id = escopo.slice(MEMBRO_PREFIX.length);
    const c = contagemPorDono.find((x) => x.ownerId === id);
    return `${nomeDoDono(id)} (${c?.total ?? 0})`;
  }, [escopo, escoposFixos, contagemPorDono, nomeDoDono]);

  const filtradas = useMemo(() => {
    if (escopo === ESCOPO_CONVERTIDAS) return convertidas;
    return porBusca.filter((i) => {
      if (escopo === 'minhas') return i.owner_user_id === meExtId;
      if (escopo === 'sem_dono') return !i.owner_user_id;
      if (escopo.startsWith(MEMBRO_PREFIX)) {
        return i.owner_user_id === escopo.slice(MEMBRO_PREFIX.length);
      }
      return true;
    });
  }, [porBusca, convertidas, escopo, meExtId]);

  const grupos = useMemo(() => groupByBucket(filtradas), [filtradas]);
  const porDia = useMemo(() => countByDay(filtradas), [filtradas]);
  // Sai da fila de cobrança, não da lista exibida: o selo do topo é a dívida
  // com o cliente, e o que já virou atividade não está mais devendo cobrança.
  const vencidasN = useMemo(() => porBusca.filter((i) => isCommitmentOverdue(i)).length, [porBusca]);

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

  const abrirTrocaDono = (item: InboxCommitment) => {
    // O select lista IDs do Cloud; `assigned_to`/`owner_user_id` são do Externo.
    const atualCloud = remapToCloudSync(item.assigned_to || item.owner_user_id);
    setNovoDonoId(atualCloud && nomePorId[atualCloud] ? atualCloud : '');
    setTrocandoDono(item);
  };

  /**
   * Grava o responsável escolhido à mão. `cloudId` vazio devolve a pendência
   * para o automático (dono do caso / da conversa / da linha).
   */
  const confirmarTrocaDono = async (cloudId: string) => {
    if (!trocandoDono) return;
    setSalvando(true);
    try {
      const extId = cloudId ? ((await remapToExternal(cloudId)) as string | null) : null;
      await setAssignee(trocandoDono.id, extId);
      toast.success(
        cloudId
          ? `Agora é responsabilidade de ${nomePorId[cloudId] || 'quem você escolheu'}`
          : 'Responsável de volta ao automático (dono do caso/da conversa)'
      );
      setTrocandoDono(null);
    } catch {
      toast.error('Não consegui salvar o responsável.');
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

              {/* Combobox e não Select: com a equipe inteira na lista, rolar
                  até o nome é mais lento que digitá-lo. */}
              <Popover open={filtroAberto} onOpenChange={setFiltroAberto}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    aria-expanded={filtroAberto}
                    className="h-7 w-[230px] justify-between px-2 text-[11px] font-normal"
                  >
                    <span className="truncate">{rotuloEscopo}</span>
                    <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[260px] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Filtrar por nome do membro…" className="text-xs" />
                    <CommandList className="max-h-[300px]">
                      <CommandEmpty className="py-4 text-center text-xs text-muted-foreground">
                        Ninguém com esse nome tem pendência.
                      </CommandEmpty>

                      <CommandGroup>
                        {escoposFixos.map((e) => (
                          <CommandItem
                            key={e.value}
                            value={e.label}
                            className="text-xs"
                            onSelect={() => { setEscopo(e.value); setFiltroAberto(false); }}
                          >
                            <span className="truncate">{e.label}</span>
                            <span className="ml-auto pl-2 tabular-nums text-muted-foreground">
                              {e.n}
                            </span>
                            <Check className={cn(
                              'ml-1 h-3 w-3 shrink-0',
                              escopo === e.value ? 'opacity-100' : 'opacity-0'
                            )} />
                          </CommandItem>
                        ))}
                      </CommandGroup>

                      {membrosComPendencia.length > 0 && (
                        <CommandGroup heading="Por responsável">
                          {membrosComPendencia.map((c) => {
                            const valor = `${MEMBRO_PREFIX}${c.ownerId}`;
                            const nome = nomeDoDono(c.ownerId!);
                            return (
                              <CommandItem
                                key={c.ownerId!}
                                /* O id entra no value para a busca casar pelo
                                   nome sem que dois homônimos virem um item só. */
                                value={`${nome} ${c.ownerId}`}
                                className="text-xs"
                                onSelect={() => { setEscopo(valor); setFiltroAberto(false); }}
                              >
                                <span className="truncate">{nome}</span>
                                <span className={cn(
                                  'ml-auto pl-2 tabular-nums',
                                  c.vencidas > 0 ? 'text-destructive' : 'text-muted-foreground'
                                )}>
                                  {c.total}
                                  {c.vencidas > 0 && ` · ${c.vencidas} venc.`}
                                </span>
                                <Check className={cn(
                                  'ml-1 h-3 w-3 shrink-0',
                                  escopo === valor ? 'opacity-100' : 'opacity-0'
                                )} />
                              </CommandItem>
                            );
                          })}
                        </CommandGroup>
                      )}
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>

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
                    : escopo === ESCOPO_CONVERTIDAS
                      ? 'Nenhuma pendência virou atividade ainda.'
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
                      nomeCliente={nomeDaConversa(item)}
                      donoNome={resolveNome(item.owner_user_id)}
                      onAbrirConversa={abrirConversa}
                      onResolver={abrirResolver}
                      onCreateActivity={onCreateActivity}
                      onOpenActivity={onOpenActivity}
                      onTrocarDono={abrirTrocaDono}
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
                          nomeCliente={nomeDaConversa(item)}
                          donoNome={resolveNome(item.owner_user_id)}
                          onAbrirConversa={abrirConversa}
                          onResolver={abrirResolver}
                          onCreateActivity={onCreateActivity}
                          onOpenActivity={onOpenActivity}
                          onTrocarDono={abrirTrocaDono}
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
          contactName={nomeDaConversa(conversaAberta)}
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
              {filterAssignableMembers(teamOptions).filter((m) => m.full_name).map((m) => (
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

      <Dialog open={!!trocandoDono} onOpenChange={(v) => { if (!v) setTrocandoDono(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">Quem cuida desta pendência?</DialogTitle>
            <DialogDescription className="text-xs">
              {trocandoDono?.title}
              <br />
              Sem escolha manual, o responsável sai automaticamente do caso, da conversa ou da
              linha. Trocar aqui vale só para esta pendência.
            </DialogDescription>
          </DialogHeader>

          <Select value={novoDonoId} onValueChange={setNovoDonoId}>
            <SelectTrigger className="h-9 text-sm">
              <SelectValue placeholder="Escolha quem passa a cobrar este cliente" />
            </SelectTrigger>
            <SelectContent>
              {filterAssignableMembers(teamOptions).filter((m) => m.full_name).map((m) => (
                <SelectItem key={m.user_id} value={m.user_id} className="text-sm">
                  {m.full_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <DialogFooter className="gap-2 sm:justify-between">
            {/* Sai da escolha manual e volta para a cascata — sem isso, um clique
                errado deixaria a pendência presa numa pessoa para sempre. */}
            <Button
              variant="ghost" size="sm" disabled={salvando}
              onClick={() => confirmarTrocaDono('')}
            >
              Voltar ao automático
            </Button>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setTrocandoDono(null)}>Cancelar</Button>
              <Button size="sm" disabled={!novoDonoId || salvando} onClick={() => confirmarTrocaDono(novoDonoId)}>
                {salvando ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <UserCog className="h-3.5 w-3.5 mr-1" />}
                Salvar responsável
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function InboxCard({
  item, donoNome, nomeCliente, onAbrirConversa, onResolver, onDismiss, onCreateActivity,
  onOpenActivity, onTrocarDono,
}: {
  item: InboxCommitment;
  donoNome: string | null;
  /** Nome do grupo/contato da conversa — nunca o JID. */
  nomeCliente: string;
  onAbrirConversa: (i: InboxCommitment) => void;
  onResolver: (i: InboxCommitment) => void;
  onDismiss: (id: string) => Promise<void>;
  onCreateActivity?: (i: InboxCommitment) => void;
  onOpenActivity?: (activityId: string) => void;
  onTrocarDono?: (i: InboxCommitment) => void;
}) {
  const [busy, setBusy] = useState(false);
  const vencida = isCommitmentOverdue(item);
  const data = commitmentDate(item);
  const virouAtividade = isCommitmentConverted(item);

  return (
    <div className={cn(
      'rounded-lg border p-3 space-y-2',
      virouAtividade
        ? 'border-primary/40 bg-primary/5'
        : vencida ? 'border-destructive/40 bg-destructive/5' : 'bg-card'
    )}>
      <div className="min-w-0">
        <p className="text-sm font-medium break-words">{item.title}</p>

        {virouAtividade && (
          <p className="text-[11px] mt-0.5 inline-flex items-center gap-1 text-primary font-medium">
            <CalendarPlus className="h-3 w-3" /> Virou atividade do escritório
          </p>
        )}

        <p className="text-[11px] text-muted-foreground mt-0.5 flex flex-wrap items-center gap-1">
          <span className="font-medium text-foreground/70">{nomeCliente}</span>
          {item.origin === 'ia' && (
            <span className="inline-flex items-center gap-1 text-primary">
              <Sparkles className="h-3 w-3" /> detectada na conversa
            </span>
          )}
          {/* Dono sem nome resolvido ≠ pendência órfã. Dizer "sem responsável"
              nesse caso mandava a equipe procurar dono que já existia. */}
          {/* Clicar no responsável troca o responsável: é onde a pessoa já está
              olhando quando percebe que a pendência caiu no nome errado. */}
          <span>
            · {onTrocarDono ? (
              <button
                type="button"
                onClick={() => onTrocarDono(item)}
                className="underline decoration-dotted underline-offset-2 hover:text-foreground"
                title="Trocar quem cuida desta pendência"
              >
                {donoNome
                  ? `responsável: ${donoNome}`
                  : item.owner_user_id ? 'responsável não identificado' : 'sem responsável definido'}
                {item.assigned_to ? ' (definido à mão)' : ''}
              </button>
            ) : (
              donoNome
                ? `responsável: ${donoNome}`
                : item.owner_user_id ? 'responsável não identificado' : 'sem responsável definido'
            )}
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
        {/* Já tem atividade: o caminho passa a ser abrir a ficha dela, não
            gerar outra — dois cards para a mesma promessa era o efeito antigo. */}
        {virouAtividade && item.activity_id && onOpenActivity && (
          <Button
            size="sm" variant="default" className="h-7 text-[11px] gap-1"
            title="Abrir a ficha da atividade em aba lateral"
            onClick={() => onOpenActivity(item.activity_id!)}
          >
            <ExternalLink className="h-3 w-3" /> Ver atividade
          </Button>
        )}
        {!virouAtividade && onCreateActivity && (
          <Button
            size="sm" variant="outline" className="h-7 text-[11px] gap-1"
            title="Abrir uma atividade do escritório para tratar desta pendência"
            onClick={() => onCreateActivity(item)}
          >
            <CalendarPlus className="h-3 w-3" /> Gerar atividade
          </Button>
        )}
        {onTrocarDono && (
          <Button
            size="sm" variant="ghost" className="h-7 text-[11px] gap-1 text-muted-foreground"
            title="Trocar quem cuida desta pendência"
            onClick={() => onTrocarDono(item)}
          >
            <UserCog className="h-3 w-3" /> Responsável
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
