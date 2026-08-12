import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell, BellRing, CheckCheck, ExternalLink, ClipboardPlus, MessageCircle, Loader2, BadgeCheck, AlertTriangle,
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
import { db } from '@/integrations/supabase';
import { remapToCloudSync } from '@/integrations/supabase/uuid-remap';
import { cloudFunctions } from '@/lib/functionRouter';
import { resolveGroupSenderInstanceName } from '@/lib/whatsappGroupInstance';
import { copyTextToClipboard } from '@/lib/clipboard';
import { useAuthContext } from '@/contexts/AuthContext';
import { useProcessUpdates, type UpdateCategoria, type ProcessUpdate, type UpdateNotificacao } from '@/hooks/useProcessUpdates';
import { useLeadActivities, type LeadActivity } from '@/hooks/useLeadActivities';
import { useProfilesList } from '@/hooks/useProfilesList';
import { useSystemOabs } from '@/hooks/useSystemOabs';
import { useActivityFieldSettings } from '@/hooks/useActivityFieldSettings';
import { useActivityMessageTemplates } from '@/hooks/useActivityMessageTemplates';
import { filterAssignableMembers } from '@/lib/assigneeBlocklist';
import { buildActivityMessage } from '@/components/activities/buildActivityMessage';
import { fetchLeadSteps } from '@/lib/leadStepContext';
import { fetchFaseProcessual } from '@/lib/processFaseAtual';
import { ESFERAS, ESFERA_ORDER, type Esfera } from '@/lib/esferaJustica';
import { ASSUNTO_SIMPLES, EXPLICACAO, blocoTextoDoTribunal } from '@/lib/linguagemSimples';
import { CATEGORIAS } from '@/lib/processUpdateCategorias';
import { CapturaStatusPanel } from '@/components/notifications/CapturaStatusPanel';
import { notificationsSupported, requestNotificationPermission } from '@/lib/nativeNotification';

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

/**
 * Conteúdo dos três campos que o cliente lê ("Como está?", "O que foi feito?",
 * "Próximo passo"), em linguagem de quem não é da área — o texto vive em
 * src/lib/linguagemSimples.ts.
 *
 * O passo do POP entra entre parênteses no fim do próximo passo: ele é escrito
 * pra equipe ("Redação da Petição"), então não pode ser a frase principal
 * endereçada ao cliente, mas some da mensagem se for descartado.
 */
function camposDaMensagem(u: ProcessUpdate, passoPop: string | null) {
  const explicacao = EXPLICACAO[u.categoria] || EXPLICACAO.movimentacao;
  return {
    comoEsta: explicacao.comoEsta,
    oQueFoiFeito: blocoTextoDoTribunal(u.descricao),
    proximo: passoPop
      ? `${explicacao.proximo}\n_(Na nossa lista de tarefas, o passo em andamento é: ${passoPop}.)_`
      : explicacao.proximo,
  };
}

interface EnvioPendente {
  update: ProcessUpdate;
  groupJid: string;
  leadName: string | null;
  message: string;
  /** Atividade do próximo passo criada (ou reaproveitada) junto com o aviso. */
  activityId: string | null;
  /** Caso sem POP e sem marco: mensagem sai reduzida, sem fase nem progresso. */
  semContexto: boolean;
  reenvio: boolean;
}

function UpdateRow({
  update, unread, notificacao, onOpenLead, onCreateActivity, onSendGroup, onMarkRead, sending,
}: {
  update: ProcessUpdate;
  unread: boolean;
  notificacao: UpdateNotificacao | undefined;
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
            {update.esfera && update.esfera !== 'outros' && (
              <span className="text-[9px] text-muted-foreground uppercase tracking-wide">
                {ESFERAS[update.esfera].curto}
              </span>
            )}
            {/* Etiqueta global: o CLIENTE já foi avisado desta movimentação. */}
            {notificacao && (
              <Badge
                variant="outline"
                className="text-[10px] px-1.5 py-0 gap-1 font-medium border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
                title={notificacao.notified_by_name ? `Notificado por ${notificacao.notified_by_name}` : 'Cliente notificado'}
              >
                <BadgeCheck className="h-3 w-3" />
                Notificado {fmtData(notificacao.notified_at.slice(0, 10))}
                {notificacao.notified_by_name ? ` · ${notificacao.notified_by_name.split(' ')[0]}` : ''}
              </Badge>
            )}
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
              title={notificacao ? 'Já notificado — reenviar mensagem ao grupo' : 'Notificar o cliente no grupo (cria a atividade do próximo passo)'}
            >
              {sending ? <Loader2 className="h-3 w-3 animate-spin" /> : <MessageCircle className="h-3 w-3" />}
              {notificacao ? 'Reenviar' : 'Notificar'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

const ESFERA_STORAGE_KEY = 'process_updates_esfera_filtro';

export function ProcessUpdatesBell({ compact = false }: { compact?: boolean }) {
  const { updates, loading, unreadCount, readIds, markRead, markAllRead, notificadas, markNotified } = useProcessUpdates();
  const { createActivity } = useLeadActivities();
  const { profile, user } = useAuthContext();
  const navigate = useNavigate();
  const [filtro, setFiltro] = useState<UpdateCategoria | 'todas'>('todas');
  // A equipe trabalhista não quer ver movimentação de INSS (e vice-versa), então
  // a escolha do ramo fica guardada entre sessões.
  const [esferaFiltro, setEsferaFiltro] = useState<Esfera | 'todas'>(
    () => (localStorage.getItem(ESFERA_STORAGE_KEY) as Esfera | 'todas') || 'todas',
  );
  const [soNaoNotificadas, setSoNaoNotificadas] = useState(false);
  const [periodo, setPeriodo] = useState<Periodo>('30d');
  const [open, setOpen] = useState(false);
  const [envioPendente, setEnvioPendente] = useState<EnvioPendente | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);

  // ---- Destaque de CHEGADA ----
  // Separado do "tem não-lida": o anel vermelho fica enquanto houver pendência,
  // mas o pulso é evento, não estado. Acende quando o contador sobe, apaga
  // sozinho em 20s ou assim que o painel é aberto — depois de olhar, não há
  // mais chegada a anunciar.
  const [pulsar, setPulsar] = useState(false);
  const contadorAnterior = useRef(unreadCount);
  useEffect(() => {
    if (unreadCount > contadorAnterior.current) setPulsar(true);
    contadorAnterior.current = unreadCount;
  }, [unreadCount]);
  useEffect(() => {
    if (!pulsar) return;
    const t = setTimeout(() => setPulsar(false), 20000);
    return () => clearTimeout(t);
  }, [pulsar]);
  useEffect(() => { if (open) setPulsar(false); }, [open]);

  // O pop-up do responsável (useProcessUpdates) só sai com permissão concedida.
  // Sem um lugar para conceder, o recurso existiria e nunca dispararia — mas o
  // navegador só aceita o pedido a partir de um clique, então é botão e não
  // efeito de montagem.
  const [permissao, setPermissao] = useState<NotificationPermission | 'indisponivel'>(
    () => (notificationsSupported() ? Notification.permission : 'indisponivel'),
  );

  // ---- Insumos da mensagem padrão da atividade (mesma função da ficha) ----
  const { fields: fieldSettings } = useActivityFieldSettings();
  const { getTemplateForContext } = useActivityMessageTemplates();
  const systemOabs = useSystemOabs();
  const profiles = useProfilesList();
  const teamMembers = useMemo(
    () => filterAssignableMembers(profiles).map((p) => ({ user_id: p.user_id, full_name: p.full_name })),
    [profiles],
  );
  const resolveUserName = useCallback((userId: string | null) => {
    if (!userId) return null;
    const direct = teamMembers.find((m) => m.user_id === userId)?.full_name;
    if (direct) return direct;
    const cloudId = remapToCloudSync(userId);
    if (cloudId && cloudId !== userId) {
      const viaRemap = teamMembers.find((m) => m.user_id === cloudId)?.full_name;
      if (viaRemap) return viaRemap;
    }
    return null;
  }, [teamMembers]);

  const escolherEsfera = (e: Esfera | 'todas') => {
    setEsferaFiltro(e);
    localStorage.setItem(ESFERA_STORAGE_KEY, e);
  };

  const filtered = useMemo(() => {
    let list = filtro === 'todas' ? updates : updates.filter((u) => u.categoria === filtro);
    if (esferaFiltro !== 'todas') list = list.filter((u) => (u.esfera || 'outros') === esferaFiltro);
    if (soNaoNotificadas) list = list.filter((u) => !notificadas.has(u.id));
    const dias = PERIODOS.find((p) => p.value === periodo)?.dias;
    if (dias !== null && dias !== undefined) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - dias);
      const cutoffIso = cutoff.toISOString().slice(0, 10);
      list = list.filter((u) => (u.data_movimentacao || u.created_at).slice(0, 10) >= cutoffIso);
    }
    return list;
  }, [updates, filtro, esferaFiltro, soNaoNotificadas, notificadas, periodo]);

  const countByCategoria = useMemo(() => {
    const acc = {} as Record<string, number>;
    // Contagem da linha de categorias respeita o ramo já escolhido — senão o
    // chip mostra 40 e a lista abre com 3.
    const base = esferaFiltro === 'todas' ? updates : updates.filter((u) => (u.esfera || 'outros') === esferaFiltro);
    for (const u of base) acc[u.categoria] = (acc[u.categoria] || 0) + 1;
    acc.todas = base.length;
    return acc;
  }, [updates, esferaFiltro]);

  const countByEsfera = useMemo(() => {
    const acc = {} as Record<string, number>;
    for (const u of updates) {
      const e = u.esfera || 'outros';
      acc[e] = (acc[e] || 0) + 1;
    }
    return acc;
  }, [updates]);

  const naoNotificadasCount = useMemo(
    () => updates.filter((u) => !notificadas.has(u.id)).length,
    [updates, notificadas],
  );

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

  /**
   * Contexto da movimentação: lead, processo, POP do lead e — quando não há POP —
   * a fase da linha do trem. É o que permite mandar a mensagem no mesmo padrão
   * da atividade (etapa / objetivo / passo atual / progresso).
   */
  const carregarContexto = useCallback(async (u: ProcessUpdate) => {
    const [leadRes, procRes] = await Promise.all([
      u.lead_id
        ? db.from('leads').select('lead_name, whatsapp_group_id, board_id, case_type').eq('id', u.lead_id).maybeSingle()
        : Promise.resolve({ data: null }),
      db.from('lead_processes').select('*').eq('id', u.process_id).maybeSingle(),
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lead = (leadRes as any).data as
      { lead_name: string | null; whatsapp_group_id: string | null; board_id: string | null; case_type: string | null } | null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const processo = (procRes as any).data as Record<string, any> | null;

    const boardId = processo?.workflow_id || lead?.board_id || null;
    const { steps, defaultStepId } = await fetchLeadSteps(u.lead_id, boardId);
    const passoAtual = steps.find((s) => s.stepId === defaultStepId) || null;

    // Sem POP: cai na régua de marcos do processo. Com POP, nem consulta.
    const fase = steps.length === 0
      ? await fetchFaseProcessual(u.process_id, {
          processNumber: processo?.process_number || u.numero_cnj,
          caseType: lead?.case_type || null,
          periciaPrevista: processo?.pericia_prevista ?? null,
        })
      : null;

    return { lead, processo, boardId, steps, passoAtual, fase };
  }, []);

  type ContextoUpdate = Awaited<ReturnType<typeof carregarContexto>>;

  /**
   * Atividade do próximo passo. Uma movimentação gera no máximo UMA — reenvio e
   * o botão "Criar atv" reaproveitam a mesma (lead_activities.process_update_id).
   */
  const buscarOuCriarAtividade = useCallback(async (
    u: ProcessUpdate,
    ctx: ContextoUpdate,
  ): Promise<LeadActivity | null> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = db as any;
    const { data: existente, error } = await client
      .from('lead_activities')
      .select('*')
      .eq('process_update_id', u.id)
      .maybeSingle();
    if (error) {
      // Banco sem a migration: segue criando (sem o vínculo), não trava o aviso.
      console.warn('[ProcessUpdatesBell] process_update_id indisponível:', error.message);
    }
    if (existente) return existente as LeadActivity;

    const campos = camposDaMensagem(u, ctx.passoAtual?.stepLabel || null);
    return await createActivity({
      // Assunto sem jargão: o título entra na mensagem como "Assunto da
      // atividade", e "Decisão de mérito" não diz nada pra quem é leigo.
      title: `${ASSUNTO_SIMPLES[u.categoria]} — ${u.processo_titulo || u.numero_cnj || 'processo'}`,
      description: [
        u.descricao,
        u.data_movimentacao ? `📌 Movimentação de ${fmtData(u.data_movimentacao)}.` : null,
        u.numero_cnj ? `⚖️ Processo ${u.numero_cnj}.` : null,
      ].filter(Boolean).join('\n\n'),
      activity_type: TIPO_ATV[u.categoria] || 'tarefa',
      priority: u.categoria === 'movimentacao' ? 'normal' : 'alta',
      // Campos da mensagem padrão: o que foi feito / como está / próximo passo.
      what_was_done: campos.oQueFoiFeito,
      current_status_notes: campos.comoEsta,
      next_steps: campos.proximo,
      process_id: u.process_id,
      process_title: u.processo_titulo || u.numero_cnj || null,
      lead_id: u.lead_id,
      lead_name: ctx.lead?.lead_name || null,
      case_id: u.case_id,
      workflow_id: ctx.boardId,
      process_update_id: u.id,
      assigned_to_name: profile?.full_name || null,
    });
  }, [createActivity, profile?.full_name]);

  /** Mensagem no padrão da atividade — mesma função da ficha (uma implementação só). */
  const montarMensagem = useCallback((
    u: ProcessUpdate,
    ctx: ContextoUpdate,
    atividade: LeadActivity | null,
  ): string => {
    const campos = camposDaMensagem(u, ctx.passoAtual?.stepLabel || null);
    const p = ctx.passoAtual;
    return buildActivityMessage({
      formTitle: atividade?.title || `${ASSUNTO_SIMPLES[u.categoria]} — ${u.processo_titulo || ''}`,
      formDeadline: atividade?.deadline || '',
      formNotificationDate: atividade?.notification_date || '',
      formWhatWasDone: atividade?.what_was_done || campos.oQueFoiFeito,
      formCurrentStatus: atividade?.current_status_notes || campos.comoEsta,
      formNextSteps: atividade?.next_steps || campos.proximo,
      formSolicitacao: '',
      formRespostaJuizo: '',
      formNotes: '',
      formAssignedToName: atividade?.assigned_to_name || profile?.full_name || '',
      formCoAssignees: [],
      formIsSystem: false,
      formClientNameOverride: '',
      formLeadName: ctx.lead?.lead_name || '',
      formCaseTitle: '',
      formProcessId: u.process_id,
      formProcessTitle: u.processo_titulo || u.numero_cnj || '',
      fieldSettings,
      selectedActivity: atividade,
      caseProcesses: ctx.processo ? [ctx.processo] : [],
      stepContext: p
        ? {
            stageId: p.phaseId,
            templateId: p.templateId,
            stepId: p.stepId,
            stepLabel: p.stepLabel,
            phaseLabel: p.phaseLabel,
            objectiveLabel: p.objectiveLabel,
            allSteps: ctx.steps,
          }
        : null,
      faseProcessual: ctx.fase,
      leadPreview: { board_id: ctx.boardId },
      systemOabs,
      currentUserId: user?.id || null,
      resolveUserName,
      getTemplateForContext,
    }, 'client');
  }, [fieldSettings, systemOabs, user?.id, resolveUserName, getTemplateForContext, profile?.full_name]);

  const handleCreateActivity = async (u: ProcessUpdate) => {
    try {
      const ctx = await carregarContexto(u);
      const created = await buscarOuCriarAtividade(u, ctx);
      if (created) {
        markRead(u.id);
        toast.success('Atividade criada a partir da atualização');
      }
    } catch (err) {
      console.error('Error creating activity from update:', err);
      toast.error('Erro ao criar atividade a partir da atualização');
    }
  };

  /**
   * Prepara a notificação: cria (ou reaproveita) a atividade do próximo passo,
   * monta a mensagem no padrão e abre a confirmação.
   */
  const handleSendGroup = async (u: ProcessUpdate) => {
    setSendingId(u.id);
    try {
      const ctx = await carregarContexto(u);
      const atividade = u.lead_id || u.case_id || u.process_id
        ? await buscarOuCriarAtividade(u, ctx)
        : null;
      const message = montarMensagem(u, ctx, atividade);
      // Sem POP e sem marco: o bloco de fase/progresso sai da mensagem inteiro.
      const semContexto = ctx.steps.length === 0 && !ctx.fase;

      if (!ctx.lead?.whatsapp_group_id) {
        const ok = await copyTextToClipboard(message);
        toast.info(
          ok
            ? `${u.lead_id ? 'Lead sem grupo vinculado' : 'Atualização sem lead vinculado'} — mensagem copiada pra envio manual`
            : 'Sem grupo de WhatsApp vinculado',
        );
        return;
      }
      setEnvioPendente({
        update: u,
        groupJid: ctx.lead.whatsapp_group_id,
        leadName: ctx.lead.lead_name || null,
        message,
        activityId: atividade?.id || null,
        semContexto,
        reenvio: notificadas.has(u.id),
      });
    } catch (err) {
      console.error('Error preparing group message:', err);
      toast.error('Erro ao preparar a notificação');
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
      // O alvo aqui é SEMPRE grupo (prepareSendGroup exige whatsapp_group_id), e
      // grupo nunca sai pelo default pessoal do usuário logado: a mensagem é da
      // firma. O default_instance_id do Cloud, que este trecho lia, é legado —
      // o ProfilePage só escreve no Externo. Incidente 04/08/2026 (FAMÍLIA 250).
      const instanceName = await resolveGroupSenderInstanceName(pending.groupJid);

      const sendBody: Record<string, unknown> = {
        phone: pending.groupJid,
        chat_id: pending.groupJid,
        message: pending.message,
        lead_id: pending.update.lead_id,
      };
      if (instanceName) sendBody.instance_name = instanceName;

      const { data, error } = await cloudFunctions.invoke('send-whatsapp', { body: sendBody });
      if (error || !data?.success) {
        toast.error(data?.error || 'Erro ao enviar mensagem ao grupo');
      } else {
        markRead(pending.update.id);
        // Etiqueta só depois do envio confirmado — "notificado" tem que
        // significar que a mensagem saiu, não que alguém clicou no botão.
        await markNotified(pending.update.id, {
          activityId: pending.activityId,
          groupJid: pending.groupJid,
          notifiedByName: profile?.full_name || null,
        });
        toast.success(`Cliente notificado${pending.leadName ? ` no grupo de ${pending.leadName}` : ''}!`, {
          action: pending.activityId
            ? {
                label: 'Abrir atv',
                onClick: () => { setOpen(false); navigate(`/?openActivity=${pending.activityId}`); },
              }
            : undefined,
        });
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
          aria-label={`Atualizações processuais${unreadCount > 0 ? ` — ${unreadCount} não lidas` : ''}`}
          title="Atualizações processuais"
          className={cn(
            'relative shrink-0 transition-colors',
            compact ? 'h-8 w-8' : 'h-10 w-10',
            // Fundo e anel enquanto houver não-lida: o sino deixa de ser mais um
            // ícone cinza na fileira e passa a ser a coisa acesa da barra.
            unreadCount > 0 && 'bg-red-500/10 hover:bg-red-500/20 ring-1 ring-red-500/40',
          )}
        >
          <Bell
            className={cn(
              compact ? 'h-4 w-4' : 'h-5 w-5',
              unreadCount > 0 && 'text-red-600 dark:text-red-500',
              // O balanço é só na chegada, junto com o pulso do contador.
              pulsar && 'animate-bounce',
            )}
          />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 flex">
              {/* O halo pulsa SÓ quando algo acabou de chegar. Pulsar sempre que
                  há não-lida deixaria 97 pendências piscando o dia inteiro no
                  canto da tela — que é o jeito mais rápido de ensinar a equipe
                  a não olhar mais para o sino. */}
              {pulsar && (
                <span
                  aria-hidden
                  className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-60"
                />
              )}
              <span className="relative inline-flex min-w-[20px] h-[20px] px-1 rounded-full bg-red-500 text-white text-[11px] font-bold items-center justify-center shadow-sm ring-2 ring-background">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
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
        {/* Só aparece enquanto ninguém decidiu: concedida some, negada some
            (insistir não reabre o prompt — o navegador bloqueia). */}
        {permissao === 'default' && (
          <button
            type="button"
            onClick={async () => {
              const ok = await requestNotificationPermission();
              setPermissao(ok ? 'granted' : Notification.permission);
              if (ok) toast.success('Pronto — você será avisado das movimentações dos seus passos');
            }}
            className="flex w-full items-start gap-2 border-b bg-amber-500/10 px-4 py-2.5 text-left hover:bg-amber-500/15"
          >
            <BellRing className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-500" />
            <span className="text-[11px] leading-snug">
              <span className="font-medium">Ativar avisos no computador</span>
              <span className="block text-muted-foreground">
                Você recebe um aviso na hora quando cair movimentação num processo cujo
                passo em aberto é seu. Só o responsável pelo passo é avisado.
              </span>
            </span>
          </button>
        )}
        {/* Quanto da atualização já foi feita, quanto falta e quanto custou.
            Fica acima dos filtros porque a pergunta "o que ainda não chegou?" é
            a mesma do sino pelo avesso — e fila parada não avisa sozinha. */}
        <CapturaStatusPanel />
        {/* Ramo da Justiça — separa o que é da equipe trabalhista do resto. */}
        <div className="flex gap-1 px-2 py-1.5 border-b overflow-x-auto shrink-0 items-center">
          <span className="text-[10px] text-muted-foreground pr-1 shrink-0">Ramo:</span>
          {(['todas', ...ESFERA_ORDER] as Array<Esfera | 'todas'>).map((e) => {
            const count = e === 'todas' ? updates.length : (countByEsfera[e] || 0);
            if (e !== 'todas' && count === 0) return null;
            return (
              <button
                key={e}
                onClick={() => escolherEsfera(e)}
                title={e === 'todas' ? 'Todos os ramos' : ESFERAS[e].label}
                className={cn(
                  'text-[11px] px-2 py-0.5 rounded-full border whitespace-nowrap transition-colors',
                  esferaFiltro === e ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-accent',
                )}
              >
                {e === 'todas' ? 'Todos' : ESFERAS[e].curto} <span className="opacity-70">({count})</span>
              </button>
            );
          })}
          <button
            onClick={() => setSoNaoNotificadas((v) => !v)}
            title="Só as movimentações em que o cliente ainda não foi avisado"
            className={cn(
              'text-[11px] px-2 py-0.5 rounded-full border whitespace-nowrap transition-colors ml-auto shrink-0',
              soNaoNotificadas ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-background hover:bg-accent',
            )}
          >
            Não notificados ({naoNotificadasCount})
          </button>
        </div>
        <div className="flex gap-1 px-2 py-1.5 border-b overflow-x-auto shrink-0">
          {FILTER_ORDER.map((cat) => {
            const active = filtro === cat;
            const label = cat === 'todas' ? 'Todas' : CATEGORIAS[cat].label;
            const count = cat === 'todas' ? countByCategoria.todas : (countByCategoria[cat] || 0);
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
                notificacao={notificadas.get(u.id)}
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
          <AlertDialogTitle>
            {envioPendente?.reenvio ? 'Reenviar ao grupo' : 'Enviar ao grupo'}
            {envioPendente?.leadName ? ` de ${envioPendente.leadName}` : ''}?
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-left">
              {envioPendente?.reenvio && (
                <p className="text-[11px] flex items-start gap-1.5 text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
                  Este cliente já foi notificado desta movimentação — vai receber de novo.
                </p>
              )}
              {envioPendente?.semContexto && (
                <p className="text-[11px] flex items-start gap-1.5 text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
                  Caso sem POP e sem marco no processo — a mensagem vai sem fase e sem progresso.
                </p>
              )}
              <div className="text-xs whitespace-pre-wrap bg-muted rounded-md p-3 max-h-64 overflow-y-auto">
                {envioPendente?.message}
              </div>
              {envioPendente?.activityId && (
                <p className="text-[11px] text-muted-foreground">
                  Uma atividade com o próximo passo foi criada e ficará com você.
                </p>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={confirmSendGroup}>
            {envioPendente?.reenvio ? 'Reenviar' : 'Enviar'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
