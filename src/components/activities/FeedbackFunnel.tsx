import { useState, useEffect, useRef, useCallback } from 'react';
import { externalSupabase, ensureExternalSession } from '@/integrations/supabase/external-client';
import { supabase } from '@/integrations/supabase/client';
import { remapToExternal, ensureRemapCache } from '@/integrations/supabase/uuid-remap';
import { useAuthContext } from '@/contexts/AuthContext';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Star, Mic, MicOff, Loader2, ThumbsUp, AlertCircle, RefreshCw, ExternalLink, Trophy, ChevronLeft, ChevronRight, CalendarDays, Columns3 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { format, parseISO, startOfDay, differenceInCalendarDays, startOfMonth, endOfMonth, eachDayOfInterval, addMonths, subMonths, isToday } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useNavigate } from 'react-router-dom';

// Um feedback = uma atividade com retorno preenchido. O observador avalia.
export interface FeedbackRow {
  id: string;
  title: string;
  feedback: string | null;
  feedback_rating: number | null;
  feedback_outcome: string | null;            // satisfeito | incompleto | insatisfeito | null
  feedback_rated_by_name: string | null;
  feedback_rated_at: string | null;
  assigned_to: string | null;                 // responsável (ext UUID)
  assigned_to_name: string | null;
  created_by: string | null;
  observer_ids: string[] | null;
  lead_id: string | null;
  lead_name: string | null;
  case_id: string | null;
  case_title: string | null;
  process_id: string | null;
  process_title: string | null;
  activity_type: string | null;
  status: string | null;
  deadline: string | null;
  rescheduled_to: string | null;
  completed_at: string | null;
  updated_at: string;
}

export interface FeedbackFollowUp {
  source: FeedbackRow;
  praise: string;
  reason: string;
}

// Atividade observada sem retorno ainda — atrasada ou reagendada (card só de leitura).
interface LateRow {
  id: string;
  title: string;
  status: string | null;
  deadline: string | null;
  rescheduled_to: string | null;
  assigned_to: string | null;          // responsável (ext UUID) — alvo da cobrança
  assigned_to_name: string | null;
  lead_name: string | null;
  case_title: string | null;
  process_title: string | null;
}

const COLUMNS: { key: string; label: string; icon: string; className: string }[] = [
  { key: 'atrasada',    label: 'Atrasadas',    icon: '⏰', className: 'border-red-400 dark:border-red-700 bg-red-50/40 dark:bg-red-950/20' },
  { key: 'reagendada',  label: 'Reagendadas',  icon: '🔁', className: 'border-blue-300 dark:border-blue-800' },
  { key: 'a_avaliar',   label: 'A avaliar',    icon: '📥', className: 'border-slate-300 dark:border-slate-700' },
  { key: 'satisfeito',  label: 'Satisfeito',   icon: '✅', className: 'border-green-300 dark:border-green-800' },
  { key: 'incompleto',  label: 'Incompleto',   icon: '⚠️', className: 'border-amber-300 dark:border-amber-800' },
  { key: 'insatisfeito',label: 'Insatisfeito', icon: '❌', className: 'border-red-300 dark:border-red-800' },
];

// Estilo dos chips no calendário, por categoria.
const CAT_STYLE: Record<string, { chip: string; label: string }> = {
  atrasada:     { chip: 'bg-red-100 border-red-300 text-red-800 dark:bg-red-950 dark:border-red-800 dark:text-red-300', label: '⏰ Atrasada' },
  reagendada:   { chip: 'bg-blue-100 border-blue-300 text-blue-800 dark:bg-blue-950 dark:border-blue-800 dark:text-blue-300', label: '🔁 Reagendada' },
  a_avaliar:    { chip: 'bg-slate-100 border-slate-300 text-slate-800 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-300', label: '📥 A avaliar' },
  satisfeito:   { chip: 'bg-green-100 border-green-300 text-green-800 dark:bg-green-950 dark:border-green-800 dark:text-green-300', label: '✅ Satisfeito' },
  incompleto:   { chip: 'bg-amber-100 border-amber-300 text-amber-800 dark:bg-amber-950 dark:border-amber-800 dark:text-amber-300', label: '⚠️ Incompleto' },
  insatisfeito: { chip: 'bg-red-50 border-red-200 text-red-700 dark:bg-red-950/50 dark:border-red-900 dark:text-red-400', label: '❌ Insatisfeito' },
};

const WEEK_DAYS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

function StarPicker({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const [hover, setHover] = useState(0);
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          type="button"
          onMouseEnter={() => setHover(n)}
          onMouseLeave={() => setHover(0)}
          onClick={() => onChange(n)}
          className="p-0.5"
          title={`${n} estrela${n > 1 ? 's' : ''}`}
        >
          <Star className={cn('h-4 w-4', (hover || value) >= n ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/40')} />
        </button>
      ))}
    </div>
  );
}

function stripHtml(s: string) {
  return (s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

// Duração legível do cronômetro abertura → conclusão (ex.: 2d 3h, 1h05min, 12:34).
function fmtDur(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h${m > 0 ? ` ${m}min` : ''}`;
  if (h > 0) return `${h}h${String(m).padStart(2, '0')}min`;
  return `${m}:${String(sec).padStart(2, '0')} min`;
}

// Mesma regra da ActivitiesPage: atrasada = não concluída + prazo vencido; reagendada = status próprio.
function situacaoBadge(row: FeedbackRow): { label: string; className: string } | null {
  if (row.status === 'reagendada') {
    let quando = '';
    if (row.rescheduled_to) {
      try { quando = ` p/ ${format(parseISO(row.rescheduled_to), 'dd/MM')}`; } catch { /* data inválida */ }
    }
    return { label: `🔁 Reagendada${quando}`, className: 'border-blue-300 bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800' };
  }
  if (row.status !== 'concluida' && row.deadline) {
    try {
      const dias = differenceInCalendarDays(startOfDay(new Date()), startOfDay(parseISO(row.deadline)));
      if (dias > 0) {
        return { label: `⚠ Atrasada · venceu há ${dias === 1 ? '1 dia' : `${dias} dias`}`, className: 'border-red-300 bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300 dark:border-red-800' };
      }
    } catch { /* deadline inválido */ }
  }
  return null;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** "Insatisfeito" pede nova atividade de melhoria — o pai abre o form prefilled. */
  onCreateFollowUp: (fu: FeedbackFollowUp) => void;
}

export function FeedbackFunnel({ open, onOpenChange, onCreateFollowUp }: Props) {
  const { user } = useAuthContext();
  const navigate = useNavigate();
  const [extId, setExtId] = useState<string | null>(null);
  const [rows, setRows] = useState<FeedbackRow[]>([]);
  const [lateRows, setLateRows] = useState<LateRow[]>([]);
  const [loading, setLoading] = useState(false);
  // Visão (funil kanban ou calendário) + filtros de assessor e período.
  const [view, setView] = useState<'funil' | 'calendario'>('funil');
  const [calMonth, setCalMonth] = useState(() => new Date());
  const [selectedCalDay, setSelectedCalDay] = useState<string | null>(null);
  const [filterAssessor, setFilterAssessor] = useState('all');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');
  // Estado por cartão (avaliação em andamento)
  const [draft, setDraft] = useState<Record<string, { rating: number; justification: string; praise: string }>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [listeningId, setListeningId] = useState<string | null>(null);
  const [nudgingId, setNudgingId] = useState<string | null>(null);
  // Última cobrança por atividade (persistida): quando foi dada e se já foi vista pelo responsável.
  const [cobrancas, setCobrancas] = useState<Record<string, { created_at: string; read_at: string | null; level: 'importante' | 'urgente' }>>({});
  // Última abertura da atividade pelo responsável (type='abertura') — início do cronômetro.
  const [aberturas, setAberturas] = useState<Record<string, string>>({});
  // Tick do cronômetro ao vivo (1s) enquanto o funil está aberto.
  const [now, setNow] = useState(() => Date.now());
  // Ids das atividades exibidas — filtro client-side dos eventos realtime.
  const trackedIdsRef = useRef<Set<string>>(new Set());
  const recognitionRef = useRef<any>(null);

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      await ensureExternalSession();
      await ensureRemapCache();
      const eid = (await remapToExternal(user.id)) as string | null;
      setExtId(eid);
      if (!eid) { setRows([]); return; }
      // Feedbacks onde sou observador OU criador.
      const { data, error } = await (externalSupabase as any)
        .from('lead_activities')
        .select('id, title, feedback, feedback_rating, feedback_outcome, feedback_rated_by_name, feedback_rated_at, assigned_to, assigned_to_name, created_by, observer_ids, lead_id, lead_name, case_id, case_title, process_id, process_title, activity_type, status, deadline, rescheduled_to, completed_at, updated_at')
        .not('feedback', 'is', null)
        .neq('feedback', '')
        .is('deleted_at', null)
        .or(`observer_ids.cs.{${eid}},created_by.eq.${eid}`)
        .order('updated_at', { ascending: false })
        .limit(300);
      if (error) throw error;
      setRows((data || []) as FeedbackRow[]);

      // Atrasadas/reagendadas que você observa — ainda sem retorno, por isso não entram no funil normal.
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const { data: late, error: lateErr } = await (externalSupabase as any)
        .from('lead_activities')
        .select('id, title, status, deadline, rescheduled_to, assigned_to, assigned_to_name, lead_name, case_title, process_title')
        .is('deleted_at', null)
        .or(`observer_ids.cs.{${eid}},created_by.eq.${eid}`)
        .or(`status.eq.reagendada,and(status.neq.concluida,deadline.lt.${todayStart.toISOString()})`)
        .order('deadline', { ascending: true })
        .limit(300);
      if (lateErr) throw lateErr;
      setLateRows((late || []) as LateRow[]);

      // Receipts das cobranças (última + se já foi vista) e das aberturas pelo
      // responsável (início do cronômetro) — de todas as atividades exibidas.
      const allIds = Array.from(new Set([...(late || []).map((r: any) => r.id), ...(data || []).map((r: any) => r.id)]));
      trackedIdsRef.current = new Set(allIds);
      if (allIds.length) {
        const { data: notifs } = await (externalSupabase as any)
          .from('activity_notifications')
          .select('activity_id, type, created_at, read_at, title')
          .in('type', ['cobranca', 'abertura'])
          .in('activity_id', allIds)
          .order('created_at', { ascending: false });
        const map: Record<string, { created_at: string; read_at: string | null; level: 'importante' | 'urgente' }> = {};
        const abMap: Record<string, string> = {};
        for (const c of (notifs || [])) {
          // Ordenado desc → a 1ª ocorrência de cada atividade é a mais recente.
          if (c.type === 'cobranca') {
            if (!map[c.activity_id]) {
              map[c.activity_id] = {
                created_at: c.created_at,
                read_at: c.read_at,
                level: /URGENTE/i.test(c.title || '') ? 'urgente' : 'importante',
              };
            }
          } else if (!abMap[c.activity_id]) {
            abMap[c.activity_id] = c.created_at;
          }
        }
        setCobrancas(map);
        setAberturas(abMap);
      } else {
        setCobrancas({});
        setAberturas({});
      }
    } catch (e: any) {
      console.error('[FeedbackFunnel] load error:', e);
      toast.error('Erro ao carregar feedbacks');
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => { if (open) load(); }, [open, load]);

  // Tick de 1s pro cronômetro ao vivo dos cards com abertura registrada.
  useEffect(() => {
    if (!open || Object.keys(aberturas).length === 0) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [open, aberturas]);

  // Tempo real enquanto o funil está aberto: abertura pelo responsável (INSERT
  // p/ mim), "visto" da cobrança (UPDATE read_at) e conclusão/feedback da
  // atividade (UPDATE em lead_activities) — sem precisar recarregar na mão.
  useEffect(() => {
    if (!open || !extId) return;
    const channel = externalSupabase
      .channel('feedback-funnel-live-' + extId)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'activity_notifications', filter: `recipient_id=eq.${extId}` },
        (payload) => {
          const n = payload.new as any;
          if (n?.type === 'abertura' && n.activity_id) {
            setAberturas(prev => ({ ...prev, [n.activity_id]: n.created_at }));
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'activity_notifications' },
        (payload) => {
          const n = payload.new as any;
          if (n?.type === 'cobranca' && n.activity_id && n.read_at && trackedIdsRef.current.has(n.activity_id)) {
            setCobrancas(prev => (prev[n.activity_id] && !prev[n.activity_id].read_at
              ? { ...prev, [n.activity_id]: { ...prev[n.activity_id], read_at: n.read_at } }
              : prev));
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'lead_activities' },
        (payload) => {
          const a = payload.new as any;
          // Atividade acompanhada mudou (concluída, reagendada, feedback…) → re-bucket.
          if (a?.id && trackedIdsRef.current.has(a.id)) load();
        }
      )
      .subscribe();
    return () => { externalSupabase.removeChannel(channel); };
  }, [open, extId, load]);

  const getDraft = (id: string, row: FeedbackRow) =>
    draft[id] || { rating: row.feedback_rating || 0, justification: '', praise: '' };

  const setDraftField = (id: string, row: FeedbackRow, patch: Partial<{ rating: number; justification: string; praise: string }>) => {
    setDraft(prev => ({ ...prev, [id]: { ...getDraft(id, row), ...patch } }));
  };

  const toggleDictation = (id: string, row: FeedbackRow) => {
    if (listeningId === id) {
      recognitionRef.current?.stop();
      setListeningId(null);
      return;
    }
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { toast.error('Seu navegador não suporta ditado por voz'); return; }
    const rec = new SR();
    rec.lang = 'pt-BR';
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (ev: any) => {
      const txt = Array.from(ev.results).map((r: any) => r[0].transcript).join(' ');
      const cur = getDraft(id, row).justification;
      setDraftField(id, row, { justification: cur ? `${cur} ${txt}` : txt });
    };
    rec.onerror = () => setListeningId(null);
    rec.onend = () => setListeningId(null);
    recognitionRef.current = rec;
    rec.start();
    setListeningId(id);
    toast.info('🎙️ Ouvindo… dite sua justificativa', { duration: 2000 });
  };

  // Notifica um destinatário (responsável) — reaproveita a tabela activity_notifications.
  const notify = async (row: FeedbackRow, type: string, title: string, body: string) => {
    if (!row.assigned_to || row.assigned_to === extId) return;
    try {
      const { data: prof } = await supabase.from('profiles').select('full_name').eq('user_id', user?.id || '').maybeSingle();
      await externalSupabase.from('activity_notifications' as any).insert({
        activity_id: row.id,
        recipient_id: row.assigned_to,
        recipient_name: row.assigned_to_name,
        type,
        title,
        body,
        actor_id: extId,
        actor_name: (prof as any)?.full_name || null,
      } as any);
    } catch (e) {
      console.warn('[FeedbackFunnel] notify falhou:', e);
    }
  };

  // Cobrança de atividade atrasada: o observador aperta e o responsável recebe um
  // popup (via activity_notifications → ActivityNotificationsListener) marcando a
  // atividade como importante ou urgente, com ação de abrir a atividade.
  const nudgeLate = async (row: LateRow, level: 'importante' | 'urgente') => {
    if (!row.assigned_to) { toast.error('Esta atividade não tem responsável para cobrar.'); return; }
    if (row.assigned_to === extId) { toast.info('Você é o responsável por esta atividade.'); return; }
    setNudgingId(row.id);
    try {
      const { data: prof } = await supabase.from('profiles').select('full_name').eq('user_id', user?.id || '').maybeSingle();
      const myName = (prof as any)?.full_name || null;
      const venceu = row.deadline ? ` (venceu ${format(parseISO(row.deadline), 'dd/MM')})` : '';
      const heading = level === 'urgente' ? '🚨 URGENTE — atividade atrasada' : '❗ Importante — atividade atrasada';
      const contexto = row.lead_name || row.case_title || row.process_title || '';
      const body = `“${row.title}”${venceu} está atrasada${contexto ? ` · ${contexto}` : ''}. Priorize a conclusão.`;
      const { error } = await externalSupabase.from('activity_notifications' as any).insert({
        activity_id: row.id,
        recipient_id: row.assigned_to,
        recipient_name: row.assigned_to_name,
        type: 'cobranca',
        title: heading,
        body,
        actor_id: extId,
        actor_name: myName,
      } as any);
      if (error) throw error;
      setCobrancas(prev => ({ ...prev, [row.id]: { created_at: new Date().toISOString(), read_at: null, level } }));
      toast.success(level === 'urgente'
        ? `🚨 Cobrança URGENTE enviada para ${row.assigned_to_name || 'o responsável'}.`
        : `❗ Cobrança de importância enviada para ${row.assigned_to_name || 'o responsável'}.`);
    } catch (e: any) {
      console.error('[FeedbackFunnel] nudgeLate error:', e);
      toast.error('Erro ao enviar a cobrança.');
    } finally {
      setNudgingId(null);
    }
  };

  const evaluate = async (row: FeedbackRow, outcome: 'satisfeito' | 'incompleto' | 'insatisfeito') => {
    const d = getDraft(row.id, row);
    const rating = d.rating;
    if (!rating) { toast.error('Dê uma nota em estrelas antes de avaliar.'); return; }
    // Justificativa obrigatória no 5 (reconhecer) e no <=2 (construtivo).
    if ((rating === 5 || rating <= 2) && !d.justification.trim()) {
      toast.error(rating === 5
        ? 'No 5 estrelas, registre o que motivou a nota máxima (reconhecimento).'
        : 'Em nota baixa (≤2), registre o que faltou — de forma construtiva.');
      return;
    }
    // Insatisfeito: sanduíche — exige registrar 1 coisa que ficou boa.
    if (outcome === 'insatisfeito' && !d.praise.trim()) {
      toast.error('Antes de pedir melhoria, registre 1 coisa que ficou boa (será enviada junto).');
      return;
    }

    setSavingId(row.id);
    try {
      const { data: prof } = await supabase.from('profiles').select('full_name').eq('user_id', user?.id || '').maybeSingle();
      const myName = (prof as any)?.full_name || null;
      const { error } = await externalSupabase
        .from('lead_activities')
        .update({
          feedback_rating: rating,
          feedback_outcome: outcome,
          feedback_rating_justification: d.justification.trim() || null,
          feedback_praise: d.praise.trim() || null,
          feedback_rated_by: extId,
          feedback_rated_by_name: myName,
          feedback_rated_at: new Date().toISOString(),
        } as any)
        .eq('id', row.id);
      if (error) throw error;

      if (outcome === 'incompleto') {
        await notify(row, 'incompleto', '⚠️ Feedback incompleto', `Falta detalhar: ${d.justification.trim().slice(0, 300) || 'complete o retorno.'}`);
        toast.success('Marcado como incompleto — o responsável foi avisado para completar.');
      } else if (outcome === 'satisfeito') {
        if (rating >= 4) {
          await notify(row, 'praise', '🌟 Seu trabalho foi elogiado', d.justification.trim() ? `${rating}⭐ — ${d.justification.trim().slice(0, 300)}` : `${rating}⭐ pelo retorno.`);
        }
        toast.success('Avaliado como satisfeito!');
      } else {
        // insatisfeito → abre nova atividade de melhoria (com o elogio embutido).
        onCreateFollowUp({ source: row, praise: d.praise.trim(), reason: d.justification.trim() });
        toast.info('Abrindo nova atividade de melhoria…');
      }

      // Atualiza a lista localmente.
      setRows(prev => prev.map(r => r.id === row.id
        ? { ...r, feedback_rating: rating, feedback_outcome: outcome, feedback_rated_by_name: myName, feedback_rated_at: new Date().toISOString() }
        : r));
      setDraft(prev => { const n = { ...prev }; delete n[row.id]; return n; });
    } catch (e: any) {
      console.error('[FeedbackFunnel] evaluate error:', e);
      toast.error('Erro ao salvar a avaliação');
    } finally {
      setSavingId(null);
    }
  };

  // Data de referência (calendário e filtro de período): reagendada usa a nova data; senão o prazo.
  const refDate = (r: { deadline?: string | null; rescheduled_to?: string | null; status?: string | null; updated_at?: string }) =>
    (r.status === 'reagendada' && r.rescheduled_to) ? r.rescheduled_to : (r.deadline || r.updated_at || null);

  const passesFilters = (name: string | null, dateStr: string | null) => {
    if (filterAssessor !== 'all' && (name || '—') !== filterAssessor) return false;
    if (filterFrom || filterTo) {
      if (!dateStr) return false;
      const d = dateStr.slice(0, 10);
      if (filterFrom && d < filterFrom) return false;
      if (filterTo && d > filterTo) return false;
    }
    return true;
  };

  const filteredRows = rows.filter(r => passesFilters(r.assigned_to_name, refDate(r)));
  const filteredLate = lateRows.filter(r => passesFilters(r.assigned_to_name, refDate(r)));

  const assessores = Array.from(new Set([...rows, ...lateRows].map(r => r.assigned_to_name || '—'))).sort((a, b) => a.localeCompare(b));

  const columnRows = (key: string) =>
    filteredRows.filter(r => (key === 'a_avaliar' ? !r.feedback_outcome : r.feedback_outcome === key));

  const lateColumnRows = (key: string) =>
    filteredLate.filter(r => (key === 'reagendada' ? r.status === 'reagendada' : r.status !== 'reagendada'));

  // Itens unificados do calendário: só as atividades deste painel de feedbacks.
  const calItems: { id: string; title: string; name: string | null; cat: string; date: string | null }[] = [
    ...filteredLate.map(r => ({ id: r.id, title: r.title, name: r.assigned_to_name, cat: r.status === 'reagendada' ? 'reagendada' : 'atrasada', date: refDate(r) })),
    ...filteredRows.map(r => ({ id: r.id, title: r.title, name: r.assigned_to_name, cat: r.feedback_outcome || 'a_avaliar', date: refDate(r) })),
  ];
  const itemsByDay: Record<string, typeof calItems> = {};
  for (const it of calItems) {
    if (!it.date) continue;
    const k = it.date.slice(0, 10);
    (itemsByDay[k] ||= []).push(it);
  }
  const calDays = eachDayOfInterval({ start: startOfMonth(calMonth), end: endOfMonth(calMonth) });

  const counts = {
    atrasada: lateColumnRows('atrasada').length,
    reagendada: lateColumnRows('reagendada').length,
    a_avaliar: columnRows('a_avaliar').length,
    satisfeito: columnRows('satisfeito').length,
    incompleto: columnRows('incompleto').length,
    insatisfeito: columnRows('insatisfeito').length,
  };

  const linkFor = (row: FeedbackRow) =>
    row.lead_name || row.case_title || row.process_title || row.title;

  // Card de leitura (atrasada/reagendada — ainda sem retorno pra avaliar).
  const renderLateCard = (row: LateRow) => {
    const reag = row.status === 'reagendada';
    const dias = row.deadline
      ? differenceInCalendarDays(startOfDay(new Date()), startOfDay(parseISO(row.deadline)))
      : 0;
    return (
      <div key={row.id} className="rounded-md border bg-card p-2.5 space-y-1 shadow-sm">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-medium truncate" title={row.title}>{row.title}</p>
            <p className="text-[10px] text-muted-foreground truncate">{row.lead_name || row.case_title || row.process_title || ''}</p>
          </div>
          <a href={`/?openActivity=${row.id}`} className="shrink-0 text-muted-foreground hover:text-foreground" title="Abrir atividade">
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
        <p className="text-[10px] text-muted-foreground">
          Responsável: <strong>{row.assigned_to_name || '—'}</strong>
        </p>
        {reag ? (
          <p className="text-[10px] text-blue-700 dark:text-blue-400 font-medium">
            🔁 Reagendada{row.rescheduled_to ? ` p/ ${format(parseISO(row.rescheduled_to), 'dd/MM')}` : ''}
          </p>
        ) : (
          <p className="text-[10px] text-red-700 dark:text-red-400 font-medium">
            ⚠ Venceu {row.deadline ? format(parseISO(row.deadline), 'dd/MM') : ''}{dias > 0 ? ` · há ${dias === 1 ? '1 dia' : `${dias} dias`}` : ''}
          </p>
        )}
        {/* Cobrar o responsável: dispara popup (importante/urgente) para ele fazer a atividade atrasada. */}
        {!reag && row.assigned_to && row.assigned_to !== extId && (() => {
          const cob = cobrancas[row.id];
          return (
            <div className="space-y-1 pt-0.5">
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 flex-1 text-[10px] gap-0.5 border-amber-300 text-amber-700 dark:text-amber-400"
                  disabled={nudgingId === row.id}
                  onClick={() => nudgeLate(row, 'importante')}
                  title="Avisar o responsável que é importante"
                >
                  ❗ Importante
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 flex-1 text-[10px] gap-0.5 border-red-400 text-red-700 dark:text-red-400"
                  disabled={nudgingId === row.id}
                  onClick={() => nudgeLate(row, 'urgente')}
                  title="Avisar o responsável que é urgente"
                >
                  🚨 Urgente
                </Button>
              </div>
              {cob && (
                <p className="text-[9px] leading-tight text-muted-foreground">
                  {cob.level === 'urgente' ? '🚨' : '❗'} Cobrado {format(parseISO(cob.created_at), 'dd/MM HH:mm')}
                  {' · '}
                  {cob.read_at ? (
                    <span className="text-green-600 dark:text-green-400 font-medium">✓ visto {format(parseISO(cob.read_at), 'dd/MM HH:mm')}</span>
                  ) : (
                    <span className="text-amber-600 dark:text-amber-400">aguardando visualização</span>
                  )}
                </p>
              )}
              {/* Abertura pelo responsável → cronômetro ao vivo até concluir. */}
              {aberturas[row.id] && (
                <p className="text-[9px] leading-tight">
                  <span className="text-blue-600 dark:text-blue-400 font-medium">👀 Aberta {format(parseISO(aberturas[row.id]), 'dd/MM HH:mm')}</span>
                  {' · '}
                  <span className="font-semibold tabular-nums text-foreground">⏱ {fmtDur(now - parseISO(aberturas[row.id]).getTime())} em andamento</span>
                </p>
              )}
            </div>
          );
        })()}
      </div>
    );
  };

  // Card completo do feedback, com o formulário de avaliação (usado no funil e na lista do dia).
  const renderFeedbackCard = (row: FeedbackRow) => {
    const d = getDraft(row.id, row);
    const evaluated = !!row.feedback_outcome;
    const situacao = situacaoBadge(row);
    return (
      <div key={row.id} className="rounded-md border bg-card p-2.5 space-y-2 shadow-sm">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-medium truncate" title={row.title}>{row.title}</p>
            <p className="text-[10px] text-muted-foreground truncate">{linkFor(row)}</p>
            {situacao && (
              <span className={cn('inline-block mt-1 rounded border px-1.5 py-0.5 text-[9px] font-medium', situacao.className)}>
                {situacao.label}
              </span>
            )}
          </div>
          <a
            href={`/?openActivity=${row.id}`}
            className="shrink-0 text-muted-foreground hover:text-foreground"
            title="Abrir atividade"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>

        <div className="rounded bg-muted/50 p-1.5 text-[11px] max-h-24 overflow-auto whitespace-pre-wrap">
          {stripHtml(row.feedback || '')}
        </div>
        <p className="text-[10px] text-muted-foreground">
          Retorno de <strong>{row.assigned_to_name || '—'}</strong>
        </p>
        {/* Cronômetro abertura → conclusão: quanto tempo levou depois de abrir a atividade cobrada. */}
        {aberturas[row.id] && row.completed_at && parseISO(row.completed_at).getTime() > parseISO(aberturas[row.id]).getTime() && (
          <p className="text-[9px] leading-tight text-muted-foreground">
            ⏱ Feita em <strong className="text-foreground">{fmtDur(parseISO(row.completed_at).getTime() - parseISO(aberturas[row.id]).getTime())}</strong> após a abertura
            <span className="text-blue-600 dark:text-blue-400"> (aberta {format(parseISO(aberturas[row.id]), 'dd/MM HH:mm')})</span>
          </p>
        )}

        {evaluated ? (
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span className="flex items-center gap-0.5">
              {[1, 2, 3, 4, 5].map(n => (
                <Star key={n} className={cn('h-3 w-3', (row.feedback_rating || 0) >= n ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/30')} />
              ))}
            </span>
            <span>avaliado{row.feedback_rated_at ? ` ${format(parseISO(row.feedback_rated_at), 'dd/MM')}` : ''}</span>
          </div>
        ) : (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <StarPicker value={d.rating} onChange={n => setDraftField(row.id, row, { rating: n })} />
              <span className="text-[10px] text-muted-foreground">{d.rating || '—'}/5</span>
            </div>
            <div className="relative">
              <Textarea
                value={d.justification}
                onChange={e => setDraftField(row.id, row, { justification: e.target.value })}
                placeholder={d.rating === 5 ? 'O que mereceu 5⭐? (obrigatório)' : d.rating > 0 && d.rating <= 2 ? 'O que faltou? (obrigatório, construtivo)' : 'Justificativa (opcional)'}
                rows={2}
                className="text-[11px] pr-7"
              />
              <button
                type="button"
                onClick={() => toggleDictation(row.id, row)}
                className={cn('absolute right-1 top-1 p-1 rounded', listeningId === row.id ? 'text-red-500' : 'text-muted-foreground hover:text-foreground')}
                title="Ditar por voz"
              >
                {listeningId === row.id ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
              </button>
            </div>
            <Textarea
              value={d.praise}
              onChange={e => setDraftField(row.id, row, { praise: e.target.value })}
              placeholder="1 coisa que ficou boa (obrigatório só p/ Insatisfeito)"
              rows={1}
              className="text-[11px]"
            />
            <div className="grid grid-cols-3 gap-1">
              <Button size="sm" variant="outline" className="h-7 text-[10px] gap-0.5 border-green-300 text-green-700 dark:text-green-400" disabled={savingId === row.id} onClick={() => evaluate(row, 'satisfeito')}>
                <ThumbsUp className="h-3 w-3" /> Satisf.
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-[10px] gap-0.5 border-amber-300 text-amber-700 dark:text-amber-400" disabled={savingId === row.id} onClick={() => evaluate(row, 'incompleto')}>
                <AlertCircle className="h-3 w-3" /> Incomp.
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-[10px] gap-0.5 border-red-300 text-red-700 dark:text-red-400" disabled={savingId === row.id} onClick={() => evaluate(row, 'insatisfeito')}>
                <RefreshCw className="h-3 w-3" /> Insatisf.
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-[95vw] p-0 flex flex-col">
        <SheetHeader className="px-4 py-3 border-b shrink-0">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <SheetTitle className="text-base flex items-center gap-2">
              💬 Feedbacks
              <span className="text-xs font-normal text-muted-foreground">retornos das suas atividades (você observa)</span>
            </SheetTitle>
            <div className="flex items-center gap-2 text-[11px]">
              <Badge variant="outline" className="border-red-400 text-red-700 dark:text-red-400 font-semibold">⏰ {counts.atrasada} atrasadas</Badge>
              <Badge variant="outline" className="border-blue-300 text-blue-700 dark:text-blue-400">🔁 {counts.reagendada} reagendadas</Badge>
              <Badge variant="outline" className="border-slate-300">📥 {counts.a_avaliar} a avaliar</Badge>
              <Badge variant="outline" className="border-green-300 text-green-700 dark:text-green-400">✅ {counts.satisfeito}</Badge>
              <Badge variant="outline" className="border-amber-300 text-amber-700 dark:text-amber-400">⚠️ {counts.incompleto}</Badge>
              <Badge variant="outline" className="border-red-300 text-red-700 dark:text-red-400">❌ {counts.insatisfeito}</Badge>
              <Button variant="outline" size="sm" className="h-7 gap-1 text-[11px]" onClick={() => navigate('/destaques')} title="Top 5 de Avaliação (modo TV)">
                <Trophy className="h-3.5 w-3.5 text-amber-500" /> Top 5
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={load} title="Recarregar">
                <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
              </Button>
            </div>
          </div>
          {/* Filtros + alternância funil/calendário */}
          <div className="flex items-center gap-2 flex-wrap pt-1">
            <div className="flex rounded-md border overflow-hidden text-[11px]">
              <button
                type="button"
                onClick={() => setView('funil')}
                className={cn('px-2 py-1 flex items-center gap-1', view === 'funil' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted')}
              >
                <Columns3 className="h-3 w-3" /> Funil
              </button>
              <button
                type="button"
                onClick={() => setView('calendario')}
                className={cn('px-2 py-1 flex items-center gap-1 border-l', view === 'calendario' ? 'bg-primary text-primary-foreground' : 'hover:bg-muted')}
              >
                <CalendarDays className="h-3 w-3" /> Calendário
              </button>
            </div>
            <Select value={filterAssessor} onValueChange={setFilterAssessor}>
              <SelectTrigger className="h-7 w-[180px] text-[11px]">
                <SelectValue placeholder="Assessor" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">Todos os assessores</SelectItem>
                {assessores.map(a => (
                  <SelectItem key={a} value={a} className="text-xs">{a}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <span>De</span>
              <input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} className="h-7 rounded border bg-background px-1.5 text-[11px]" />
              <span>até</span>
              <input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)} className="h-7 rounded border bg-background px-1.5 text-[11px]" />
            </div>
            {(filterAssessor !== 'all' || filterFrom || filterTo) && (
              <Button variant="ghost" size="sm" className="h-7 text-[11px]" onClick={() => { setFilterAssessor('all'); setFilterFrom(''); setFilterTo(''); }}>
                Limpar filtros
              </Button>
            )}
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-auto p-3">
          {loading && rows.length === 0 ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
              <Loader2 className="h-5 w-5 animate-spin" /> Carregando feedbacks…
            </div>
          ) : rows.length === 0 && lateRows.length === 0 ? (
            <div className="text-center py-16 text-sm text-muted-foreground">
              Nenhum feedback para você ainda. Quando você for observador de uma atividade e o responsável
              preencher o feedback, ele aparece aqui — nunca no seu calendário de tarefas.
            </div>
          ) : view === 'calendario' ? (
            <div className="max-w-6xl mx-auto">
              <div className="flex items-center justify-center gap-2 mb-1">
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setCalMonth(m => subMonths(m, 1))}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-sm font-medium capitalize w-40 text-center">
                  {format(calMonth, 'MMMM yyyy', { locale: ptBR })}
                </span>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setCalMonth(m => addMonths(m, 1))}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex items-center justify-center gap-2 mb-2 flex-wrap">
                {Object.entries(CAT_STYLE).map(([k, s]) => (
                  <span key={k} className={cn('rounded border px-1.5 py-0.5 text-[9px]', s.chip)}>{s.label}</span>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {WEEK_DAYS.map(d => (
                  <div key={d} className="text-[10px] font-medium text-muted-foreground text-center py-1">{d}</div>
                ))}
                {Array.from({ length: (calDays[0]?.getDay() || 7) - 1 }).map((_, i) => (
                  <div key={`pad-${i}`} />
                ))}
                {calDays.map(day => {
                  const dateKey = format(day, 'yyyy-MM-dd');
                  const dayItems = itemsByDay[dateKey] || [];
                  const MAX = 4;
                  const isSelected = selectedCalDay === dateKey;
                  return (
                    <div
                      key={dateKey}
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedCalDay(prev => (prev === dateKey ? null : dateKey))}
                      className={cn(
                        'min-h-[92px] rounded-md border bg-card p-1 flex flex-col gap-0.5 text-left cursor-pointer hover:border-primary/50',
                        isToday(day) && 'ring-1 ring-primary',
                        isSelected && 'border-primary ring-2 ring-primary',
                        dayItems.length === 0 && 'opacity-60'
                      )}
                    >
                      <span className={cn('text-[10px] leading-none px-0.5', isToday(day) ? 'font-bold text-primary' : 'text-muted-foreground')}>
                        {format(day, 'd')}
                      </span>
                      {dayItems.slice(0, MAX).map(it => (
                        <span
                          key={it.id}
                          title={`${CAT_STYLE[it.cat]?.label || it.cat} — ${it.title}${it.name ? ` · ${it.name}` : ''}`}
                          className={cn('block rounded border px-1 py-0.5 text-[9px] leading-tight truncate', CAT_STYLE[it.cat]?.chip)}
                        >
                          {it.title}
                        </span>
                      ))}
                      {dayItems.length > MAX && (
                        <span className="text-[9px] text-muted-foreground px-0.5">+{dayItems.length - MAX} mais</span>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Relação do dia clicado — avaliação direto aqui, sem abrir a ficha. */}
              {selectedCalDay && (() => {
                const dayFeedback = filteredRows.filter(r => (refDate(r) || '').slice(0, 10) === selectedCalDay);
                const dayLate = filteredLate.filter(r => (refDate(r) || '').slice(0, 10) === selectedCalDay);
                return (
                  <div className="mt-4 border-t pt-3">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-semibold">
                        📅 Atividades de {format(parseISO(selectedCalDay), 'dd/MM/yyyy')} — {dayFeedback.length + dayLate.length}
                      </p>
                      <Button variant="ghost" size="sm" className="h-7 text-[11px]" onClick={() => setSelectedCalDay(null)}>
                        Fechar
                      </Button>
                    </div>
                    {dayFeedback.length + dayLate.length === 0 ? (
                      <p className="text-[11px] text-muted-foreground text-center py-6">Nenhuma atividade neste dia.</p>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                        {dayFeedback.map(renderFeedbackCard)}
                        {dayLate.map(renderLateCard)}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-6 gap-3 min-h-full">
              {COLUMNS.map(col => (
                <div key={col.key} className={cn('rounded-lg border-2 bg-muted/20 p-2 flex flex-col gap-2', col.className)}>
                  <div className="text-xs font-semibold px-1 flex items-center justify-between">
                    <span>{col.icon} {col.label}</span>
                    <span className="text-muted-foreground">{counts[col.key as keyof typeof counts]}</span>
                  </div>
                  {(col.key === 'atrasada' || col.key === 'reagendada') && lateColumnRows(col.key).map(renderLateCard)}
                  {(col.key === 'atrasada' || col.key === 'reagendada') && lateColumnRows(col.key).length === 0 && (
                    <p className="text-[10px] text-muted-foreground/60 text-center py-4">—</p>
                  )}
                  {col.key !== 'atrasada' && col.key !== 'reagendada' && columnRows(col.key).map(renderFeedbackCard)}
                  {col.key !== 'atrasada' && col.key !== 'reagendada' && columnRows(col.key).length === 0 && (
                    <p className="text-[10px] text-muted-foreground/60 text-center py-4">—</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
