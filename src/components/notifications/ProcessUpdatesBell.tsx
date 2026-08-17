import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell, BellRing, CheckCheck, ExternalLink, ClipboardPlus, MessageCircle, Loader2, BadgeCheck, AlertTriangle,
  ListChecks, X, ChevronDown, ChevronRight, Users, Sparkles,
} from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
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
import { useProcessUpdates, FETCH_LIMIT, JANELA_DIAS, type UpdateCategoria, type ProcessUpdate, type UpdateNotificacao } from '@/hooks/useProcessUpdates';
import { useLeadActivities, type LeadActivity } from '@/hooks/useLeadActivities';
import { useProfilesList } from '@/hooks/useProfilesList';
import { useSystemOabs } from '@/hooks/useSystemOabs';
import { useActivityFieldSettings } from '@/hooks/useActivityFieldSettings';
import { useActivityMessageTemplates } from '@/hooks/useActivityMessageTemplates';
import { filterAssignableMembers } from '@/lib/assigneeBlocklist';
import { buildActivityMessage } from '@/components/activities/buildActivityMessage';
import { resumoMovimentacao } from './resumoMovimentacao';
import { UpdateDetalhe, type PassoDoPop, type SugestaoIA } from './UpdateDetalhe';
import { fetchLeadSteps } from '@/lib/leadStepContext';
import { fetchFaseProcessual } from '@/lib/processFaseAtual';
import { ESFERAS, ESFERA_ORDER, type Esfera } from '@/lib/esferaJustica';
import { ASSUNTO_SIMPLES } from '@/lib/linguagemSimples';
import { CATEGORIAS } from '@/lib/processUpdateCategorias';
import {
  camposConsolidados, camposDeUmaMovimentacao, movimentacaoPrincipal, type CamposDaMensagem,
} from './notificacaoEmLote';
import { CapturaStatusPanel } from '@/components/notifications/CapturaStatusPanel';
import { notificationsSupported, requestNotificationPermission } from '@/lib/nativeNotification';

const FILTER_ORDER: Array<UpdateCategoria | 'todas'> = [
  'todas', 'decisao_merito', 'audiencia', 'pericia', 'prazo', 'despacho', 'movimentacao',
];

type Periodo = 'hoje' | 'ontem' | '7d' | '30d' | 'tudo';
const PERIODOS: Array<{ value: Periodo; label: string }> = [
  { value: 'hoje', label: 'Hoje' },
  { value: 'ontem', label: 'Ontem' },
  { value: '7d', label: '7 dias' },
  { value: '30d', label: '30 dias' },
  { value: 'tudo', label: 'Tudo' },
];

/**
 * Dia no fuso de quem está olhando, YYYY-MM-DD.
 *
 * `toISOString().slice(0,10)` — que era o que estava aqui — devolve o dia em
 * UTC: depois das 21h de Brasília já é "amanhã", e a partir daí "Hoje" perdia
 * a movimentação da noite. Com "Ontem" ao lado o erro fica visível (um dia
 * mostrando o do outro), então o corte passou a ser pelo calendário local.
 */
function diaLocal(d: Date): string {
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

/** Faixa fechada de dias do período; `null` numa ponta = sem limite daquele lado. */
function faixaDoPeriodo(p: Periodo): { de: string | null; ate: string | null } {
  if (p === 'tudo') return { de: null, ate: null };
  const hoje = new Date();
  if (p === 'hoje') return { de: diaLocal(hoje), ate: null };
  // Ontem é o único fechado dos dois lados: é "o que caiu no dia anterior",
  // não "de ontem para cá" — senão repetiria o que Hoje já mostra.
  if (p === 'ontem') {
    const d = new Date(hoje);
    d.setDate(d.getDate() - 1);
    const dia = diaLocal(d);
    return { de: dia, ate: dia };
  }
  const d = new Date(hoje);
  d.setDate(d.getDate() - (p === '7d' ? 7 : 30));
  return { de: diaLocal(d), ate: null };
}

function dentroDaFaixa(u: ProcessUpdate, faixa: { de: string | null; ate: string | null }): boolean {
  const dia = (u.data_movimentacao || u.created_at).slice(0, 10);
  if (faixa.de && dia < faixa.de) return false;
  if (faixa.ate && dia > faixa.ate) return false;
  return true;
}

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

/**
 * Título da linha, quando ele diz mais que o rótulo da categoria.
 *
 * Nas linhas de push agrupado o título é o evento principal ("Decorrido o prazo
 * de CGB ENERGIA LTDA"); nas antigas é só o rótulo genérico que o badge ao lado
 * já mostra — repetir "Movimentação" embaixo de "Movimentação" é ruído.
 */
function tituloUtil(u: ProcessUpdate): string | null {
  const t = (u.titulo || '').trim();
  if (!t) return null;
  const rotulo = (CATEGORIAS[u.categoria] || CATEGORIAS.movimentacao).label;
  return t.toLowerCase() === rotulo.toLowerCase() ? null : t;
}

function UpdateRow({
  update, unread, notificacao, onOpenLead, onCreateActivity, onSendGroup, onMarkRead, sending,
  carregarPasso, sugerirComIA, criarAtividadeDoPasso,
  showOpenLead = true, showProcesso = true,
  selecionavel = false, selecionado = false, onToggleSelecao,
}: {
  update: ProcessUpdate;
  unread: boolean;
  notificacao: UpdateNotificacao | undefined;
  onOpenLead: (u: ProcessUpdate) => void;
  onCreateActivity: (u: ProcessUpdate) => void;
  onSendGroup: (u: ProcessUpdate) => void;
  onMarkRead: (u: ProcessUpdate) => void;
  sending: boolean;
  carregarPasso: (u: ProcessUpdate) => Promise<PassoDoPop | null>;
  sugerirComIA: (u: ProcessUpdate, passo: PassoDoPop | null) => Promise<SugestaoIA | null>;
  criarAtividadeDoPasso: (u: ProcessUpdate, rascunho?: SugestaoIA) => Promise<void>;
  /** Fora quando o painel já está dentro da ficha: "abrir lead" ali é redirecionar. */
  showOpenLead?: boolean;
  /** Fora no modo por processo: seria repetir o mesmo cabeçalho em toda linha. */
  showProcesso?: boolean;
  /** Modo lote ligado: a linha ganha caixa de marcar e o clique passa a marcar. */
  selecionavel?: boolean;
  selecionado?: boolean;
  onToggleSelecao?: (u: ProcessUpdate) => void;
}) {
  const style = CATEGORIAS[update.categoria] || CATEGORIAS.movimentacao;
  const Icon = style.icon;
  const dataMov = fmtData(update.data_movimentacao);
  const { assunto, origem } = useMemo(() => resumoMovimentacao(update.descricao), [update.descricao]);
  const titulo = tituloUtil(update);
  const [detalheAberto, setDetalheAberto] = useState(false);

  return (
    <div
      className={cn(
        'px-3 py-2.5 border-b last:border-b-0',
        unread && 'bg-accent/40',
        selecionado && 'bg-primary/10',
        selecionavel && 'cursor-pointer',
        style.borda && 'border-l-2',
        style.borda,
      )}
      onClick={() => {
        // Em modo lote a linha inteira é alvo de marcação: caixinha de 16px é
        // mira ruim quando são quarenta linhas para percorrer.
        if (selecionavel) { onToggleSelecao?.(update); return; }
        if (unread) onMarkRead(update);
      }}
    >
      <div className="flex gap-2.5">
        {selecionavel ? (
          <Checkbox
            checked={selecionado}
            onCheckedChange={() => onToggleSelecao?.(update)}
            onClick={(e) => e.stopPropagation()}
            className="mt-0.5 shrink-0"
            aria-label={`Selecionar movimentação de ${update.processo_titulo || update.numero_cnj || 'processo'}`}
          />
        ) : (
          <span className={cn('mt-1.5 h-2 w-2 rounded-full shrink-0', unread ? style.dot : 'bg-transparent border border-border')} />
        )}
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
          {showProcesso && (
            <>
              <p className="text-xs font-medium mt-1 truncate">
                {update.processo_titulo || update.numero_cnj || 'Processo'}
              </p>
              {update.numero_cnj && update.processo_titulo && (
                <p className="text-[10px] text-muted-foreground font-mono truncate">{update.numero_cnj}</p>
              )}
            </>
          )}
          {/* O que aconteceu vem em destaque; de onde veio o aviso, quando é só
              o que existe, vem miúdo. Antes os dois saíam do mesmo jeito, e o
              "Distribuído por sorteio" tinha o mesmo peso do "[PUSH] ..." que
              repetia o número do processo. */}
          {/* Título do evento principal em destaque; o resumo dos demais
              embaixo, miúdo. Sem título (linha antiga), o resumo sobe. */}
          {titulo && (
            <p className="text-[11px] mt-0.5 font-medium leading-snug line-clamp-2">{titulo}</p>
          )}
          {/* O que o e-mail do tribunal quis dizer, em português. Vem pronto do
              banco (escrito na captura), então aparecer aqui não custa chamada
              de IA nenhuma — e é o que a pessoa lê ao varrer a lista. O texto
              cru continua embaixo, porque resumo não substitui o que foi
              comunicado oficialmente. */}
          {update.resumo_ia && (
            <p className="text-[11px] mt-0.5 leading-snug flex gap-1">
              <Sparkles className="h-3 w-3 shrink-0 mt-px text-primary" />
              <span className="text-foreground/90">{update.resumo_ia}</span>
            </p>
          )}
          {assunto && assunto !== titulo && (
            <p className={cn(
              'text-[11px] mt-0.5 line-clamp-2',
              titulo || update.resumo_ia ? 'text-muted-foreground' : 'text-foreground/85',
            )}>
              {assunto}
            </p>
          )}
          {!assunto && !titulo && origem && (
            <p className="text-[10px] mt-0.5 truncate text-muted-foreground/70">{origem}</p>
          )}
          <UpdateDetalhe
            update={update}
            aberto={detalheAberto}
            onToggle={() => setDetalheAberto((v) => !v)}
            carregarPasso={carregarPasso}
            sugerirComIA={sugerirComIA}
            criarAtividade={criarAtividadeDoPasso}
          />
          <div className="flex gap-1 mt-1.5">
            {showOpenLead && (
              <Button
                variant="outline" size="sm" className="h-6 px-2 text-[10px] gap-1"
                onClick={(e) => { e.stopPropagation(); onOpenLead(update); }}
              >
                <ExternalLink className="h-3 w-3" />
                Abrir lead
              </Button>
            )}
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

/** Linhas renderizadas por vez. Ver mais é clique, não rolagem infinita. */
const PAGINA = 100;

/**
 * Preparo do lote em paralelo limitado.
 *
 * Cada cliente custa ~4 idas ao banco (lead + processo + POP + cargos), e
 * "Marcar todas" num mês são 124 clientes com grupo (973 movimentações / 209
 * leads no Externo em 17/08/2026) — em série isso é minuto de tela parada.
 * Cinco de cada vez porque são só leituras; mais que isso é fila no Supabase
 * sem ganho de tempo.
 */
const PREPARO_CONCORRENCIA = 5;

/**
 * Cadência do disparo. Espaçamento POR INSTÂNCIA, não só global: as 124
 * mensagens de um mês saem por 9 instâncias, mas 46 delas pela mesma
 * ("Atendimento Processual") e 33 por outra ("Raym"). Um `setTimeout` chapado
 * entre clientes deixaria essas 46 saírem quase encostadas — que é o caminho
 * curto para a UazAPI derrubar o número da firma.
 */
const GAP_MESMA_INSTANCIA_MS = 4000;
/** Piso entre duas mensagens quaisquer, mesmo por números diferentes. */
const GAP_GLOBAL_MS = 1200;
/** Custo estimado do trabalho por cliente (atividade + envio + etiquetas). */
const TRABALHO_POR_CLIENTE_MS = 2500;
/**
 * Acima disto o lote deixa de ser "avisar quem caiu movimentação hoje" e passa
 * a ser disparo em massa: a revisão exige confirmação explícita do risco.
 */
const LOTE_GRANDE = 25;

/**
 * Sino de atualizações processuais.
 *
 * Com `processId`, o mesmo painel vira atalho de UM processo — é o que a ficha
 * da atividade usa para responder "caiu movimentação neste processo?" sem sair
 * dali. Mesma lista, mesmo Criar atv e mesmo Notificar: um componente só, para
 * a regra da mensagem ao cliente não existir em duas versões.
 */
export function ProcessUpdatesBell({
  compact = false, processId = null, processLabel = null,
}: {
  compact?: boolean;
  /** Escopo: só as movimentações deste processo (lead_processes.id). */
  processId?: string | null;
  /** Rótulo do processo no cabeçalho do painel escopado. */
  processLabel?: string | null;
}) {
  const escopado = !!processId;
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
  // Num processo só, "30 dias" esconderia justamente a resposta que se foi
  // buscar ali ("tem alguma?") quando a última movimentação é de um mês atrás.
  const [periodo, setPeriodo] = useState<Periodo>(escopado ? 'tudo' : '30d');

  // Janela da BUSCA (não do filtro): o sino traz o período inteiro do banco em
  // vez das N linhas mais recentes da tabela. Num processo só não há janela —
  // são poucas linhas e a pergunta ali é "tem alguma, de quando for?".
  const desde = useMemo(() => {
    if (escopado || periodo === 'tudo') return null;
    const d = new Date();
    d.setDate(d.getDate() - JANELA_DIAS);
    return diaLocal(d);
  }, [escopado, periodo]);

  const { updates, loading, unreadCount, readIds, markRead, markAllRead, notificadas, markNotified, totalNoBanco } =
    useProcessUpdates({ processId, desde });

  const [open, setOpen] = useState(false);
  const [envioPendente, setEnvioPendente] = useState<EnvioPendente | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);
  // ---- Lote ----
  const [modoSelecao, setModoSelecao] = useState(false);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [preparandoLote, setPreparandoLote] = useState(false);
  const [lote, setLote] = useState<LoteCliente[] | null>(null);
  const [loteExpandido, setLoteExpandido] = useState<Set<string>>(new Set());
  /** Progresso do disparo: sem isso, 30 clientes são 45s de tela parada. */
  const [loteProgresso, setLoteProgresso] = useState<{ feitos: number; total: number } | null>(null);
  /** Progresso do PREPARO — com 124 clientes o spinner sozinho parece travado. */
  const [preparoProgresso, setPreparoProgresso] = useState<{ feitos: number; total: number } | null>(null);
  /** Clientes cujo contexto não carregou: entram na revisão como aviso, não como silêncio. */
  const [preparoFalhas, setPreparoFalhas] = useState<string[]>([]);
  /** Ciente do risco de volume — só pedido acima de LOTE_GRANDE clientes. */
  const [riscoAceito, setRiscoAceito] = useState(false);

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

  // Tudo menos o período. Serve de base para a lista E para a contagem de cada
  // chip de período — que por isso já sai respeitando ramo, categoria e
  // "não notificados", em vez de prometer 26 e abrir 3.
  const baseSemPeriodo = useMemo(() => {
    let list = filtro === 'todas' ? updates : updates.filter((u) => u.categoria === filtro);
    // No modo escopado o ramo não é filtro, é característica do processo — e o
    // valor guardado no localStorage é do sino global: quem deixou "Trabalhista"
    // ligado abriria o atalho de um processo do INSS e veria lista vazia.
    if (!escopado && esferaFiltro !== 'todas') list = list.filter((u) => (u.esfera || 'outros') === esferaFiltro);
    if (soNaoNotificadas) list = list.filter((u) => !notificadas.has(u.id));
    return list;
  }, [updates, filtro, escopado, esferaFiltro, soNaoNotificadas, notificadas]);

  // Uma vez por lista, não uma vez por item: `new Date()` dentro do filter seria
  // uma alocação por linha, e a virada do dia não precisa de precisão de ms.
  const faixas = useMemo(() => {
    const acc = {} as Record<Periodo, { de: string | null; ate: string | null }>;
    for (const p of PERIODOS) acc[p.value] = faixaDoPeriodo(p.value);
    return acc;
  }, [updates]);

  const filtered = useMemo(
    () => baseSemPeriodo.filter((u) => dentroDaFaixa(u, faixas[periodo])),
    [baseSemPeriodo, faixas, periodo],
  );

  // O que vai para o DOM. A busca passou a trazer o período inteiro (452 em
  // 12/08/2026), e 452 cards com badge, resumo e detalhe de uma vez é rolagem
  // travada. O que pagina é a renderização — a contagem do chip continua sendo
  // a do período, senão o número volta a mentir.
  const [visiveis, setVisiveis] = useState(PAGINA);
  useEffect(() => { setVisiveis(PAGINA); }, [filtro, esferaFiltro, soNaoNotificadas, periodo]);
  const paginadas = useMemo(() => filtered.slice(0, visiveis), [filtered, visiveis]);

  const countByPeriodo = useMemo(() => {
    const acc = {} as Record<Periodo, number>;
    for (const p of PERIODOS) acc[p.value] = baseSemPeriodo.filter((u) => dentroDaFaixa(u, faixas[p.value])).length;
    return acc;
  }, [baseSemPeriodo, faixas]);

  // Sobrou movimentação no banco fora do que foi carregado? Só então o chip
  // ganha "+". A busca agora pagina até o filtro acabar, então na prática os
  // números são exatos (974 em 30 dias, 2576 na tabela em 17/08/2026) e o "+"
  // só aparece se o teto de segurança de FETCH_LIMIT for alcançado — o que
  // importa, porque é exatamente aí que "Marcar todas" deixaria de ser todas.
  const noTeto = updates.length >= FETCH_LIMIT || (totalNoBanco !== null && totalNoBanco > updates.length);

  const countByCategoria = useMemo(() => {
    const acc = {} as Record<string, number>;
    // Contagem da linha de categorias respeita o ramo já escolhido — senão o
    // chip mostra 40 e a lista abre com 3.
    const base = escopado || esferaFiltro === 'todas'
      ? updates
      : updates.filter((u) => (u.esfera || 'outros') === esferaFiltro);
    for (const u of base) acc[u.categoria] = (acc[u.categoria] || 0) + 1;
    acc.todas = base.length;
    return acc;
  }, [updates, escopado, esferaFiltro]);

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
   * Um destinatário do lote: as movimentações daquele cliente já viradas em UMA
   * mensagem. Sem grupo vinculado, `groupJid` é null — a linha aparece na
   * revisão como "não vai sair" em vez de falhar calada no meio do disparo.
   *
   * A atividade NÃO é criada aqui: quem desistir na revisão não pode deixar
   * trinta atividades órfãs no nome de quem clicou. Ela nasce no envio.
   */
  interface LoteCliente {
    chave: string;
    leadName: string | null;
    groupJid: string | null;
    /**
     * Por qual número a mensagem sai. Resolvido no PREPARO, não no disparo: é o
     * que permite mostrar na revisão quantas mensagens cada instância vai
     * carregar e espaçar o envio por instância. `undefined` = sem histórico
     * utilizável, a edge send-whatsapp escolhe.
     */
    instanceName: string | undefined;
    principal: ProcessUpdate;
    updates: ProcessUpdate[];
    ctx: ContextoUpdate;
    campos: CamposDaMensagem;
    message: string;
    reenvio: boolean;
    semContexto: boolean;
  }

  /**
   * Atividade do próximo passo. Uma movimentação gera no máximo UMA — reenvio e
   * o botão "Criar atv" reaproveitam a mesma (lead_activities.process_update_id).
   */
  const buscarOuCriarAtividade = useCallback(async (
    u: ProcessUpdate,
    ctx: ContextoUpdate,
    opts?: {
      /** Rascunho da IA: quando vem, é ele que preenche título e os três campos. */
      rascunho?: SugestaoIA;
      /** Campos já prontos — é como o lote entrega o texto das N movimentações juntas. */
      campos?: CamposDaMensagem;
      /** As demais movimentações do mesmo cliente, para a descrição interna citar todas. */
      agrupadas?: ProcessUpdate[];
    },
  ): Promise<LeadActivity | null> => {
    const rascunho = opts?.rascunho;
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

    const campos = opts?.campos || camposDeUmaMovimentacao(u, ctx.passoAtual?.stepLabel || null);
    // No lote a descrição interna lista TODAS as movimentações que a atividade
    // cobre — quem abrir a ficha depois precisa ver as seis, não só a principal.
    const cobertas = opts?.agrupadas?.length ? opts.agrupadas : [u];
    return await createActivity({
      // Assunto sem jargão: o título entra na mensagem como "Assunto da
      // atividade", e "Decisão de mérito" não diz nada pra quem é leigo.
      title: rascunho?.title || campos.titulo,
      description: [
        ...cobertas.map((m) => [
          m.data_movimentacao ? `📌 ${fmtData(m.data_movimentacao)}` : null,
          m.descricao,
        ].filter(Boolean).join(' — ')),
        u.numero_cnj ? `⚖️ Processo ${u.numero_cnj}.` : null,
      ].filter(Boolean).join('\n\n'),
      activity_type: rascunho?.activity_type || TIPO_ATV[u.categoria] || 'tarefa',
      priority: u.categoria === 'movimentacao' ? 'normal' : 'alta',
      // Campos da mensagem padrão: o que foi feito / como está / próximo passo.
      what_was_done: rascunho?.what_was_done || campos.oQueFoiFeito,
      current_status_notes: rascunho?.current_status || campos.comoEsta,
      next_steps: rascunho?.next_steps || campos.proximo,
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
    /**
     * Campos do lote. Vêm por fora porque a atividade pode ser reaproveitada de
     * um aviso anterior (`process_update_id` já existente): sem isso a mensagem
     * sairia com o texto de UMA movimentação e as outras cinco sumiriam.
     */
    override?: CamposDaMensagem,
  ): string => {
    const campos = override || camposDeUmaMovimentacao(u, ctx.passoAtual?.stepLabel || null);
    const p = ctx.passoAtual;
    return buildActivityMessage({
      formTitle: override?.titulo || atividade?.title || `${ASSUNTO_SIMPLES[u.categoria]} — ${u.processo_titulo || ''}`,
      formDeadline: atividade?.deadline || '',
      formNotificationDate: atividade?.notification_date || '',
      formWhatWasDone: override ? campos.oQueFoiFeito : (atividade?.what_was_done || campos.oQueFoiFeito),
      formCurrentStatus: override ? campos.comoEsta : (atividade?.current_status_notes || campos.comoEsta),
      formNextSteps: override ? campos.proximo : (atividade?.next_steps || campos.proximo),
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

  /**
   * O que a equipe já registrou neste processo. Entra no prompt como modelo de
   * tom e de andamento — a função de IA já sabe receber isso, mas o sino nunca
   * mandou: a dica saía sem saber que o passo anterior já tinha sido cumprido.
   */
  const atividadesAnteriores = useCallback(async (processId: string) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = db as any;
      const { data, error } = await client
        .from('lead_activities')
        .select('title, status, activity_type, what_was_done, current_status_notes, next_steps, created_at')
        .eq('process_id', processId)
        .order('created_at', { ascending: false })
        .limit(8);
      if (error) throw error;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (data || []).map((a: any) => ({
        title: a.title,
        status: a.status,
        type: a.activity_type,
        what_was_done: a.what_was_done,
        current_status: a.current_status_notes,
        next_steps: a.next_steps,
        date: (a.created_at || '').slice(0, 10),
      }));
    } catch (err) {
      // Contexto extra que falha não pode derrubar a dica.
      console.warn('[ProcessUpdatesBell] atividades anteriores indisponíveis:', err);
      return [];
    }
  }, []);

  /**
   * Passo em aberto do POP daquele processo — a dica de "o que fazer agora",
   * de graça, direto do banco. Sem POP, devolve a fase da régua de marcos.
   */
  const carregarPasso = useCallback(async (u: ProcessUpdate): Promise<PassoDoPop | null> => {
    try {
      const ctx = await carregarContexto(u);
      const p = ctx.passoAtual;
      const i = p ? ctx.steps.findIndex((s) => s.stepId === p.stepId) : -1;
      const proximo = i >= 0 ? ctx.steps.slice(i + 1).find((s) => !s.checked) || null : null;
      return {
        phaseLabel: p?.phaseLabel || null,
        objectiveLabel: p?.objectiveLabel || null,
        stepLabel: p?.stepLabel || null,
        proximoLabel: proximo?.stepLabel || null,
        faseProcessual: ctx.fase?.faseLabel || null,
        responsavelNome: resolveUserName(p?.assigneeId || null),
      };
    } catch (err) {
      console.error('[ProcessUpdatesBell] passo do POP:', err);
      return null;
    }
  }, [carregarContexto, resolveUserName]);

  /**
   * Dica redigida: a IA lê os EVENTOS do push (não só o resumo) mais o POP e
   * devolve o próximo passo. Mesma função que a aba de movimentações do
   * processo usa — uma implementação só do "movimentação vira atividade".
   */
  const sugerirComIA = useCallback(async (
    u: ProcessUpdate,
    passo: PassoDoPop | null,
  ): Promise<SugestaoIA | null> => {
    try {
      const eventos = u.eventos || [];
      const anteriores = await atividadesAnteriores(u.process_id);
      const { data, error } = await cloudFunctions.invoke('activity-from-movement', {
        body: {
          // O servidor busca os e-mails do tribunal daquele CNJ e lê o processo
          // inteiro antes de dizer o que fazer. Sem isso a dica saía de uma
          // linha só — muitas vezes o cabeçalho do push, que não diz nada.
          include_email_history: true,
          movement: {
            data: u.data_movimentacao,
            tipo: CATEGORIAS[u.categoria]?.label,
            // O texto do tribunal, nunca o resumo: resumo é derivado, e alimentar
            // a IA com a própria saída dela empilha erro em cima de erro.
            conteudo: u.descricao || u.titulo,
          },
          // Os eventos do próprio e-mail entram como contexto recente: é o
          // detalhe que o resumo do card corta.
          recent_movements: eventos.map((e) => ({ data: e.data, conteudo: e.texto })),
          activity_context: {
            process_title: u.processo_titulo,
            process_number: u.numero_cnj,
            previous_activities: anteriores,
            workflow: passo
              ? {
                  step_label: passo.stepLabel || undefined,
                  phase_label: passo.phaseLabel || undefined,
                  next_step: passo.proximoLabel || undefined,
                }
              : undefined,
          },
        },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'A IA não conseguiu responder');
      const f = data.fields || {};
      if (!f.next_steps && !f.title) {
        toast.error('A IA não devolveu uma dica desta vez');
        return null;
      }
      return f as SugestaoIA;
    } catch (err) {
      console.error('[ProcessUpdatesBell] sugestão da IA:', err);
      toast.error(err instanceof Error ? err.message : 'Erro ao pedir a dica à IA');
      return null;
    }
  }, [atividadesAnteriores]);

  /** Cria a atividade da movimentação — com o rascunho da IA, quando houver. */
  const criarAtividadeDoPasso = useCallback(async (u: ProcessUpdate, rascunho?: SugestaoIA) => {
    try {
      const ctx = await carregarContexto(u);
      const criada = await buscarOuCriarAtividade(u, ctx, { rascunho });
      if (criada) {
        markRead(u.id);
        toast.success(rascunho ? 'Atividade criada com a dica da IA' : 'Atividade criada a partir da atualização');
      }
    } catch (err) {
      console.error('[ProcessUpdatesBell] criar atividade do passo:', err);
      toast.error('Erro ao criar a atividade');
    }
  }, [carregarContexto, buscarOuCriarAtividade, markRead]);

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
          // Dentro da ficha não se oferece "Abrir atv": o atalho navega e jogaria
          // a pessoa para fora da atividade que ela está preenchendo.
          action: pending.activityId && !escopado
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

  // ===========================================================================
  // Lote — uma mensagem por CLIENTE, não uma por movimentação
  // ===========================================================================

  /**
   * Quem recebe. É o lead (dono do grupo de WhatsApp), não o processo: um mesmo
   * cliente pode ter movimentação de até três processos no período, e mandar
   * três mensagens ao mesmo grupo é exatamente o que o lote existe para evitar.
   */
  const chaveDoCliente = (u: ProcessUpdate) => u.lead_id || `processo:${u.process_id}`;

  const alternarSelecao = useCallback((id: string) => {
    setSelecionados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const sairDaSelecao = useCallback(() => {
    setModoSelecao(false);
    setSelecionados(new Set());
  }, []);

  // O que conta é o FILTRO, não a paginação. `paginadas` é detalhe de
  // renderização (100 por vez): com 384 linhas em "7 dias", marcar tudo só
  // pegava as 100 na tela e as outras 284 sumiam do lote sem aviso. O filtro
  // continua sendo o limite — seleção não atravessa troca de período/categoria,
  // senão sairia mensagem do que a pessoa não está mais vendo.
  const selecionadosNoFiltro = useMemo(
    () => filtered.filter((u) => selecionados.has(u.id)),
    [filtered, selecionados],
  );

  const clientesSelecionados = useMemo(
    () => new Set(selecionadosNoFiltro.map(chaveDoCliente)).size,
    [selecionadosNoFiltro],
  );

  const todasDoFiltroMarcadas = filtered.length > 0 && selecionadosNoFiltro.length === filtered.length;

  /** Marca (ou limpa) TUDO que o filtro atual devolve, renderizado ou não. */
  const alternarTodasDoFiltro = useCallback(() => {
    setSelecionados((prev) => {
      const next = new Set(prev);
      const marcar = !filtered.every((u) => next.has(u.id));
      for (const u of filtered) {
        if (marcar) next.add(u.id); else next.delete(u.id);
      }
      return next;
    });
  }, [filtered]);

  /** Agrupa por cliente, monta a mensagem de cada um e abre a revisão. */
  const prepararLote = async () => {
    if (!selecionadosNoFiltro.length) return;
    setPreparandoLote(true);
    setPreparoFalhas([]);
    setRiscoAceito(false);
    try {
      const porCliente = new Map<string, ProcessUpdate[]>();
      for (const u of selecionadosNoFiltro) {
        const k = chaveDoCliente(u);
        porCliente.set(k, [...(porCliente.get(k) || []), u]);
      }
      const entradas = [...porCliente.entries()];
      setPreparoProgresso({ feitos: 0, total: entradas.length });

      // Índice preservado (array esparso + filter no fim) para o resultado não
      // depender da ordem em que as promessas voltaram.
      const preparados: Array<LoteCliente | undefined> = new Array(entradas.length);
      const falhas: string[] = [];
      let cursor = 0;
      let feitos = 0;

      const trabalhar = async () => {
        while (cursor < entradas.length) {
          const i = cursor++;
          const [chave, ups] = entradas[i];
          const principal = movimentacaoPrincipal(ups);
          try {
            const ctx = await carregarContexto(principal);
            const campos = camposConsolidados(ups, ctx.passoAtual?.stepLabel || null);
            const groupJid = ctx.lead?.whatsapp_group_id || null;
            preparados[i] = {
              chave,
              leadName: ctx.lead?.lead_name || null,
              groupJid,
              instanceName: groupJid ? await resolveGroupSenderInstanceName(groupJid) : undefined,
              principal,
              updates: ups,
              ctx,
              campos,
              message: montarMensagem(principal, ctx, null, campos),
              reenvio: ups.some((x) => notificadas.has(x.id)),
              semContexto: ctx.steps.length === 0 && !ctx.fase,
            };
          } catch (err) {
            // Um lead com dado quebrado não pode derrubar o preparo dos outros
            // 123 — a pessoa perderia minutos de espera e não saberia por quê.
            console.error('[ProcessUpdatesBell] preparo — falha em', principal.id, err);
            falhas.push(principal.processo_titulo || principal.numero_cnj || 'processo sem título');
          }
          feitos++;
          setPreparoProgresso({ feitos, total: entradas.length });
        }
      };

      await Promise.all(
        Array.from({ length: Math.min(PREPARO_CONCORRENCIA, entradas.length) }, trabalhar),
      );

      // Quem não vai sair fica no fim da revisão: o que precisa de decisão é o
      // que vai ser enviado.
      const prontos = preparados.filter((c): c is LoteCliente => !!c);
      prontos.sort((a, b) => Number(!!b.groupJid) - Number(!!a.groupJid));
      setPreparoFalhas(falhas);
      if (!prontos.length) {
        toast.error('Nenhuma mensagem pôde ser preparada');
        return;
      }
      setLote(prontos);
    } catch (err) {
      console.error('[ProcessUpdatesBell] preparo do lote:', err);
      toast.error('Erro ao preparar as mensagens do lote');
    } finally {
      setPreparandoLote(false);
      setPreparoProgresso(null);
    }
  };

  /**
   * Dispara. Em série e com respiro entre um cliente e outro, mas o respiro é
   * contado POR INSTÂNCIA: numa seleção de mês inteiro, 46 das 124 mensagens
   * saem pelo mesmo número, e é a fila daquele número que derruba a conta na
   * UazAPI — não o total. Instâncias diferentes só respeitam o piso global.
   *
   * A espera vem ANTES do envio e desconta o tempo que o trabalho do cliente já
   * gastou (atividade + etiquetas): pausa depois somaria em cima do que já
   * passou e dobraria a duração sem ganho de proteção.
   */
  const confirmarLote = async () => {
    const alvos = (lote || []).filter((c) => c.groupJid);
    if (!alvos.length) return;
    setLote(null);
    setLoteProgresso({ feitos: 0, total: alvos.length });

    let enviados = 0;
    const falhas: string[] = [];
    const ultimoPorInstancia = new Map<string, number>();
    let ultimoEnvio = 0;

    for (const [i, cliente] of alvos.entries()) {
      try {
        // A atividade nasce agora, com o texto que o cliente vai receber, e uma
        // só para as N movimentações dele.
        const atividade = await buscarOuCriarAtividade(cliente.principal, cliente.ctx, {
          campos: cliente.campos,
          agrupadas: cliente.updates,
        });

        // Instância já resolvida no preparo — é a mesma que a revisão mostrou.
        const instanceName = cliente.instanceName;
        const chaveInstancia = instanceName || '(escolhida pela edge)';
        const agora = Date.now();
        const anteriorDaInstancia = ultimoPorInstancia.get(chaveInstancia);
        const espera = Math.max(
          ultimoEnvio ? GAP_GLOBAL_MS - (agora - ultimoEnvio) : 0,
          anteriorDaInstancia ? GAP_MESMA_INSTANCIA_MS - (agora - anteriorDaInstancia) : 0,
        );
        if (espera > 0) await new Promise((r) => setTimeout(r, espera));

        const sendBody: Record<string, unknown> = {
          phone: cliente.groupJid,
          chat_id: cliente.groupJid,
          message: cliente.message,
          lead_id: cliente.principal.lead_id,
        };
        if (instanceName) sendBody.instance_name = instanceName;

        const { data, error } = await cloudFunctions.invoke('send-whatsapp', { body: sendBody });
        const marcado = Date.now();
        ultimoEnvio = marcado;
        ultimoPorInstancia.set(chaveInstancia, marcado);
        if (error || !data?.success) throw new Error(data?.error || 'envio recusado');

        enviados++;
        // Etiqueta em TODAS as movimentações que a mensagem cobriu, com a mesma
        // atividade: senão as outras cinco continuariam pedindo aviso. Em
        // paralelo porque um cliente com seis movimentações eram seis idas ao
        // banco em fila, vezes 124 clientes.
        for (const u of cliente.updates) markRead(u.id);
        await Promise.all(cliente.updates.map((u) => markNotified(u.id, {
          activityId: atividade?.id || null,
          groupJid: cliente.groupJid,
          notifiedByName: profile?.full_name || null,
        })));
      } catch (err) {
        console.error('[ProcessUpdatesBell] lote — falha em', cliente.leadName, err);
        falhas.push(cliente.leadName || 'cliente sem nome');
      }
      setLoteProgresso({ feitos: i + 1, total: alvos.length });
    }

    setLoteProgresso(null);
    sairDaSelecao();
    if (falhas.length) {
      toast.warning(`${enviados} de ${alvos.length} avisados`, {
        description: `Não saiu para: ${falhas.slice(0, 3).join(', ')}${falhas.length > 3 ? ` e mais ${falhas.length - 3}` : ''}`,
        duration: 10000,
      });
    } else {
      toast.success(`${enviados} ${enviados === 1 ? 'cliente avisado' : 'clientes avisados'} no grupo`);
    }
  };

  const loteComGrupo = (lote || []).filter((c) => c.groupJid);
  const loteSemGrupo = (lote || []).filter((c) => !c.groupJid);
  const loteReenvios = loteComGrupo.filter((c) => c.reenvio).length;

  /**
   * Quantas mensagens cada número vai carregar. É a informação que decide se o
   * lote é seguro: 124 mensagens espalhadas por 9 instâncias é uma coisa, 46
   * pelo mesmo número é outra — e só isto aqui mostra a diferença antes do
   * clique.
   */
  const distribuicaoInstancia = (() => {
    const acc = new Map<string, number>();
    for (const c of loteComGrupo) {
      const k = c.instanceName || 'número escolhido no envio';
      acc.set(k, (acc.get(k) || 0) + 1);
    }
    return [...acc.entries()].sort((a, b) => b[1] - a[1]);
  })();
  const maiorFilaDeInstancia = distribuicaoInstancia[0]?.[1] || 0;

  // O que manda na duração é o maior dos dois: o trabalho em série de todos os
  // clientes ou a fila do número mais carregado.
  const duracaoEstimadaMs = Math.max(
    loteComGrupo.length * Math.max(TRABALHO_POR_CLIENTE_MS, GAP_GLOBAL_MS),
    maiorFilaDeInstancia * GAP_MESMA_INSTANCIA_MS,
  );
  const duracaoEstimada = duracaoEstimadaMs < 90_000
    ? `${Math.max(5, Math.ceil(duracaoEstimadaMs / 1000 / 5) * 5)} segundos`
    : `${Math.ceil(duracaoEstimadaMs / 60_000)} minutos`;
  const loteGrande = loteComGrupo.length > LOTE_GRANDE;
  const podeEnviarLote = loteComGrupo.length > 0 && (!loteGrande || riscoAceito);

  return (
    <>
    <Sheet
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        // Fechou o painel: a seleção morre junto. Voltar dias depois e achar 40
        // linhas marcadas de um filtro que não existe mais é armadilha.
        if (!o) sairDaSelecao();
      }}
    >
      <SheetTrigger asChild>
        {escopado ? (
          // Na barra da ficha o gatilho é botão com rótulo, não ícone: ali ele
          // divide espaço com Financeiro/Grupo WA, e sino solto no meio deles não
          // diz de qual processo está falando. O número já responde antes do
          // clique — 0 é resposta ("nada capturado neste processo"), não erro.
          <Button
            variant="outline"
            size="sm"
            className={cn(
              'h-7 text-xs gap-1 shrink-0',
              unreadCount > 0 && 'text-red-600 border-red-200 hover:bg-red-50 dark:hover:bg-red-950/30',
            )}
            title={
              unreadCount > 0
                ? `${unreadCount} movimentação(ões) não lida(s) neste processo`
                : 'Movimentações capturadas neste processo'
            }
          >
            <Bell className={cn('h-3 w-3', pulsar && 'animate-bounce')} />
            Atualizações
            <span
              className={cn(
                'ml-0.5 inline-flex min-w-[16px] h-4 px-1 rounded-full items-center justify-center text-[10px] font-bold',
                unreadCount > 0 ? 'bg-red-500 text-white' : 'bg-muted text-muted-foreground',
              )}
            >
              {unreadCount > 0 ? (unreadCount > 99 ? '99+' : unreadCount) : updates.length}
            </span>
          </Button>
        ) : (
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
        )}
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:w-[440px] sm:max-w-[440px] p-0 flex flex-col">
        <SheetHeader className="px-4 py-3 border-b space-y-0">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <SheetTitle className="text-base">
                {escopado ? 'Atualizações deste processo' : 'Atualizações processuais'}
              </SheetTitle>
              {escopado && processLabel && (
                <p className="text-[11px] text-muted-foreground truncate mt-0.5" title={processLabel}>
                  {processLabel}
                </p>
              )}
            </div>
            <div className="flex items-center gap-1 mr-6 shrink-0">
              {unreadCount > 0 && !modoSelecao && (
                <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={markAllRead}>
                  <CheckCheck className="h-3.5 w-3.5" />
                  Marcar lidas
                </Button>
              )}
              {/* Avisar em lote: 43 movimentações numa semana para 30 clientes
                  eram 43 confirmações, uma a uma. */}
              <Button
                variant={modoSelecao ? 'secondary' : 'ghost'}
                size="sm"
                className="h-7 text-xs gap-1"
                onClick={() => (modoSelecao ? sairDaSelecao() : setModoSelecao(true))}
                title={modoSelecao ? 'Sair da seleção' : 'Selecionar várias e avisar todos os clientes de uma vez'}
              >
                {modoSelecao ? <X className="h-3.5 w-3.5" /> : <ListChecks className="h-3.5 w-3.5" />}
                {modoSelecao ? 'Sair' : 'Selecionar'}
              </Button>
            </div>
          </div>
        </SheetHeader>
        {/* Só aparece enquanto ninguém decidiu: concedida some, negada some
            (insistir não reabre o prompt — o navegador bloqueia). */}
        {permissao === 'default' && !escopado && (
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
            a mesma do sino pelo avesso — e fila parada não avisa sozinha.
            Fora do modo escopado: o andamento da fila inteira não é assunto de
            quem abriu a ficha de uma atividade. */}
        {!escopado && <CapturaStatusPanel />}
        {/* Ramo da Justiça — separa o que é da equipe trabalhista do resto.
            Um processo só tem um ramo, então no escopado a linha vira ruído. */}
        {!escopado && (
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
        )}
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
          {PERIODOS.map((p) => {
            const count = countByPeriodo[p.value] || 0;
            // "+" quando o período pegou tudo que foi carregado e ainda sobrou
            // no banco — aí o que falta é banco, não filtro. "Tudo" é sempre
            // parcial enquanto a busca estiver limitada à janela de 30 dias:
            // clicar nele é o que amplia a busca.
            const truncado = (noTeto || (p.value === 'tudo' && desde !== null))
              && count === baseSemPeriodo.length;
            return (
              <button
                key={p.value}
                onClick={() => setPeriodo(p.value)}
                title={
                  truncado
                    ? (p.value === 'tudo' && desde !== null
                        ? `Mais de ${count} — clique para buscar além dos últimos ${JANELA_DIAS} dias`
                        : `Mais de ${count} — o sino carrega até ${FETCH_LIMIT} de uma vez`)
                    : undefined
                }
                className={cn(
                  'text-[11px] px-2 py-0.5 rounded-full border whitespace-nowrap transition-colors',
                  periodo === p.value ? 'bg-primary text-primary-foreground border-primary' : 'bg-background hover:bg-accent',
                )}
              >
                {p.label} <span className="opacity-70">({count}{truncado ? '+' : ''})</span>
              </button>
            );
          })}
          {/* No escopado a linha de Ramo (onde este filtro mora) não existe, e
              "o cliente já foi avisado disto?" é justamente a pergunta de quem
              abriu o atalho pela ficha. */}
          {escopado && (
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
          )}
        </div>
        <ScrollArea className="flex-1">
          {loading ? (
            <p className="text-xs text-muted-foreground text-center py-8">Carregando...</p>
          ) : filtered.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-8">
              {escopado && updates.length === 0
                // Diferença que importa na ficha: "não caiu nada" é resposta;
                // "seu filtro escondeu" é outra conversa.
                ? 'Nenhuma movimentação capturada neste processo ainda.'
                : `Nenhuma atualização nesse período${filtro !== 'todas' ? ' e categoria' : ''}.`}
            </p>
          ) : (
            <>
            {paginadas.map((u) => (
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
                carregarPasso={carregarPasso}
                sugerirComIA={sugerirComIA}
                criarAtividadeDoPasso={criarAtividadeDoPasso}
                showOpenLead={!escopado}
                showProcesso={!escopado}
                selecionavel={modoSelecao}
                selecionado={selecionados.has(u.id)}
                onToggleSelecao={(upd) => alternarSelecao(upd.id)}
              />
            ))}
            {/* Quantas ficaram de fora da tela — e o botão para trazê-las. Sem
                isto, "100 de 452" seria de novo indistinguível de "452". */}
            {filtered.length > paginadas.length && (
              <div className="p-3 text-center">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => setVisiveis((v) => v + PAGINA)}
                >
                  Ver mais {Math.min(PAGINA, filtered.length - paginadas.length)} de {filtered.length - paginadas.length} restantes
                </Button>
              </div>
            )}
            </>
          )}
        </ScrollArea>
        {/* Barra do lote: no fluxo, com borda — nada de flutuante por cima da
            última linha da lista. */}
        {modoSelecao && (
          <div className="border-t bg-muted/40 px-3 py-2 shrink-0 space-y-2">
            <div className="flex items-center justify-between gap-2">
              {/* Marca TODO o filtro, não só as 100 renderizadas — com 384 em
                  "7 dias" a diferença é 284 movimentações que ficavam de fora
                  do lote sem ninguém perceber. */}
              <button
                type="button"
                onClick={alternarTodasDoFiltro}
                className="text-[11px] text-primary hover:underline shrink-0"
                title={
                  todasDoFiltroMarcadas
                    ? 'Desmarcar tudo'
                    : `Marcar todas as ${filtered.length} movimentações deste filtro, inclusive as que ainda não apareceram na lista`
                }
              >
                {todasDoFiltroMarcadas ? 'Limpar seleção' : `Marcar todas as ${filtered.length}`}
              </button>
              <span className="text-[11px] text-muted-foreground truncate">
                {selecionadosNoFiltro.length === 0
                  ? 'Nenhuma marcada'
                  : `${selecionadosNoFiltro.length} ${selecionadosNoFiltro.length === 1 ? 'movimentação' : 'movimentações'} · ${clientesSelecionados} ${clientesSelecionados === 1 ? 'cliente' : 'clientes'}`}
              </span>
            </div>
            <Button
              size="sm"
              className="w-full h-8 text-xs gap-1.5"
              disabled={selecionadosNoFiltro.length === 0 || preparandoLote || !!loteProgresso}
              onClick={prepararLote}
            >
              {preparandoLote || loteProgresso ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Users className="h-3.5 w-3.5" />}
              {loteProgresso
                ? `Enviando ${loteProgresso.feitos}/${loteProgresso.total}...`
                : preparandoLote
                  // Com 124 clientes o preparo leva ~1 min; sem o contador a
                  // pessoa acha que travou e recarrega a página no meio.
                  ? preparoProgresso
                    ? `Montando as mensagens ${preparoProgresso.feitos}/${preparoProgresso.total}...`
                    : 'Montando as mensagens...'
                  : `Notificar ${clientesSelecionados || ''} ${clientesSelecionados === 1 ? 'cliente' : 'clientes'}`.trim()}
            </Button>
            {/* Uma mensagem por cliente é o ponto do recurso — dizer isso antes
                do clique evita o medo de "vou mandar 43 mensagens". */}
            {selecionadosNoFiltro.length > clientesSelecionados && (
              <p className="text-[10px] text-muted-foreground leading-snug">
                Clientes com mais de uma movimentação recebem <strong>uma mensagem só</strong>, com todas juntas.
              </p>
            )}
          </div>
        )}
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

    {/* Revisão do lote: uma linha por CLIENTE, com o texto inteiro sob clique.
        Nada sai sem alguém ter podido ler — é o que separa isto de notificar
        automaticamente. */}
    <AlertDialog
      open={!!lote}
      onOpenChange={(o) => {
        if (o) return;
        setLote(null);
        // O "entendi o risco" não sobrevive ao fechamento: o próximo lote pode
        // ter outro tamanho e outra distribuição de números.
        setRiscoAceito(false);
      }}
    >
      <AlertDialogContent className="max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {loteComGrupo.length === 1
              ? 'Avisar 1 cliente no grupo?'
              : `Avisar ${loteComGrupo.length} clientes no grupo?`}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-left">
              <p className="text-[11px]">
                Cada cliente recebe <strong>uma mensagem</strong>, com todas as movimentações dele juntas.
                O envio é em série, com pausa maior entre mensagens do mesmo número — leva cerca de{' '}
                <strong>{duracaoEstimada}</strong>. A aba precisa ficar aberta até o fim.
              </p>
              {/* Por qual número cada mensagem sai. É o dado que decide se o
                  lote é seguro — total alto espalhado é tranquilo, total baixo
                  concentrado num número só é que dá problema. */}
              {distribuicaoInstancia.length > 0 && (
                <div className="text-[11px] rounded-md border bg-muted/50 p-2 space-y-0.5">
                  <p className="text-muted-foreground">Sai por:</p>
                  {distribuicaoInstancia.map(([nome, qtd]) => (
                    <p key={nome} className="flex justify-between gap-2">
                      <span className="truncate">{nome}</span>
                      <span className="shrink-0 font-medium">
                        {qtd} {qtd === 1 ? 'mensagem' : 'mensagens'}
                      </span>
                    </p>
                  ))}
                </div>
              )}
              {loteGrande && (
                <div className="text-[11px] rounded-md border border-red-500/40 bg-red-500/10 p-2 space-y-1.5">
                  <p className="flex items-start gap-1.5 text-red-600 dark:text-red-400">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
                    <span>
                      Lote grande: <strong>{loteComGrupo.length} mensagens</strong>, sendo{' '}
                      <strong>{maiorFilaDeInstancia}</strong> pelo mesmo número
                      {distribuicaoInstancia[0] ? ` (${distribuicaoInstancia[0][0]})` : ''}.
                      Volume assim em sequência é o que faz o WhatsApp bloquear a linha —
                      e uma linha bloqueada leva os atendimentos dela junto.
                    </span>
                  </p>
                  {/* `htmlFor` em vez de <label> por fora: o Checkbox do Radix é
                      um <button>, e envolver botão em label não repassa o
                      clique do texto — a caixa ficaria com mira de 16px. */}
                  <div className="flex items-start gap-1.5">
                    <Checkbox
                      id="lote-risco-aceito"
                      checked={riscoAceito}
                      onCheckedChange={(v) => setRiscoAceito(v === true)}
                      className="mt-px shrink-0"
                    />
                    <label htmlFor="lote-risco-aceito" className="cursor-pointer">
                      Entendi o risco e quero enviar mesmo assim.
                    </label>
                  </div>
                </div>
              )}
              {preparoFalhas.length > 0 && (
                <p className="text-[11px] flex items-start gap-1.5 text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
                  {preparoFalhas.length === 1
                    ? '1 movimentação não pôde ser preparada e ficou de fora'
                    : `${preparoFalhas.length} movimentações não puderam ser preparadas e ficaram de fora`}
                  {preparoFalhas.length <= 3 ? ` (${preparoFalhas.join(', ')})` : ''}.
                </p>
              )}
              {loteReenvios > 0 && (
                <p className="text-[11px] flex items-start gap-1.5 text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
                  {loteReenvios === 1
                    ? '1 cliente já foi notificado de alguma dessas movimentações e vai receber de novo.'
                    : `${loteReenvios} clientes já foram notificados de alguma dessas movimentações e vão receber de novo.`}
                </p>
              )}
              <div className="max-h-[45vh] overflow-y-auto space-y-1.5 pr-1">
                {loteComGrupo.map((c) => {
                  const aberto = loteExpandido.has(c.chave);
                  return (
                    <div key={c.chave} className="border rounded-md overflow-hidden">
                      <button
                        type="button"
                        className="w-full flex items-center gap-1.5 px-2 py-1.5 text-left hover:bg-accent"
                        onClick={() => setLoteExpandido((prev) => {
                          const next = new Set(prev);
                          if (next.has(c.chave)) next.delete(c.chave); else next.add(c.chave);
                          return next;
                        })}
                      >
                        {aberto ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
                        <span className="text-xs font-medium truncate flex-1">
                          {c.leadName || 'Cliente sem nome'}
                        </span>
                        {c.reenvio && (
                          <Badge variant="outline" className="text-[9px] px-1 py-0 border-amber-500/40 text-amber-600 dark:text-amber-400 shrink-0">
                            reenvio
                          </Badge>
                        )}
                        {c.semContexto && (
                          <Badge variant="outline" className="text-[9px] px-1 py-0 text-muted-foreground shrink-0">
                            sem POP
                          </Badge>
                        )}
                        <span className="text-[10px] text-muted-foreground shrink-0">
                          {c.updates.length} mov.
                        </span>
                      </button>
                      {aberto && (
                        <div className="text-[11px] whitespace-pre-wrap bg-muted p-2 max-h-56 overflow-y-auto border-t">
                          {c.message}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {loteSemGrupo.length > 0 && (
                <p className="text-[11px] flex items-start gap-1.5 text-muted-foreground">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
                  {loteSemGrupo.length === 1 ? '1 cliente ficou de fora' : `${loteSemGrupo.length} clientes ficaram de fora`}
                  {' '}por não ter grupo de WhatsApp vinculado
                  {loteSemGrupo.length <= 3 ? ` (${loteSemGrupo.map((c) => c.leadName || 'sem nome').join(', ')})` : ''}.
                </p>
              )}
              <p className="text-[11px] text-muted-foreground">
                Uma atividade com o próximo passo é criada para cada cliente e fica com você.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={confirmarLote} disabled={!podeEnviarLote}>
            Enviar {loteComGrupo.length} {loteComGrupo.length === 1 ? 'mensagem' : 'mensagens'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
