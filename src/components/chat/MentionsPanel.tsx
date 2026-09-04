import { useEffect, useMemo, useState } from 'react';
import { useMyMentions, type MentionNudgeLevel, type MentionScope, type TeamMentionItem } from '@/hooks/useTeamChat';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AtSign, Loader2, CheckCheck, Users, ClipboardList, Briefcase, Workflow, ArrowRight, ArrowLeft, MessageCircle, Scale, Search, Timer, Reply, CornerDownRight, BellOff, Plus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { externalSupabase, ensureExternalSession } from '@/integrations/supabase/external-client';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { TeamDirectChatPanel } from './TeamDirectChatPanel';
import { openTeamChatConversation, openTeamChatNewConversation, subscribeToTeamChatConversation, type TeamChatOpenIntent } from '@/lib/teamChatPanelEvents';
import { startDirectConversationWith } from '@/lib/teamDirectMessages';
import { openWhatsAppChatSheet } from '@/lib/whatsappChatSheet';
import { useProfilesList } from '@/hooks/useProfilesList';
import { useInactiveUserIds } from '@/hooks/useInactiveUserIds';
import { useAuthContext } from '@/contexts/AuthContext';
import { resolveOpenActivityOfChain } from '@/lib/activityChatThread';

interface MentionsPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const entityIcons: Record<string, React.ReactNode> = {
  lead: <Briefcase className="h-3.5 w-3.5" />,
  activity: <ClipboardList className="h-3.5 w-3.5" />,
  contact: <Users className="h-3.5 w-3.5" />,
  workflow: <Workflow className="h-3.5 w-3.5" />,
  pop_step: <Workflow className="h-3.5 w-3.5" />,
  whatsapp: <MessageCircle className="h-3.5 w-3.5" />,
  team_chat: <MessageCircle className="h-3.5 w-3.5" />,
  process: <Scale className="h-3.5 w-3.5" />,
  case: <Briefcase className="h-3.5 w-3.5" />,
};

const entityLabels: Record<string, string> = {
  lead: 'Lead',
  activity: 'Atividade',
  contact: 'Contato',
  workflow: 'POP',
  pop_step: 'Passo do POP',
  whatsapp: 'WhatsApp',
  team_chat: 'Chat da Equipe',
  process: 'Processo',
  case: 'Caso',
};

const CHIP_BASE =
  'flex-1 h-6 rounded-full text-[10px] font-medium border transition-colors inline-flex items-center justify-center gap-1';
/** Desligado é sempre igual: sem cor, sem preenchimento. */
const CHIP_OFF = 'bg-transparent text-muted-foreground border-border hover:bg-accent';
/** Ligado é sempre preenchido — a cor só diz QUAL filtro está valendo. */
const CHIP_ON = {
  primary: 'bg-primary text-primary-foreground border-primary',
  amber: 'bg-amber-500 text-white border-amber-500',
  sky: 'bg-sky-500 text-white border-sky-500',
  foreground: 'bg-foreground text-background border-foreground',
  violet: 'bg-violet-500 text-white border-violet-500',
  slate: 'bg-slate-500 text-white border-slate-500',
};

function iniciais(nome: string) {
  return nome
    .trim()
    .split(/s+/)
    .slice(0, 2)
    .map(parte => parte[0] || '')
    .join('')
    .toUpperCase() || '?';
}

const entityColors: Record<string, string> = {
  lead: 'bg-blue-500/10 text-blue-600',
  activity: 'bg-emerald-500/10 text-emerald-600',
  contact: 'bg-purple-500/10 text-purple-600',
  workflow: 'bg-orange-500/10 text-orange-600',
  pop_step: 'bg-orange-500/10 text-orange-600',
  whatsapp: 'bg-green-500/10 text-green-600',
  team_chat: 'bg-sky-500/10 text-sky-600',
  process: 'bg-amber-500/10 text-amber-600',
  case: 'bg-indigo-500/10 text-indigo-600',
};

/**
 * Cobrança de urgência da menção. Aparece na menção que VOCÊ fez e ainda não
 * teve resposta: um toque e quem foi marcado recebe o popup. O que já foi
 * cobrado fica registrado aqui embaixo, com o "visto" — igual ao Feedback.
 */
function MentionNudgeRow({
  mention,
  busy,
  onNudge,
  following,
  onLeave,
}: {
  mention: TeamMentionItem;
  busy: boolean;
  onNudge: (level: MentionNudgeLevel) => void;
  following: boolean;
  onLeave: () => void;
}) {
  const nudge = mention.nudge;
  // Cobrar só faz sentido enquanto ninguém respondeu, e só quem marcou cobra.
  const podeCobrar =
    mention.direction === 'out' &&
    mention.status !== 'respondido' &&
    (mention.targets?.length ?? 0) > 0;

  if (!podeCobrar && !nudge && !following) return null;

  return (
    <div className="pl-10 pr-1 pt-1.5 space-y-1">
      {podeCobrar && (
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="outline"
            className="h-6 flex-1 text-[10px] border-amber-300 text-amber-700 dark:text-amber-400"
            disabled={busy}
            onClick={() => onNudge('importante')}
            title="Avisar quem você marcou que é importante responder"
          >
            ❗ Importante
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-6 flex-1 text-[10px] border-red-400 text-red-700 dark:text-red-400"
            disabled={busy}
            onClick={() => onNudge('urgente')}
            title="Avisar quem você marcou que é urgente — popup na tela dele"
          >
            🚨 Urgente
          </Button>
        </div>
      )}
      {nudge && (
        <p className="text-[9px] leading-tight text-muted-foreground">
          {nudge.level === 'urgente' ? '🚨' : '❗'}{' '}
          {mention.direction === 'out'
            ? `Cobrado ${format(new Date(nudge.created_at), 'dd/MM HH:mm')}`
            : `${nudge.actor_name || 'Alguém'} pediu resposta ${nudge.level} ${format(new Date(nudge.created_at), 'dd/MM HH:mm')}`}
          {' · '}
          {nudge.read_at ? (
            <span className="text-green-600 dark:text-green-400 font-medium">
              ✓ visto {format(new Date(nudge.read_at), 'dd/MM HH:mm')}
            </span>
          ) : (
            <span className="text-amber-600 dark:text-amber-400">aguardando visualização</span>
          )}
        </p>
      )}
      {/* Enquanto acompanha, tudo que for dito nesse chat chega como popup —
          mesmo sem novo @. Aqui é onde a pessoa desliga isso. */}
      {following && (
        <button
          type="button"
          onClick={onLeave}
          title="Parar de receber as mensagens deste chat"
          className="inline-flex items-center gap-1 text-[9px] text-muted-foreground hover:text-foreground underline underline-offset-2"
        >
          <BellOff className="h-2.5 w-2.5" /> Finalizar participação
        </button>
      )}
    </div>
  );
}

export function MentionsPanel({ open, onOpenChange }: MentionsPanelProps) {
  const { mentions, loading, markAsRead, markAllAsRead, nudgeMention, followedThreads, leaveMentionThread } = useMyMentions();
  // Trava de duplo clique da cobrança, por mensagem.
  const [nudgingId, setNudgingId] = useState<string | null>(null);
  const navigate = useNavigate();
  // O painel é a lista de Menções, e só. A conversa em si (Chat da Equipe) abre
  // EMPILHADA por cima daqui, sempre por INTENT — menção de conversa direta,
  // "no privado" da ficha, deep link, clique no toast. Não existe mais nem aba
  // nem botão para ela: o que a aba "Chat" mostrava já chega pelas menções
  // (privado / grupo / ficha).
  const [chatView, setChatView] = useState(false);
  const [chatIntent, setChatIntent] = useState<TeamChatOpenIntent | null>(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  // Mesmo vocabulário da aba Chat: a bola está com você (responder) ou com o
  // outro (aguardando). "Não lidas" continua sendo só o que você ainda não abriu.
  const [statusFilter, setStatusFilter] = useState<'all' | 'unread' | 'responder' | 'aguardando'>('all');
  // Onde foi dito (privado / grupo / ficha) e como te chamaram (nome / @todos).
  // São dimensões independentes do status — dá pra cruzar as duas.
  const [scopeFilter, setScopeFilter] = useState<'all' | MentionScope>('all');
  const [kindFilter, setKindFilter] = useState<'all' | 'nome' | 'todos'>('all');
  // Buscar na caixa também acha PESSOA, não só menção: quem nunca te marcou não
  // tem linha aqui, e antes o nome dela simplesmente não voltava nada.
  const { user } = useAuthContext();
  const profiles = useProfilesList();
  const inactiveIds = useInactiveUserIds();
  const [abrindoConversaCom, setAbrindoConversaCom] = useState<string | null>(null);

  // Fechou o painel, some a pilha: reabrir pelo sino volta nas menções.
  useEffect(() => {
    if (!open) setChatView(false);
  }, [open]);

  useEffect(() => {
    return subscribeToTeamChatConversation((intent) => {
      setChatIntent(intent);
      setChatView(true);
      onOpenChange(true);
    });
  }, [onOpenChange]);

  const handleMentionClick = async (mention: typeof mentions[0]) => {
    // Abrir já dá ciência automaticamente — sem passo extra
    if (!mention.is_read) {
      void markAsRead(mention.id);
    }

    // Menção feita no chat direto/grupo: abre a própria conversa na aba Chat
    if (!mention.entity_type && mention.conversation_id) {
      openTeamChatConversation({ conversationId: mention.conversation_id });
      return;
    }

    try {
      let entityExists = true;
      if (mention.entity_type === 'activity') {
        const { data } = await (externalSupabase as any).from('lead_activities').select('id').eq('id', mention.entity_id).maybeSingle();
        entityExists = !!data;
      } else if (mention.entity_type === 'lead') {
        const { data } = await externalSupabase.from('leads').select('id').eq('id', mention.entity_id).maybeSingle();
        entityExists = !!data;
      } else if (mention.entity_type === 'contact') {
        const { data } = await externalSupabase.from('contacts').select('id').eq('id', mention.entity_id).maybeSingle();
        entityExists = !!data;
      }
      if (!entityExists) {
        const label = mention.entity_type === 'activity' ? 'Atividade' : mention.entity_type === 'lead' ? 'Lead' : 'Contato';
        toast.error(`${label} foi excluído(a) e não existe mais.`);
        return;
      }
    } catch (e) {
      console.error('Error validating entity:', e);
    }

    onOpenChange(false);

    const msgParam = `&highlightMsg=${mention.message_id}`;
    switch (mention.entity_type) {
      case 'lead': {
        let boardParam = '';
        try {
          const { data: lead } = await supabase
            .from('leads')
            .select('board_id')
            .eq('id', mention.entity_id)
            .maybeSingle();
          if (lead?.board_id) {
            boardParam = `board=${lead.board_id}&`;
          }
        } catch (e) {
          console.error('Error fetching lead board:', e);
        }
        navigate(`/leads?${boardParam}openLead=${mention.entity_id}${msgParam}`);
        break;
      }
      case 'activity': {
        // A menção guarda a raiz da cadeia (o chat é dela); quem clica quer a
        // etapa que está aberta hoje, não a ficha já concluída.
        const alvo = await resolveOpenActivityOfChain(mention.entity_id);
        navigate(`/?openActivity=${alvo}${msgParam}`);
        break;
      }
      case 'contact':
        navigate(`/leads?openContact=${mention.entity_id}${msgParam}`);
        break;
      case 'workflow':
        navigate(`/workflow?openBoard=${mention.entity_id}${msgParam}`);
        break;
      case 'pop_step': {
        // entity_id = id do passo. Resolve o board (POP) que contém o passo
        // via template → stage link, tudo no Externo.
        let boardId: string | null = null;
        try {
          await ensureExternalSession();
          const { data: tmpl } = await (externalSupabase as any)
            .from('checklist_templates')
            .select('id')
            .contains('items', [{ id: mention.entity_id }])
            .limit(1)
            .maybeSingle();
          if (tmpl?.id) {
            const { data: link } = await externalSupabase
              .from('checklist_stage_links')
              .select('board_id')
              .eq('checklist_template_id', tmpl.id)
              .limit(1)
              .maybeSingle();
            boardId = (link as { board_id?: string } | null)?.board_id ?? null;
          }
        } catch (e) {
          console.error('Erro ao resolver o POP do passo:', e);
        }
        if (!boardId) {
          toast.error('O passo do POP não foi encontrado (pode ter sido removido).');
          break;
        }
        navigate(`/workflow-progress?editBoard=${boardId}&openStep=${mention.entity_id}&openStepChat=1${msgParam}`);
        break;
      }
      case 'whatsapp':
        // A conversa inteira abre POR CIMA, de baixo pra cima, no mesmo drawer
        // que o resto do app usa (DashboardChatPreview): histórico, mídia,
        // resposta com IA, virar atividade. Mandar para /whatsapp tirava a
        // pessoa da tela e fazia ela procurar a conversa de novo na inbox.
        openWhatsAppChatSheet({
          phone: mention.entity_id,
          contactName: mention.entity_name,
          direction: 'bottom',
          // Vale mesmo já estando em /whatsapp: sem isso a conversa trocava na
          // inbox ATRÁS do painel de menções, que é a mesma sensação de ter
          // sido jogado na sessão.
          forceSheet: true,
        });
        break;
      case 'case':
        // Onde a conversa mora desde 19/08/2026 — o dock do caso abre junto com
        // a ficha e a mensagem citada fica destacada.
        navigate(`/cases/${mention.entity_id}?highlightMsg=${mention.message_id}`);
        break;
      case 'process':
        // Processo não tem rota própria: a página de casos resolve o caso-pai,
        // abre a FICHA DO PROCESSO e destaca a mensagem. Antes parava no caso e
        // a pessoa via o chat do caso — outro thread, quase sempre vazio.
        navigate(`/cases?openProcess=${mention.entity_id}${msgParam}`);
        break;
    }
  };

  const handleNudge = async (mention: TeamMentionItem, level: MentionNudgeLevel) => {
    setNudgingId(mention.message_id);
    try {
      await nudgeMention?.(mention, level);
    } finally {
      setNudgingId(null);
    }
  };

  // Total da caixa, sem filtro nenhum — é o que o cabeçalho e o "Todas" usam.
  const unreadTotal = mentions.filter(m => !m.is_read).length;

  // Tipos que realmente aparecem nas menções — não adianta oferecer filtro vazio.
  const availableTypes = useMemo(() => {
    const set = new Set(mentions.map(m => m.entity_type || 'team_chat'));
    return Array.from(set).sort((a, b) =>
      (entityLabels[a] || a).localeCompare(entityLabels[b] || b, 'pt-BR')
    );
  }, [mentions]);

  /**
   * Cada filtro é uma dimensão, e o número do chip conta DENTRO do que as
   * outras dimensões já deixaram passar — por isso o `pular`. Contar sobre a
   * lista inteira fazia o chip dizer "Aguardando (27)" enquanto a lista abaixo
   * dizia "ninguém te devendo resposta": o 27 era de outro recorte.
   */
  const passa = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (m: TeamMentionItem, pular?: 'status' | 'scope' | 'kind' | 'tipo') => {
      if (pular !== 'status') {
        if (statusFilter === 'unread' && m.is_read) return false;
        if ((statusFilter === 'responder' || statusFilter === 'aguardando') && m.status !== statusFilter) return false;
      }
      if (pular !== 'scope' && scopeFilter !== 'all' && m.scope !== scopeFilter) return false;
      if (pular !== 'kind' && kindFilter !== 'all' && (m.mentionKind || 'nome') !== kindFilter) return false;
      if (pular !== 'tipo' && typeFilter !== 'all' && (m.entity_type || 'team_chat') !== typeFilter) return false;
      if (!term) return true;
      const haystack = [
        m.message?.sender_name,
        m.message?.content,
        m.entity_name,
        m.reply?.content,
        entityLabels[m.entity_type || 'team_chat'],
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(term);
    };
  }, [search, typeFilter, statusFilter, scopeFilter, kindFilter]);

  const visibleMentions = useMemo(() => mentions.filter(m => passa(m)), [mentions, passa]);

  // Quantos sobrariam se você ligasse ESTE chip, mantendo o resto do filtro.
  const unreadCount = useMemo(
    () => mentions.filter(m => passa(m, 'status') && !m.is_read).length,
    [mentions, passa]);
  const responderCount = useMemo(
    () => mentions.filter(m => passa(m, 'status') && m.status === 'responder').length,
    [mentions, passa]);
  const aguardandoCount = useMemo(
    () => mentions.filter(m => passa(m, 'status') && m.status === 'aguardando').length,
    [mentions, passa]);
  const kindCount = (k: 'nome' | 'todos') =>
    mentions.filter(m => passa(m, 'kind') && (m.mentionKind || 'nome') === k).length;
  const typeCount = (t: string) =>
    mentions.filter(m => passa(m, 'tipo') && (m.entity_type || 'team_chat') === t).length;

  const hasActiveFilter =
    search.trim() !== '' || typeFilter !== 'all' || statusFilter !== 'all' ||
    scopeFilter !== 'all' || kindFilter !== 'all';

  // Lista vazia com escopo/tipo/nome ligados não é "ninguém te deve resposta":
  // é a combinação que não devolve nada. A mensagem tem que dizer isso.
  const outrosFiltrosAlemDoStatus =
    search.trim() !== '' || typeFilter !== 'all' || scopeFilter !== 'all' || kindFilter !== 'all';

  const limparFiltros = () => {
    setSearch(''); setTypeFilter('all'); setStatusFilter('all');
    setScopeFilter('all'); setKindFilter('all');
  };

  const scopeCount = (s: MentionScope) =>
    mentions.filter(m => passa(m, 'scope') && m.scope === s).length;

  // Gente do escritório que casa com o texto buscado (sem você e sem desativado).
  const pessoasDaBusca = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (term.length < 2) return [];
    return profiles
      .filter(pf => pf.user_id !== user?.id && !inactiveIds.has(pf.user_id))
      .filter(pf =>
        (pf.full_name || '').toLowerCase().includes(term) ||
        (pf.email || '').toLowerCase().includes(term)
      )
      .slice(0, 6);
  }, [profiles, inactiveIds, user?.id, search]);

  const abrirConversaCom = async (otherUserId: string) => {
    if (!user?.id) return;
    setAbrindoConversaCom(otherUserId);
    try {
      const convId = await startDirectConversationWith(otherUserId, user.id);
      if (!convId) {
        toast.error('Não consegui abrir a conversa.');
        return;
      }
      // O próprio painel escuta esse intent e empilha o chat por cima.
      openTeamChatConversation({ conversationId: convId, focusComposer: true });
    } catch (e) {
      console.error('[MentionsPanel] erro ao abrir conversa direta:', e);
      toast.error('Não consegui abrir a conversa.');
    } finally {
      setAbrindoConversaCom(null);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[380px] sm:w-[420px] p-0 flex flex-col">
        {/* Header */}
        <div className="shrink-0 px-4 py-3 border-b bg-primary/5">
          <SheetHeader>
            <SheetTitle className="text-sm flex items-center gap-2">
              {chatView ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="w-8 h-8 rounded-full bg-primary/20 shrink-0"
                  onClick={() => setChatView(false)}
                  title="Voltar às menções"
                >
                  <ArrowLeft className="h-4 w-4 text-primary" />
                </Button>
              ) : (
                <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
                  <AtSign className="h-4 w-4 text-primary" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="truncate text-sm">{chatView ? 'Chat interno' : 'Menções'}</div>
                <div className="text-[10px] text-muted-foreground font-normal">
                  {chatView
                    ? 'Conversas diretas e em grupo'
                    : (unreadTotal > 0 ? `${unreadTotal} não lida${unreadTotal > 1 ? 's' : ''}` : 'Todas lidas')
                  }
                </div>
              </div>
              {!chatView && unreadTotal > 0 && (
                <Button variant="ghost" size="sm" className="text-xs h-7" onClick={markAllAsRead}>
                  <CheckCheck className="h-3.5 w-3.5 mr-1" /> Todas
                </Button>
              )}
              {!chatView && (
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs h-7 shrink-0"
                  onClick={openTeamChatNewConversation}
                  title="Começar conversa com alguém ou criar grupo"
                >
                  <Plus className="h-3.5 w-3.5 mr-1" /> Nova
                </Button>
              )}
            </SheetTitle>
          </SheetHeader>
        </div>

        {/* Filtros das menções */}
        {!chatView && mentions.length > 0 && (
          <div className="shrink-0 px-3 py-2 border-b space-y-1.5">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar por pessoa, texto ou registro..."
                className="h-8 pl-8 text-sm"
              />
            </div>
            {availableTypes.length > 1 && (
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue placeholder="Filtrar por tipo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os tipos</SelectItem>
                  {availableTypes.map(t => (
                    <SelectItem key={t} value={t}>
                      {entityLabels[t] || t} ({typeCount(t)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {/* Um vocabulário só: chip apagado = desligado, chip aceso = ligado.
                Nada de cor de identidade em filtro que não está valendo — era
                isso que fazia parecer que tudo estava selecionado. */}
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => setStatusFilter(v => (v === 'unread' ? 'all' : 'unread'))}
                title="Menções que você ainda não abriu"
                className={cn(CHIP_BASE, statusFilter === 'unread' ? CHIP_ON.primary : CHIP_OFF)}
              >
                Não lidas{unreadCount > 0 ? ` (${unreadCount})` : ''}
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter(v => (v === 'responder' ? 'all' : 'responder'))}
                title="Marcaram você e você ainda não escreveu nada nessa conversa"
                className={cn(CHIP_BASE, statusFilter === 'responder' ? CHIP_ON.amber : CHIP_OFF)}
              >
                <Timer className="h-3 w-3" /> Responder{responderCount > 0 ? ` (${responderCount})` : ''}
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter(v => (v === 'aguardando' ? 'all' : 'aguardando'))}
                title="Você marcou alguém e ninguém respondeu depois"
                className={cn(CHIP_BASE, statusFilter === 'aguardando' ? CHIP_ON.sky : CHIP_OFF)}
              >
                <Reply className="h-3 w-3" /> Aguardando{aguardandoCount > 0 ? ` (${aguardandoCount})` : ''}
              </button>
            </div>
            {/* Onde foi dito: no privado, no grupo, ou no chat de uma ficha. */}
            <div className="flex gap-1">
              {([
                { v: 'privado' as const, label: 'Privado', icon: <MessageCircle className="h-3 w-3" /> },
                { v: 'grupo' as const, label: 'Grupo', icon: <Users className="h-3 w-3" /> },
                { v: 'ficha' as const, label: 'Ficha', icon: <ClipboardList className="h-3 w-3" /> },
              ]).map(({ v, label, icon }) => {
                const n = scopeCount(v);
                return (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setScopeFilter(prev => (prev === v ? 'all' : v))}
                    title={
                      v === 'privado' ? 'Marcaram você numa conversa direta'
                        : v === 'grupo' ? 'Marcaram você num grupo'
                          : 'Marcaram você no chat de uma atividade, lead, processo, contato ou POP'
                    }
                    className={cn(CHIP_BASE, scopeFilter === v ? CHIP_ON.foreground : CHIP_OFF)}
                  >
                    {icon} {label}{n > 0 ? ` (${n})` : ''}
                  </button>
                );
              })}
            </div>
            {/* Te chamaram pelo nome ou foi um @todos? Muda o quanto é com você. */}
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => setKindFilter(prev => (prev === 'nome' ? 'all' : 'nome'))}
                title="Marcaram você pelo nome"
                className={cn(CHIP_BASE, kindFilter === 'nome' ? CHIP_ON.violet : CHIP_OFF)}
              >
                Pelo nome{kindCount('nome') > 0 ? ` (${kindCount('nome')})` : ''}
              </button>
              <button
                type="button"
                onClick={() => setKindFilter(prev => (prev === 'todos' ? 'all' : 'todos'))}
                title="Chamaram a equipe inteira com @todos — não era só com você"
                className={cn(CHIP_BASE, kindFilter === 'todos' ? CHIP_ON.slate : CHIP_OFF)}
              >
                @todos{kindCount('todos') > 0 ? ` (${kindCount('todos')})` : ''}
              </button>
            </div>
            {/* Só aparece quando há filtro valendo — é a saída óbvia de "voltei
                a ver tudo", que antes era um chip verde sempre aceso. */}
            {hasActiveFilter && (
              <button
                type="button"
                onClick={limparFiltros}
                className="w-full h-6 rounded-full text-[10px] font-medium border border-dashed border-border text-muted-foreground hover:bg-accent transition-colors inline-flex items-center justify-center gap-1"
              >
                <X className="h-3 w-3" /> Limpar filtros e ver tudo
              </button>
            )}
          </div>
        )}

        {/* Content */}
        {chatView ? (
          <div className="flex-1 min-h-0">
            <TeamDirectChatPanel
              intent={chatIntent}
              onIntentHandled={() => setChatIntent(null)}
            />
          </div>
        ) : (
          <ScrollArea className="flex-1">
            {/* Buscar nome de gente abre conversa, não só filtra menção. Sem
                isso, procurar por quem nunca te marcou não devolvia nada. */}
            {pessoasDaBusca.length > 0 && (
              <div className="border-b bg-muted/20">
                <div className="px-4 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Falar com
                </div>
                <div className="divide-y">
                  {pessoasDaBusca.map(pf => (
                    <button
                      key={pf.user_id}
                      type="button"
                      disabled={abrindoConversaCom === pf.user_id}
                      onClick={() => abrirConversaCom(pf.user_id)}
                      className="w-full text-left px-4 py-2 hover:bg-accent/50 transition-colors flex items-center gap-3 disabled:opacity-60"
                    >
                      <Avatar className="h-7 w-7">
                        <AvatarFallback className="text-[10px] bg-primary/20 text-primary">
                          {iniciais(pf.full_name || pf.email || '?')}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-medium truncate">{pf.full_name || pf.email}</div>
                        <div className="text-[10px] text-muted-foreground truncate">Abrir conversa direta</div>
                      </div>
                      {abrindoConversaCom === pf.user_id
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground shrink-0" />
                        : <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {loading ? (
              <div className="flex items-center justify-center h-32">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : mentions.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 text-muted-foreground text-xs text-center gap-2 px-6">
                <AtSign className="h-8 w-8 opacity-30" />
                <p>Nenhuma menção ainda.<br/>Quando alguém marcar você com <span className="font-medium text-primary">@seu_nome</span> — ou quando você marcar alguém no chat de uma ficha — aparecerá aqui.</p>
              </div>
            ) : visibleMentions.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 text-muted-foreground text-xs text-center gap-2 px-6">
                <Search className="h-8 w-8 opacity-30" />
                <p>
                  {pessoasDaBusca.length > 0
                    ? 'Nenhuma menção com esse nome — mas dá pra abrir a conversa aí em cima.'
                    : outrosFiltrosAlemDoStatus
                      ? 'Nada com essa combinação de filtros.'
                      : statusFilter === 'responder'
                        ? 'Nada pendente de resposta sua. 🎉'
                        : statusFilter === 'aguardando'
                          ? 'Ninguém te devendo resposta.'
                          : 'Nenhuma menção com esse filtro.'}
                </p>
                {hasActiveFilter && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={limparFiltros}
                  >
                    Limpar filtros
                  </Button>
                )}
              </div>
            ) : (
              <div className="divide-y">
                {visibleMentions.map(mention => (
                  <div
                    key={mention.id}
                    className={cn(
                      "px-4 py-3 transition-colors",
                      !mention.is_read && "bg-primary/5",
                      mention.status === 'responder' && "border-l-2 border-l-amber-500",
                      mention.status === 'aguardando' && "border-l-2 border-l-sky-500/70"
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => handleMentionClick(mention)}
                      className="w-full text-left flex items-start gap-3 rounded-md hover:bg-accent/50 transition-colors"
                    >
                      <div className={cn("shrink-0 w-7 h-7 rounded-full flex items-center justify-center mt-0.5", entityColors[mention.entity_type || 'team_chat'] || 'bg-muted')}>
                        {entityIcons[mention.entity_type || 'team_chat'] || <AtSign className="h-3.5 w-3.5" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-xs font-semibold truncate">
                            {mention.direction === 'out' ? 'Você' : (mention.message?.sender_name || 'Alguém')}
                          </span>
                          <span className="text-[10px] text-muted-foreground shrink-0">
                            {mention.direction === 'out' ? 'marcou a equipe' : 'mencionou você'}
                          </span>
                          {!mention.is_read && (
                            <span className="w-2 h-2 rounded-full bg-primary shrink-0" />
                          )}
                        </div>
                        <p className="text-[12px] text-muted-foreground line-clamp-2 mb-1">
                          {mention.message?.content}
                        </p>
                        {mention.status && (
                          <div className="mb-1">
                            {mention.status === 'respondido' && mention.reply ? (
                              <p className="text-[11px] text-emerald-600 dark:text-emerald-400 line-clamp-1 flex items-start gap-1">
                                <CornerDownRight className="h-3 w-3 mt-[1px] shrink-0" />
                                <span className="truncate">
                                  <b className="font-medium">{mention.reply.sender_name || 'Alguém'}:</b>{' '}
                                  {mention.reply.content}
                                </span>
                              </p>
                            ) : mention.status === 'responder' ? (
                              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                                <Timer className="h-3 w-3" /> Esperando você responder
                              </span>
                            ) : mention.status === 'aguardando' ? (
                              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-sky-600 dark:text-sky-400">
                                <Reply className="h-3 w-3" /> Aguardando resposta
                              </span>
                            ) : null}
                          </div>
                        )}
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className={cn("text-[9px] h-4 px-1.5", entityColors[mention.entity_type || 'team_chat'])}>
                            {entityIcons[mention.entity_type || 'team_chat']}
                            <span className="ml-1">{entityLabels[mention.entity_type || 'team_chat'] || mention.entity_type}</span>
                          </Badge>
                          {mention.entity_name && (
                            <span className="text-[10px] text-muted-foreground truncate max-w-[120px]">{mention.entity_name}</span>
                          )}
                          <span className="ml-auto text-[10px] text-muted-foreground shrink-0">
                            {format(new Date(mention.created_at), "dd/MM HH:mm", { locale: ptBR })}
                          </span>
                        </div>
                      </div>
                      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-2" />
                    </button>
                    <MentionNudgeRow
                      mention={mention}
                      busy={nudgingId === mention.message_id}
                      onNudge={level => handleNudge(mention, level)}
                      following={!!followedThreads?.has(`${mention.message.entity_type}:${mention.message.entity_id}`)}
                      onLeave={() => leaveMentionThread?.(mention)}
                    />
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        )}
      </SheetContent>
    </Sheet>
  );
}
