import { useState, useEffect, useRef, useCallback } from 'react';
import { externalSupabase, ensureExternalSession } from '@/integrations/supabase/external-client';
import { supabase } from '@/integrations/supabase/client';
import { remapToExternal, ensureRemapCache } from '@/integrations/supabase/uuid-remap';
import { useAuthContext } from '@/contexts/AuthContext';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Star, Mic, MicOff, Loader2, ThumbsUp, AlertCircle, RefreshCw, ExternalLink, Trophy } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { format, parseISO } from 'date-fns';
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
  updated_at: string;
}

export interface FeedbackFollowUp {
  source: FeedbackRow;
  praise: string;
  reason: string;
}

const COLUMNS: { key: string; label: string; icon: string; className: string }[] = [
  { key: 'a_avaliar',   label: 'A avaliar',    icon: '📥', className: 'border-slate-300 dark:border-slate-700' },
  { key: 'satisfeito',  label: 'Satisfeito',   icon: '✅', className: 'border-green-300 dark:border-green-800' },
  { key: 'incompleto',  label: 'Incompleto',   icon: '⚠️', className: 'border-amber-300 dark:border-amber-800' },
  { key: 'insatisfeito',label: 'Insatisfeito', icon: '❌', className: 'border-red-300 dark:border-red-800' },
];

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
  const [loading, setLoading] = useState(false);
  // Estado por cartão (avaliação em andamento)
  const [draft, setDraft] = useState<Record<string, { rating: number; justification: string; praise: string }>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [listeningId, setListeningId] = useState<string | null>(null);
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
        .select('id, title, feedback, feedback_rating, feedback_outcome, feedback_rated_by_name, feedback_rated_at, assigned_to, assigned_to_name, created_by, observer_ids, lead_id, lead_name, case_id, case_title, process_id, process_title, activity_type, updated_at')
        .not('feedback', 'is', null)
        .neq('feedback', '')
        .is('deleted_at', null)
        .or(`observer_ids.cs.{${eid}},created_by.eq.${eid}`)
        .order('updated_at', { ascending: false })
        .limit(300);
      if (error) throw error;
      setRows((data || []) as FeedbackRow[]);
    } catch (e: any) {
      console.error('[FeedbackFunnel] load error:', e);
      toast.error('Erro ao carregar feedbacks');
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => { if (open) load(); }, [open, load]);

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

  const columnRows = (key: string) =>
    rows.filter(r => (key === 'a_avaliar' ? !r.feedback_outcome : r.feedback_outcome === key));

  const counts = {
    a_avaliar: columnRows('a_avaliar').length,
    satisfeito: columnRows('satisfeito').length,
    incompleto: columnRows('incompleto').length,
    insatisfeito: columnRows('insatisfeito').length,
  };

  const linkFor = (row: FeedbackRow) =>
    row.lead_name || row.case_title || row.process_title || row.title;

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
        </SheetHeader>

        <div className="flex-1 overflow-auto p-3">
          {loading && rows.length === 0 ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
              <Loader2 className="h-5 w-5 animate-spin" /> Carregando feedbacks…
            </div>
          ) : rows.length === 0 ? (
            <div className="text-center py-16 text-sm text-muted-foreground">
              Nenhum feedback para você ainda. Quando você for observador de uma atividade e o responsável
              preencher o feedback, ele aparece aqui — nunca no seu calendário de tarefas.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 min-h-full">
              {COLUMNS.map(col => (
                <div key={col.key} className={cn('rounded-lg border-2 bg-muted/20 p-2 flex flex-col gap-2', col.className)}>
                  <div className="text-xs font-semibold px-1 flex items-center justify-between">
                    <span>{col.icon} {col.label}</span>
                    <span className="text-muted-foreground">{counts[col.key as keyof typeof counts]}</span>
                  </div>
                  {columnRows(col.key).map(row => {
                    const d = getDraft(row.id, row);
                    const evaluated = !!row.feedback_outcome;
                    return (
                      <div key={row.id} className="rounded-md border bg-card p-2.5 space-y-2 shadow-sm">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-xs font-medium truncate" title={row.title}>{row.title}</p>
                            <p className="text-[10px] text-muted-foreground truncate">{linkFor(row)}</p>
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
                  })}
                  {columnRows(col.key).length === 0 && (
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
