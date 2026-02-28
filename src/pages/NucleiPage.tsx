import { useState } from 'react';
import { useSpecializedNuclei, SpecializedNucleus } from '@/hooks/useSpecializedNuclei';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Atom, Plus, Pencil, Trash2, Hash } from 'lucide-react';

const PRESET_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4',
  '#3b82f6', '#8b5cf6', '#ec4899', '#6b7280', '#0ea5e9',
];

export default function NucleiPage() {
  const { nuclei, loading, addNucleus, updateNucleus, deleteNucleus } = useSpecializedNuclei();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<SpecializedNucleus | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // Form state
  const [name, setName] = useState('');
  const [prefix, setPrefix] = useState('');
  const [color, setColor] = useState(PRESET_COLORS[0]);
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  const openNew = () => {
    setEditing(null);
    setName('');
    setPrefix('');
    setColor(PRESET_COLORS[0]);
    setDescription('');
    setDialogOpen(true);
  };

  const openEdit = (n: SpecializedNucleus) => {
    setEditing(n);
    setName(n.name);
    setPrefix(n.prefix);
    setColor(n.color);
    setDescription(n.description || '');
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!name.trim() || !prefix.trim()) return;
    setSaving(true);
    try {
      if (editing) {
        await updateNucleus(editing.id, { name: name.trim(), prefix: prefix.trim().toUpperCase(), color, description: description.trim() || null });
      } else {
        await addNucleus({ name: name.trim(), prefix: prefix.trim().toUpperCase(), color, description: description.trim() || null });
      }
      setDialogOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (n: SpecializedNucleus) => {
    await updateNucleus(n.id, { is_active: !n.is_active });
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    await deleteNucleus(deleteId);
    setDeleteId(null);
  };

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Atom className="h-5 w-5 text-primary" />
            <h1 className="text-lg font-semibold">Núcleos Especializados</h1>
          </div>
          <Button size="sm" onClick={openNew}>
            <Plus className="h-4 w-4 mr-1" /> Novo
          </Button>
        </div>
      </div>

      {/* List */}
      <div className="p-4 space-y-3">
        {loading && <p className="text-center py-12 text-muted-foreground">Carregando...</p>}

        {!loading && nuclei.length === 0 && (
          <div className="text-center py-16 text-muted-foreground space-y-2">
            <Atom className="h-10 w-10 mx-auto opacity-40" />
            <p className="text-sm">Nenhum núcleo cadastrado</p>
            <Button variant="outline" size="sm" onClick={openNew}>
              <Plus className="h-4 w-4 mr-1" /> Criar primeiro núcleo
            </Button>
          </div>
        )}

        {nuclei.map(n => (
          <Card key={n.id} className="p-4">
            <div className="flex items-center gap-3">
              <span className="w-4 h-4 rounded-full shrink-0" style={{ backgroundColor: n.color }} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-medium truncate">{n.name}</p>
                  <Badge variant="secondary" className="text-[10px] font-mono shrink-0">
                    <Hash className="h-2.5 w-2.5 mr-0.5" />{n.prefix}
                  </Badge>
                  {!n.is_active && (
                    <Badge variant="outline" className="text-[10px] text-muted-foreground shrink-0">Inativo</Badge>
                  )}
                </div>
                {n.description && (
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">{n.description}</p>
                )}
                <p className="text-[10px] text-muted-foreground mt-1">
                  Sequência atual: {n.sequence_counter}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Switch checked={n.is_active} onCheckedChange={() => handleToggleActive(n)} />
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(n)}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setDeleteId(n.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar Núcleo' : 'Novo Núcleo'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Nome *</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="Ex: Acidente de Trabalho" className="mt-1" />
            </div>
            <div>
              <Label>Prefixo *</Label>
              <Input value={prefix} onChange={e => setPrefix(e.target.value.toUpperCase())} placeholder="Ex: AT" maxLength={6} className="mt-1 font-mono" />
              <p className="text-[10px] text-muted-foreground mt-1">Usado na numeração dos casos (ex: AT-0001)</p>
            </div>
            <div>
              <Label>Cor</Label>
              <div className="flex gap-2 mt-1 flex-wrap">
                {PRESET_COLORS.map(c => (
                  <button
                    key={c}
                    onClick={() => setColor(c)}
                    className={`w-7 h-7 rounded-full border-2 transition-transform ${color === c ? 'border-foreground scale-110' : 'border-transparent'}`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
            <div>
              <Label>Descrição</Label>
              <Input value={description} onChange={e => setDescription(e.target.value)} placeholder="Descrição opcional..." className="mt-1" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving || !name.trim() || !prefix.trim()}>
              {saving ? 'Salvando...' : editing ? 'Salvar' : 'Criar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={open => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir núcleo?</AlertDialogTitle>
            <AlertDialogDescription>
              Casos existentes vinculados a este núcleo não serão afetados, mas novos casos não poderão usá-lo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
