// =============================================================================
// Metas processuais de time OU de pessoa: cadastro (todos os marcos de uma vez,
// com o número de hoje ao lado) e painel realizado × meta.
//
// Semântica: alvo ABSOLUTO. O formulário traz quantos processos do dono já estão
// em cada marco (RPC process_marco_baseline) e o usuário informa até quanto quer
// chegar. A barra mede o acumulado de hoje contra o alvo; o ganho dentro do
// período aparece como ritmo.
//
// Time e pessoa não medem o mesmo universo: a meta de time inclui processos sem
// responsável (via POP), a individual não; a individual inclui quem não está em
// nenhum time, a de time não. Somar as duas famílias não faz sentido.
//
// O % médio de fluxo do POP é foto do estado atual — lead_checklist_instances
// não guarda data por item, então não dá pra recortar pelo período.
// =============================================================================
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Plus, Trash2, Pencil, Loader2, Target, ChevronDown, AlertTriangle, Workflow, CalendarIcon, Users, User } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  useTeamProcessGoals, TeamProcessGoalProgress, GoalPeriodType, MarcoBaseline,
  GoalOwner, OwnerKind,
} from '@/hooks/useTeamProcessGoals';
import type { MarcoTipo } from '@/hooks/useProcessMovements';
import { TeamMarcoProcessosSheet, MarcoDrill } from './TeamMarcoProcessosSheet';

const MARCO_LABEL: Record<MarcoTipo, string> = {
  peticao_inicial: 'Petição Inicial',
  audiencia_conciliacao: 'Audiência de Conciliação',
  pericia: 'Perícia',
  audiencia_instrucao: 'Audiência de Instrução',
  sentenca_1grau: 'Sentença (1º grau)',
  acordo: 'Acordo',
  acordao_2grau: 'Acórdão (2º grau)',
  acordao_superior: 'Acórdão (superior)',
  transito_julgado: 'Trânsito em Julgado',
  pagamento: 'Pagamento',
};

/** Ordem canônica do ciclo de vida — mesma de process_movements.marco_ordem. */
const MARCO_ORDER: MarcoTipo[] = [
  'peticao_inicial', 'audiencia_conciliacao', 'pericia', 'audiencia_instrucao',
  'sentenca_1grau', 'acordo', 'acordao_2grau', 'acordao_superior',
  'transito_julgado', 'pagamento',
];

const PERIOD_LABEL: Record<GoalPeriodType, string> = {
  monthly: 'Mensal',
  quarterly: 'Trimestral',
  custom: 'Personalizado',
};

function iso(d: Date) {
  return format(d, 'yyyy-MM-dd');
}

function parseIso(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function periodRange(type: GoalPeriodType): { start: string; end: string } {
  const now = new Date();
  if (type === 'quarterly') {
    const q = Math.floor(now.getMonth() / 3);
    return {
      start: iso(new Date(now.getFullYear(), q * 3, 1)),
      end: iso(new Date(now.getFullYear(), q * 3 + 3, 0)),
    };
  }
  return {
    start: iso(new Date(now.getFullYear(), now.getMonth(), 1)),
    end: iso(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
  };
}

function formatPeriod(start: string, end: string) {
  return `${format(parseIso(start), 'dd/MM/yy')} → ${format(parseIso(end), 'dd/MM/yy')}`;
}

/** Campo de data com calendário (mesmo padrão do relatório diário). */
function DateField({ label, value, onChange }: {
  label: string; value: string; onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" className="w-full justify-start gap-2 font-normal">
            <CalendarIcon className="h-4 w-4 shrink-0" />
            {format(parseIso(value), 'dd/MM/yyyy')}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={parseIso(value)}
            onSelect={d => { if (d) { onChange(iso(d)); setOpen(false); } }}
            initialFocus
            locale={ptBR}
            className={cn('p-3 pointer-events-auto')}
            classNames={{ day_today: 'ring-1 ring-primary/50 font-medium' }}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

/** Número clicável da tabela de marcos — abre a lista dos processos. */
function CountButton({ value, onClick, muted = false }: {
  value: number; onClick: () => void; muted?: boolean;
}) {
  if (value === 0) {
    return <span className={cn('text-right text-sm tabular-nums', muted ? 'text-muted-foreground/60' : 'text-muted-foreground')}>0</span>;
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded px-1 text-right text-sm tabular-nums underline decoration-dotted underline-offset-2 transition-colors hover:text-primary',
        muted && 'text-muted-foreground',
      )}
    >
      {value}
    </button>
  );
}

/** Barra de um alvo, com rótulo acima — nunca sobreposto à barra. */
function GoalBar({ label, done, target, baseline, ganho, suffix = '' }: {
  label: string; done: number | null; target: number;
  baseline?: number | null; ganho?: number | null; suffix?: string;
}) {
  const value = done ?? 0;
  const pct = target > 0 ? Math.min(100, (value / target) * 100) : 0;
  const hit = value >= target;
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className={hit ? 'font-semibold text-emerald-600' : 'font-medium'}>
          {value.toLocaleString('pt-BR')}{suffix} / {target.toLocaleString('pt-BR')}{suffix}
        </span>
      </div>
      <Progress value={pct} className="h-2" />
      {(baseline != null || ganho != null) && (
        <div className="flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
          {baseline != null && <span>Início: {baseline}</span>}
          {ganho != null && <span>No período: +{ganho}</span>}
          {target > value && <span>Faltam {(target - value).toLocaleString('pt-BR')}{suffix}</span>}
        </div>
      )}
    </div>
  );
}

/** Metas de um dono num período — todas as linhas de marco viram um card só. */
interface GoalGroup {
  key: string;
  owner: GoalOwner;
  /** Nome do dono para exibição: o time ou a pessoa. */
  owner_name: string | null;
  name: string | null;
  period_type: GoalPeriodType;
  period_start: string;
  period_end: string;
  marcos: TeamProcessGoalProgress[];
  flow: TeamProcessGoalProgress | null;
  stats: TeamProcessGoalProgress;
}

/** Dono da linha vinda da RPC — owner_kind diz qual dos dois ids vale. */
function rowOwner(r: TeamProcessGoalProgress): GoalOwner {
  return r.owner_kind === 'user'
    ? { kind: 'user', id: r.user_id ?? '' }
    : { kind: 'team', id: r.team_id ?? '' };
}

function groupGoals(rows: TeamProcessGoalProgress[]): GoalGroup[] {
  const map = new Map<string, GoalGroup>();
  rows.forEach(r => {
    const owner = rowOwner(r);
    const key = `${owner.kind}|${owner.id}|${r.period_start}|${r.period_end}`;
    let g = map.get(key);
    if (!g) {
      g = {
        key,
        owner,
        owner_name: owner.kind === 'user' ? r.user_name : r.team_name,
        name: r.name,
        period_type: r.period_type,
        period_start: r.period_start,
        period_end: r.period_end,
        marcos: [],
        flow: null,
        stats: r,
      };
      map.set(key, g);
    }
    if (r.marco_tipo) g.marcos.push(r);
    else g.flow = r;
    if (!g.name && r.name) g.name = r.name;
  });
  map.forEach(g => {
    g.marcos.sort(
      (a, b) => MARCO_ORDER.indexOf(a.marco_tipo!) - MARCO_ORDER.indexOf(b.marco_tipo!),
    );
  });
  return Array.from(map.values());
}

interface FormState {
  owner_kind: OwnerKind;
  /** id do time ou da pessoa, conforme owner_kind. Vazio = ainda não escolhido. */
  owner_id: string;
  name: string;
  period_type: GoalPeriodType;
  period_start: string;
  period_end: string;
  /** marco → alvo digitado (string pra permitir campo vazio) */
  targets: Record<string, string>;
  target_flow_avg_pct: string;
}

function emptyForm(kind: OwnerKind = 'user'): FormState {
  const { start, end } = periodRange('monthly');
  return {
    owner_kind: kind, owner_id: '', name: '', period_type: 'monthly',
    period_start: start, period_end: end, targets: {}, target_flow_avg_pct: '',
  };
}

const OWNER_LABEL: Record<OwnerKind, string> = { team: 'Time', user: 'Pessoa' };

export function TeamProcessGoals() {
  const {
    goals, teams, owners, boards, loading, error,
    fetchMarcoBaseline, fetchMarcoProcessos, saveGoalSet, deleteGoalSet, setBoardTeam,
  } = useTeamProcessGoals();
  const [drill, setDrill] = useState<MarcoDrill | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [baseline, setBaseline] = useState<MarcoBaseline[]>([]);
  const [baselineLoading, setBaselineLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState<GoalGroup | null>(null);
  const [mapOpen, setMapOpen] = useState(false);

  const groups = useMemo(() => groupGoals(goals), [goals]);

  const baselineByMarco = useMemo(() => {
    const m = new Map<string, MarcoBaseline>();
    baseline.forEach(b => m.set(b.marco_tipo, b));
    return m;
  }, [baseline]);

  const totalNoDono = useMemo(
    () => baseline.reduce((acc, b) => Math.max(acc, b.acumulado), 0),
    [baseline],
  );

  /** Dono escolhido no formulário — null enquanto não escolheu. */
  const formOwner = useMemo<GoalOwner | null>(
    () => (form.owner_id ? { kind: form.owner_kind, id: form.owner_id } : null),
    [form.owner_kind, form.owner_id],
  );

  const ownerName = useCallback((kind: OwnerKind, id: string): string | null => (
    kind === 'team'
      ? teams.find(t => t.id === id)?.name ?? null
      : owners.find(o => o.user_id === id)?.full_name ?? null
  ), [teams, owners]);

  const loadBaseline = useCallback(async (owner: GoalOwner) => {
    setBaselineLoading(true);
    try {
      setBaseline(await fetchMarcoBaseline(owner));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao carregar o retrato do dono da meta');
      setBaseline([]);
    } finally {
      setBaselineLoading(false);
    }
  }, [fetchMarcoBaseline]);

  useEffect(() => {
    if (dialogOpen && formOwner) loadBaseline(formOwner);
    if (!formOwner) setBaseline([]);
  }, [dialogOpen, formOwner, loadBaseline]);

  const openNew = () => { setForm(emptyForm()); setBaseline([]); setDialogOpen(true); };

  const openEdit = (g: GoalGroup) => {
    const targets: Record<string, string> = {};
    g.marcos.forEach(m => {
      if (m.marco_tipo && m.target_processes != null) targets[m.marco_tipo] = String(m.target_processes);
    });
    setForm({
      owner_kind: g.owner.kind,
      owner_id: g.owner.id,
      name: g.name || '',
      period_type: g.period_type,
      period_start: g.period_start,
      period_end: g.period_end,
      targets,
      target_flow_avg_pct: g.flow?.target_flow_avg_pct != null ? String(g.flow.target_flow_avg_pct) : '',
    });
    setDialogOpen(true);
  };

  const changePeriodType = (type: GoalPeriodType) => {
    setForm(f => {
      if (type === 'custom') return { ...f, period_type: type };
      const { start, end } = periodRange(type);
      return { ...f, period_type: type, period_start: start, period_end: end };
    });
  };

  const handleSave = async () => {
    if (!formOwner) {
      toast.error(form.owner_kind === 'team' ? 'Escolha o time' : 'Escolha a pessoa');
      return;
    }
    if (form.period_end < form.period_start) { toast.error('Fim do período é anterior ao início'); return; }

    const marcos = MARCO_ORDER
      .filter(m => (form.targets[m] || '').trim() !== '')
      .map(m => ({
        marco_tipo: m,
        target_processes: Number(form.targets[m]),
        baseline_processes: baselineByMarco.get(m)?.acumulado ?? 0,
      }));

    const invalido = marcos.find(m => !Number.isFinite(m.target_processes) || m.target_processes < 0);
    if (invalido) { toast.error(`Alvo inválido em ${MARCO_LABEL[invalido.marco_tipo]}`); return; }

    // Alvo é absoluto e cumulativo: não existe processo "saindo" de um marco.
    const abaixo = marcos.find(m => m.target_processes < m.baseline_processes);
    if (abaixo) {
      toast.error(
        `${MARCO_LABEL[abaixo.marco_tipo]}: alvo (${abaixo.target_processes}) é menor que os ${abaixo.baseline_processes} já alcançados`,
      );
      return;
    }

    const pct = form.target_flow_avg_pct.trim() ? Number(form.target_flow_avg_pct) : null;
    if (pct != null && (pct < 0 || pct > 100)) { toast.error('% de fluxo precisa ficar entre 0 e 100'); return; }
    if (marcos.length === 0 && pct == null) {
      toast.error('Defina ao menos um alvo: algum marco ou o % de fluxo');
      return;
    }

    setSaving(true);
    try {
      await saveGoalSet({
        owner: formOwner,
        owner_name: ownerName(formOwner.kind, formOwner.id),
        name: form.name.trim() || null,
        period_type: form.period_type,
        period_start: form.period_start,
        period_end: form.period_end,
        marcos,
        target_flow_avg_pct: pct,
      });
      toast.success('Metas salvas');
      setDialogOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao salvar metas');
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    try {
      await deleteGoalSet(toDelete.owner, toDelete.period_start, toDelete.period_end);
      toast.success('Metas arquivadas');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao arquivar');
    } finally {
      setToDelete(null);
    }
  };

  const handleBoardTeam = async (boardId: string, value: string) => {
    try {
      await setBoardTeam(boardId, value === '__none__' ? null : value);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao mapear POP');
    }
  };

  const semMarco = useMemo(
    () => groups.some(g => (g.stats.processos_com_marco ?? 0) === 0 && g.marcos.length > 0),
    [groups],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Target className="h-5 w-5" />
          <h2 className="text-lg font-semibold">Metas Processuais</h2>
        </div>
        <Button size="sm" className="gap-1" onClick={openNew}>
          <Plus className="h-4 w-4" />
          Nova meta
        </Button>
      </div>

      {error && (
        <Card className="border-destructive/40">
          <CardContent className="flex items-start gap-2 p-4 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="break-words">{error}</span>
          </CardContent>
        </Card>
      )}

      {semMarco && (
        <Card className="border-amber-300/60 bg-amber-50/50 dark:bg-amber-950/20">
          <CardContent className="flex items-start gap-2 p-4 text-xs leading-relaxed">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <span>
              Há meta de marco cujos processos ainda não têm marco registrado. Marcos
              entram pelo sync de movimentações do Escavador — até ele cobrir o processo,
              o realizado fica em zero mesmo com trabalho feito.
            </span>
          </CardContent>
        </Card>
      )}

      {groups.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            Nenhuma meta cadastrada. Crie a primeira em "Nova meta".
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {groups.map(g => (
            <Card key={g.key}>
              <CardHeader className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <CardTitle className="flex items-center gap-1.5 break-words text-sm font-semibold">
                      {g.owner.kind === 'user'
                        ? <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        : <Users className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                      {g.owner_name || (g.owner.kind === 'user' ? 'Pessoa removida' : 'Time removido')}
                    </CardTitle>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {g.name && <span className="break-words text-xs text-muted-foreground">{g.name}</span>}
                      <Badge variant="outline" className="text-[10px]">{PERIOD_LABEL[g.period_type]}</Badge>
                      <Badge variant="secondary" className="text-[10px]">
                        {formatPeriod(g.period_start, g.period_end)}
                      </Badge>
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(g)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => setToDelete(g)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 px-4 pb-4 pt-0">
                {g.marcos.map(m => (
                  <GoalBar
                    key={m.goal_id}
                    label={MARCO_LABEL[m.marco_tipo!]}
                    done={m.realizado_processos}
                    target={m.target_processes ?? 0}
                    baseline={m.baseline_processes}
                    ganho={m.realizado_no_periodo}
                  />
                ))}
                {g.flow?.target_flow_avg_pct != null && (
                  <GoalBar
                    label="Fluxo médio concluído (hoje)"
                    done={g.flow.fluxo_medio_pct}
                    target={g.flow.target_flow_avg_pct}
                    suffix="%"
                  />
                )}
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  {g.stats.processos_no_time ?? 0} processos{' '}
                  {g.owner.kind === 'user' ? 'sob responsabilidade' : 'atribuídos ao time'} ·{' '}
                  {g.stats.processos_com_fluxo ?? 0} com passos de POP ·{' '}
                  {g.stats.processos_com_marco ?? 0} com algum marco registrado
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Mapa POP → time: fallback de atribuição quando o lead não tem responsável em time */}
      <Collapsible open={mapOpen} onOpenChange={setMapOpen}>
        <Card>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Workflow className="h-4 w-4" />
                  <CardTitle className="text-sm font-medium">POPs por time</CardTitle>
                  <Badge variant="secondary" className="text-[10px]">
                    {boards.filter(b => b.team_id).length}/{boards.length} mapeados
                  </Badge>
                </div>
                <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${mapOpen ? 'rotate-180' : ''}`} />
              </div>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="space-y-2 px-4 pb-4 pt-0">
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Processo entra na meta pelo responsável processual do lead. Sem responsável
                em time, cai no time dono do POP definido aqui. Cada POP pertence a um único time.
              </p>
              {boards.map(b => (
                <div key={b.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/40 px-2 py-1.5">
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="truncate text-sm">{b.name}</span>
                    <Badge variant="outline" className="shrink-0 text-[10px]">{b.process_count}</Badge>
                  </div>
                  <Select value={b.team_id || '__none__'} onValueChange={v => handleBoardTeam(b.id, v)}>
                    <SelectTrigger className="h-8 w-full sm:w-56"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Sem time</SelectItem>
                      {teams.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* Cadastro: todos os marcos de uma vez, com o número de hoje ao lado */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] gap-0 overflow-hidden p-0 sm:max-w-2xl">
          <DialogHeader className="border-b px-6 py-4">
            <DialogTitle>Metas processuais</DialogTitle>
          </DialogHeader>

          <ScrollArea className="max-h-[calc(90vh-9rem)]">
            <div className="space-y-4 px-6 py-4">
              {/* Trocar de tipo zera o dono: os universos de processo são diferentes,
                  e o baseline carregado não vale para o outro recorte. */}
              <div className="space-y-1">
                <Label>Meta de</Label>
                <div className="flex gap-2">
                  {(['user', 'team'] as OwnerKind[]).map(k => (
                    <Button
                      key={k}
                      type="button"
                      size="sm"
                      variant={form.owner_kind === k ? 'default' : 'outline'}
                      className="flex-1 gap-1.5"
                      onClick={() => setForm(f => (
                        f.owner_kind === k ? f : { ...f, owner_kind: k, owner_id: '' }
                      ))}
                    >
                      {k === 'user' ? <User className="h-3.5 w-3.5" /> : <Users className="h-3.5 w-3.5" />}
                      {OWNER_LABEL[k]}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label>{OWNER_LABEL[form.owner_kind]} *</Label>
                  <Select value={form.owner_id} onValueChange={v => setForm(f => ({ ...f, owner_id: v }))}>
                    <SelectTrigger>
                      <SelectValue placeholder={form.owner_kind === 'team' ? 'Escolha o time' : 'Escolha a pessoa'} />
                    </SelectTrigger>
                    <SelectContent>
                      {form.owner_kind === 'team'
                        ? teams.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)
                        : owners.map(o => (
                          <SelectItem key={o.user_id} value={o.user_id}>
                            {o.full_name} · {o.processos} proc. ({o.processos_com_marco} c/ marco)
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Nome da meta</Label>
                  <Input
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="Ex: Metas de agosto"
                  />
                </div>
              </div>

              <p className="text-[11px] leading-relaxed text-muted-foreground">
                {form.owner_kind === 'user'
                  ? 'Processo entra pela responsabilidade: o responsável do próprio processo e, na falta dele, o responsável processual do lead. Processo sem responsável não entra em meta individual.'
                  : 'Processo entra pelo responsável processual do lead que esteja no time; sem isso, pelo time dono do POP. Só a meta de time alcança processos sem responsável.'}
              </p>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label>Período</Label>
                  <Select value={form.period_type} onValueChange={v => changePeriodType(v as GoalPeriodType)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(Object.keys(PERIOD_LABEL) as GoalPeriodType[]).map(k => (
                        <SelectItem key={k} value={k}>{PERIOD_LABEL[k]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <DateField
                  label="Início"
                  value={form.period_start}
                  onChange={v => setForm(f => ({ ...f, period_start: v, period_type: 'custom' }))}
                />
                <DateField
                  label="Fim"
                  value={form.period_end}
                  onChange={v => setForm(f => ({ ...f, period_end: v, period_type: 'custom' }))}
                />
              </div>

              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Label>Marcos processuais</Label>
                  {baselineLoading
                    ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    : formOwner && (
                      <span className="text-[11px] text-muted-foreground">
                        {totalNoDono} processos já têm marco
                      </span>
                    )}
                </div>

                {!formOwner ? (
                  <p className="rounded-md bg-muted/40 px-3 py-4 text-center text-xs text-muted-foreground">
                    Escolha {form.owner_kind === 'team' ? 'o time' : 'a pessoa'} para ver quantos
                    processos já estão em cada marco.
                  </p>
                ) : (
                  <div className="overflow-hidden rounded-md border">
                    <div className="grid grid-cols-[1fr_4.5rem_5rem_6rem] items-center gap-2 border-b bg-muted/50 px-3 py-2 text-[11px] font-medium text-muted-foreground">
                      <span>Marco</span>
                      <span className="text-right">Até hoje</span>
                      <span className="text-right">Atualmente</span>
                      <span className="text-right">Meta</span>
                    </div>
                    {MARCO_ORDER.map(m => {
                      const b = baselineByMarco.get(m);
                      const acumulado = b?.acumulado ?? 0;
                      const atual = b?.atual ?? 0;
                      return (
                        <div
                          key={m}
                          className="grid grid-cols-[1fr_4.5rem_5rem_6rem] items-center gap-2 border-b px-3 py-1.5 last:border-b-0"
                        >
                          <span className="truncate text-sm">{MARCO_LABEL[m]}</span>
                          <CountButton
                            value={acumulado}
                            onClick={() => formOwner && setDrill({
                              owner: formOwner, marco: m, marcoLabel: MARCO_LABEL[m],
                              modo: 'acumulado', esperado: acumulado,
                            })}
                          />
                          <CountButton
                            value={atual}
                            muted
                            onClick={() => formOwner && setDrill({
                              owner: formOwner, marco: m, marcoLabel: MARCO_LABEL[m],
                              modo: 'atual', esperado: atual,
                            })}
                          />
                          <Input
                            type="number"
                            min={acumulado}
                            className="h-8 text-right"
                            value={form.targets[m] ?? ''}
                            onChange={e => setForm(f => ({ ...f, targets: { ...f.targets, [m]: e.target.value } }))}
                            placeholder="—"
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  <strong>Até hoje</strong> = processos que já passaram pelo marco (é daí que a barra parte).
                  <strong> Atualmente</strong> = aqueles em que esse é o marco mais recente, ou seja, onde o
                  processo está agora. Clique em qualquer número para ver a lista dos processos. Deixe a
                  meta em branco nos marcos que não quer acompanhar.
                </p>
              </div>

              <div className="space-y-1">
                <Label>Fluxo médio do POP (%)</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={form.target_flow_avg_pct}
                  onChange={e => setForm(f => ({ ...f, target_flow_avg_pct: e.target.value }))}
                  placeholder="Ex: 60"
                />
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Média do percentual de passos do POP concluídos nos processos{' '}
                  {form.owner_kind === 'user' ? 'da pessoa' : 'do time'} — leitura do estado
                  atual, não do período.
                </p>
              </div>
            </div>
          </ScrollArea>

          <DialogFooter className="border-t px-6 py-3">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <TeamMarcoProcessosSheet
        drill={drill}
        onClose={() => setDrill(null)}
        fetchMarcoProcessos={fetchMarcoProcessos}
      />

      <AlertDialog open={!!toDelete} onOpenChange={open => !open && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Arquivar as metas deste período?</AlertDialogTitle>
            <AlertDialogDescription>
              Todos os marcos de {toDelete?.owner_name || 'dono removido'} em{' '}
              {toDelete && formatPeriod(toDelete.period_start, toDelete.period_end)} saem do
              painel. Os registros ficam preservados no histórico.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>Arquivar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
