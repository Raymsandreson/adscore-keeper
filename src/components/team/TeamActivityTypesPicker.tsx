import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  CheckCircle2,
  Circle,
  ChevronDown,
  ChevronUp,
  ListChecks,
  Loader2,
  Search,
  X,
  Plus,
  Pencil,
  Trash2,
  Check,
  AlertTriangle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useActivityTypes, type ActivityType } from '@/hooks/useActivityTypes';
import { externalSupabase } from '@/integrations/supabase/external-client';
import { supabase as cloudSupabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface Props {
  teamId: string;
}

const COLOR_OPTIONS = [
  'bg-red-500', 'bg-orange-500', 'bg-amber-500', 'bg-yellow-500',
  'bg-lime-500', 'bg-green-500', 'bg-emerald-500', 'bg-teal-500',
  'bg-cyan-500', 'bg-sky-500', 'bg-blue-500', 'bg-indigo-500',
  'bg-violet-500', 'bg-purple-500', 'bg-fuchsia-500', 'bg-pink-500',
  'bg-rose-500', 'bg-slate-500',
];

/**
 * Lets an admin pick which activity types are exclusive to a team,
 * and also create / edit / delete activity types inline.
 */
export function TeamActivityTypesPicker({ teamId }: Props) {
  const { types, loading, updateType, addType, deleteType } = useActivityTypes();
  const [expanded, setExpanded] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  // Create form state
  const [creating, setCreating] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newColor, setNewColor] = useState(COLOR_OPTIONS[5]);
  const [savingNew, setSavingNew] = useState(false);

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editColor, setEditColor] = useState(COLOR_OPTIONS[5]);

  // Delete with migration
  const [deleteConfirm, setDeleteConfirm] = useState<{
    type: ActivityType;
    activitiesCount: number;
    routinesCount: number;
  } | null>(null);
  const [loadingLinked, setLoadingLinked] = useState(false);
  const [migrateToKey, setMigrateToKey] = useState('');
  const [deletingType, setDeletingType] = useState(false);

  const linkedTypes = types.filter(t => (t.team_ids || []).includes(teamId));

  const toggleType = async (typeId: string, currentTeamIds: string[]) => {
    const isLinked = currentTeamIds.includes(teamId);
    const newIds = isLinked
      ? currentTeamIds.filter(id => id !== teamId)
      : [...currentTeamIds, teamId];
    setSavingKey(typeId);
    await updateType(typeId, { team_ids: newIds });
    setSavingKey(null);
  };

  const handleCreate = async () => {
    if (!newLabel.trim()) return;
    setSavingNew(true);
    await addType(newLabel.trim(), newColor);
    setSavingNew(false);
    setNewLabel('');
    setNewColor(COLOR_OPTIONS[5]);
    setCreating(false);
  };

  const startEdit = (t: ActivityType) => {
    setEditingId(t.id);
    setEditLabel(t.label);
    setEditColor(t.color);
  };

  const saveEdit = async () => {
    if (!editingId || !editLabel.trim()) return;
    setSavingKey(editingId);
    await updateType(editingId, { label: editLabel.trim(), color: editColor });
    setSavingKey(null);
    setEditingId(null);
  };

  const handleDeleteCheck = async (type: ActivityType) => {
    setLoadingLinked(true);
    setMigrateToKey('');
    try {
      const [activitiesRes, blocksRes] = await Promise.all([
        externalSupabase
          .from('lead_activities')
          .select('id', { count: 'exact', head: true })
          .eq('activity_type', type.key),
        cloudSupabase
          .from('user_timeblock_settings')
          .select('id', { count: 'exact', head: true })
          .eq('activity_type', type.key),
      ]);

      const activitiesCount = activitiesRes.count || 0;
      const routinesCount = blocksRes.count || 0;

      if (activitiesCount + routinesCount === 0) {
        if (!confirm(`Excluir o tipo "${type.label}"? Essa ação não pode ser desfeita.`)) return;
        setSavingKey(type.id);
        await deleteType(type.id);
        setSavingKey(null);
        if (editingId === type.id) setEditingId(null);
        return;
      }

      setDeleteConfirm({ type, activitiesCount, routinesCount });
    } catch (e: any) {
      toast.error('Erro ao buscar vínculos: ' + (e.message || ''));
    } finally {
      setLoadingLinked(false);
    }
  };

  const handleDeleteWithMigration = async () => {
    if (!deleteConfirm || !migrateToKey) return;
    setDeletingType(true);
    try {
      await externalSupabase
        .from('lead_activities')
        .update({ activity_type: migrateToKey } as any)
        .eq('activity_type', deleteConfirm.type.key);
      await cloudSupabase
        .from('user_timeblock_settings')
        .update({ activity_type: migrateToKey } as any)
        .eq('activity_type', deleteConfirm.type.key);
      await deleteType(deleteConfirm.type.id);
      toast.success('Tipo excluído e registros migrados!');
      setDeleteConfirm(null);
      if (editingId === deleteConfirm.type.id) setEditingId(null);
    } catch (e: any) {
      toast.error('Erro ao migrar: ' + (e.message || 'Erro desconhecido'));
    } finally {
      setDeletingType(false);
    }
  };

  return (
    <div>
      <button
        onClick={() => setExpanded(prev => !prev)}
        className="flex items-center justify-between w-full text-xs text-muted-foreground hover:text-foreground transition-colors py-1 mb-1"
      >
        <span className="flex items-center gap-1.5 font-medium">
          <ListChecks className="h-3.5 w-3.5" />
          Tipos de atividade do time
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
            {linkedTypes.length}
          </Badge>
        </span>
        {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>

      <div
        className={cn(
          'overflow-hidden transition-all duration-200',
          expanded ? 'max-h-[700px] opacity-100' : 'max-h-0 opacity-0'
        )}
      >
        <div className="space-y-2">
          {linkedTypes.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {linkedTypes.map(t => (
                <Badge
                  key={t.id}
                  variant="outline"
                  className="gap-1.5 text-[11px] pr-1 cursor-pointer hover:bg-destructive/10"
                  onClick={() => toggleType(t.id, t.team_ids || [])}
                >
                  <span className={cn('h-2 w-2 rounded-full', t.color)} />
                  {t.label}
                  {savingKey === t.id ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <X className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                  )}
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground italic">
              Nenhum tipo exclusivo. Membros deste time veem apenas os tipos globais.
            </p>
          )}

          <Popover onOpenChange={(o) => { if (!o) { setSearch(''); setCreating(false); setEditingId(null); } }}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5 w-full">
                <ListChecks className="h-3.5 w-3.5" />
                Gerenciar tipos
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-80 p-2">
              <div className="flex items-center justify-between px-2 py-1.5">
                <p className="text-xs font-semibold">Tipos de atividade</p>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-[11px] gap-1"
                  onClick={() => { setCreating(c => !c); setEditingId(null); }}
                >
                  <Plus className="h-3 w-3" />
                  {creating ? 'Cancelar' : 'Novo'}
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground px-2 pb-2">
                Clique para vincular ao time. Tipos sem time = visíveis a todos.
              </p>

              {creating && (
                <div className="mb-2 p-2 rounded border border-border bg-muted/30 space-y-2">
                  <Input
                    value={newLabel}
                    onChange={e => setNewLabel(e.target.value)}
                    placeholder="Nome do novo tipo..."
                    className="h-7 text-xs"
                    autoFocus
                    onKeyDown={e => { if (e.key === 'Enter') handleCreate(); }}
                  />
                  <div className="flex flex-wrap gap-1">
                    {COLOR_OPTIONS.map(c => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setNewColor(c)}
                        className={cn(
                          'h-4 w-4 rounded-full border transition-all',
                          c,
                          newColor === c ? 'ring-2 ring-offset-1 ring-foreground scale-110' : 'border-transparent'
                        )}
                      />
                    ))}
                  </div>
                  <Button size="sm" className="h-7 w-full text-xs" onClick={handleCreate} disabled={savingNew || !newLabel.trim()}>
                    {savingNew ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Criar tipo'}
                  </Button>
                </div>
              )}

              <div className="relative px-1 pb-2">
                <Search className="h-3.5 w-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                <Input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Buscar tipo..."
                  className="h-8 text-xs pl-8"
                />
              </div>
              {loading ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <ScrollArea className="h-[260px]">
                  <div className="space-y-0.5 pr-2">
                    {(() => {
                      const q = search.trim().toLowerCase();
                      const list = types
                        .filter(t => !q || t.label.toLowerCase().includes(q))
                        .slice()
                        .sort((a, b) => {
                          const aL = (a.team_ids || []).includes(teamId) ? 0 : 1;
                          const bL = (b.team_ids || []).includes(teamId) ? 0 : 1;
                          return aL - bL;
                        });
                      if (list.length === 0) {
                        return (
                          <p className="text-[11px] text-muted-foreground italic text-center py-6">
                            Nenhum tipo encontrado.
                          </p>
                        );
                      }
                      return list.map(t => {
                        const teamIds = t.team_ids || [];
                        const isLinked = teamIds.includes(teamId);
                        const isEditing = editingId === t.id;

                        if (isEditing) {
                          return (
                            <div key={t.id} className="p-2 rounded bg-muted/40 space-y-2">
                              <Input
                                value={editLabel}
                                onChange={e => setEditLabel(e.target.value)}
                                className="h-7 text-xs"
                                autoFocus
                                onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditingId(null); }}
                              />
                              <div className="flex flex-wrap gap-1">
                                {COLOR_OPTIONS.map(c => (
                                  <button
                                    key={c}
                                    type="button"
                                    onClick={() => setEditColor(c)}
                                    className={cn(
                                      'h-4 w-4 rounded-full border transition-all',
                                      c,
                                      editColor === c ? 'ring-2 ring-offset-1 ring-foreground scale-110' : 'border-transparent'
                                    )}
                                  />
                                ))}
                              </div>
                              <div className="flex gap-1">
                                <Button size="sm" className="h-6 flex-1 text-[11px]" onClick={saveEdit} disabled={savingKey === t.id}>
                                  {savingKey === t.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <><Check className="h-3 w-3 mr-1" />Salvar</>}
                                </Button>
                                <Button size="sm" variant="ghost" className="h-6 text-[11px]" onClick={() => setEditingId(null)}>
                                  Cancelar
                                </Button>
                              </div>
                            </div>
                          );
                        }

                        return (
                          <div
                            key={t.id}
                            className="group flex items-center gap-2 px-2 py-1.5 rounded text-xs hover:bg-muted transition-colors"
                          >
                            <button
                              onClick={() => toggleType(t.id, teamIds)}
                              disabled={savingKey === t.id}
                              className="flex items-center gap-2 flex-1 min-w-0 text-left"
                            >
                              <span className={cn('h-2.5 w-2.5 rounded-full flex-shrink-0', t.color)} />
                              <span className="flex-1 truncate">{t.label}</span>
                              {teamIds.length > 0 ? (
                                <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4">
                                  {teamIds.length} time{teamIds.length > 1 ? 's' : ''}
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="text-[9px] px-1 py-0 h-4">
                                  global
                                </Badge>
                              )}
                              {savingKey === t.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                              ) : isLinked ? (
                                <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
                              ) : (
                                <Circle className="h-3.5 w-3.5 text-muted-foreground/40" />
                              )}
                            </button>
                            <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                onClick={(e) => { e.stopPropagation(); startEdit(t); }}
                                className="p-1 hover:text-foreground text-muted-foreground"
                                title="Editar"
                              >
                                <Pencil className="h-3 w-3" />
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleDeleteCheck(t); }}
                                disabled={loadingLinked}
                                className="p-1 hover:text-destructive text-muted-foreground disabled:opacity-50"
                                title="Excluir"
                              >
                                {loadingLinked ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                              </button>
                            </div>
                          </div>
                        );
                      });
                    })()}
                  </div>
                </ScrollArea>
              )}
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* Delete with migration dialog */}
      <Dialog open={!!deleteConfirm} onOpenChange={(o) => !o && !deletingType && setDeleteConfirm(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Tipo em uso
            </DialogTitle>
            <DialogDescription>
              O tipo <strong>"{deleteConfirm?.type.label}"</strong> está vinculado a{' '}
              <strong>{deleteConfirm?.activitiesCount ?? 0}</strong> atividade(s) e{' '}
              <strong>{deleteConfirm?.routinesCount ?? 0}</strong> bloco(s) de rotina.
              Escolha para qual tipo migrar antes de excluir.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Migrar para qual tipo?
            </label>
            <Select value={migrateToKey} onValueChange={setMigrateToKey}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione o tipo de destino..." />
              </SelectTrigger>
              <SelectContent>
                {types
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
          </div>

          <DialogFooter>
            <Button variant="outline" disabled={deletingType} onClick={() => setDeleteConfirm(null)}>
              Cancelar
            </Button>
            <Button
              onClick={handleDeleteWithMigration}
              disabled={!migrateToKey || deletingType}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletingType ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Trash2 className="h-4 w-4 mr-1" />}
              Migrar e Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
