import { useRef, useState, useCallback, useMemo, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Trash2, Copy } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { BlockEditPopover } from './BlockEditPopover';
import type { TimeBlockConfig } from './TimeBlockSettingsDialog';

const DAYS = [
  { label: 'SEG', idx: 0 },
  { label: 'TER', idx: 1 },
  { label: 'QUA', idx: 2 },
  { label: 'QUI', idx: 3 },
  { label: 'SEX', idx: 4 },
];

const MIN_HOUR = 6;
const MAX_HOUR = 23; // exclusive end (shown 6..22)
const PX_PER_HOUR = 44;
const SNAP_MIN = 15;

type AvailableType = { key: string; label: string; color: string };

interface Props {
  blocks: TimeBlockConfig[];
  availableTypes: AvailableType[];
  onCreate: (block: TimeBlockConfig) => void;
  onUpdate: (blockId: string, patch: Partial<TimeBlockConfig>) => void;
  onRemove: (blockId: string) => void;
  userTeams?: { id: string; name: string; color?: string }[];
  onAddType?: (label: string, color: string, teamIds: string[]) => Promise<{ key: string; label: string; color: string } | null>;
}

const newId = () => (crypto as any).randomUUID?.() || `b_${Date.now()}_${Math.random().toString(36).slice(2)}`;
const toMin = (h: number, m = 0) => h * 60 + m;
const fromMin = (total: number) => ({ h: Math.floor(total / 60), m: total % 60 });
const fmt = (h: number, m = 0) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
const snap = (min: number) => Math.round(min / SNAP_MIN) * SNAP_MIN;

interface DragState {
  blockId: string;
  mode: 'move' | 'resize-end' | 'resize-start' | 'create';
  dayIdx: number;
  initialStartMin: number;
  initialEndMin: number;
  originY: number;
  originX?: number;
  moved?: boolean;
  /** for create mode: anchor minute */
  anchorMin?: number;
}

export function RoutineCalendarGrid({ blocks, availableTypes, onCreate, onUpdate, onRemove, userTeams = [], onAddType }: Props) {
  const [activeKey, setActiveKey] = useState<string>(availableTypes[0]?.key ?? '');
  useEffect(() => {
    if (!activeKey && availableTypes[0]) setActiveKey(availableTypes[0].key);
  }, [availableTypes, activeKey]);

  const [editingBlock, setEditingBlock] = useState<{ block: TimeBlockConfig; rect: DOMRect } | null>(null);

  const colRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  dragRef.current = drag;

  const totalHours = MAX_HOUR - MIN_HOUR;
  const totalHeight = totalHours * PX_PER_HOUR;

  const yToMin = useCallback((y: number, dayIdx: number): number => {
    const col = colRefs.current[dayIdx];
    if (!col) return MIN_HOUR * 60;
    const rect = col.getBoundingClientRect();
    const offset = Math.max(0, Math.min(totalHeight, y - rect.top));
    const minutes = (offset / PX_PER_HOUR) * 60 + MIN_HOUR * 60;
    return Math.max(MIN_HOUR * 60, Math.min(MAX_HOUR * 60, snap(minutes)));
  }, [totalHeight]);

  const xToDay = useCallback((x: number): number | null => {
    for (const day of DAYS) {
      const col = colRefs.current[day.idx];
      if (!col) continue;
      const r = col.getBoundingClientRect();
      if (x >= r.left && x <= r.right) return day.idx;
    }
    return null;
  }, []);

  // Global mouse handlers
  useEffect(() => {
    if (!drag) return;
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      if (d.originX != null) {
        const dx = Math.abs(e.clientX - d.originX);
        const dy = Math.abs(e.clientY - d.originY);
        if (dx > 4 || dy > 4) d.moved = true;
      }
      const cur = yToMin(e.clientY, d.dayIdx);

      if (d.mode === 'move') {
        if (!d.moved) return;
        const dur = d.initialEndMin - d.initialStartMin;
        const offsetMin = yToMin(d.originY, d.dayIdx) - d.initialStartMin;
        let newStart = cur - offsetMin;
        newStart = snap(newStart);
        let newEnd = newStart + dur;
        if (newStart < MIN_HOUR * 60) { newStart = MIN_HOUR * 60; newEnd = newStart + dur; }
        if (newEnd > MAX_HOUR * 60) { newEnd = MAX_HOUR * 60; newStart = newEnd - dur; }
        const s = fromMin(newStart);
        const e2 = fromMin(newEnd);
        const targetDay = xToDay(e.clientX);
        const patch: Partial<TimeBlockConfig> = { startHour: s.h, startMinute: s.m, endHour: e2.h, endMinute: e2.m };
        if (targetDay != null && targetDay !== d.dayIdx) {
          patch.days = [targetDay];
          d.dayIdx = targetDay;
        }
        onUpdate(d.blockId, patch);
      } else if (d.mode === 'resize-end') {
        let newEnd = Math.max(d.initialStartMin + SNAP_MIN, cur);
        const s = fromMin(d.initialStartMin);
        const e2 = fromMin(newEnd);
        onUpdate(d.blockId, { startHour: s.h, startMinute: s.m, endHour: e2.h, endMinute: e2.m });
      } else if (d.mode === 'resize-start') {
        let newStart = Math.min(d.initialEndMin - SNAP_MIN, cur);
        const s = fromMin(newStart);
        const e2 = fromMin(d.initialEndMin);
        onUpdate(d.blockId, { startHour: s.h, startMinute: s.m, endHour: e2.h, endMinute: e2.m });
      } else if (d.mode === 'create') {
        const anchor = d.anchorMin ?? cur;
        const start = Math.min(anchor, cur);
        const end = Math.max(anchor + SNAP_MIN, cur);
        const s = fromMin(start);
        const e2 = fromMin(end);
        onUpdate(d.blockId, { startHour: s.h, startMinute: s.m, endHour: e2.h, endMinute: e2.m });
      }
    };
    const onUp = (e: MouseEvent) => {
      const d = dragRef.current;
      if (d && d.mode === 'move' && !d.moved) {
        const block = blocks.find(b => b.blockId === d.blockId);
        const target = (e.target as HTMLElement).closest('[data-block]') as HTMLElement | null;
        if (block && target) {
          setEditingBlock({ block, rect: target.getBoundingClientRect() });
        }
      }
      setDrag(null);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [drag, yToMin, xToDay, onUpdate, blocks]);

  const typeMap = useMemo(() => {
    const m: Record<string, AvailableType> = {};
    availableTypes.forEach(t => { m[t.key] = t; });
    return m;
  }, [availableTypes]);

  const handleColumnMouseDown = (e: React.MouseEvent, dayIdx: number) => {
    if (e.button !== 0) return;
    if (!activeKey) return;
    // Only react if clicking on the column bg, not on an existing block
    if ((e.target as HTMLElement).closest('[data-block]')) return;
    const startMin = yToMin(e.clientY, dayIdx);
    const endMin = Math.min(MAX_HOUR * 60, startMin + 60);
    const t = typeMap[activeKey];
    if (!t) return;
    const id = newId();
    const s = fromMin(startMin);
    const en = fromMin(endMin);
    onCreate({
      blockId: id,
      activityType: t.key,
      label: t.label,
      color: t.color,
      days: [dayIdx],
      startHour: s.h,
      startMinute: s.m,
      endHour: en.h,
      endMinute: en.m,
      isCustom: false,
    });
    setDrag({
      blockId: id,
      mode: 'create',
      dayIdx,
      initialStartMin: startMin,
      initialEndMin: endMin,
      originY: e.clientY,
      anchorMin: startMin,
    });
  };

  const startBlockDrag = (
    e: React.MouseEvent,
    block: TimeBlockConfig,
    dayIdx: number,
    mode: 'move' | 'resize-end' | 'resize-start',
  ) => {
    e.stopPropagation();
    e.preventDefault();
    setDrag({
      blockId: block.blockId,
      mode,
      dayIdx,
      initialStartMin: toMin(block.startHour, block.startMinute ?? 0),
      initialEndMin: toMin(block.endHour, block.endMinute ?? 0),
      originY: e.clientY,
      originX: e.clientX,
      moved: false,
    });
  };

  return (
    <div className="rounded-lg border bg-background overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-2 p-2 border-b bg-muted/20">
        <span className="text-xs font-semibold text-muted-foreground">Adicionar como:</span>
        <Select value={activeKey} onValueChange={setActiveKey}>
          <SelectTrigger className="h-8 w-[200px] text-xs">
            <SelectValue placeholder="Escolha um tipo" />
          </SelectTrigger>
          <SelectContent>
            {availableTypes.length === 0 ? (
              <div className="px-2 py-1.5 text-xs text-muted-foreground">Nenhum tipo disponível</div>
            ) : availableTypes.map(t => (
              <SelectItem key={t.key} value={t.key}>
                <span className="flex items-center gap-2">
                  <span className={cn('h-2 w-2 rounded-full', t.color)} />
                  {t.label}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-[10px] text-muted-foreground hidden sm:inline">
          Clique num horário vazio para criar • arraste para mover • puxe a borda para esticar
        </span>
      </div>

      {/* Day headers */}
      <div className="grid border-b bg-muted/10" style={{ gridTemplateColumns: '48px repeat(5, 1fr)' }}>
        <div />
        {DAYS.map(d => (
          <div key={d.idx} className="text-center text-[11px] font-bold text-muted-foreground py-1.5 border-l">
            {d.label}
          </div>
        ))}
      </div>

      {/* Grid body */}
      <div className="grid select-none" style={{ gridTemplateColumns: '48px repeat(5, 1fr)' }}>
        {/* Hour column */}
        <div className="relative" style={{ height: totalHeight }}>
          {Array.from({ length: totalHours + 1 }).map((_, i) => {
            const h = MIN_HOUR + i;
            return (
              <div
                key={h}
                className="absolute right-1 -translate-y-1/2 text-[10px] text-muted-foreground"
                style={{ top: i * PX_PER_HOUR }}
              >
                {String(h).padStart(2, '0')}h
              </div>
            );
          })}
        </div>

        {/* Day columns */}
        {DAYS.map(day => {
          const dayBlocks = blocks.filter(b => b.days.includes(day.idx));
          return (
            <div
              key={day.idx}
              ref={el => { colRefs.current[day.idx] = el; }}
              onMouseDown={e => handleColumnMouseDown(e, day.idx)}
              className="relative border-l cursor-cell"
              style={{ height: totalHeight }}
            >
              {/* Hour grid lines */}
              {Array.from({ length: totalHours }).map((_, i) => (
                <div
                  key={i}
                  className="absolute left-0 right-0 border-t border-border/40"
                  style={{ top: i * PX_PER_HOUR }}
                />
              ))}
              {/* Half-hour subtle lines */}
              {Array.from({ length: totalHours }).map((_, i) => (
                <div
                  key={`h-${i}`}
                  className="absolute left-0 right-0 border-t border-dashed border-border/20"
                  style={{ top: i * PX_PER_HOUR + PX_PER_HOUR / 2 }}
                />
              ))}

              {/* Blocks */}
              {dayBlocks.map(b => {
                const startMin = toMin(b.startHour, b.startMinute ?? 0);
                const endMin = toMin(b.endHour, b.endMinute ?? 0);
                const top = ((startMin - MIN_HOUR * 60) / 60) * PX_PER_HOUR;
                const height = Math.max(20, ((endMin - startMin) / 60) * PX_PER_HOUR);
                return (
                  <div
                    key={b.blockId}
                    data-block
                    onMouseDown={e => startBlockDrag(e, b, day.idx, 'move')}
                    className={cn(
                      'group absolute left-0.5 right-0.5 rounded-md text-white text-[10px] overflow-hidden cursor-grab active:cursor-grabbing shadow-sm',
                      b.color,
                      'opacity-90 hover:opacity-100 hover:shadow-md transition'
                    )}
                    style={{ top, height }}
                    title={`${b.label} • ${fmt(b.startHour, b.startMinute ?? 0)}–${fmt(b.endHour, b.endMinute ?? 0)} — clique no X para excluir`}
                  >
                    {/* Top resize handle */}
                    <div
                      onMouseDown={e => startBlockDrag(e, b, day.idx, 'resize-start')}
                      className="absolute top-0 left-0 right-12 h-1 cursor-ns-resize z-10"
                    />
                    {/* Conteúdo */}
                    <div className="px-1.5 py-1 pr-12">
                      <div className="font-bold truncate leading-tight">{b.label}</div>
                      {height > 32 && (
                        <div className="opacity-90 leading-tight">
                          {fmt(b.startHour, b.startMinute ?? 0)}–{fmt(b.endHour, b.endMinute ?? 0)}
                        </div>
                      )}
                    </div>
                    {/* Duplicar */}
                    <button
                      type="button"
                      onMouseDown={e => { e.stopPropagation(); e.preventDefault(); }}
                      onClick={e => {
                        e.stopPropagation();
                        e.preventDefault();
                        const nextDay = (day.idx + 1) % DAYS.length;
                        onCreate({ ...b, blockId: newId(), days: [nextDay] });
                      }}
                      className="absolute top-0 right-6 h-6 w-6 flex items-center justify-center bg-black/20 hover:bg-blue-500/90 transition-colors z-20"
                      title="Duplicar bloco"
                      aria-label="Duplicar bloco"
                    >
                      <Copy className="h-3 w-3" />
                    </button>
                    {/* Excluir */}
                    <button
                      type="button"
                      onMouseDown={e => { e.stopPropagation(); e.preventDefault(); }}
                      onClick={e => {
                        e.stopPropagation();
                        e.preventDefault();
                        onRemove(b.blockId);
                      }}
                      className="absolute top-0 right-0 h-6 w-6 flex items-center justify-center bg-black/20 hover:bg-red-500/90 transition-colors z-20 rounded-bl-md"
                      title="Excluir bloco"
                      aria-label="Excluir bloco"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                    {/* Bottom resize handle */}
                    <div
                      onMouseDown={e => startBlockDrag(e, b, day.idx, 'resize-end')}
                      className="absolute bottom-0 left-0 right-0 h-1.5 cursor-ns-resize z-10"
                    />
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {editingBlock && (
        <BlockEditPopover
          open={!!editingBlock}
          anchorRect={editingBlock.rect}
          currentTypeKey={editingBlock.block.activityType}
          availableTypes={availableTypes}
          userTeams={userTeams}
          onSelectType={(t) => {
            onUpdate(editingBlock.block.blockId, {
              activityType: t.key,
              label: t.label,
              color: t.color,
            });
          }}
          onAddType={async (label, color, teamIds) => {
            if (!onAddType) return null;
            return await onAddType(label, color, teamIds);
          }}
          onClose={() => setEditingBlock(null)}
        />
      )}
    </div>
  );
}
