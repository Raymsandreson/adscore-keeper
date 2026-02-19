import { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Settings2, RotateCcw, Save, Plus, Trash2, Search, SlidersHorizontal, X } from 'lucide-react';

export interface TimeBlockConfig {
  activityType: string;
  days: number[]; // 0=Mon, 1=Tue, 2=Wed, 3=Thu, 4=Fri
  startHour: number;
  endHour: number;
  color: string;
  label: string;
  isCustom?: boolean;
}

const WEEK_DAYS = [
  { label: 'SEG', idx: 0 },
  { label: 'TER', idx: 1 },
  { label: 'QUA', idx: 2 },
  { label: 'QUI', idx: 3 },
  { label: 'SEX', idx: 4 },
];

const HOURS = Array.from({ length: 13 }, (_, i) => i + 7); // 7h to 19h

const DEFAULT_ACTIVITY_TYPES = [
  { value: 'tarefa', label: 'Tarefa', color: 'bg-blue-500', defaultDays: [0,1,2,3,4], defaultStart: 9, defaultEnd: 12 },
  { value: 'audiencia', label: 'Audiência', color: 'bg-green-500', defaultDays: [1,3], defaultStart: 9, defaultEnd: 11 },
  { value: 'prazo', label: 'Prazo', color: 'bg-yellow-500', defaultDays: [0,2,4], defaultStart: 8, defaultEnd: 10 },
  { value: 'acompanhamento', label: 'Acompanhamento', color: 'bg-purple-500', defaultDays: [0,2,4], defaultStart: 14, defaultEnd: 17 },
  { value: 'reuniao', label: 'Reunião', color: 'bg-pink-500', defaultDays: [1,3], defaultStart: 13, defaultEnd: 15 },
  { value: 'diligencia', label: 'Diligência', color: 'bg-orange-500', defaultDays: [2,4], defaultStart: 10, defaultEnd: 12 },
];

const COLOR_OPTIONS = [
  { value: 'bg-blue-500', label: 'Azul' },
  { value: 'bg-green-500', label: 'Verde' },
  { value: 'bg-yellow-500', label: 'Amarelo' },
  { value: 'bg-purple-500', label: 'Roxo' },
  { value: 'bg-pink-500', label: 'Rosa' },
  { value: 'bg-orange-500', label: 'Laranja' },
  { value: 'bg-red-500', label: 'Vermelho' },
  { value: 'bg-teal-500', label: 'Teal' },
  { value: 'bg-indigo-500', label: 'Índigo' },
  { value: 'bg-cyan-500', label: 'Ciano' },
  { value: 'bg-emerald-500', label: 'Esmeralda' },
  { value: 'bg-rose-500', label: 'Rosa escuro' },
];

const STORAGE_KEY = 'timeblock_settings_v1';

export const getDefaultTimeBlockConfigs = (): TimeBlockConfig[] =>
  DEFAULT_ACTIVITY_TYPES.map(t => ({
    activityType: t.value,
    label: t.label,
    color: t.color,
    days: t.defaultDays,
    startHour: t.defaultStart,
    endHour: t.defaultEnd,
    isCustom: false,
  }));

export const loadTimeBlockConfigs = (): TimeBlockConfig[] => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch {}
  return getDefaultTimeBlockConfigs();
};

export const saveTimeBlockConfigs = (configs: TimeBlockConfig[]) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(configs));
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  configs: TimeBlockConfig[];
  onSave: (configs: TimeBlockConfig[]) => void;
}

export function TimeBlockSettingsDialog({ open, onOpenChange, configs, onSave }: Props) {
  const [local, setLocal] = useState<TimeBlockConfig[]>(configs);
  const [newLabel, setNewLabel] = useState('');
  const [newColor, setNewColor] = useState('bg-teal-500');
  const [showAddForm, setShowAddForm] = useState(false);
  const [search, setSearch] = useState('');
  const [showTypeSelector, setShowTypeSelector] = useState(false);
  // which types are currently "active" (shown in list). Default: all
  const [activeTypes, setActiveTypes] = useState<Set<string>>(() => new Set(configs.map(c => c.activityType)));

  useEffect(() => {
    if (!open) return;
    setLocal(configs);
    setActiveTypes(new Set(configs.map(c => c.activityType)));
    setShowAddForm(false);
    setSearch('');
    setShowTypeSelector(false);
    setNewLabel('');
  }, [configs, open]);

  const visibleConfigs = useMemo(() => {
    return local.filter(c => {
      const matchesActive = activeTypes.has(c.activityType);
      const matchesSearch = c.label.toLowerCase().includes(search.toLowerCase());
      return matchesActive && matchesSearch;
    });
  }, [local, activeTypes, search]);

  const updateConfig = (type: string, patch: Partial<TimeBlockConfig>) => {
    setLocal(prev => prev.map(c => c.activityType === type ? { ...c, ...patch } : c));
  };

  const toggleDay = (type: string, dayIdx: number) => {
    const cfg = local.find(c => c.activityType === type);
    if (!cfg) return;
    const days = cfg.days.includes(dayIdx)
      ? cfg.days.filter(d => d !== dayIdx)
      : [...cfg.days, dayIdx].sort();
    updateConfig(type, { days });
  };

  const toggleTypeActive = (type: string) => {
    setActiveTypes(prev => {
      const next = new Set(prev);
      if (next.has(type)) { next.delete(type); } else { next.add(type); }
      return next;
    });
  };

  const selectAllTypes = () => setActiveTypes(new Set(local.map(c => c.activityType)));
  const clearAllTypes = () => setActiveTypes(new Set());

  const handleAddCustom = () => {
    const trimmed = newLabel.trim();
    if (!trimmed) return;
    const key = `custom_${Date.now()}`;
    const newCfg: TimeBlockConfig = {
      activityType: key,
      label: trimmed,
      color: newColor,
      days: [0, 1, 2, 3, 4],
      startHour: 9,
      endHour: 11,
      isCustom: true,
    };
    setLocal(prev => [...prev, newCfg]);
    setActiveTypes(prev => new Set([...prev, key]));
    setNewLabel('');
    setNewColor('bg-teal-500');
    setShowAddForm(false);
  };

  const handleRemoveCustom = (type: string) => {
    setLocal(prev => prev.filter(c => c.activityType !== type));
    setActiveTypes(prev => { const next = new Set(prev); next.delete(type); return next; });
  };

  const handleReset = () => setLocal(getDefaultTimeBlockConfigs());

  const handleSave = () => {
    onSave(local);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="h-4 w-4" />
            Configurar Blocos de Tempo
          </DialogTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Defina em quais dias e horários cada tipo de atividade deve aparecer na grade semanal.
          </p>
        </DialogHeader>

        {/* Search + type selector bar */}
        <div className="flex items-center gap-2 mt-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Filtrar por nome..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-8 h-8 text-sm"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <Button
            variant={showTypeSelector ? 'secondary' : 'outline'}
            size="sm"
            onClick={() => setShowTypeSelector(v => !v)}
            className="gap-1.5 shrink-0"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Selecionar tipos
            {activeTypes.size < local.length && (
              <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-[10px]">
                {activeTypes.size}/{local.length}
              </Badge>
            )}
          </Button>
        </div>

        {/* Type selector panel */}
        {showTypeSelector && (
          <div className="rounded-lg border p-3 bg-muted/10 space-y-2">
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Tipos visíveis</p>
              <div className="flex gap-1.5">
                <button onClick={selectAllTypes} className="text-[11px] text-primary hover:underline">Todos</button>
                <span className="text-muted-foreground text-[11px]">·</span>
                <button onClick={clearAllTypes} className="text-[11px] text-muted-foreground hover:underline">Nenhum</button>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {local.map(c => (
                <button
                  key={c.activityType}
                  onClick={() => toggleTypeActive(c.activityType)}
                  className={cn(
                    'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all',
                    activeTypes.has(c.activityType)
                      ? `${c.color} text-white border-transparent`
                      : 'bg-muted/30 text-muted-foreground border-border hover:bg-muted/50'
                  )}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-5 mt-1">
          {visibleConfigs.length === 0 && (
            <div className="text-center py-8 text-sm text-muted-foreground">
              Nenhum tipo encontrado. Ajuste o filtro ou a seleção.
            </div>
          )}
          {visibleConfigs.map((cfg) => (
            <div key={cfg.activityType} className="rounded-lg border p-4 space-y-3">
              {/* Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {cfg.isCustom ? (
                    /* Color picker for custom types */
                    <div className="flex items-center gap-1.5">
                      <span className={cn('h-3 w-3 rounded-full shrink-0', cfg.color)} />
                      <div className="flex gap-1">
                        {COLOR_OPTIONS.map(c => (
                          <button
                            key={c.value}
                            onClick={() => updateConfig(cfg.activityType, { color: c.value })}
                            className={cn(
                              'h-4 w-4 rounded-full border-2 transition-all',
                              c.value,
                              cfg.color === c.value ? 'border-foreground scale-110' : 'border-transparent'
                            )}
                            title={c.label}
                          />
                        ))}
                      </div>
                    </div>
                  ) : (
                    <span className={cn('h-3 w-3 rounded-full shrink-0', cfg.color)} />
                  )}
                  {cfg.isCustom ? (
                    <Input
                      value={cfg.label}
                      onChange={e => updateConfig(cfg.activityType, { label: e.target.value })}
                      className="h-7 text-sm font-semibold w-40"
                    />
                  ) : (
                    <span className="font-semibold text-sm">{cfg.label}</span>
                  )}
                </div>
                {cfg.isCustom && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => handleRemoveCustom(cfg.activityType)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>

              {/* Days selector */}
              <div>
                <p className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wide">Dias da semana</p>
                <div className="flex gap-1.5">
                  {WEEK_DAYS.map(d => (
                    <button
                      key={d.idx}
                      onClick={() => toggleDay(cfg.activityType, d.idx)}
                      className={cn(
                        'h-8 w-10 rounded-md text-xs font-bold border transition-all',
                        cfg.days.includes(d.idx)
                          ? `${cfg.color} text-white border-transparent`
                          : 'bg-muted/30 text-muted-foreground border-border hover:bg-muted/60'
                      )}
                    >
                      {d.label}
                    </button>
                  ))}
                  <button
                    onClick={() => {
                      const allActive = WEEK_DAYS.every(d => cfg.days.includes(d.idx));
                      updateConfig(cfg.activityType, { days: allActive ? [] : WEEK_DAYS.map(d => d.idx) });
                    }}
                    className="h-8 px-2 rounded-md text-[10px] font-medium border border-dashed border-muted-foreground/40 text-muted-foreground hover:bg-muted/30 transition-all"
                  >
                    {WEEK_DAYS.every(d => cfg.days.includes(d.idx)) ? 'Nenhum' : 'Todos'}
                  </button>
                </div>
              </div>

              {/* Time range */}
              <div>
                <p className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wide">Bloco de horário</p>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">De</span>
                    <select
                      value={cfg.startHour}
                      onChange={e => {
                        const v = Number(e.target.value);
                        updateConfig(cfg.activityType, { startHour: v, endHour: Math.max(cfg.endHour, v + 1) });
                      }}
                      className="h-8 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    >
                      {HOURS.map(h => (
                        <option key={h} value={h}>{h}:00</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">até</span>
                    <select
                      value={cfg.endHour}
                      onChange={e => {
                        const v = Number(e.target.value);
                        updateConfig(cfg.activityType, { endHour: Math.max(v, cfg.startHour + 1) });
                      }}
                      className="h-8 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    >
                      {HOURS.filter(h => h > cfg.startHour).map(h => (
                        <option key={h} value={h}>{h}:00</option>
                      ))}
                    </select>
                  </div>
                  {/* Mini preview bar */}
                  <div className="flex-1 relative h-6 bg-muted/30 rounded-full overflow-hidden">
                    {(() => {
                      const totalHours = HOURS[HOURS.length - 1] - HOURS[0];
                      const startPct = ((cfg.startHour - HOURS[0]) / totalHours) * 100;
                      const widthPct = ((cfg.endHour - cfg.startHour) / totalHours) * 100;
                      return (
                        <div
                          className={cn('absolute top-0 bottom-0 rounded-full opacity-70', cfg.color)}
                          style={{ left: `${startPct}%`, width: `${widthPct}%` }}
                        />
                      );
                    })()}
                    <div className="absolute inset-0 flex items-center px-2">
                      <span className="text-[9px] text-muted-foreground font-medium">
                        {cfg.startHour}h – {cfg.endHour}h ({cfg.endHour - cfg.startHour}h)
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {cfg.days.length === 0 && (
                <p className="text-[11px] text-destructive">⚠️ Nenhum dia selecionado — este tipo não aparecerá na grade</p>
              )}
            </div>
          ))}

          {/* Add custom type */}
          {showAddForm ? (
            <div className="rounded-lg border border-dashed p-4 space-y-3 bg-muted/10">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Novo tipo de atividade</p>
              <div className="flex items-center gap-3">
                <Input
                  placeholder="Nome do tipo (ex: Perícia, Triagem...)"
                  value={newLabel}
                  onChange={e => setNewLabel(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAddCustom()}
                  className="flex-1"
                  autoFocus
                />
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-2">Cor</p>
                <div className="flex flex-wrap gap-2">
                  {COLOR_OPTIONS.map(c => (
                    <button
                      key={c.value}
                      onClick={() => setNewColor(c.value)}
                      className={cn(
                        'h-6 w-6 rounded-full border-2 transition-all',
                        c.value,
                        newColor === c.value ? 'border-foreground scale-110' : 'border-transparent hover:border-muted-foreground/50'
                      )}
                      title={c.label}
                    />
                  ))}
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <Button size="sm" onClick={handleAddCustom} disabled={!newLabel.trim()} className="gap-1.5">
                  <Plus className="h-3.5 w-3.5" />
                  Adicionar
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setShowAddForm(false); setNewLabel(''); }}>
                  Cancelar
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowAddForm(true)}
              className="w-full gap-2 border-dashed"
            >
              <Plus className="h-4 w-4" />
              Adicionar tipo personalizado
            </Button>
          )}
        </div>

        {/* Visual preview mini-grid */}
        <div className="mt-4 rounded-lg border p-3 bg-muted/20">
          <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-3">Prévia da grade semanal</p>
          <div className="grid grid-cols-5 gap-1">
            {WEEK_DAYS.map(d => (
              <div key={d.idx} className="space-y-1">
                <div className="text-center text-[10px] font-bold text-muted-foreground">{d.label}</div>
                {local.filter(c => c.days.includes(d.idx)).map(c => (
                  <div
                    key={c.activityType}
                    className={cn('rounded px-1.5 py-1 text-[9px] text-white font-bold', c.color)}
                  >
                    <div className="truncate">{c.label.slice(0, 6)}</div>
                    <div className="opacity-80">{c.startHour}h-{c.endHour}h</div>
                  </div>
                ))}
                {local.filter(c => c.days.includes(d.idx)).length === 0 && (
                  <div className="rounded border border-dashed border-muted-foreground/20 h-8 flex items-center justify-center">
                    <span className="text-[9px] text-muted-foreground/40">vazio</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <Separator />
        <div className="flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={handleReset} className="gap-1.5 text-muted-foreground">
            <RotateCcw className="h-3.5 w-3.5" />
            Restaurar padrões
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button size="sm" onClick={handleSave} className="gap-1.5">
              <Save className="h-3.5 w-3.5" />
              Salvar configuração
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
