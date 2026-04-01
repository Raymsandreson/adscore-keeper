import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Plus, Pencil, Trash2, Check, X, Building2, ChevronRight, ChevronDown, Lightbulb, Package, Kanban } from 'lucide-react';
import { useSpecializedNuclei, SpecializedNucleus } from '@/hooks/useSpecializedNuclei';
import { useCompanies, Company } from '@/hooks/useCompanies';
import { useProductsServices, ProductService } from '@/hooks/useProductsServices';
import { useKanbanBoards } from '@/hooks/useKanbanBoards';
import { toast } from 'sonner';

const COLORS = ['#ef4444','#f97316','#eab308','#22c55e','#06b6d4','#3b82f6','#8b5cf6','#ec4899','#6b7280'];

// ─── Inline Forms ───────────────────────────────────────────────────

function InlineNucleusForm({ onSave, onCancel, initial }: {
  onSave: (data: { name: string; prefix: string; color: string; description: string }) => void;
  onCancel: () => void;
  initial?: { name: string; prefix: string; color: string; description: string };
}) {
  const [form, setForm] = useState(initial || { name: '', prefix: '', color: COLORS[0], description: '' });
  return (
    <div className="space-y-2 p-2 rounded border bg-muted/30">
      <div className="grid grid-cols-2 gap-2">
        <Input autoFocus placeholder="Nome do núcleo" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="h-8 text-xs" />
        <Input placeholder="Prefixo (ex: ATT)" value={form.prefix} onChange={e => setForm(f => ({ ...f, prefix: e.target.value.toUpperCase() }))} maxLength={5} className="h-8 text-xs" />
      </div>
      <Input placeholder="Descrição (opcional)" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className="h-8 text-xs" />
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] text-muted-foreground">Cor:</span>
        {COLORS.map(c => (
          <button key={c} onClick={() => setForm(f => ({ ...f, color: c }))}
            className="h-5 w-5 rounded-full border-2 transition-transform"
            style={{ backgroundColor: c, borderColor: form.color === c ? 'white' : 'transparent', transform: form.color === c ? 'scale(1.15)' : 'scale(1)' }}
          />
        ))}
      </div>
      <div className="flex gap-2 justify-end">
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onCancel}><X className="h-3 w-3 mr-1" />Cancelar</Button>
        <Button size="sm" className="h-7 text-xs" disabled={!form.name || !form.prefix} onClick={() => onSave(form)}>
          <Check className="h-3 w-3 mr-1" />Salvar
        </Button>
      </div>
    </div>
  );
}

function InlineProductForm({ onSave, onCancel }: {
  onSave: (data: { name: string; description: string }) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({ name: '', description: '' });
  return (
    <div className="flex items-center gap-2 p-2 rounded border bg-muted/30 ml-4">
      <Input autoFocus placeholder="Nome do produto" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="h-8 text-xs flex-1" />
      <Input placeholder="Descrição" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className="h-8 text-xs flex-1" />
      <Button size="sm" className="h-8 text-xs shrink-0" disabled={!form.name.trim()} onClick={() => onSave(form)}>
        <Check className="h-3 w-3 mr-1" />Salvar
      </Button>
      <Button size="sm" variant="ghost" className="h-8 text-xs shrink-0" onClick={onCancel}><X className="h-3 w-3" /></Button>
    </div>
  );
}

// ─── Leaf: Funnel ───────────────────────────────────────────────────

function FunnelRow({ board }: { board: { id: string; name: string } }) {
  return (
    <div className="flex items-center gap-2 py-1 pl-8 text-xs text-muted-foreground">
      <Kanban className="h-3 w-3 text-primary/60" />
      <span>{board.name}</span>
      <Badge variant="outline" className="text-[9px] h-4">Funil</Badge>
    </div>
  );
}

// ─── Product Row ────────────────────────────────────────────────────

function ProductRow({ product, funnels, onDelete }: {
  product: ProductService;
  funnels: { id: string; name: string }[];
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="flex items-center gap-2 py-1.5 pl-4 group">
        <CollapsibleTrigger asChild>
          <button className="p-0.5 rounded hover:bg-muted">
            {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </button>
        </CollapsibleTrigger>
        <Package className="h-3.5 w-3.5 text-orange-500" />
        <span className="text-xs font-medium">{product.name}</span>
        {funnels.length > 0 && <Badge variant="secondary" className="text-[9px] h-4">{funnels.length} funil(is)</Badge>}
        <Button size="icon" variant="ghost" className="h-5 w-5 opacity-0 group-hover:opacity-100 ml-auto" onClick={onDelete}><Trash2 className="h-3 w-3 text-destructive" /></Button>
      </div>
      <CollapsibleContent>
        {funnels.length > 0 ? funnels.map(f => <FunnelRow key={f.id} board={f} />) : (
          <p className="text-[10px] text-muted-foreground pl-8 py-1">Nenhum funil vinculado</p>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

// ─── Company Picker (inside nucleus) ────────────────────────────────

function CompanyLinker({ nucleus, companies, onToggle }: {
  nucleus: SpecializedNucleus;
  companies: Company[];
  onToggle: (companyId: string, linked: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const linkedIds = nucleus.company_ids || [];

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="flex items-center gap-2 py-1 pl-4">
        <CollapsibleTrigger asChild>
          <button className="p-0.5 rounded hover:bg-muted">
            {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </button>
        </CollapsibleTrigger>
        <Building2 className="h-3.5 w-3.5 text-blue-500" />
        <span className="text-xs text-muted-foreground">
          {linkedIds.length > 0
            ? companies.filter(c => linkedIds.includes(c.id)).map(c => c.trading_name || c.name).join(', ')
            : 'Nenhuma empresa vinculada'}
        </span>
        <Badge variant="secondary" className="text-[9px] h-4">{linkedIds.length}</Badge>
      </div>
      <CollapsibleContent className="pl-8 py-1 space-y-1">
        {companies.map(c => (
          <label key={c.id} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-muted/30 rounded px-2 py-0.5">
            <Checkbox
              checked={linkedIds.includes(c.id)}
              onCheckedChange={(checked) => onToggle(c.id, !!checked)}
            />
            <span>{c.trading_name || c.name}</span>
          </label>
        ))}
        {companies.length === 0 && <p className="text-[10px] text-muted-foreground">Nenhuma empresa cadastrada</p>}
      </CollapsibleContent>
    </Collapsible>
  );
}

// ─── Nucleus Row (TOP LEVEL) ────────────────────────────────────────

function NucleusRow({ nucleus, companies, products, boards, onEdit, onDelete, onAddProduct, onDeleteProduct, onToggleCompany }: {
  nucleus: SpecializedNucleus;
  companies: Company[];
  products: ProductService[];
  boards: { id: string; name: string; product_service_id: string | null }[];
  onEdit: () => void;
  onDelete: () => void;
  onAddProduct: (data: { name: string; description: string }) => void;
  onDeleteProduct: (id: string) => void;
  onToggleCompany: (nucleusId: string, companyId: string, linked: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [addingProduct, setAddingProduct] = useState(false);

  const nucleusProducts = products.filter(p => p.nucleus_id === nucleus.id);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="flex items-center gap-2 p-2 rounded-lg border group hover:bg-muted/30">
        <CollapsibleTrigger asChild>
          <button className="p-0.5 rounded hover:bg-muted">
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </CollapsibleTrigger>
        <div className="h-3.5 w-3.5 rounded-full shrink-0" style={{ backgroundColor: nucleus.color }} />
        <Lightbulb className="h-4 w-4 text-yellow-500" />
        <span className="text-sm font-semibold">{nucleus.name}</span>
        <Badge variant="outline" className="text-[9px] h-4 font-mono">{nucleus.prefix}</Badge>
        {nucleusProducts.length > 0 && <Badge variant="secondary" className="text-[9px] h-4">{nucleusProducts.length} produto(s)</Badge>}
        {(nucleus.company_ids?.length || 0) > 0 && (
          <Badge variant="secondary" className="text-[9px] h-4">
            <Building2 className="h-2.5 w-2.5 mr-0.5" />{nucleus.company_ids.length}
          </Badge>
        )}
        <div className="flex items-center gap-0.5 ml-auto opacity-0 group-hover:opacity-100">
          <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={(e) => { e.stopPropagation(); setAddingProduct(true); setOpen(true); }}>
            <Plus className="h-3 w-3 mr-0.5" />Produto
          </Button>
          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={onEdit}><Pencil className="h-3 w-3" /></Button>
          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={onDelete}><Trash2 className="h-3 w-3 text-destructive" /></Button>
        </div>
      </div>
      <CollapsibleContent className="space-y-0.5 mt-1 ml-2">
        {/* Companies linked */}
        <CompanyLinker
          nucleus={nucleus}
          companies={companies}
          onToggle={(companyId, linked) => onToggleCompany(nucleus.id, companyId, linked)}
        />

        {/* Products */}
        {addingProduct && (
          <InlineProductForm
            onSave={(data) => { onAddProduct(data); setAddingProduct(false); }}
            onCancel={() => setAddingProduct(false)}
          />
        )}
        {nucleusProducts.length > 0 ? nucleusProducts.map(p => (
          <ProductRow
            key={p.id}
            product={p}
            funnels={boards.filter(b => b.product_service_id === p.id)}
            onDelete={() => onDeleteProduct(p.id)}
          />
        )) : !addingProduct && (
          <p className="text-[10px] text-muted-foreground pl-4 py-1">Nenhum produto neste núcleo</p>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

// ─── Main Component ─────────────────────────────────────────────────

export function NucleiSettings() {
  const { nuclei, loading, addNucleus, updateNucleus, deleteNucleus } = useSpecializedNuclei();
  const { companies, activeCompanies } = useCompanies();
  const { products, addProduct, deleteProduct } = useProductsServices();
  const { boards } = useKanbanBoards();
  const [addingNucleus, setAddingNucleus] = useState(false);
  const [editingNucleus, setEditingNucleus] = useState<SpecializedNucleus | null>(null);

  const funnelBoards = useMemo(() =>
    (boards || []).filter((b: any) => b.board_type === 'funnel').map((b: any) => ({ id: b.id, name: b.name, product_service_id: b.product_service_id || null })),
    [boards]
  );

  const handleAddNucleus = async (data: { name: string; prefix: string; color: string; description: string }) => {
    await addNucleus({ ...data });
    setAddingNucleus(false);
  };

  const handleEditNucleus = async (nucleus: SpecializedNucleus, data: { name: string; prefix: string; color: string; description: string }) => {
    await updateNucleus(nucleus.id, { name: data.name, prefix: data.prefix, color: data.color, description: data.description, company_ids: nucleus.company_ids });
    setEditingNucleus(null);
  };

  const handleDeleteNucleus = async (id: string) => {
    if (!confirm('Remover este núcleo?')) return;
    await deleteNucleus(id);
  };

  const handleAddProduct = async (nucleusId: string, data: { name: string; description: string }) => {
    await addProduct({ name: data.name, description: data.description, nucleus_id: nucleusId });
  };

  const handleDeleteProduct = async (id: string) => {
    if (!confirm('Remover este produto?')) return;
    await deleteProduct(id);
  };

  const handleToggleCompany = async (nucleusId: string, companyId: string, linked: boolean) => {
    const nucleus = nuclei.find(n => n.id === nucleusId);
    if (!nucleus) return;
    const currentIds = nucleus.company_ids || [];
    const newIds = linked
      ? [...currentIds, companyId]
      : currentIds.filter(id => id !== companyId);
    await updateNucleus(nucleusId, { company_ids: newIds });
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div>
          <CardTitle className="text-base">Ecossistema</CardTitle>
          <p className="text-xs text-muted-foreground mt-0.5">Núcleo → Empresa(s) → Produto → Funil</p>
        </div>
        <Button size="sm" onClick={() => setAddingNucleus(true)}>
          <Plus className="h-4 w-4 mr-1" />Novo Núcleo
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {addingNucleus && (
          <InlineNucleusForm onSave={handleAddNucleus} onCancel={() => setAddingNucleus(false)} />
        )}

        {editingNucleus && (
          <InlineNucleusForm
            initial={{ name: editingNucleus.name, prefix: editingNucleus.prefix, color: editingNucleus.color, description: editingNucleus.description || '' }}
            onSave={(data) => handleEditNucleus(editingNucleus, data)}
            onCancel={() => setEditingNucleus(null)}
          />
        )}

        {loading ? (
          <p className="text-sm text-muted-foreground text-center py-4">Carregando...</p>
        ) : nuclei.length === 0 && !addingNucleus ? (
          <p className="text-sm text-muted-foreground text-center py-4">Nenhum núcleo cadastrado. Comece criando um núcleo.</p>
        ) : (
          nuclei.map(n => editingNucleus?.id === n.id ? null : (
            <NucleusRow
              key={n.id}
              nucleus={n}
              companies={activeCompanies}
              products={products}
              boards={funnelBoards}
              onEdit={() => setEditingNucleus(n)}
              onDelete={() => handleDeleteNucleus(n.id)}
              onAddProduct={(data) => handleAddProduct(n.id, data)}
              onDeleteProduct={handleDeleteProduct}
              onToggleCompany={handleToggleCompany}
            />
          ))
        )}
      </CardContent>
    </Card>
  );
}
