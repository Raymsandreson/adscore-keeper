import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { Settings2, RotateCcw, Save } from 'lucide-react';

export interface TimeBlockConfig {
  activityType: string;
  days: number[]; // 0=Mon, 1=Tue, 2=Wed, 3=Thu, 4=Fri
  startHour: number;
  endHour: number;
  color: string;
  label: string;
}

const WEEK_DAYS = [
  { label: 'SEG', idx: 0 },
  { label: 'TER', idx: 1 },
  { label: 'QUA', idx: 2 },
  { label: 'QUI', idx: 3 },
  { label: 'SEX', idx: 4 },
];

const HOURS = Array.from({ length: 13 }, (_, i) => i + 7); // 7h to 19h

const ACTIVITY_TYPES = [
  { value: 'tarefa', label: 'Tarefa', color: 'bg-blue-500', defaultDays: [0,1,2,3,4], defaultStart: 9, defaultEnd: 12 },
  { value: 'audiencia', label: 'Audiência', color: 'bg-green-500', defaultDays: [1,3], defaultStart: 9, defaultEnd: 11 },
  { value: 'prazo', label: 'Prazo', color: 'bg-yellow-500', defaultDays: [0,2,4], defaultStart: 8, defaultEnd: 10 },
  { value: 'acompanhamento', label: 'Acompanhamento', color: 'bg-purple-500', defaultDays: [0,2,4], defaultStart: 14, defaultEnd: 17 },
  { value: 'reuniao', label: 'Reunião', color: 'bg-pink-500', defaultDays: [1,3], defaultStart: 13, defaultEnd: 15 },
  { value: 'diligencia', label: 'Diligência', color: 'bg-orange-500', defaultDays: [2,4], defaultStart: 10, defaultEnd: 12 },
];

const STORAGE_KEY = 'timeblock_settings_v1';

export const getDefaultTimeBlockConfigs = (): TimeBlockConfig[] =>
  ACTIVITY_TYPES.map(t => ({
    activityType: t.value,
    label: t.label,
    color: t.color,
    days: t.defaultDays,
    startHour: t.defaultStart,
    endHour: t.defaultEnd,
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

  useEffect(() => {
    setLocal(configs);
  }, [configs, open]);

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

        <div className="space-y-5 mt-2">
          {local.map((cfg) => {
            const typeMeta = ACTIVITY_TYPES.find(t => t.value === cfg.activityType);
            return (
              <div key={cfg.activityType} className="rounded-lg border p-4 space-y-3">
                {/* Header */}
                <div className="flex items-center gap-2">
                  <span className={cn('h-3 w-3 rounded-full shrink-0', cfg.color)} />
                  <span className="font-semibold text-sm">{cfg.label}</span>
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

                {/* Días preview badges */}
                {cfg.days.length === 0 && (
                  <p className="text-[11px] text-destructive">⚠️ Nenhum dia selecionado — este tipo não aparecerá na grade</p>
                )}
              </div>
            );
          })}
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
                    <div className="truncate">{c.label.slice(0, 5)}</div>
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
