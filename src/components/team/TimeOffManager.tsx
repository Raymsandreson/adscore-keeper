import { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { CalendarOff, Loader2, Plus, Trash2, Palmtree, Clock3, Coffee } from 'lucide-react';
import { toast } from 'sonner';
import { externalSupabase, ensureExternalSession } from '@/integrations/supabase/external-client';
import { useProfilesList } from '@/hooks/useProfilesList';
import { useAuthContext } from '@/contexts/AuthContext';
import { filterAssignableMembers } from '@/lib/assigneeBlocklist';
import {
  TIME_OFF_TYPE_LABELS,
  formatBrDate,
  type TimeOffEntry,
  type TimeOffType,
} from '@/lib/timeOff';
import { cn } from '@/lib/utils';

const TYPE_META: Record<TimeOffType, { icon: React.ElementType; badge: string }> = {
  ferias: { icon: Palmtree, badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400' },
  compensacao: { icon: Clock3, badge: 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400' },
  folga: { icon: Coffee, badge: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400' },
};

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Aba "Férias" da Gestão de Equipe — previsão de ausências (férias, compensação
 * de horas, folga) por pessoa. O sistema usa esses períodos para NÃO deixar
 * criar/reatribuir atividade com prazo dentro da ausência do responsável
 * (bloqueio em useLeadActivities + aviso no formulário de atividade).
 */
export function TimeOffManager() {
  const profilesList = useProfilesList();
  const { user } = useAuthContext();
  const [entries, setEntries] = useState<TimeOffEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Form
  const [formUserId, setFormUserId] = useState('');
  const [formType, setFormType] = useState<TimeOffType>('ferias');
  const [formStart, setFormStart] = useState('');
  const [formEnd, setFormEnd] = useState('');
  const [formNote, setFormNote] = useState('');

  const people = useMemo(
    () => filterAssignableMembers(profilesList.map(p => ({ user_id: p.user_id, full_name: p.full_name, email: p.email })))
      .sort((a, b) => (a.full_name || a.email || '').localeCompare(b.full_name || b.email || '', 'pt-BR', { sensitivity: 'base' })),
    [profilesList],
  );

  const fetchEntries = useCallback(async () => {
    try {
      await ensureExternalSession();
      const { data, error } = await (externalSupabase as any)
        .from('member_time_off')
        .select('*')
        .order('start_date', { ascending: true });
      if (error) throw error;
      setEntries((data || []) as TimeOffEntry[]);
    } catch (e) {
      console.error('[TimeOffManager] Falha ao carregar ausências:', e);
      toast.error('Erro ao carregar as ausências');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);

  const handleAdd = async () => {
    if (!formUserId) { toast.error('Selecione a pessoa'); return; }
    if (!formStart || !formEnd) { toast.error('Informe início e fim do período'); return; }
    if (formEnd < formStart) { toast.error('O fim do período não pode ser antes do início'); return; }
    setSaving(true);
    try {
      await ensureExternalSession();
      const person = people.find(p => p.user_id === formUserId);
      const { error } = await (externalSupabase as any).from('member_time_off').insert({
        user_id: formUserId,
        user_name: person?.full_name || person?.email || null,
        type: formType,
        start_date: formStart,
        end_date: formEnd,
        note: formNote.trim() || null,
        created_by: user?.id || null,
      });
      if (error) throw error;
      toast.success(`${TIME_OFF_TYPE_LABELS[formType]} registrada para ${person?.full_name || 'a pessoa'}`);
      setFormStart(''); setFormEnd(''); setFormNote('');
      fetchEntries();
    } catch (e: any) {
      console.error('[TimeOffManager] Falha ao salvar:', e);
      toast.error(e?.message || 'Erro ao registrar a ausência');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (entry: TimeOffEntry) => {
    try {
      await ensureExternalSession();
      const { error } = await (externalSupabase as any)
        .from('member_time_off')
        .delete()
        .eq('id', entry.id);
      if (error) throw error;
      toast.success('Ausência removida');
      setEntries(prev => prev.filter(e => e.id !== entry.id));
    } catch (e: any) {
      console.error('[TimeOffManager] Falha ao remover:', e);
      toast.error('Erro ao remover a ausência');
    }
  };

  const today = todayISO();
  const current = entries.filter(e => e.start_date <= today && e.end_date >= today);
  const upcoming = entries.filter(e => e.start_date > today);
  const past = entries.filter(e => e.end_date < today);

  const renderEntry = (entry: TimeOffEntry, dimmed = false) => {
    const meta = TYPE_META[entry.type] || TYPE_META.folga;
    const Icon = meta.icon;
    return (
      <div key={entry.id} className={cn('flex items-center justify-between gap-2 p-2 rounded-md bg-muted/50', dimmed && 'opacity-60')}>
        <div className="flex items-center gap-2 min-w-0">
          <div className={cn('h-7 w-7 rounded-full flex items-center justify-center shrink-0', meta.badge)}>
            <Icon className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0">
            <span className="text-sm font-medium block truncate">{entry.user_name || 'Sem nome'}</span>
            <span className="text-xs text-muted-foreground">
              {TIME_OFF_TYPE_LABELS[entry.type] || entry.type}
              {' · '}
              {entry.start_date === entry.end_date
                ? formatBrDate(entry.start_date)
                : `${formatBrDate(entry.start_date)} — ${formatBrDate(entry.end_date)}`}
              {entry.note ? ` · ${entry.note}` : ''}
            </span>
          </div>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0">
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remover esta ausência?</AlertDialogTitle>
              <AlertDialogDescription>
                {entry.user_name || 'A pessoa'} voltará a poder receber atividades neste período.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={() => handleDelete(entry)}>Remover</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <CalendarOff className="h-5 w-5 text-primary" /> Férias, compensação e folgas
        </h3>
        <p className="text-sm text-muted-foreground">
          Registre a previsão de ausência de cada pessoa. O sistema não deixa criar
          atividade com prazo dentro do período registrado do responsável.
        </p>
      </div>

      {/* Registrar nova ausência */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Plus className="h-4 w-4" /> Registrar ausência
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="lg:col-span-2">
              <Label className="text-xs">Pessoa</Label>
              <Select value={formUserId} onValueChange={setFormUserId}>
                <SelectTrigger className="h-9 mt-1">
                  <SelectValue placeholder="Selecionar pessoa" />
                </SelectTrigger>
                <SelectContent>
                  {people.map(p => (
                    <SelectItem key={p.user_id} value={p.user_id}>
                      {p.full_name || p.email || 'Sem nome'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Tipo</Label>
              <Select value={formType} onValueChange={v => setFormType(v as TimeOffType)}>
                <SelectTrigger className="h-9 mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(TIME_OFF_TYPE_LABELS) as TimeOffType[]).map(t => (
                    <SelectItem key={t} value={t}>{TIME_OFF_TYPE_LABELS[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Início</Label>
              <Input type="date" value={formStart} onChange={e => setFormStart(e.target.value)} className="h-9 mt-1" />
            </div>
            <div>
              <Label className="text-xs">Fim</Label>
              <Input type="date" value={formEnd} onChange={e => setFormEnd(e.target.value)} className="h-9 mt-1" />
            </div>
            <div className="sm:col-span-2 lg:col-span-4">
              <Label className="text-xs">Observação (opcional)</Label>
              <Input value={formNote} onChange={e => setFormNote(e.target.value)} placeholder="Ex.: férias aprovadas pela diretoria" className="h-9 mt-1" />
            </div>
            <div className="flex items-end">
              <Button onClick={handleAdd} disabled={saving} className="w-full h-9">
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
                Registrar
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Em andamento hoje */}
      {current.length > 0 && (
        <Card className="border-amber-300 dark:border-amber-800">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              Ausentes hoje <Badge variant="secondary">{current.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {current.map(e => renderEntry(e))}
          </CardContent>
        </Card>
      )}

      {/* Previstas */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            Previstas <Badge variant="secondary">{upcoming.length}</Badge>
          </CardTitle>
          <CardDescription>Ausências futuras já registradas.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {upcoming.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-2">Nenhuma ausência prevista.</p>
          ) : (
            upcoming.map(e => renderEntry(e))
          )}
        </CardContent>
      </Card>

      {/* Encerradas */}
      {past.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2 text-muted-foreground">
              Encerradas <Badge variant="secondary">{past.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {past.slice(-20).reverse().map(e => renderEntry(e, true))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
