import React from 'react';
import { Pencil, GripVertical, EyeOff, Eye } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  children: React.ReactNode;
  fieldKey: string;
  hidden?: boolean;
  onEdit: () => void;
  onToggleHide: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  isDragging?: boolean;
}

export function FieldCustomizeOverlay({
  children, hidden, onEdit, onToggleHide, onDragStart, onDragOver, onDrop, isDragging,
}: Props) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={cn(
        'relative group rounded-md ring-2 ring-dashed ring-primary/40 hover:ring-primary transition-all p-1 -m-1',
        hidden && 'opacity-40',
        isDragging && 'opacity-30',
      )}
    >
      {/* Top toolbar overlay */}
      <div className="absolute -top-3 left-2 right-2 flex items-center justify-between z-20 pointer-events-none">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onEdit(); }}
          className="pointer-events-auto h-6 px-2 rounded-md bg-primary text-primary-foreground shadow-md flex items-center gap-1 text-[10px] font-medium hover:bg-primary/90"
          title="Editar campo"
        >
          <Pencil className="h-3 w-3" />
          Editar
        </button>
        <div className="flex items-center gap-1 pointer-events-auto">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onToggleHide(); }}
            className="h-6 w-6 rounded-md bg-background border shadow-sm flex items-center justify-center hover:bg-accent"
            title={hidden ? 'Mostrar nesta aba' : 'Ocultar deste funil'}
          >
            {hidden ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.stopPropagation()}
            className="h-6 w-6 rounded-md bg-background border shadow-sm flex items-center justify-center cursor-grab active:cursor-grabbing"
            title="Arraste para outra aba ou para reordenar"
          >
            <GripVertical className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className={cn('pt-2', hidden && 'pointer-events-none')}>{children}</div>
    </div>
  );
}
