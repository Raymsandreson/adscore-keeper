import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tag, ChevronDown, Plus, X, Pencil, Trash2, Users2, Lock, Check } from 'lucide-react';
import { classificationColors, classificationLabel } from '@/hooks/useContactClassifications';
import { useClassificationCounts } from '@/hooks/useClassificationContacts';
import { ClassificationContactsSheet } from './ClassificationContactsSheet';

export interface ClassificationOption {
  id?: string;
  name: string;
  color: string;
  label: string;
  isSystem: boolean;
}

interface MultiClassificationSelectProps {
  values: string[];
  onChange: (values: string[]) => void;
  classifications: ClassificationOption[];
  onAddNew: (name: string, color: string) => Promise<any>;
  /** Sem handler, o lápis não aparece. */
  onUpdate?: (id: string, updates: { name?: string; color?: string }) => Promise<boolean>;
  /** Sem handler, a lixeira não aparece. */
  onDelete?: (id: string) => Promise<boolean>;
}

const getLabel = (name: string) => classificationLabel(name);

export const MultiClassificationSelect: React.FC<MultiClassificationSelectProps> = ({
  values,
  onChange,
  classifications,
  onAddNew,
  onUpdate,
  onDelete,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('bg-blue-500');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('bg-blue-500');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [listOpen, setListOpen] = useState(false);
  const [listTarget, setListTarget] = useState<ClassificationOption | null>(null);

  // Contagem só é buscada com o menu aberto (uma RPC agregada, sem payload de linhas).
  const { counts, refresh: refreshCounts } = useClassificationCounts(menuOpen);

  const toggleClassification = (name: string) => {
    if (values.includes(name)) {
      onChange(values.filter(v => v !== name));
    } else {
      onChange([...values, name]);
    }
  };

  const handleAddNew = async () => {
    if (!newName.trim()) return;
    const result = await onAddNew(newName, newColor);
    if (result) {
      onChange([...values, result.name]);
      setIsAddingNew(false);
      setNewName('');
      refreshCounts();
    }
  };

  const startEdit = (option: ClassificationOption) => {
    setConfirmDeleteId(null);
    setEditingId(option.id || null);
    setEditName(option.label);
    setEditColor(option.color?.startsWith('bg-') ? option.color : 'bg-blue-500');
  };

  const saveEdit = async (option: ClassificationOption) => {
    if (!onUpdate || !option.id) return;
    setBusyId(option.id);
    const nextName = editName.trim().toLowerCase().replace(/\s+/g, '_');
    const updates: { name?: string; color?: string } = {};
    if (nextName && nextName !== option.name) updates.name = editName;
    if (editColor !== option.color) updates.color = editColor;

    const ok = Object.keys(updates).length === 0 ? true : await onUpdate(option.id, updates);
    setBusyId(null);
    if (ok) {
      // O status selecionado no contato acompanha o rename.
      if (updates.name && values.includes(option.name)) {
        onChange(values.map(v => (v === option.name ? nextName : v)));
      }
      setEditingId(null);
      refreshCounts();
    }
  };

  const handleDelete = async (option: ClassificationOption) => {
    if (!onDelete || !option.id) return;
    setBusyId(option.id);
    const ok = await onDelete(option.id);
    setBusyId(null);
    if (ok) {
      onChange(values.filter(v => v !== option.name));
      setConfirmDeleteId(null);
      refreshCounts();
    }
  };

  const openList = (option: ClassificationOption) => {
    setMenuOpen(false);
    setListTarget(option);
    setListOpen(true);
  };

  const selectedClassifications = classifications.filter(c => values.includes(c.name));

  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={(v) => {
        setMenuOpen(v);
        if (!v) { setEditingId(null); setConfirmDeleteId(null); setIsAddingNew(false); }
      }}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-auto min-h-[28px] px-2 hover:bg-muted/50 flex flex-wrap gap-1 justify-start"
          >
            {selectedClassifications.length === 0 ? (
              <Badge className="bg-slate-400 text-white text-xs cursor-pointer">
                <Tag className="h-3 w-3" />
                <span className="ml-1">Sem status</span>
                <ChevronDown className="h-3 w-3 ml-1" />
              </Badge>
            ) : (
              <>
                {selectedClassifications.slice(0, 2).map((c) => (
                  <Badge key={c.name} className={`${c.color} text-white text-xs`}>
                    {getLabel(c.name)}
                  </Badge>
                ))}
                {selectedClassifications.length > 2 && (
                  <Badge variant="outline" className="text-xs">
                    +{selectedClassifications.length - 2}
                  </Badge>
                )}
                <ChevronDown className="h-3 w-3 ml-1 text-muted-foreground" />
              </>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-[22rem]">
          <DropdownMenuLabel>Relacionamento Conosco</DropdownMenuLabel>
          <DropdownMenuSeparator />

          {/* Lista com seleção + gestão (editar / excluir / ver contatos) */}
          <div className="p-2 space-y-1 max-h-[320px] overflow-y-auto">
            {classifications.map((option) => {
              const count = counts[option.name];
              const isEditing = !!option.id && editingId === option.id;
              const isConfirming = !!option.id && confirmDeleteId === option.id;
              const busy = !!option.id && busyId === option.id;

              if (isEditing) {
                return (
                  <div key={option.name} className="p-2 space-y-2 rounded border bg-muted/30">
                    <Input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="h-8 text-sm"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveEdit(option);
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <div className="flex gap-1 flex-wrap">
                      {classificationColors.map((c) => (
                        <button
                          key={c.value}
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setEditColor(c.value); }}
                          className={`w-5 h-5 rounded-full ${c.value} ${editColor === c.value ? 'ring-2 ring-offset-1 ring-primary' : ''}`}
                          title={c.label}
                        />
                      ))}
                    </div>
                    {option.isSystem && (
                      <p className="flex items-start gap-1 text-[11px] text-amber-600 dark:text-amber-500">
                        <Lock className="h-3 w-3 mt-0.5 shrink-0" />
                        <span>
                          Status padrão: o código-chave <code className="font-mono">{option.name}</code> é
                          usado em filtros e relatórios. Trocar a cor é seguro; renomear pode quebrá-los.
                        </span>
                      </p>
                    )}
                    <div className="flex gap-1">
                      <Button size="sm" className="h-7 text-xs flex-1" disabled={busy} onClick={() => saveEdit(option)}>
                        <Check className="h-3 w-3 mr-1" /> Salvar
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditingId(null)}>
                        Cancelar
                      </Button>
                    </div>
                  </div>
                );
              }

              if (isConfirming) {
                return (
                  <div key={option.name} className="p-2 space-y-2 rounded border border-destructive/40 bg-destructive/5">
                    <p className="text-xs">
                      Excluir <strong>{getLabel(option.name)}</strong>?
                      {typeof count === 'number' && count > 0 && (
                        <> O status sai de <strong>{count}</strong> contato{count === 1 ? '' : 's'}.</>
                      )}
                    </p>
                    {option.isSystem && (
                      <p className="flex items-start gap-1 text-[11px] text-amber-600 dark:text-amber-500">
                        <Lock className="h-3 w-3 mt-0.5 shrink-0" />
                        <span>
                          Status padrão: <code className="font-mono">{option.name}</code> aparece em
                          filtros e relatórios do sistema. Excluir não desfaz sozinho.
                        </span>
                      </p>
                    )}
                    <div className="flex gap-1">
                      <Button size="sm" variant="destructive" className="h-7 text-xs flex-1" disabled={busy} onClick={() => handleDelete(option)}>
                        {busy ? 'Excluindo...' : 'Excluir'}
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setConfirmDeleteId(null)}>
                        Cancelar
                      </Button>
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={option.name}
                  className="flex items-center gap-2 p-2 rounded hover:bg-muted/50 group"
                >
                  <div
                    className="flex items-center gap-2 min-w-0 flex-1 cursor-pointer"
                    onClick={() => toggleClassification(option.name)}
                  >
                    <Checkbox
                      checked={values.includes(option.name)}
                      onCheckedChange={() => toggleClassification(option.name)}
                    />
                    <Badge className={`${option.color} text-white text-xs max-w-full`}>
                      <Tag className="h-3 w-3 mr-1 shrink-0" />
                      <span className="truncate">{getLabel(option.name)}</span>
                    </Badge>
                  </div>

                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      type="button"
                      title="Ver contatos com esse relacionamento"
                      className="flex items-center gap-1 h-6 px-1.5 rounded text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                      onClick={(e) => { e.stopPropagation(); openList(option); }}
                    >
                      <Users2 className="h-3.5 w-3.5" />
                      <span className="tabular-nums">{typeof count === 'number' ? count : '—'}</span>
                    </button>

                    {onUpdate && option.id && (
                      <button
                        type="button"
                        title="Editar"
                        className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                        onClick={(e) => { e.stopPropagation(); startEdit(option); }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {onDelete && option.id && (
                      <button
                        type="button"
                        title="Excluir"
                        className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        onClick={(e) => { e.stopPropagation(); setEditingId(null); setConfirmDeleteId(option.id!); }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <DropdownMenuSeparator />

          {/* Clear all */}
          {values.length > 0 && (
            <>
              <div
                className="p-2 flex items-center gap-2 cursor-pointer hover:bg-muted/50"
                onClick={() => onChange([])}
              >
                <X className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm">Limpar seleção</span>
              </div>
              <DropdownMenuSeparator />
            </>
          )}

          {/* Add new classification */}
          {isAddingNew ? (
            <div className="p-2 space-y-2">
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Nome do status"
                className="h-8 text-sm"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddNew();
                  if (e.key === 'Escape') setIsAddingNew(false);
                }}
                onClick={(e) => e.stopPropagation()}
              />
              <div className="flex gap-1 flex-wrap">
                {classificationColors.slice(0, 8).map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setNewColor(c.value);
                    }}
                    className={`w-5 h-5 rounded-full ${c.value} ${newColor === c.value ? 'ring-2 ring-offset-1 ring-primary' : ''}`}
                    title={c.label}
                  />
                ))}
              </div>
              <div className="flex gap-1">
                <Button size="sm" className="h-7 text-xs flex-1" onClick={handleAddNew}>
                  Criar
                </Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setIsAddingNew(false)}>
                  Cancelar
                </Button>
              </div>
            </div>
          ) : (
            <div
              className="p-2 flex items-center gap-2 cursor-pointer hover:bg-muted/50"
              onClick={() => setIsAddingNew(true)}
            >
              <Plus className="h-4 w-4" />
              <span className="text-sm">Novo status...</span>
            </div>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <ClassificationContactsSheet
        classification={listTarget?.name || null}
        color={listTarget?.color}
        open={listOpen}
        onOpenChange={setListOpen}
      />
    </>
  );
};

export default MultiClassificationSelect;
