import { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  Settings2, RotateCcw, Save, Plus, Trash2, X, Pencil, AlertTriangle,
  Sparkles, Loader2, Wand2, GripVertical, CheckCircle2, Circle,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useActivityTypes, ActivityType } from '@/hooks/useActivityTypes';
import { useUserRole } from '@/hooks/useUserRole';
import { ActivityProcessGoalsConfig, ProcessGoalEntry } from './ActivityProcessGoalsConfig';
import { useRoutineProcessGoals } from '@/hooks/useRoutineProcessGoals';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';

/** One time-slot block (a type can have multiple) */
export interface TimeBlockConfig {
  /** Unique id for this block (temp uuid while editing, DB id after save) */
  blockId: string;
  activityType: string;
  days: number[];
  startHour: number;
  startMinute?: number;
  endHour: number;
  endMinute?: number;
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

const HOURS = Array.from({ length: 24 }, (_, i) => i); // 0h–23h
const MINUTES = [0, 15, 30, 45];

/** Convert hour+minute to decimal for overlap comparison */
const toDecimal = (h: number, m: number = 0) => h + m / 60;

/** Format as HH:MM */
const fmtTime = (h: number, m: number = 0) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;


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
  { value: 'bg-amber-500', label: 'Âmbar' },
  { value: 'bg-lime-500', label: 'Lima' },
  { value: 'bg-sky-500', label: 'Céu' },
  { value: 'bg-violet-500', label: 'Violeta' },
  { value: 'bg-fuchsia-500', label: 'Fúcsia' },
  { value: 'bg-stone-500', label: 'Pedra' },
  { value: 'bg-slate-500', label: 'Ardósia' },
  { value: 'bg-zinc-500', label: 'Zinco' },
];

// Legacy exports kept for compatibility
export const getDefaultTimeBlockConfigs = (): TimeBlockConfig[] => [];
export const loadTimeBlockConfigs = (): TimeBlockConfig[] => [];
export const saveTimeBlockConfigs = (_: TimeBlockConfig[]) => {};

let _blockIdCounter = 0;
const newBlockId = () => `block_${Date.now()}_${_blockIdCounter++}`;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  configs: TimeBlockConfig[];
  onSave: (configs: TimeBlockConfig[]) => void;
  targetUserId?: string;
}

// ------------------------------------------------------------------
// Helpers for overlap detection
// ------------------------------------------------------------------

/** All blocks that belong to OTHER blockIds */
function getOccupiedRanges(
  blocks: TimeBlockConfig[],
  currentBlockId: string,
  days: number[],
): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  blocks.forEach(b => {
    if (b.blockId === currentBlockId) return;
    const sharesDay = days.some(d => b.days.includes(d));
    if (!sharesDay) return;
    ranges.push({ start: toDecimal(b.startHour, b.startMinute), end: toDecimal(b.endHour, b.endMinute) });
  });
  return ranges;
}

function hasOverlap(
  blocks: TimeBlockConfig[],
  blockId: string,
  days: number[],
  startDecimal: number,
  endDecimal: number,
): boolean {
  const ranges = getOccupiedRanges(blocks, blockId, days);
  return ranges.some(r => startDecimal < r.end && endDecimal > r.start);
}


// ------------------------------------------------------------------
// Component
// ------------------------------------------------------------------

export function TimeBlockSettingsDialog({ open, onOpenChange, configs, onSave, targetUserId }: Props) {
  const { types: globalTypes, loading: typesLoading, addType, deleteType, updateType, reorder } = useActivityTypes();
  const { isAdmin } = useUserRole();
  const { goals: savedProcessGoals, saveGoals: saveProcessGoals } = useRoutineProcessGoals(targetUserId);

  // Working copy — list of all blocks being edited
  const [blocks, setBlocks] = useState<TimeBlockConfig[]>([]);
  
  // Process goals per activity type: { [activityType]: ProcessGoalEntry[] }
  const [processGoals, setProcessGoals] = useState<Record<string, ProcessGoalEntry[]>>({});

  // Boards for funnel selector (with stages)
  const [boards, setBoards] = useState<{id: string; name: string; stages?: {id: string; name: string}[]}[]>([]);

  // Admin: manage global types
  const [showAddType, setShowAddType] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newColor, setNewColor] = useState('bg-teal-500');

  // Edit type state
  const [editingType, setEditingType] = useState<ActivityType | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editColor, setEditColor] = useState('');
  const [editDescription, setEditDescription] = useState('');

  // Delete with migration state
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: ActivityType; linkedCount: number } | null>(null);
  const [migrateToKey, setMigrateToKey] = useState('');
  const [deletingType, setDeletingType] = useState(false);

  // AI assistant
  const [showAI, setShowAI] = useState(false);
  const [aiDescription, setAiDescription] = useState('');
  const [aiLoading, setAiLoading] = useState(false);

  // Drag & drop for global types reorder (admin only)
  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);
  const [dropTargetIdx, setDropTargetIdx] = useState<number | null>(null);

  // Fetch boards with stages
  useEffect(() => {
    if (!open) return;
    supabase.from('kanban_boards').select('id, name, stages').order('display_order').then(({ data }) => {
      if (data) {
        setBoards(data.map((b: any) => ({
          id: b.id,
          name: b.name,
          stages: (Array.isArray(b.stages) ? b.stages : []).map((s: any) => ({ id: s.id, name: s.name })),
        })));
      }
    });
  }, [open]);

  // Init blocks and process goals from saved data
  useEffect(() => {
    if (!open) return;
    setBlocks(configs.map(c => ({ ...c, blockId: c.blockId || newBlockId() })));
    
    // Convert saved goals into the working map
    const goalsMap: Record<string, ProcessGoalEntry[]> = {};
    savedProcessGoals.forEach(g => {
      if (!goalsMap[g.activity_type]) goalsMap[g.activity_type] = [];
      goalsMap[g.activity_type].push({
        metric_key: g.metric_key,
        target_value: g.target_value,
        board_id: g.board_id,
      });
    });
    setProcessGoals(goalsMap);
    
    setShowAI(false);
    setAiDescription('');
    setShowAddType(false);
    setNewLabel('');
  }, [open, configs, savedProcessGoals]);

  // Types that have at least one block
  const activeTypeKeys = new Set(blocks.map(b => b.activityType));

  // Toggle a type: if it has blocks → remove all; if not → add one default block
  const handleToggle = (type: ActivityType) => {
    if (activeTypeKeys.has(type.key)) {
      setBlocks(prev => prev.filter(b => b.activityType !== type.key));
    } else {
      setBlocks(prev => [
        ...prev,
        {
          blockId: newBlockId(),
          activityType: type.key,
          label: type.label,
          color: type.color,
          days: [0, 1, 2, 3, 4],
          startHour: 9,
          endHour: 11,
          isCustom: false,
        },
      ]);
    }
  };

  const addBlock = (type: ActivityType) => {
    setBlocks(prev => [
      ...prev,
      {
        blockId: newBlockId(),
        activityType: type.key,
        label: type.label,
        color: type.color,
        days: [0, 1, 2, 3, 4],
        startHour: 9,
        endHour: 11,
        isCustom: false,
      },
    ]);
  };

  const removeBlock = (blockId: string) => {
    setBlocks(prev => prev.filter(b => b.blockId !== blockId));
  };

  const updateBlock = (blockId: string, patch: Partial<TimeBlockConfig>) => {
    setBlocks(prev => prev.map(b => b.blockId === blockId ? { ...b, ...patch } : b));
  };

  const toggleDay = (blockId: string, dayIdx: number) => {
    setBlocks(prev => prev.map(b => {
      if (b.blockId !== blockId) return b;
      const days = b.days.includes(dayIdx)
        ? b.days.filter(d => d !== dayIdx)
        : [...b.days, dayIdx].sort();
      return { ...b, days };
    }));
  };

  const handleSave = async () => {
    onSave(blocks);
    
    // Save process goals
    const allGoals = Object.entries(processGoals).flatMap(([actType, entries]) =>
      entries.filter(e => e.target_value > 0).map(e => ({
        user_id: targetUserId || '',
        activity_type: actType,
        metric_key: e.metric_key,
        target_value: e.target_value,
        board_id: e.board_id,
      }))
    );
    await saveProcessGoals(allGoals, targetUserId);
    
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

  const handleStartEdit = (type: ActivityType) => {
    setEditingType(type);
    setEditLabel(type.label);
    setEditColor(type.color);
    setEditDescription(type.description || '');
  };

  const handleSaveEdit = async () => {
    if (!editingType || !editLabel.trim()) return;
    await updateType(editingType.id, { label: editLabel.trim(), color: editColor, description: editDescription.trim() || null });
    setEditingType(null);
    toast.success('Tipo atualizado!');
  };

  const handleDeleteCheck = async (type: ActivityType) => {
    // Check if there are activities or routine blocks linked to this type
    const [activitiesRes, blocksRes] = await Promise.all([
      supabase.from('lead_activities').select('id', { count: 'exact', head: true }).eq('activity_type', type.key),
      supabase.from('user_timeblock_settings').select('id', { count: 'exact', head: true }).eq('activity_type', type.key),
    ]);
    const total = (activitiesRes.count || 0) + (blocksRes.count || 0);
    if (total > 0) {
      setDeleteConfirm({ type, linkedCount: total });
      setMigrateToKey('');
    } else {
      await deleteType(type.id);
    }
  };

  const handleDeleteWithMigration = async () => {
    if (!deleteConfirm || !migrateToKey) return;
    setDeletingType(true);
    try {
      // Migrate activities
      await supabase.from('lead_activities').update({ activity_type: migrateToKey } as any).eq('activity_type', deleteConfirm.type.key);
      // Migrate routine blocks
      await supabase.from('user_timeblock_settings').update({ activity_type: migrateToKey } as any).eq('activity_type', deleteConfirm.type.key);
      // Delete the type
      await deleteType(deleteConfirm.type.id);
      // Update local blocks too
      const migrateTarget = globalTypes.find(t => t.key === migrateToKey);
      if (migrateTarget) {
        setBlocks(prev => prev.map(b => b.activityType === deleteConfirm.type.key
          ? { ...b, activityType: migrateTarget.key, label: migrateTarget.label, color: migrateTarget.color }
          : b
        ));
      }
      toast.success('Tipo excluído e registros migrados!');
      setDeleteConfirm(null);
    } catch (e: any) {
      toast.error('Erro ao migrar: ' + (e.message || 'Erro desconhecido'));
    } finally {
      setDeletingType(false);
    }
  };

  const handleAISuggest = async () => {
    if (!aiDescription.trim()) {
      toast.error('Descreva sua semana antes de gerar a rotina');
      return;
    }
    setAiLoading(true);
    try {
      const { data, error } = await cloudFunctions.invoke('suggest-routine', {
        body: { description: aiDescription },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const suggested: Array<{ activityType: string; days: number[]; startHour: number; endHour: number }> =
        (data?.configs || []);

      const newBlocks: TimeBlockConfig[] = [];
      suggested.forEach((s: any) => {
        const globalMatch = globalTypes.find(
          t => t.key === s.activityType || t.label.toLowerCase() === (s.label || '').toLowerCase()
        );
        if (globalMatch) {
          newBlocks.push({
            blockId: newBlockId(),
            activityType: globalMatch.key,
            label: globalMatch.label,
            color: globalMatch.color,
            days: Array.isArray(s.days) ? s.days : [0, 1, 2, 3, 4],
            startHour: Number(s.startHour) || 9,
            endHour: Number(s.endHour) || 11,
            isCustom: false,
          });
        }
      });

      if (newBlocks.length === 0) {
        toast.warning('A IA não conseguiu mapear sugestões aos tipos globais existentes.');
      } else {
        setBlocks(newBlocks);
        toast.success(`✨ ${newBlocks.length} bloco${newBlocks.length !== 1 ? 's' : ''} configurados pela IA!`);
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
  const handleDragStart = (idx: number) => { dragItem.current = idx; setDraggedIdx(idx); };
  const handleDragEnter = (idx: number) => { dragOverItem.current = idx; setDropTargetIdx(idx); };
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

  const selectedCount = activeTypeKeys.size;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="h-4 w-4" />
            Configurar Minha Rotina
          </DialogTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Selecione os tipos de atividade e adicione quantos blocos de horário quiser por tipo.
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
              const typeBlocks = blocks.filter(b => b.activityType === type.key);
              const sel = typeBlocks.length > 0;
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
                  {/* Type header */}
                  <div
                    className="flex items-center gap-3 p-3 select-none"
                  >
                    {isAdmin && (
                      <GripVertical
                        className="h-4 w-4 text-muted-foreground/40 flex-shrink-0 cursor-grab"
                        onClick={e => e.stopPropagation()}
                      />
                    )}
                    <span className={cn('h-3 w-3 rounded-full flex-shrink-0', type.color)} />
                    <span
                      className="flex-1 text-sm font-medium cursor-pointer"
                      onClick={() => handleToggle(type)}
                    >
                      {type.label}
                    </span>
                    {isAdmin && (
                      <div className="flex items-center gap-1 mr-2">
                        <button
                          onClick={e => { e.stopPropagation(); handleStartEdit(type); }}
                          className="p-1 rounded text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                          title="Editar tipo"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); handleDeleteCheck(type); }}
                          className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                          title="Excluir tipo"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                    <div
                      className="cursor-pointer flex-shrink-0"
                      onClick={() => handleToggle(type)}
                    >
                      {sel
                        ? <CheckCircle2 className="h-4 w-4 text-primary" />
                        : <Circle className="h-4 w-4 text-muted-foreground/40" />}
                    </div>
                  </div>

                  {/* Blocks — only when selected */}
                  {sel && (
                    <div className="px-3 pb-3 border-t border-primary/20 pt-3 space-y-3">
                      {typeBlocks.map((block, bi) => {
                        const startDec = toDecimal(block.startHour, block.startMinute ?? 0);
                        const endDec = toDecimal(block.endHour, block.endMinute ?? 0);

                        const handleStartChange = (h: number, m: number) => {
                          const newStartDec = toDecimal(h, m);
                          let newEndH = block.endHour;
                          let newEndM = block.endMinute ?? 0;
                          // If end <= new start, push end to start + 15min
                          if (toDecimal(newEndH, newEndM) <= newStartDec) {
                            const totalMin = h * 60 + m + 15;
                            newEndH = Math.floor(totalMin / 60);
                            newEndM = totalMin % 60;
                            // Snap to nearest 15min
                            newEndM = [0, 15, 30, 45].reduce((prev, curr) => Math.abs(curr - newEndM) < Math.abs(prev - newEndM) ? curr : prev);
                            if (newEndH > 23) { newEndH = 23; newEndM = 45; }
                          }
                          updateBlock(block.blockId, { startHour: h, startMinute: m, endHour: newEndH, endMinute: newEndM });
                        };

                        const handleEndHourChange = (h: number) => {
                          // Find a valid minute for this end hour
                          let m = block.endMinute ?? 0;
                          const currentStartDec = toDecimal(block.startHour, block.startMinute ?? 0);
                          if (toDecimal(h, m) <= currentStartDec) {
                            // Find the first minute that makes end > start
                            const validMinute = MINUTES.find(min => toDecimal(h, min) > currentStartDec);
                            if (validMinute !== undefined) {
                              m = validMinute;
                            } else {
                              return; // no valid minute for this hour, skip
                            }
                          }
                          updateBlock(block.blockId, { endHour: h, endMinute: m });
                        };

                        const handleEndMinuteChange = (m: number) => {
                          const currentStartDec = toDecimal(block.startHour, block.startMinute ?? 0);
                          if (toDecimal(block.endHour, m) > currentStartDec) {
                            updateBlock(block.blockId, { endMinute: m });
                          }
                        };

                        const overlapWarn = hasOverlap(blocks, block.blockId, block.days, startDec, endDec);

                        return (
                          <div key={block.blockId} className={cn(
                            'space-y-2 rounded-md p-2 bg-background/60',
                            typeBlocks.length > 1 && 'border border-border'
                          )}>
                            {/* Block header with remove button (only if >1 block) */}
                            {typeBlocks.length > 1 && (
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">
                                  Bloco {bi + 1}
                                </span>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-5 w-5 text-muted-foreground hover:text-destructive"
                                  onClick={() => removeBlock(block.blockId)}
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </div>
                            )}

                            {/* Days */}
                            <div>
                              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide mb-1.5">Dias da semana</p>
                              <div className="flex gap-1.5 flex-wrap">
                                {WEEK_DAYS.map(d => (
                                  <button
                                    key={d.idx}
                                    onClick={() => toggleDay(block.blockId, d.idx)}
                                    className={cn(
                                      'h-7 w-9 rounded-md text-[11px] font-bold border transition-all',
                                      block.days.includes(d.idx)
                                        ? `${type.color} text-white border-transparent`
                                        : 'bg-muted/30 text-muted-foreground border-border hover:bg-muted/60'
                                    )}
                                  >
                                    {d.label}
                                  </button>
                                ))}
                                <button
                                  onClick={() => {
                                    const allActive = WEEK_DAYS.every(d => block.days.includes(d.idx));
                                    updateBlock(block.blockId, { days: allActive ? [] : WEEK_DAYS.map(d => d.idx) });
                                  }}
                                  className="h-7 px-2 rounded-md text-[10px] font-medium border border-dashed border-muted-foreground/40 text-muted-foreground hover:bg-muted/30 transition-all"
                                >
                                  {WEEK_DAYS.every(d => block.days.includes(d.idx)) ? 'Nenhum' : 'Todos'}
                                </button>
                              </div>
                            </div>

                            {/* Time pickers with hour + minute */}
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide whitespace-nowrap">Horário</p>
                              
                              <span className="text-xs text-muted-foreground">De</span>
                              {/* Start time */}
                              <div className="flex items-center gap-1">
                                <select
                                  value={block.startHour}
                                  onChange={e => handleStartChange(Number(e.target.value), block.startMinute ?? 0)}
                                  className="h-7 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                                >
                                  {HOURS.map(h => (
                                    <option key={h} value={h}>{String(h).padStart(2, '0')}h</option>
                                  ))}
                                </select>
                                <span className="text-xs text-muted-foreground">:</span>
                                <select
                                  value={block.startMinute ?? 0}
                                  onChange={e => handleStartChange(block.startHour, Number(e.target.value))}
                                  className="h-7 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                                >
                                  {MINUTES.map(m => (
                                    <option key={m} value={m}>{String(m).padStart(2, '0')}</option>
                                  ))}
                                </select>
                              </div>

                              <span className="text-xs text-muted-foreground">até</span>
                              {/* End time */}
                              <div className="flex items-center gap-1">
                                <select
                                  value={block.endHour}
                                  onChange={e => handleEndHourChange(Number(e.target.value))}
                                  className="h-7 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                                >
                                  {HOURS.map(h => (
                                    <option key={h} value={h} disabled={toDecimal(h, 45) <= startDec}>
                                      {String(h).padStart(2, '0')}h
                                    </option>
                                  ))}
                                </select>
                                <span className="text-xs text-muted-foreground">:</span>
                                <select
                                  value={block.endMinute ?? 0}
                                  onChange={e => handleEndMinuteChange(Number(e.target.value))}
                                  className="h-7 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                                >
                                  {MINUTES.map(m => (
                                    <option key={m} value={m} disabled={toDecimal(block.endHour, m) <= startDec}>
                                      {String(m).padStart(2, '0')}
                                    </option>
                                  ))}
                                </select>
                              </div>

                              {/* Duration label */}
                              <span className="text-[10px] text-muted-foreground">
                                ({Math.round((endDec - startDec) * 60)}min)
                              </span>

                              {/* Mini bar */}
                              <div className="flex-1 relative h-4 bg-muted/30 rounded-full overflow-hidden min-w-[60px] hidden sm:block">
                                {(() => {
                                  const total = HOURS[HOURS.length - 1] - HOURS[0];
                                  const sp = ((startDec - HOURS[0]) / total) * 100;
                                  const wp = ((endDec - startDec) / total) * 100;
                                  return (
                                    <div
                                      className={cn('absolute top-0 bottom-0 rounded-full opacity-70', type.color)}
                                      style={{ left: `${Math.max(0, sp)}%`, width: `${Math.max(2, wp)}%` }}
                                    />
                                  );
                                })()}
                              </div>
                            </div>

                            {overlapWarn && (
                              <p className="text-[11px] text-orange-500">⚠️ Este horário sobrepõe outro bloco nos mesmos dias</p>
                            )}
                            {block.days.length === 0 && (
                              <p className="text-[11px] text-destructive">⚠️ Nenhum dia selecionado</p>
                            )}
                          </div>
                        );
                      })}

                      {/* Add another block for this type */}
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full gap-1.5 text-xs h-7 border-dashed"
                        onClick={e => { e.stopPropagation(); addBlock(type); }}
                      >
                        <Plus className="h-3 w-3" />
                        Adicionar outro horário para "{type.label}"
                      </Button>

                      {/* Process goals config for this activity type */}
                      <ActivityProcessGoalsConfig
                        activityType={type.key}
                        goals={processGoals[type.key] || []}
                        boards={boards}
                        onChange={(newGoals) => setProcessGoals(prev => ({ ...prev, [type.key]: newGoals }))}
                        userId={targetUserId}
                      />
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
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Tipos Globais (Admin)
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs gap-1"
                  onClick={() => setShowAddType(v => !v)}
                >
                  <Plus className="h-3 w-3" />
                  Novo Tipo
                </Button>
              </div>

              {showAddType && (
                <div className="flex gap-2 items-end">
                  <div className="flex-1 space-y-1">
                    <p className="text-[10px] text-muted-foreground">Nome do tipo</p>
                    <Input
                      value={newLabel}
                      onChange={e => setNewLabel(e.target.value)}
                      placeholder="Ex: Audiência"
                      className="h-8 text-sm"
                      onKeyDown={e => e.key === 'Enter' && handleAddGlobalType()}
                      autoFocus
                    />
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] text-muted-foreground">Cor</p>
                    <div className="flex gap-1 flex-wrap max-w-[200px]">
                      {COLOR_OPTIONS.map(c => (
                        <button
                          key={c.value}
                          onClick={() => setNewColor(c.value)}
                          className={cn(
                            'h-5 w-5 rounded-full border-2 transition-all',
                            c.value,
                            newColor === c.value ? 'border-foreground scale-110' : 'border-transparent'
                          )}
                          title={c.label}
                        />
                      ))}
                    </div>
                  </div>
                  <Button size="sm" className="h-8" onClick={handleAddGlobalType} disabled={!newLabel.trim()}>
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" className="h-8" onClick={() => setShowAddType(false)}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                {globalTypes.map(t => (
                  <div key={t.key} className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs bg-background">
                    <span className={cn('h-2.5 w-2.5 rounded-full', t.color)} />
                    <span className="font-medium">{t.label}</span>
                    <button
                      onClick={() => handleStartEdit(t)}
                      className="ml-1 text-muted-foreground hover:text-primary transition-colors"
                      title="Editar tipo"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => handleDeleteCheck(t)}
                      className="text-muted-foreground hover:text-destructive transition-colors"
                      title="Excluir tipo"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>

              {/* Inline edit type */}
              {editingType && (
                <div className="flex flex-col gap-2 border rounded-lg p-3 bg-muted/20">
                  <div className="flex gap-2 items-end">
                    <div className="flex-1 space-y-1">
                      <p className="text-[10px] text-muted-foreground">Editar: {editingType.label}</p>
                      <Input
                        value={editLabel}
                        onChange={e => setEditLabel(e.target.value)}
                        className="h-8 text-sm"
                        placeholder="Nome do tipo"
                        autoFocus
                      />
                    </div>
                    <div className="space-y-1">
                      <p className="text-[10px] text-muted-foreground">Cor</p>
                      <div className="flex gap-1 flex-wrap max-w-[200px]">
                        {COLOR_OPTIONS.map(c => (
                          <button
                            key={c.value}
                            onClick={() => setEditColor(c.value)}
                            className={cn(
                              'h-5 w-5 rounded-full border-2 transition-all',
                              c.value,
                              editColor === c.value ? 'border-foreground scale-110' : 'border-transparent'
                            )}
                            title={c.label}
                          />
                        ))}
                      </div>
                    </div>
                    <Button size="sm" className="h-8" onClick={handleSaveEdit} disabled={!editLabel.trim()}>
                      <Save className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-8" onClick={() => setEditingType(null)}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] text-muted-foreground">Descrição (usada pela IA para identificar o tipo correto)</p>
                    <Input
                      value={editDescription}
                      onChange={e => setEditDescription(e.target.value)}
                      className="h-8 text-sm"
                      placeholder="Ex: Atividades de prospecção ativa de novos clientes via telefone e WhatsApp"
                    />
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {/* Delete with migration dialog */}
        <AlertDialog open={!!deleteConfirm} onOpenChange={(o) => !o && setDeleteConfirm(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-destructive" />
                Tipo em uso
              </AlertDialogTitle>
              <AlertDialogDescription className="space-y-3">
                <p>
                  O tipo <strong>"{deleteConfirm?.type.label}"</strong> possui{' '}
                  <strong>{deleteConfirm?.linkedCount}</strong> registro(s) vinculado(s) (atividades e/ou rotinas).
                </p>
                <p>Selecione para qual tipo deseja migrar antes de excluir:</p>
                <Select value={migrateToKey} onValueChange={setMigrateToKey}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione o tipo de destino..." />
                  </SelectTrigger>
                  <SelectContent>
                    {globalTypes
                      .filter(t => t.key !== deleteConfirm?.type.key)
                      .map(t => (
                        <SelectItem key={t.key} value={t.key}>
                          <div className="flex items-center gap-2">
                            <span className={cn('h-2 w-2 rounded-full', t.color)} />
                            {t.label}
                          </div>
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deletingType}>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDeleteWithMigration}
                disabled={!migrateToKey || deletingType}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {deletingType ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Trash2 className="h-4 w-4 mr-1" />}
                Migrar e Excluir
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Save footer */}
        <div className="flex justify-end gap-2 pt-2 border-t">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSave} className="gap-1.5">
            <Save className="h-3.5 w-3.5" />
            Salvar Rotina
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
