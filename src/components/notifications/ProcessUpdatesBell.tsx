import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell, CheckCheck, ExternalLink, ClipboardPlus, MessageCircle, Loader2,
} from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { format, parseISO } from 'date-fns';
import { db, authClient } from '@/integrations/supabase';
import { cloudFunctions } from '@/lib/functionRouter';
import { copyTextToClipboard } from '@/lib/clipboard';
import { useAuthContext } from '@/contexts/AuthContext';
import { useProcessUpdates, type UpdateCategoria, type ProcessUpdate } from '@/hooks/useProcessUpdates';
import { useLeadActivities } from '@/hooks/useLeadActivities';
import { CATEGORIAS } from '@/lib/processUpdateCategorias';

const FILTER_ORDER: Array<UpdateCategoria | 'todas'> = [
  'todas', 'decisao_merito', 'audiencia', 'pericia', 'prazo', 'despacho', 'movimentacao',
];

type Periodo = 'hoje' | '7d' | '30d' | 'tudo';
const PERIODOS: Array<{ value: Periodo; label: string; dias: number | null }> = [
  { value: 'hoje', label: 'Hoje', dias: 0 },
  { value: '7d', label: '7 dias', dias: 7 },
  { value: '30d', label: '30 dias', dias: 30 },
  { value: 'tudo', label: 'Tudo', dias: null },
];

const TIPO_ATV: Partial<Record<UpdateCategoria, string>> = {
  audiencia: 'audiencia',
  pericia: 'audiencia',
  prazo: 'prazo',
};

function fmtData(iso: string | null): string | null {
  if (!iso) return null;
  try {
    return format(parseISO(iso), 'dd/MM/yyyy');
  } catch {
    return iso;
  }
}

/** Mensagem no formato das notificações de atividade: saudação + corpo + assinatura. */
function buildGroupMessage(u: ProcessUpdate, clienteNome: string | null, remetenteNome: string | null): string {
  const style = CATEGORIAS[u.categoria] || CATEGORIAS.movimentacao;
  const primeiroNome = (clienteNome || '').trim().split(' ')[0] || null;
  const linhas = [
    primeiroNome ? `Olá, ${primeiroNome}! 😊` : 'Olá! 😊',
    '',
    '⚖️ *Atualização no seu processo*',
    u.numero_cnj ? `📌 Processo: ${u.numero_cnj}` : null,
    `🗂️ ${style.label}${u.data_movimentacao ? ` — ${fmtData(u.data_movimentacao)}` : ''}`,
    u.descricao ? `\n${u.descricao}` : null,
    '',
    'Qualquer dúvida, estamos à disposição.',
    '',
    `Com carinho, ${(remetenteNome || '').trim().split(' ')[0] || 'Equipe'} 💚`,
  ];
  return linhas.filter((l) => l !== null).join('\n');
}

interface EnvioPendente {
  update: ProcessUpdate;
  groupJid: string;
  leadName: string | null;
  message: string;
}

function UpdateRow({
  update, unread, onOpenLead, onCreateActivity, onSendGroup, onMarkRead, sending,
}: {
  update: ProcessUpdate;
  unread: boolean;
  onOpenLead: (u: ProcessUpdate) => void;
  onCreateActivity: (u: ProcessUpdate) => void;
  onSendGroup: (u: ProcessUpdate) => void;
  onMarkRead: (u: ProcessUpdate) => void;
  sending: boolean;
}) {
  const style = CATEGORIAS[update.categoria] || CATEGORIAS.movimentacao;
  const Icon = style.icon;
  const dataMov = fmtData(update.data_movimentacao);

  return (
    <div
      className={cn(
        'px-3 py-2.5 border-b last:border-b-0',
        unread && 'bg-accent/40',
        style.borda && 'border-l-2',
        style.borda,
      )}
      onClick={() => unread && onMarkRead(update)}
    >
      <div className="flex gap-2.5">
        <span className={cn('mt-1.5 h-2 w-2 rounded-full shrink-0', unread ? style.dot : 'bg-transparent border border-border')} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <Badge variant="outline" className={cn('text-[10px] px-1.5 py-0 gap-1 font-medium', style.badge)}>
              <Icon className="h-3 w-3" />
              {style.label}
            </Badge>
            {dataMov && <span className="text-[10px] text-muted-foreground">{dataMov}</span>}
            {unread && <span className="text-[9px] font-semibold text-primary uppercase">novo</span>}
          </div>
          <p className="text-xs font-medium mt-1 truncate">
            {update.processo_titulo || update.numero_cnj || 'Processo'}
          </p>
          {update.numero_cnj && update.processo_titulo && (
            <p className="text-[10px] text-muted-foreground font-mono truncate">{update.numero_cnj}</p>
          )}
          {update.descricao && (
            <p className={cn(
              'text-[11px] mt-0.5 line-clamp-2',
              update.categoria === 'movimentacao' ? 'text-muted-foreground/70' : 'text-muted-foreground',
            )}>
              {update.descricao}
            </p>
          )}
          <div className="flex gap-1 mt-1.5">
            <Button
              variant="outline" size="sm" className="h-6 px-2 text-[10px] gap-1"
              onClick={(e) => { e.stopPropagation(); onOpenLead(update); }}
            >
              <ExternalLink className="h-3 w-3" />
              Abrir lead
            </Button>
            <Button
              variant="outline" size="sm" className="h-6 px-2 text-[10px] gap-1"
              onClick={(e) => { e.stopPropagation(); onCreateActivity(update); }}
            >
              <ClipboardPlus className="h-3 w-3" />
              Criar atv
            </Button>
            <Button
              variant="outline" size="sm" className="h-6 px-2 text-[10px] gap-1"
              disabled={sending}
              onClick={(e) => { e.stopPropagation(); onSendGroup(update); }}
            >
              {sending ? <Loader2 className="h-3 w-3 animate-spin" /> : <MessageCircle className="h-3 w-3" />}
              Msg grupo
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ProcessUpdatesBell({ compact = false }: { compact?: boolean }) {
  const { updates, loading, unreadCount, readIds, markRead, markAllRead } = useProcessUpdates();
  const { createActivity } = useLeadActivities();
  const { user, profile } = useAuthContext();
  const navigate = useNavigate();
  const [filtro, setFiltro] = useState<UpdateCategoria | 'todas'>('todas');
  const [periodo, setPeriodo] = useState<Periodo>('30d');
  const [open, setOpen] = useState(false);
  const [envioPendente, setEnvioPendente] = useState<EnvioPendente | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let list = filtro === 'todas' ? updates : updates.filter((u) => u.categoria === filtro);
    const dias = PERIODOS.find((p) => p.value === periodo)?.dias;
    if (dias !== null && dias !== undefined) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - dias);
      const cutoffIso = cutoff.toISOString().slice(0, 10);
      list = list.filter((u) => (u.data_movimentacao || u.created_at).slice(0, 10) >= cutoffIso);
    }
    return list;
  }, [updates, filtro, periodo]);

  const countByCategoria = useMemo(() => {
    const acc = {} as Record<string, number>;
    for (const u of updates) acc[u.categoria] = (acc[u.categoria] || 0) + 1;
    return acc;
  }, [updates]);

  const handleOpenLead = (u: ProcessUpdate) => {
    markRead(u.id);
    setOpen(false);
    if (u.lead_id) {
      navigate(`/leads?openLead=${u.lead_id}`);
    } else {
      toast.info('Atualização sem lead vinculado — abrindo o processo');
      navigate(`/processes?openProcess=${u.process_id}`);
    }
  };

  const handleCreateActivity = async (u: ProcessUpdate) => {
    const style = CATEGORIAS[u.categoria] || CATEGORIAS.movimentacao;
    try {
      const created = await createActivity({
        title: `${style.label} — ${u.processo_titulo || u.numero_cnj || 'processo'}`,
        description: [
          u.descricao,
          u.data_movimentacao ? `📌 Movimentação de ${fmtData(u.data_movimentacao)}.` : null,
          u.numero_cnj ? `⚖️ Processo ${u.numero_cnj}.` : null,
        ].filter(Boolean).join('\n\n'),
        activity_type: TIPO_ATV[u.categoria] || 'tarefa',
        priority: u.categoria === 'movimentacao' ? 'normal' : 'alta',
        process_id: u.process_id,
        process_title: u.processo_titulo || u.numero_cnj || null,
        lead_id: u.lead_id,
        case_id: u.case_id,
      });
      if (created) {
        markRead(u.id);
        toast.success('Atividade criada a partir da atualização');
      }
    } catch (err) {
      console.error('Error creating activity from update:', err);
    }
  };

  /** Prepara o envio pro grupo do lead: busca grupo + nome e abre a confirmação. */
  const handleSendGroup = async (u: ProcessUpdate) => {
    if (!u.lead_id) {
      const ok = await copyTextToClipboard(buildGroupMessage(u, null, profile?.full_name || null));
      toast.info(ok ? 'Sem lead vinculado — mensagem copiada pra envio manual' : 'Atualização sem lead vinculado');
      return;
    }
    setSendingId(u.id);
    try {
      const { data: lead, error } = await db
        .from('leads')
        .select('lead_name, whatsapp_group_id')
        .eq('id', u.lead_id)
        .maybeSingle();
      if (error) throw error;

      const message = buildGroupMessage(u, lead?.lead_name || null, profile?.full_name || null);
      if (!lead?.whatsapp_group_id) {
        const ok = await copyTextToClipboard(message);
        toast.info(ok ? 'Lead sem grupo vinculado — mensagem copiada pra envio manual' : 'Lead sem grupo de WhatsApp vinculado');
        return;
      }
      setEnvioPendente({ update: u, groupJid: lead.whatsapp_group_id, leadName: lead.lead_name || null, message });
    } catch (err) {
      console.error('Error preparing group message:', err);
      toast.error('Erro ao buscar o grupo do lead');
    } finally {
      setSendingId(null);
    }
  };

  /** Envia de fato (mesmo padrão do sendGroupNotification das atividades). */
  const confirmSendGroup = async () => {
    const pending = envioPendente;
    if (!pending) return;
    setEnvioPendente(null);
    setSendingId(pending.update.id);
    try {
      let instanceId: string | undefined;
      if (user?.id) {
        const { data: cloudProfile } = await authClient
          .from('profiles')
          .select('default_instance_id')
          .eq('user_id', user.id)
          .maybeSingle();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        instanceId = (cloudProfile as any)?.default_instance_id || undefined;
      }

      const sendBody: Record<string, unknown> = {
        phone: pending.groupJid,
        chat_id: pending.groupJid,
        message: pending.message,
        lead_id: pending.update.lead_id,
      };
      if (instanceId) sendBody.instance_id = instanceId;

      const { data, error } = await cloudFunctions.invoke('send-whatsapp', { body: sendBody });
      if (error || !data?.success) {
        toast.error(data?.error || 'Erro ao enviar mensagem ao grupo');
      } else {
        markRead(pending.update.id);
        toast.success(`Mensagem enviada ao grupo${pending.leadName ? ` de ${pending.leadName}` : ''}!`);
      }
    } catch (err) {
      console.error('Error sending group message:', err);
      toast.error('Erro ao enviar mensagem ao grupo');
    } finally {
      setSendingId(null);
    }
  };

  return (
    <>
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Atualizações processuais"
          title="Atualizações processuais"
          className={cn('relative shrink-0', compact ? 'h-8 w-8' : 'h-10 w-10')}
        >
          <Bell className={cn(compact ? 'h-4 w-4' : 'h-5 w-5', unreadCount > 0 && 'text-primary')} />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:w-[440px] sm:max-w-[440px] p-0 flex flex-col">
        <SheetHeader className="px-4 py-3 border-b space-y-0">
          <div className="flex items-center justify-between">
            <SheetTitle className="text-base">Atualizações processuais</SheetTitle>
            {unreadCount > 0 && (
              <Button variant="ghost" size="sm" className="h-7 text-xs gap-1 mr-6" onClick={markAllRead}>
                <CheckCheck className="h-3.5 w-3.5" />
                Marcar lidas
              </Button>
            )}
          </div>
        </SheetHeader>
        <div className="flex gap-1 px-2 py-1.5 border-b overflow-x-auto shrink-0">
          {FILTER_ORDER.map((cat) => {
            const active = filtro === cat;
            const label = cat === 'todas' ? 'Todas' : CATEGORIAS[cat].label;
            const count = cat === 'todas' ? updates.length : (countByCategoria[cat] || 0);
            if (cat !== 'todas' && count === 0) return null;
            return (
              <button
                key={cat}
                onClick={() => setFiltro(cat)}
                className={cn(
                  'text-[11px] px-2 py-1 rounded-full border whitespace-nowrap transition-colors',
                  active ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-accent',
                )}
              >
                {label} {count > 0 && <span className="opacity-70">({count})</span>}
              </button>
            );
          })}
        </div>
        <div className="flex gap-1 px-2 py-1.5 border-b overflow-x-auto shrink-0 items-center">
          <span className="text-[10px] text-muted-foreground pr-1">Período:</span>
          {PERIODOS.map((p) => (
            <button
              key={p.value}
              onClick={() => setPeriodo(p.value)}
              className={cn(
                'text-[11px] px-2 py-0.5 rounded-full border whitespace-nowrap transition-colors',
                periodo === p.value ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-accent',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        <ScrollArea className="flex-1">
          {loading ? (
            <p className="text-xs text-muted-foreground text-center py-8">Carregando...</p>
          ) : filtered.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-8">
              Nenhuma atualização nesse período{filtro !== 'todas' ? ' e categoria' : ''}.
            </p>
          ) : (
            filtered.map((u) => (
              <UpdateRow
                key={u.id}
                update={u}
                unread={!readIds.has(u.id)}
                onOpenLead={handleOpenLead}
                onCreateActivity={handleCreateActivity}
                onSendGroup={handleSendGroup}
                onMarkRead={(upd) => markRead(upd.id)}
                sending={sendingId === u.id}
              />
            ))
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>

    <AlertDialog open={!!envioPendente} onOpenChange={(o) => !o && setEnvioPendente(null)}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>Enviar ao grupo{envioPendente?.leadName ? ` de ${envioPendente.leadName}` : ''}?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="text-xs whitespace-pre-wrap bg-muted rounded-md p-3 max-h-64 overflow-y-auto text-left">
              {envioPendente?.message}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={confirmSendGroup}>Enviar</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
