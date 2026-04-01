import { useState, memo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Plus, Pencil, Trash2, Check, X, Building2 } from 'lucide-react';
import { useSpecializedNuclei, SpecializedNucleus } from '@/hooks/useSpecializedNuclei';
import { useCompanies, Company } from '@/hooks/useCompanies';
import { toast } from 'sonner';
import { Checkbox } from '@/components/ui/checkbox';

const COLORS = ['#ef4444','#f97316','#eab308','#22c55e','#06b6d4','#3b82f6','#8b5cf6','#ec4899','#6b7280'];

interface FormState {
  name: string;
  prefix: string;
  color: string;
  description: string;
  company_ids: string[];
}

interface FormRowProps {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  showNewCompany: boolean;
  setShowNewCompany: React.Dispatch<React.SetStateAction<boolean>>;
  newCompanyName: string;
  setNewCompanyName: React.Dispatch<React.SetStateAction<string>>;
  activeCompanies: Company[];
  onAddCompany: (data: { name: string }) => Promise<Company>;
  onSave: () => void;
  onCancel: () => void;
}

const FormRow = memo(function FormRow({
  form, setForm, showNewCompany, setShowNewCompany,
  newCompanyName, setNewCompanyName, activeCompanies,
  onAddCompany, onSave, onCancel
}: FormRowProps) {
  const toggleCompany = (companyId: string) => {
    setForm(f => ({
      ...f,
      company_ids: f.company_ids.includes(companyId)
        ? f.company_ids.filter(id => id !== companyId)
        : [...f.company_ids, companyId]
    }));
  };

  return (
    <div className="space-y-3 p-3 rounded-lg border bg-muted/30">
      <div className="grid grid-cols-2 gap-2">
        <Input placeholder="Nome" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
        <Input placeholder="Prefixo (ex: ATT)" value={form.prefix} onChange={e => setForm(f => ({ ...f, prefix: e.target.value.toUpperCase() }))} maxLength={5} />
      </div>
      <Input placeholder="Descrição (opcional)" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Empresas vinculadas:</span>
          <Button type="button" size="sm" variant="outline" className="h-7 text-xs shrink-0 ml-auto" onClick={() => setShowNewCompany(s => !s)}>
            <Plus className="h-3 w-3 mr-1" />Nova
          </Button>
        </div>
        {activeCompanies.length > 0 && (
          <div className="grid grid-cols-1 gap-1.5 pl-6 max-h-32 overflow-y-auto">
            {activeCompanies.map(c => (
              <label key={c.id} className="flex items-center gap-2 cursor-pointer text-xs hover:bg-muted/50 rounded px-1 py-0.5">
                <Checkbox
                  checked={form.company_ids.includes(c.id)}
                  onCheckedChange={() => toggleCompany(c.id)}
                />
                <span>{c.trading_name || c.name}</span>
              </label>
            ))}
          </div>
        )}
        {showNewCompany && (
          <div className="flex items-center gap-2 pl-6">
            <Input
              placeholder="Nome da empresa"
              value={newCompanyName}
              onChange={e => setNewCompanyName(e.target.value)}
              className="h-8 text-xs"
              autoFocus
            />
            <Button
              size="sm"
              className="h-8 text-xs shrink-0"
              disabled={!newCompanyName.trim()}
              onClick={async () => {
                try {
                  const company = await onAddCompany({ name: newCompanyName.trim() });
                  setForm(f => ({ ...f, company_ids: [...f.company_ids, company.id] }));
                  setNewCompanyName('');
                  setShowNewCompany(false);
                  toast.success('Empresa criada');
                } catch (e) {
                  toast.error('Erro ao criar empresa');
                }
              }}
            >
              <Check className="h-3 w-3 mr-1" />Criar
            </Button>
            <Button size="sm" variant="ghost" className="h-8 text-xs shrink-0" onClick={() => { setShowNewCompany(false); setNewCompanyName(''); }}>
              <X className="h-3 w-3" />
            </Button>
          </div>
        )}
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
});

export function NucleiSettings() {
  const { nuclei, loading, addNucleus, updateNucleus, deleteNucleus } = useSpecializedNuclei();
  const { activeCompanies, addCompany } = useCompanies();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({ name: '', prefix: '', color: COLORS[0], description: '', company_ids: [] });
  const [showNewCompany, setShowNewCompany] = useState(false);
  const [newCompanyName, setNewCompanyName] = useState('');

  const resetForm = () => {
    setForm({ name: '', prefix: '', color: COLORS[0], description: '', company_ids: [] });
    setAdding(false);
    setEditingId(null);
  };

  const handleAdd = async () => {
    if (!form.name || !form.prefix) return toast.error('Nome e prefixo são obrigatórios');
    await addNucleus({ ...form });
    resetForm();
  };

  const startEdit = (n: SpecializedNucleus) => {
    setEditingId(n.id);
    setForm({ name: n.name, prefix: n.prefix, color: n.color, description: n.description || '', company_ids: n.company_ids || [] });
  };

  const handleUpdate = async () => {
    if (!editingId || !form.name || !form.prefix) return;
    await updateNucleus(editingId, { ...form });
    resetForm();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Remover este núcleo?')) return;
    await deleteNucleus(id);
  };

  const formRowProps = {
    form, setForm, showNewCompany, setShowNewCompany,
    newCompanyName, setNewCompanyName, activeCompanies,
    onAddCompany: addCompany,
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-base">Núcleos Especializados</CardTitle>
        {!adding && !editingId && (
          <Button size="sm" onClick={() => setAdding(true)}><Plus className="h-4 w-4 mr-1" />Novo Núcleo</Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {adding && <FormRow {...formRowProps} onSave={handleAdd} onCancel={resetForm} />}

        {loading ? (
          <p className="text-sm text-muted-foreground text-center py-4">Carregando...</p>
        ) : nuclei.length === 0 && !adding ? (
          <p className="text-sm text-muted-foreground text-center py-4">Nenhum núcleo cadastrado</p>
        ) : (
          nuclei.map(n => editingId === n.id ? (
            <FormRow key={n.id} {...formRowProps} onSave={handleUpdate} onCancel={resetForm} />
          ) : (
            <div key={n.id} className="flex items-center gap-3 p-3 rounded-lg border">
              <div className="h-4 w-4 rounded-full shrink-0" style={{ backgroundColor: n.color }} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium">{n.name}</span>
                  <Badge variant="outline" className="text-[10px]">{n.prefix}</Badge>
                  {(n.company_ids || []).map(cid => {
                    const company = activeCompanies.find(c => c.id === cid);
                    return company ? (
                      <Badge key={cid} variant="secondary" className="text-[10px]">
                        <Building2 className="h-2.5 w-2.5 mr-0.5" />{company.trading_name || company.name}
                      </Badge>
                    ) : null;
                  })}
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
