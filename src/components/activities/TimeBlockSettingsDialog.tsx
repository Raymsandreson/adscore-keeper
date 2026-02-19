import { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import {
  Settings2, RotateCcw, Save, Plus, Trash2, X,
  Sparkles, Loader2, Wand2, GripVertical, CheckCircle2, Circle,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useActivityTypes, ActivityType } from '@/hooks/useActivityTypes';
import { useUserRole } from '@/hooks/useUserRole';

export interface TimeBlockConfig {
  activityType: string;
  days: number[];
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

const HOURS = Array.from({ length: 13 }, (_, i) => i + 7); // 7h–19h

export const COLOR_OPTIONS = [
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

// Legacy exports kept for compatibility
export const getDefaultTimeBlockConfigs = (): TimeBlockConfig[] => [];
export const loadTimeBlockConfigs = (): TimeBlockConfig[] => [];
export const saveTimeBlockConfigs = (_: TimeBlockConfig[]) => {};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  configs: TimeBlockConfig[]; // user's current selections
  onSave: (configs: TimeBlockConfig[]) => void;
}

export function TimeBlockSettingsDialog({ open, onOpenChange, configs, onSave }: Props) {
  const { types: globalTypes, loading: typesLoading, addType, deleteType, updateType, reorder } = useActivityTypes();
  const { isAdmin } = useUserRole();

  // User's local selection: map of activityType key → schedule config
  const [selected, setSelected] = useState<Record<string, { days: number[]; startHour: number; endHour: number }>>({});

  // Admin: manage global types
  const [showAddType, setShowAddType] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newColor, setNewColor] = useState('bg-teal-500');

  // AI assistant
  const [showAI, setShowAI] = useState(false);
  const [aiDescription, setAiDescription] = useState('');
  const [aiLoading, setAiLoading] = useState(false);

  // Drag & drop for global types reorder (admin only)
  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);
  const [dropTargetIdx, setDropTargetIdx] = useState<number | null>(null);

  // Init selected from configs
  useEffect(() => {
    if (!open) return;
    const map: Record<string, { days: number[]; startHour: number; endHour: number }> = {};
    configs.forEach(c => {
      map[c.activityType] = { days: c.days, startHour: c.startHour, endHour: c.endHour };
    });
    setSelected(map);
    setShowAI(false);
    setAiDescription('');
    setShowAddType(false);
    setNewLabel('');
  }, [open, configs]);

  const isSelected = (key: string) => key in selected;

  // Fixed toggle
  const handleToggle = (type: ActivityType) => {
    const k = type.key;
    setSelected(prev => {
      if (k in prev) {
        const next = { ...prev };
        delete next[k];
        return next;
      }
      return { ...prev, [k]: { days: [0, 1, 2, 3, 4], startHour: 9, endHour: 11 } };
    });
  };

  const updateSchedule = (key: string, patch: Partial<{ days: number[]; startHour: number; endHour: number }>) => {
    setSelected(prev => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  };

  const toggleDay = (key: string, dayIdx: number) => {
    const current = selected[key]?.days || [];
    const days = current.includes(dayIdx)
      ? current.filter(d => d !== dayIdx)
      : [...current, dayIdx].sort();
    updateSchedule(key, { days });
  };

  const handleSave = () => {
    const result: TimeBlockConfig[] = globalTypes
      .filter(t => t.key in selected)
      .map(t => ({
        activityType: t.key,
        label: t.label,
        color: t.color,
        days: selected[t.key].days,
        startHour: selected[t.key].startHour,
        endHour: selected[t.key].endHour,
        isCustom: false,
      }));
    onSave(result);
    onOpenChange(false);
  };

  const handleAddGlobalType = async () => {
    const trimmed = newLabel.trim();
    if (!trimmed) return;
    await addType(trimmed, newColor);
    setNewLabel('');
    setNewColor('bg-teal-500');
    setShowAddType(false);
  };

  const handleAISuggest = async () => {
    if (!aiDescription.trim()) {
      toast.error('Descreva sua semana antes de gerar a rotina');
      return;
    }
    setAiLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('suggest-routine', {
        body: { description: aiDescription },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const suggested: Array<{ activityType: string; days: number[]; startHour: number; endHour: number }> =
        (data?.configs || []);

      // Map AI suggestions to global types by key match
      const newSelected: Record<string, { days: number[]; startHour: number; endHour: number }> = {};
      suggested.forEach((s: any) => {
        const globalMatch = globalTypes.find(
          t => t.key === s.activityType || t.label.toLowerCase() === (s.label || '').toLowerCase()
        );
        if (globalMatch) {
          newSelected[globalMatch.key] = {
            days: Array.isArray(s.days) ? s.days : [0, 1, 2, 3, 4],
            startHour: Number(s.startHour) || 9,
            endHour: Number(s.endHour) || 11,
          };
        }
      });

      if (Object.keys(newSelected).length === 0) {
        toast.warning('A IA não conseguiu mapear sugestões aos tipos globais existentes. Selecione os tipos manualmente.');
      } else {
        setSelected(newSelected);
        toast.success(`✨ ${Object.keys(newSelected).length} tipos configurados pela IA!`);
      }
      setShowAI(false);
      setAiDescription('');
    } catch (e: any) {
      toast.error(e.message || 'Erro ao gerar rotina com IA');
    } finally {
      setAiLoading(false);
    }
  };

  // Drag handlers for global type reorder (admin)
  const handleDragStart = (idx: number) => {
    dragItem.current = idx;
    setDraggedIdx(idx);
  };
  const handleDragEnter = (idx: number) => {
    dragOverItem.current = idx;
    setDropTargetIdx(idx);
  };
  const handleDragEnd = () => {
    if (
      dragItem.current !== null &&
      dragOverItem.current !== null &&
      dragItem.current !== dragOverItem.current
    ) {
      const reordered = [...globalTypes];
      const [moved] = reordered.splice(dragItem.current, 1);
      reordered.splice(dragOverItem.current, 0, moved);
      reorder(reordered);
    }
    dragItem.current = null;
    dragOverItem.current = null;
    setDraggedIdx(null);
    setDropTargetIdx(null);
  };

  const selectedCount = Object.keys(selected).length;

  // Returns hours that are already occupied by OTHER blocks on the given days
  const getOccupiedHours = (currentKey: string, days: number[]): Set<number> => {
    const occupied = new Set<number>();
    Object.entries(selected).forEach(([key, sched]) => {
      if (key === currentKey) return;
      // Only block if the other block shares at least one of the same days
      const sharesDay = days.some(d => sched.days.includes(d));
      if (!sharesDay) return;
      for (let h = sched.startHour; h < sched.endHour; h++) {
        occupied.add(h);
      }
    });
    return occupied;
  };

  // Returns available start hours (not occupied by other blocks on same days)
  const getAvailableStartHours = (currentKey: string, days: number[]): number[] => {
    if (days.length === 0) return HOURS.slice(0, -1); // no days selected → show all
    const occupied = getOccupiedHours(currentKey, days);
    return HOURS.slice(0, -1).filter(h => !occupied.has(h));
  };

  // Returns available end hours for a given start (no overlap with others on same days)
  const getAvailableEndHours = (currentKey: string, days: number[], startHour: number): number[] => {
    if (days.length === 0) return HOURS.filter(h => h > startHour);
    const occupied = getOccupiedHours(currentKey, days);
    const available: number[] = [];
    for (const h of HOURS) {
      if (h <= startHour) continue;
      // End hour is exclusive — we need the range [startHour, h) to be free
      let blocked = false;
      for (let t = startHour; t < h; t++) {
        if (occupied.has(t)) { blocked = true; break; }
      }
      if (!blocked) available.push(h);
      else break; // stop at first blocked hour
    }
    return available;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="h-4 w-4" />
            Configurar Minha Rotina
          </DialogTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Selecione os tipos de atividade que fazem parte da sua semana e defina os horários.
          </p>
        </DialogHeader>

        {/* AI Assistant Banner */}
        {!showAI ? (
          <button
            onClick={() => setShowAI(true)}
            className="flex items-center gap-3 w-full rounded-lg border border-dashed border-primary/40 p-3 bg-primary/5 hover:bg-primary/10 transition-colors text-left"
          >
            <div className="h-8 w-8 rounded-full bg-primary/15 flex items-center justify-center flex-shrink-0">
              <Sparkles className="h-4 w-4 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-primary">✨ Organizar rotina com IA</p>
              <p className="text-xs text-muted-foreground">Descreva sua semana e a IA configura os blocos automaticamente</p>
            </div>
          </button>
        ) : (
          <div className="rounded-lg border border-primary/30 p-4 bg-primary/5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <span className="text-sm font-semibold text-primary">Assistente de Rotina IA</span>
              </div>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setShowAI(false)}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
            <Textarea
              placeholder="Exemplo: Faço audiências nas terças e quintas de manhã, reuniões toda segunda, prazos nas quartas, atendimento nas sextas à tarde..."
              value={aiDescription}
              onChange={e => setAiDescription(e.target.value)}
              className="min-h-[90px] text-sm resize-none"
              autoFocus
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={handleAISuggest} disabled={aiLoading || !aiDescription.trim()} className="gap-1.5 flex-1">
                {aiLoading
                  ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Gerando...</>
                  : <><Wand2 className="h-3.5 w-3.5" />Gerar Rotina</>}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowAI(false)}>Cancelar</Button>
            </div>
          </div>
        )}

        {/* Header with count */}
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">Tipos de atividade disponíveis</p>
          <Badge variant="secondary" className="text-xs">
            {selectedCount} selecionado{selectedCount !== 1 ? 's' : ''}
          </Badge>
        </div>

        {/* Global types list */}
        {typesLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-2">
            {globalTypes.map((type, idx) => {
              const sel = isSelected(type.key);
              const schedule = selected[type.key];
              return (
                <div
                  key={type.key}
                  draggable={isAdmin}
                  onDragStart={() => isAdmin && handleDragStart(idx)}
                  onDragEnter={() => isAdmin && handleDragEnter(idx)}
                  onDragEnd={handleDragEnd}
                  onDragOver={e => e.preventDefault()}
                  className={cn(
                    'rounded-lg border transition-all',
                    sel ? 'border-primary/40 bg-primary/5' : 'border-border bg-background',
                    isAdmin && 'cursor-grab active:cursor-grabbing',
                    draggedIdx === idx && 'opacity-40 scale-[0.98]',
                    dropTargetIdx === idx && draggedIdx !== idx && 'border-primary border-2'
                  )}
                >
                  {/* Type header — always visible */}
                  <div
                    className="flex items-center gap-3 p-3 cursor-pointer select-none"
                    onClick={() => handleToggle(type)}
                  >
                    {isAdmin && (
                      <GripVertical
                        className="h-4 w-4 text-muted-foreground/40 flex-shrink-0"
                        onClick={e => e.stopPropagation()}
                      />
                    )}
                    <span className={cn('h-3 w-3 rounded-full flex-shrink-0', type.color)} />
                    <span className="flex-1 text-sm font-medium">{type.label}</span>
                    {sel
                      ? <CheckCircle2 className="h-4 w-4 text-primary flex-shrink-0" />
                      : <Circle className="h-4 w-4 text-muted-foreground/40 flex-shrink-0" />}
                  </div>

                  {/* Schedule config — only when selected */}
                  {sel && schedule && (
                    <div className="px-3 pb-3 space-y-3 border-t border-primary/20 pt-3">
                      {/* Days */}
                      <div>
                        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide mb-1.5">Dias da semana</p>
                        <div className="flex gap-1.5 flex-wrap">
                          {WEEK_DAYS.map(d => (
                            <button
                              key={d.idx}
                              onClick={() => toggleDay(type.key, d.idx)}
                              className={cn(
                                'h-7 w-9 rounded-md text-[11px] font-bold border transition-all',
                                schedule.days.includes(d.idx)
                                  ? `${type.color} text-white border-transparent`
                                  : 'bg-muted/30 text-muted-foreground border-border hover:bg-muted/60'
                              )}
                            >
                              {d.label}
                            </button>
                          ))}
                          <button
                            onClick={() => {
                              const allActive = WEEK_DAYS.every(d => schedule.days.includes(d.idx));
                              updateSchedule(type.key, { days: allActive ? [] : WEEK_DAYS.map(d => d.idx) });
                            }}
                            className="h-7 px-2 rounded-md text-[10px] font-medium border border-dashed border-muted-foreground/40 text-muted-foreground hover:bg-muted/30 transition-all"
                          >
                            {WEEK_DAYS.every(d => schedule.days.includes(d.idx)) ? 'Nenhum' : 'Todos'}
                          </button>
                        </div>
                      </div>

                      {/* Hours */}
                      {(() => {
                        const availStart = getAvailableStartHours(type.key, schedule.days);
                        const availEnd = getAvailableEndHours(type.key, schedule.days, schedule.startHour);
                        const correctedStart = availStart.includes(schedule.startHour) ? schedule.startHour : (availStart[0] ?? schedule.startHour);
                        const correctedEnd = availEnd.includes(schedule.endHour) ? schedule.endHour : (availEnd[0] ?? schedule.endHour);
                        return (
                          <div className="flex items-center gap-3">
                            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Horário</p>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-muted-foreground">De</span>
                              <select
                                value={correctedStart}
                                onChange={e => {
                                  const v = Number(e.target.value);
                                  const newEnd = getAvailableEndHours(type.key, schedule.days, v);
                                  updateSchedule(type.key, { startHour: v, endHour: newEnd[0] ?? v + 1 });
                                }}
                                className="h-7 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                              >
                                {availStart.length > 0
                                  ? availStart.map(h => <option key={h} value={h}>{h}:00</option>)
                                  : <option value={correctedStart}>{correctedStart}:00</option>}
                              </select>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-muted-foreground">até</span>
                              <select
                                value={correctedEnd}
                                onChange={e => updateSchedule(type.key, { endHour: Number(e.target.value) })}
                                className="h-7 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                              >
                                {availEnd.length > 0
                                  ? availEnd.map(h => <option key={h} value={h}>{h}:00</option>)
                                  : <option value={correctedEnd}>{correctedEnd}:00</option>}
                              </select>
                            </div>
                            <div className="flex-1 relative h-5 bg-muted/30 rounded-full overflow-hidden hidden sm:block">
                              {(() => {
                                const total = HOURS[HOURS.length - 1] - HOURS[0];
                                const sp = ((correctedStart - HOURS[0]) / total) * 100;
                                const wp = ((correctedEnd - correctedStart) / total) * 100;
                                return (
                                  <div
                                    className={cn('absolute top-0 bottom-0 rounded-full opacity-70', type.color)}
                                    style={{ left: `${sp}%`, width: `${wp}%` }}
                                  />
                                );
                              })()}
                            </div>
                          </div>
                        );
                      })()}

                      {schedule.days.length === 0 && (
                        <p className="text-[11px] text-destructive">⚠️ Nenhum dia selecionado</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Admin: Manage global types */}
        {isAdmin && (
          <>
            <Separator />
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">
                  🔧 Gerenciar tipos globais (Admin)
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setShowAddType(v => !v)}
                  className="gap-1.5 h-7 text-xs border-dashed"
                >
                  <Plus className="h-3 w-3" />
                  Novo tipo
                </Button>
              </div>
              <p className="text-xs text-muted-foreground -mt-1">
                Estes tipos ficam disponíveis para todos os usuários escolherem em suas rotinas. Arraste para reordenar.
              </p>

              {showAddType && (
                <div className="rounded-lg border border-dashed p-3 space-y-3 bg-muted/10">
                  <Input
                    placeholder="Nome do tipo (ex: Perícia, Triagem...)"
                    value={newLabel}
                    onChange={e => setNewLabel(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleAddGlobalType()}
                    autoFocus
                    className="h-8 text-sm"
                  />
                  <div>
                    <p className="text-[10px] text-muted-foreground mb-1.5">Cor</p>
                    <div className="flex flex-wrap gap-1.5">
                      {COLOR_OPTIONS.map(c => (
                        <button
                          key={c.value}
                          onClick={() => setNewColor(c.value)}
                          className={cn('h-5 w-5 rounded-full border-2 transition-all', c.value,
                            newColor === c.value ? 'border-foreground scale-110' : 'border-transparent')}
                          title={c.label}
                        />
                      ))}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={handleAddGlobalType} disabled={!newLabel.trim()} className="gap-1 h-7 text-xs">
                      <Plus className="h-3 w-3" /> Adicionar
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setShowAddType(false); setNewLabel(''); }}>
                      Cancelar
                    </Button>
                  </div>
                </div>
              )}

              {/* Edit existing global types inline */}
              <div className="space-y-1">
                {globalTypes.map((type, idx) => (
                  <div
                    key={type.key}
                    className="flex items-center gap-2 rounded-md border px-3 py-1.5 bg-background"
                  >
                    <span className={cn('h-2.5 w-2.5 rounded-full flex-shrink-0', type.color)} />
                    <Input
                      value={type.label}
                      onChange={e => updateType(type.id, { label: e.target.value })}
                      className="h-6 text-xs border-0 p-0 focus-visible:ring-0 flex-1 bg-transparent"
                    />
                    <div className="flex gap-1">
                      {COLOR_OPTIONS.slice(0, 6).map(c => (
                        <button
                          key={c.value}
                          onClick={() => updateType(type.id, { color: c.value })}
                          className={cn('h-3.5 w-3.5 rounded-full border-2 transition-all', c.value,
                            type.color === c.value ? 'border-foreground scale-110' : 'border-transparent')}
                        />
                      ))}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-destructive hover:text-destructive hover:bg-destructive/10 flex-shrink-0"
                      onClick={() => deleteType(type.id)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Preview mini-grid */}
        {Object.keys(selected).length > 0 && (
          <div className="rounded-lg border p-3 bg-muted/20">
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-3">Prévia da grade semanal</p>
            <div className="grid grid-cols-5 gap-1">
              {WEEK_DAYS.map(d => (
                <div key={d.idx} className="space-y-1">
                  <div className="text-center text-[10px] font-bold text-muted-foreground">{d.label}</div>
                  {globalTypes
                    .filter(t => t.key in selected && selected[t.key].days.includes(d.idx))
                    .map(t => (
                      <div key={t.key} className={cn('rounded px-1.5 py-1 text-[9px] text-white font-bold', t.color)}>
                        <div className="truncate">{t.label.slice(0, 6)}</div>
                        <div className="opacity-80">{selected[t.key].startHour}h-{selected[t.key].endHour}h</div>
                      </div>
                    ))}
                  {globalTypes.filter(t => t.key in selected && selected[t.key].days.includes(d.idx)).length === 0 && (
                    <div className="rounded border border-dashed border-muted-foreground/20 h-8 flex items-center justify-center">
                      <span className="text-[9px] text-muted-foreground/40">vazio</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <Separator />
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelected({})}
            className="gap-1.5 text-muted-foreground"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Limpar seleção
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button size="sm" onClick={handleSave} className="gap-1.5">
              <Save className="h-3.5 w-3.5" />
              Salvar rotina
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
