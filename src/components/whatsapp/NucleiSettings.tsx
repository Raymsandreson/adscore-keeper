import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Pencil, Trash2, Check, X, Building2 } from 'lucide-react';
import { useSpecializedNuclei, SpecializedNucleus } from '@/hooks/useSpecializedNuclei';
import { useCompanies } from '@/hooks/useCompanies';
import { toast } from 'sonner';

const COLORS = ['#ef4444','#f97316','#eab308','#22c55e','#06b6d4','#3b82f6','#8b5cf6','#ec4899','#6b7280'];

export function NucleiSettings() {
  const { nuclei, loading, addNucleus, updateNucleus, deleteNucleus } = useSpecializedNuclei();
  const { activeCompanies, addCompany, fetchCompanies } = useCompanies();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', prefix: '', color: COLORS[0], description: '', company_id: '' });
  const [showNewCompany, setShowNewCompany] = useState(false);
  const [newCompanyName, setNewCompanyName] = useState('');

  const resetForm = () => {
    setForm({ name: '', prefix: '', color: COLORS[0], description: '', company_id: '' });
    setAdding(false);
    setEditingId(null);
  };

  const handleAdd = async () => {
    if (!form.name || !form.prefix) return toast.error('Nome e prefixo são obrigatórios');
    await addNucleus({ ...form, company_id: form.company_id || null });
    resetForm();
  };

  const startEdit = (n: SpecializedNucleus) => {
    setEditingId(n.id);
    setForm({ name: n.name, prefix: n.prefix, color: n.color, description: n.description || '', company_id: n.company_id || '' });
  };

  const handleUpdate = async () => {
    if (!editingId || !form.name || !form.prefix) return;
    await updateNucleus(editingId, { ...form, company_id: form.company_id || null });
    resetForm();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Remover este núcleo?')) return;
    await deleteNucleus(id);
  };

  const FormRow = ({ onSave, onCancel }: { onSave: () => void; onCancel: () => void }) => (
    <div className="space-y-3 p-3 rounded-lg border bg-muted/30">
      <div className="grid grid-cols-2 gap-2">
        <Input placeholder="Nome" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
        <Input placeholder="Prefixo (ex: ATT)" value={form.prefix} onChange={e => setForm(f => ({ ...f, prefix: e.target.value.toUpperCase() }))} maxLength={5} />
      </div>
      <Input placeholder="Descrição (opcional)" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
      <div className="flex items-center gap-2">
        <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
        <Select value={form.company_id} onValueChange={v => setForm(f => ({ ...f, company_id: v === '_none' ? '' : v }))}>
          <SelectTrigger className="h-8 text-xs flex-1">
            <SelectValue placeholder="Vincular a empresa (opcional)" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_none">Nenhuma empresa</SelectItem>
            {activeCompanies.map(c => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Cor:</span>
        {COLORS.map(c => (
          <button key={c} onClick={() => setForm(f => ({ ...f, color: c }))}
            className="h-6 w-6 rounded-full border-2 transition-transform"
            style={{ backgroundColor: c, borderColor: form.color === c ? 'white' : 'transparent', transform: form.color === c ? 'scale(1.2)' : 'scale(1)' }}
          />
        ))}
      </div>
      <div className="flex gap-2 justify-end">
        <Button size="sm" variant="ghost" onClick={onCancel}><X className="h-4 w-4 mr-1" />Cancelar</Button>
        <Button size="sm" onClick={onSave}><Check className="h-4 w-4 mr-1" />Salvar</Button>
      </div>
    </div>
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-base">Núcleos Especializados</CardTitle>
        {!adding && !editingId && (
          <Button size="sm" onClick={() => setAdding(true)}><Plus className="h-4 w-4 mr-1" />Novo Núcleo</Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {adding && <FormRow onSave={handleAdd} onCancel={resetForm} />}

        {loading ? (
          <p className="text-sm text-muted-foreground text-center py-4">Carregando...</p>
        ) : nuclei.length === 0 && !adding ? (
          <p className="text-sm text-muted-foreground text-center py-4">Nenhum núcleo cadastrado</p>
        ) : (
          nuclei.map(n => editingId === n.id ? (
            <FormRow key={n.id} onSave={handleUpdate} onCancel={resetForm} />
          ) : (
            <div key={n.id} className="flex items-center gap-3 p-3 rounded-lg border">
              <div className="h-4 w-4 rounded-full shrink-0" style={{ backgroundColor: n.color }} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{n.name}</span>
                  <Badge variant="outline" className="text-[10px]">{n.prefix}</Badge>
                  {n.company_id && (() => {
                    const company = activeCompanies.find(c => c.id === n.company_id);
                    return company ? <Badge variant="secondary" className="text-[10px]"><Building2 className="h-2.5 w-2.5 mr-0.5" />{company.trading_name || company.name}</Badge> : null;
                  })()}
                </div>
                {n.description && <p className="text-xs text-muted-foreground truncate">{n.description}</p>}
              </div>
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => startEdit(n)}><Pencil className="h-3.5 w-3.5" /></Button>
              <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => handleDelete(n.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
