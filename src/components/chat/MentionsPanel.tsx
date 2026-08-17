import { useEffect, useMemo, useState } from 'react';
import { useMyMentions, type MentionNudgeLevel, type MentionScope, type TeamMentionItem } from '@/hooks/useTeamChat';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AtSign, Loader2, CheckCheck, Users, ClipboardList, Briefcase, Workflow, ArrowRight, MessageCircle, Scale, Search, Timer, Reply, CornerDownRight, BellOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { externalSupabase, ensureExternalSession } from '@/integrations/supabase/external-client';
import { TeamDirectChatPanel } from './TeamDirectChatPanel';
import { openTeamChatConversation, subscribeToTeamChatConversation, type TeamChatOpenIntent } from '@/lib/teamChatPanelEvents';
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
  const [activeTab, setActiveTab] = useState<'mentions' | 'chat'>('chat');
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

  useEffect(() => {
    return subscribeToTeamChatConversation((intent) => {
      setChatIntent(intent);
      setActiveTab('chat');
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
        navigate(`/whatsapp?openChat=${encodeURIComponent(mention.entity_id)}`);
        break;
      case 'case':
        navigate(`/cases/${mention.entity_id}`);
        break;
      case 'process': {
        // Processo não tem rota própria — abre o caso-pai (mesma regra da busca global).
        try {
          const { data: proc } = await externalSupabase
            .from('lead_processes')
            .select('case_id, lead_id')
            .eq('id', mention.entity_id)
            .maybeSingle();
          const p = proc as { case_id?: string | null; lead_id?: string | null } | null;
          if (p?.case_id) navigate(`/cases/${p.case_id}`);
          else if (p?.lead_id) navigate(`/leads?openLead=${p.lead_id}`);
          else toast.error('Processo não encontrado.');
        } catch (e) {
          console.error('Erro ao resolver o processo da menção:', e);
        }
        break;
      }
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

  const unreadCount = mentions.filter(m => !m.is_read).length;
  const responderCount = mentions.filter(m => m.status === 'responder').length;
  const aguardandoCount = mentions.filter(m => m.status === 'aguardando').length;

  // Tipos que realmente aparecem nas menções — não adianta oferecer filtro vazio.
  const availableTypes = useMemo(() => {
    const set = new Set(mentions.map(m => m.entity_type || 'team_chat'));
    return Array.from(set).sort((a, b) =>
      (entityLabels[a] || a).localeCompare(entityLabels[b] || b, 'pt-BR')
    );
  }, [mentions]);

  const visibleMentions = useMemo(() => {
    const term = search.trim().toLowerCase();
    return mentions.filter(m => {
      if (statusFilter === 'unread' && m.is_read) return false;
      if ((statusFilter === 'responder' || statusFilter === 'aguardando') && m.status !== statusFilter) return false;
      if (scopeFilter !== 'all' && m.scope !== scopeFilter) return false;
      if (kindFilter !== 'all' && (m.mentionKind || 'nome') !== kindFilter) return false;
      if (typeFilter !== 'all' && (m.entity_type || 'team_chat') !== typeFilter) return false;
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
    });
  }, [mentions, search, typeFilter, statusFilter, scopeFilter, kindFilter]);

  const hasActiveFilter =
    search.trim() !== '' || typeFilter !== 'all' || statusFilter !== 'all' ||
    scopeFilter !== 'all' || kindFilter !== 'all';

  const limparFiltros = () => {
    setSearch(''); setTypeFilter('all'); setStatusFilter('all');
    setScopeFilter('all'); setKindFilter('all');
  };

  const scopeCount = (s: MentionScope) => mentions.filter(m => m.scope === s).length;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[380px] sm:w-[420px] p-0 flex flex-col">
        {/* Header */}
        <div className="shrink-0 px-4 py-3 border-b bg-primary/5">
          <SheetHeader>
            <SheetTitle className="text-sm flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center">
                {activeTab === 'mentions' ? (
                  <AtSign className="h-4 w-4 text-primary" />
                ) : (
                  <MessageCircle className="h-4 w-4 text-primary" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="truncate text-sm">Chat interno</div>
                <div className="text-[10px] text-muted-foreground font-normal">
                  {activeTab === 'mentions'
                    ? (unreadCount > 0 ? `${unreadCount} não lida${unreadCount > 1 ? 's' : ''}` : 'Todas lidas')
                    : 'Conversas diretas e em grupo'
                  }
                </div>
              </div>
              {activeTab === 'mentions' && unreadCount > 0 && (
                <Button variant="ghost" size="sm" className="text-xs h-7" onClick={markAllAsRead}>
                  <CheckCheck className="h-3.5 w-3.5 mr-1" /> Todas
                </Button>
              )}
            </SheetTitle>
          </SheetHeader>

          {/* Tabs */}
          <div className="flex gap-1 mt-3 p-0.5 bg-muted/60 rounded-lg">
            <button
              onClick={() => setActiveTab('mentions')}
              className={cn(
                'flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-all',
                activeTab === 'mentions'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <AtSign className="h-3.5 w-3.5" />
              Menções
              {unreadCount > 0 && (
                <span className="w-4 h-4 rounded-full bg-destructive text-destructive-foreground text-[9px] font-bold flex items-center justify-center">
                  {unreadCount}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('chat')}
              className={cn(
                'flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-all',
                activeTab === 'chat'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <MessageCircle className="h-3.5 w-3.5" />
              Chat
            </button>
          </div>
        </div>

        {/* Filtros das menções */}
        {activeTab === 'mentions' && mentions.length > 0 && (
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
                    <SelectItem key={t} value={t}>{entityLabels[t] || t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => setStatusFilter('all')}
                className={cn(
                  'flex-1 h-6 rounded-full text-[10px] font-medium border transition-colors',
                  statusFilter === 'all'
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-transparent text-muted-foreground border-border hover:bg-accent'
                )}
              >
                Todas
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter(v => (v === 'unread' ? 'all' : 'unread'))}
                title="Menções que você ainda não abriu"
                className={cn(
                  'flex-1 h-6 rounded-full text-[10px] font-semibold border transition-colors',
                  statusFilter === 'unread'
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-primary/10 text-primary border-primary/40 hover:bg-primary/20'
                )}
              >
                Não lidas{unreadCount > 0 ? ` (${unreadCount})` : ''}
              </button>
            </div>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => setStatusFilter(v => (v === 'responder' ? 'all' : 'responder'))}
                title="Marcaram você e você ainda não escreveu nada nessa conversa"
                className={cn(
                  'flex-1 h-6 rounded-full text-[10px] font-semibold border transition-colors inline-flex items-center justify-center gap-1',
                  statusFilter === 'responder'
                    ? 'bg-amber-500 text-white border-amber-500'
                    : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/40 hover:bg-amber-500/20'
                )}
              >
                <Timer className="h-3 w-3" /> Responder{responderCount > 0 ? ` (${responderCount})` : ''}
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter(v => (v === 'aguardando' ? 'all' : 'aguardando'))}
                title="Você marcou alguém e ninguém respondeu depois"
                className={cn(
                  'flex-1 h-6 rounded-full text-[10px] font-semibold border transition-colors inline-flex items-center justify-center gap-1',
                  statusFilter === 'aguardando'
                    ? 'bg-sky-500 text-white border-sky-500'
                    : 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/40 hover:bg-sky-500/20'
                )}
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
                    className={cn(
                      'flex-1 h-6 rounded-full text-[10px] font-medium border transition-colors inline-flex items-center justify-center gap-1',
                      scopeFilter === v
                        ? 'bg-foreground text-background border-foreground'
                        : 'bg-transparent text-muted-foreground border-border hover:bg-accent'
                    )}
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
                className={cn(
                  'flex-1 h-6 rounded-full text-[10px] font-medium border transition-colors',
                  kindFilter === 'nome'
                    ? 'bg-violet-500 text-white border-violet-500'
                    : 'bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/40 hover:bg-violet-500/20'
                )}
              >
                Pelo nome
              </button>
              <button
                type="button"
                onClick={() => setKindFilter(prev => (prev === 'todos' ? 'all' : 'todos'))}
                title="Chamaram a equipe inteira com @todos — não era só com você"
                className={cn(
                  'flex-1 h-6 rounded-full text-[10px] font-medium border transition-colors',
                  kindFilter === 'todos'
                    ? 'bg-slate-500 text-white border-slate-500'
                    : 'bg-slate-500/10 text-slate-600 dark:text-slate-300 border-slate-500/40 hover:bg-slate-500/20'
                )}
              >
                @todos
              </button>
            </div>
          </div>
        )}

        {/* Content */}
        {activeTab === 'chat' ? (
          <div className="flex-1 min-h-0">
            <TeamDirectChatPanel
              intent={chatIntent}
              onIntentHandled={() => setChatIntent(null)}
            />
          </div>
        ) : (
          <ScrollArea className="flex-1">
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
                  {statusFilter === 'responder'
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
