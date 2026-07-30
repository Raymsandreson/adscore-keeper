// =============================================================================
// Metas processuais por time: cadastro (time + período + marco alvo + % médio de
// fluxo do POP) e painel realizado × meta.
//
// Duas leituras diferentes convivem aqui, de propósito:
//   - marco alvo  → conta processos que ATINGIRAM o marco DENTRO do período;
//   - % de fluxo  → média dos passos do POP concluídos, foto do estado ATUAL
//                   (checklist não guarda data por item, não dá pra recortar).
// =============================================================================
import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Plus, Trash2, Pencil, Loader2, Target, ChevronDown, AlertTriangle, Workflow } from 'lucide-react';
import { toast } from 'sonner';
import { useTeamProcessGoals, TeamProcessGoalProgress, GoalPeriodType } from '@/hooks/useTeamProcessGoals';
import type { MarcoTipo } from '@/hooks/useProcessMovements';

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

const ANY_MARCO = '__any__';

function iso(d: Date) {
  return d.toISOString().slice(0, 10);
}

/** Primeiro e último dia do período corrente, conforme o tipo escolhido. */
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
  const fmt = (s: string) => s.split('-').reverse().slice(0, 2).join('/');
  return `${fmt(start)} → ${fmt(end)}`;
}

interface FormState {
  id?: string;
  team_id: string;
  name: string;
  period_type: GoalPeriodType;
  period_start: string;
  period_end: string;
  marco_tipo: string;
  target_processes: string;
  target_flow_avg_pct: string;
}

function emptyForm(): FormState {
  const { start, end } = periodRange('monthly');
  return {
    team_id: '', name: '', period_type: 'monthly', period_start: start, period_end: end,
    marco_tipo: ANY_MARCO, target_processes: '', target_flow_avg_pct: '',
  };
}

/** Barra de um alvo (realizado × meta) com rótulo sempre legível acima da barra. */
function GoalBar({ label, done, target, suffix = '' }: {
  label: string; done: number | null; target: number; suffix?: string;
}) {
  const value = done ?? 0;
  const pct = target > 0 ? Math.min(100, (value / target) * 100) : 0;
  const hit = value >= target;
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className={hit ? 'font-semibold text-emerald-600' : 'font-medium'}>
          {value.toLocaleString('pt-BR')}{suffix} / {target.toLocaleString('pt-BR')}{suffix}
        </span>
      </div>
      <Progress value={pct} className="h-2" />
    </div>
  );
}

function GoalCard({ goal, onEdit, onDelete }: {
  goal: TeamProcessGoalProgress;
  onEdit: (g: TeamProcessGoalProgress) => void;
  onDelete: (g: TeamProcessGoalProgress) => void;
}) {
  return (
    <Card>
      <CardHeader className="py-3 px-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <CardTitle className="text-sm font-semibold break-words">
              {goal.team_name || 'Time removido'}
            </CardTitle>
            <div className="flex flex-wrap items-center gap-1.5">
              {goal.name && <span className="text-xs text-muted-foreground break-words">{goal.name}</span>}
              <Badge variant="outline" className="text-[10px]">{PERIOD_LABEL[goal.period_type]}</Badge>
              <Badge variant="secondary" className="text-[10px]">
                {formatPeriod(goal.period_start, goal.period_end)}
              </Badge>
              <Badge variant="outline" className="text-[10px]">
                {goal.marco_tipo ? MARCO_LABEL[goal.marco_tipo] : 'Qualquer marco'}
              </Badge>
            </div>
          </div>
          <div className="flex shrink-0 gap-1">
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => onEdit(goal)}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => onDelete(goal)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 px-4 pb-4 pt-0">
        {goal.target_processes != null && (
          <GoalBar label="Processos no marco (no período)" done={goal.realizado_processos} target={goal.target_processes} />
        )}
        {goal.target_flow_avg_pct != null && (
          <GoalBar
            label="Fluxo médio concluído (hoje)"
            done={goal.fluxo_medio_pct}
            target={goal.target_flow_avg_pct}
            suffix="%"
          />
        )}
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {goal.processos_no_time ?? 0} processos atribuídos ao time ·{' '}
          {goal.processos_com_fluxo ?? 0} com passos de POP ·{' '}
          {goal.processos_com_marco ?? 0} com algum marco registrado
        </p>
      </CardContent>
    </Card>
  );
}

export function TeamProcessGoals() {
  const { goals, teams, boards, loading, error, saveGoal, deleteGoal, setBoardTeam } = useTeamProcessGoals();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState<TeamProcessGoalProgress | null>(null);
  const [mapOpen, setMapOpen] = useState(false);

  const semMarco = useMemo(
    () => goals.some(g => (g.processos_com_marco ?? 0) === 0 && (g.target_processes ?? 0) > 0),
    [goals],
  );

  const openNew = () => { setForm(emptyForm()); setDialogOpen(true); };

  const openEdit = (g: TeamProcessGoalProgress) => {
    setForm({
      id: g.goal_id,
      team_id: g.team_id,
      name: g.name || '',
      period_type: g.period_type,
      period_start: g.period_start,
      period_end: g.period_end,
      marco_tipo: g.marco_tipo || ANY_MARCO,
      target_processes: g.target_processes != null ? String(g.target_processes) : '',
      target_flow_avg_pct: g.target_flow_avg_pct != null ? String(g.target_flow_avg_pct) : '',
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
    if (!form.team_id) { toast.error('Escolha o time'); return; }
    const qtd = form.target_processes.trim() ? Number(form.target_processes) : null;
    const pct = form.target_flow_avg_pct.trim() ? Number(form.target_flow_avg_pct) : null;
    if (qtd == null && pct == null) { toast.error('Defina ao menos um alvo: quantidade ou % de fluxo'); return; }
    if (pct != null && (pct < 0 || pct > 100)) { toast.error('% de fluxo precisa ficar entre 0 e 100'); return; }
    if (form.period_end < form.period_start) { toast.error('Fim do período é anterior ao início'); return; }

    setSaving(true);
    try {
      await saveGoal({
        id: form.id,
        team_id: form.team_id,
        team_name: teams.find(t => t.id === form.team_id)?.name || null,
        name: form.name.trim() || null,
        period_type: form.period_type,
        period_start: form.period_start,
        period_end: form.period_end,
        marco_tipo: form.marco_tipo === ANY_MARCO ? null : (form.marco_tipo as MarcoTipo),
        target_processes: qtd,
        target_flow_avg_pct: pct,
      });
      toast.success(form.id ? 'Meta atualizada' : 'Meta criada');
      setDialogOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao salvar meta');
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    try {
      await deleteGoal(toDelete.goal_id);
      toast.success('Meta arquivada');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao arquivar meta');
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
          <h2 className="text-lg font-semibold">Metas Processuais por Time</h2>
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
              Há meta de marco em time cujos processos ainda não têm marco registrado.
              Marcos entram pelo sync de movimentações do Escavador — até ele cobrir o
              processo, o realizado fica em zero mesmo com trabalho feito.
            </span>
          </CardContent>
        </Card>
      )}

      {goals.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            Nenhuma meta cadastrada. Crie a primeira em "Nova meta".
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {goals.map(g => (
            <GoalCard key={g.goal_id} goal={g} onEdit={openEdit} onDelete={setToDelete} />
          ))}
        </div>
      )}

      {/* Mapa POP → time: fallback de atribuição quando o lead não tem responsável em time */}
      <Collapsible open={mapOpen} onOpenChange={setMapOpen}>
        <Card>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer py-3 px-4">
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

      {/* Cadastro / edição */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{form.id ? 'Editar meta' : 'Nova meta processual'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Time *</Label>
              <Select value={form.team_id} onValueChange={v => setForm(f => ({ ...f, team_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Escolha o time" /></SelectTrigger>
                <SelectContent>
                  {teams.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Nome da meta</Label>
              <Input
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Ex: Audiências de conciliação de agosto"
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
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
              <div>
                <Label>Início</Label>
                <Input
                  type="date"
                  value={form.period_start}
                  onChange={e => setForm(f => ({ ...f, period_start: e.target.value, period_type: 'custom' }))}
                />
              </div>
              <div>
                <Label>Fim</Label>
                <Input
                  type="date"
                  value={form.period_end}
                  onChange={e => setForm(f => ({ ...f, period_end: e.target.value, period_type: 'custom' }))}
                />
              </div>
            </div>

            <div>
              <Label>Marco alvo</Label>
              <Select value={form.marco_tipo} onValueChange={v => setForm(f => ({ ...f, marco_tipo: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY_MARCO}>Qualquer marco</SelectItem>
                  {MARCO_ORDER.map(m => <SelectItem key={m} value={m}>{MARCO_LABEL[m]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Processos no marco</Label>
                <Input
                  type="number"
                  min={0}
                  value={form.target_processes}
                  onChange={e => setForm(f => ({ ...f, target_processes: e.target.value }))}
                  placeholder="Ex: 20"
                />
              </div>
              <div>
                <Label>Fluxo médio (%)</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={form.target_flow_avg_pct}
                  onChange={e => setForm(f => ({ ...f, target_flow_avg_pct: e.target.value }))}
                  placeholder="Ex: 60"
                />
              </div>
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Preencha ao menos um dos dois alvos. O fluxo médio é a média do percentual
              de passos do POP concluídos nos processos do time — leitura do estado atual,
              não do período.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!toDelete} onOpenChange={open => !open && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Arquivar meta?</AlertDialogTitle>
            <AlertDialogDescription>
              A meta de {toDelete?.team_name || 'time removido'} sai do painel, mas o
              registro é preservado no histórico.
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
