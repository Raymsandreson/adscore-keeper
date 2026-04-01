import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Plus, Pencil, Trash2, Check, X, Building2, ChevronRight, ChevronDown, Lightbulb, Package, Kanban } from 'lucide-react';
import { useSpecializedNuclei, SpecializedNucleus } from '@/hooks/useSpecializedNuclei';
import { useCompanies, Company } from '@/hooks/useCompanies';
import { useProductsServices, ProductService } from '@/hooks/useProductsServices';
import { useKanbanBoards } from '@/hooks/useKanbanBoards';
import { toast } from 'sonner';

const COLORS = ['#ef4444','#f97316','#eab308','#22c55e','#06b6d4','#3b82f6','#8b5cf6','#ec4899','#6b7280'];

// ─── Inline Add/Edit helpers ────────────────────────────────────────

function InlineCompanyForm({ onSave, onCancel }: { onSave: (name: string) => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  return (
    <div className="flex items-center gap-2 p-2 rounded border bg-muted/30">
      <Input autoFocus placeholder="Nome da empresa" value={name} onChange={e => setName(e.target.value)} className="h-8 text-xs" />
      <Button size="sm" className="h-8 text-xs shrink-0" disabled={!name.trim()} onClick={() => onSave(name.trim())}>
        <Check className="h-3 w-3 mr-1" />Criar
      </Button>
      <Button size="sm" variant="ghost" className="h-8 text-xs shrink-0" onClick={onCancel}><X className="h-3 w-3" /></Button>
    </div>
  );
}

function InlineNucleusForm({ onSave, onCancel, initial }: {
  onSave: (data: { name: string; prefix: string; color: string; description: string }) => void;
  onCancel: () => void;
  initial?: { name: string; prefix: string; color: string; description: string };
}) {
  const [form, setForm] = useState(initial || { name: '', prefix: '', color: COLORS[0], description: '' });
  return (
    <div className="space-y-2 p-2 rounded border bg-muted/30 ml-4">
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

function InlineProductForm({ onSave, onCancel, initial }: {
  onSave: (data: { name: string; description: string }) => void;
  onCancel: () => void;
  initial?: { name: string; description: string };
}) {
  const [form, setForm] = useState(initial || { name: '', description: '' });
  return (
    <div className="flex items-center gap-2 p-2 rounded border bg-muted/30 ml-8">
      <Input autoFocus placeholder="Nome do produto" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="h-8 text-xs flex-1" />
      <Input placeholder="Descrição" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className="h-8 text-xs flex-1" />
      <Button size="sm" className="h-8 text-xs shrink-0" disabled={!form.name.trim()} onClick={() => onSave(form)}>
        <Check className="h-3 w-3 mr-1" />Salvar
      </Button>
      <Button size="sm" variant="ghost" className="h-8 text-xs shrink-0" onClick={onCancel}><X className="h-3 w-3" /></Button>
    </div>
  );
}

// ─── Funnel Row (leaf) ──────────────────────────────────────────────

function FunnelRow({ board }: { board: { id: string; name: string } }) {
  return (
    <div className="flex items-center gap-2 py-1 pl-12 text-xs text-muted-foreground">
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
      <div className="flex items-center gap-2 py-1.5 pl-8 group">
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
          <p className="text-[10px] text-muted-foreground pl-12 py-1">Nenhum funil vinculado</p>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

// ─── Nucleus Row ────────────────────────────────────────────────────

function NucleusRow({ nucleus, products, boards, onEdit, onDelete, onAddProduct, onDeleteProduct }: {
  nucleus: SpecializedNucleus;
  products: ProductService[];
  boards: { id: string; name: string; product_service_id: string | null }[];
  onEdit: () => void;
  onDelete: () => void;
  onAddProduct: (data: { name: string; description: string }) => void;
  onDeleteProduct: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [addingProduct, setAddingProduct] = useState(false);

  const nucleusProducts = products.filter(p => p.nucleus_id === nucleus.id);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="flex items-center gap-2 py-1.5 pl-4 group">
        <CollapsibleTrigger asChild>
          <button className="p-0.5 rounded hover:bg-muted">
            {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
        </CollapsibleTrigger>
        <div className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: nucleus.color }} />
        <Lightbulb className="h-3.5 w-3.5 text-yellow-500" />
        <span className="text-sm font-medium">{nucleus.name}</span>
        <Badge variant="outline" className="text-[9px] h-4">{nucleus.prefix}</Badge>
        {nucleusProducts.length > 0 && <Badge variant="secondary" className="text-[9px] h-4">{nucleusProducts.length} produto(s)</Badge>}
        <div className="flex items-center gap-0.5 ml-auto opacity-0 group-hover:opacity-100">
          <Button size="icon" variant="ghost" className="h-5 w-5" onClick={() => setAddingProduct(true)}><Plus className="h-3 w-3" /></Button>
          <Button size="icon" variant="ghost" className="h-5 w-5" onClick={onEdit}><Pencil className="h-3 w-3" /></Button>
          <Button size="icon" variant="ghost" className="h-5 w-5" onClick={onDelete}><Trash2 className="h-3 w-3 text-destructive" /></Button>
        </div>
      </div>
      <CollapsibleContent className="space-y-0.5">
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
          <p className="text-[10px] text-muted-foreground pl-8 py-1">Nenhum produto neste núcleo</p>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

// ─── Company Row (top level) ────────────────────────────────────────

function CompanyRow({ company, nuclei, products, boards, onAddNucleus, onEditNucleus, onDeleteNucleus, onAddProduct, onDeleteProduct }: {
  company: Company;
  nuclei: SpecializedNucleus[];
  products: ProductService[];
  boards: { id: string; name: string; product_service_id: string | null }[];
  onAddNucleus: (companyId: string, data: { name: string; prefix: string; color: string; description: string }) => void;
  onEditNucleus: (nucleus: SpecializedNucleus) => void;
  onDeleteNucleus: (id: string) => void;
  onAddProduct: (nucleusId: string, data: { name: string; description: string }) => void;
  onDeleteProduct: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [addingNucleus, setAddingNucleus] = useState(false);
  const [editingNucleus, setEditingNucleus] = useState<SpecializedNucleus | null>(null);

  // Nuclei linked to this company via nucleus_companies N:N
  const companyNuclei = nuclei.filter(n => (n.company_ids || []).includes(company.id));

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="flex items-center gap-2 p-2 rounded-lg border group hover:bg-muted/30">
        <CollapsibleTrigger asChild>
          <button className="p-0.5 rounded hover:bg-muted">
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </CollapsibleTrigger>
        <Building2 className="h-4 w-4 text-blue-500" />
        <span className="text-sm font-semibold">{company.trading_name || company.name}</span>
        {company.cnpj && <Badge variant="outline" className="text-[9px] h-4">{company.cnpj}</Badge>}
        {companyNuclei.length > 0 && <Badge variant="secondary" className="text-[9px] h-4">{companyNuclei.length} núcleo(s)</Badge>}
        <Button size="sm" variant="ghost" className="h-6 text-[10px] ml-auto opacity-0 group-hover:opacity-100" onClick={(e) => { e.stopPropagation(); setAddingNucleus(true); setOpen(true); }}>
          <Plus className="h-3 w-3 mr-0.5" />Núcleo
        </Button>
      </div>
      <CollapsibleContent className="space-y-0.5 mt-1">
        {addingNucleus && (
          <InlineNucleusForm
            onSave={(data) => { onAddNucleus(company.id, data); setAddingNucleus(false); }}
            onCancel={() => setAddingNucleus(false)}
          />
        )}
        {editingNucleus && (
          <InlineNucleusForm
            initial={{ name: editingNucleus.name, prefix: editingNucleus.prefix, color: editingNucleus.color, description: editingNucleus.description || '' }}
            onSave={(data) => {
              onEditNucleus({ ...editingNucleus, ...data } as SpecializedNucleus);
              setEditingNucleus(null);
            }}
            onCancel={() => setEditingNucleus(null)}
          />
        )}
        {companyNuclei.map(n => editingNucleus?.id === n.id ? null : (
          <NucleusRow
            key={n.id}
            nucleus={n}
            products={products}
            boards={boards}
            onEdit={() => setEditingNucleus(n)}
            onDelete={() => onDeleteNucleus(n.id)}
            onAddProduct={(data) => onAddProduct(n.id, data)}
            onDeleteProduct={onDeleteProduct}
          />
        ))}
        {companyNuclei.length === 0 && !addingNucleus && (
          <p className="text-[10px] text-muted-foreground pl-4 py-1">Nenhum núcleo nesta empresa</p>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

// ─── Main Component ─────────────────────────────────────────────────

export function NucleiSettings() {
  const { nuclei, loading, addNucleus, updateNucleus, deleteNucleus } = useSpecializedNuclei();
  const { companies, activeCompanies, addCompany } = useCompanies();
  const { products, addProduct, deleteProduct } = useProductsServices();
  const { boards } = useKanbanBoards();
  const [addingCompany, setAddingCompany] = useState(false);

  const funnelBoards = useMemo(() =>
    (boards || []).filter((b: any) => b.board_type === 'funnel').map((b: any) => ({ id: b.id, name: b.name, product_service_id: b.product_service_id || null })),
    [boards]
  );

  // Orphan nuclei (not linked to any company)
  const orphanNuclei = useMemo(() =>
    nuclei.filter(n => !n.company_ids || n.company_ids.length === 0),
    [nuclei]
  );

  const handleAddNucleus = async (companyId: string, data: { name: string; prefix: string; color: string; description: string }) => {
    await addNucleus({ ...data, company_ids: [companyId] });
  };

  const handleEditNucleus = async (nucleus: SpecializedNucleus) => {
    const { id, company_ids, ...rest } = nucleus;
    await updateNucleus(id, { name: rest.name, prefix: rest.prefix, color: rest.color, description: rest.description, company_ids });
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

  const handleAddCompany = async (name: string) => {
    try {
      await addCompany({ name });
      setAddingCompany(false);
    } catch {
      toast.error('Erro ao criar empresa');
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div>
          <CardTitle className="text-base">Ecossistema</CardTitle>
          <p className="text-xs text-muted-foreground mt-0.5">Empresa → Núcleo → Produto → Funil</p>
        </div>
        <Button size="sm" onClick={() => setAddingCompany(true)}>
          <Plus className="h-4 w-4 mr-1" />Nova Empresa
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {addingCompany && (
          <InlineCompanyForm onSave={handleAddCompany} onCancel={() => setAddingCompany(false)} />
        )}

        {loading ? (
          <p className="text-sm text-muted-foreground text-center py-4">Carregando...</p>
        ) : activeCompanies.length === 0 && orphanNuclei.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">Nenhuma empresa cadastrada. Comece criando uma empresa.</p>
        ) : (
          <>
            {activeCompanies.map(c => (
              <CompanyRow
                key={c.id}
                company={c}
                nuclei={nuclei}
                products={products}
                boards={funnelBoards}
                onAddNucleus={handleAddNucleus}
                onEditNucleus={handleEditNucleus}
                onDeleteNucleus={handleDeleteNucleus}
                onAddProduct={handleAddProduct}
                onDeleteProduct={handleDeleteProduct}
              />
            ))}

            {orphanNuclei.length > 0 && (
              <div className="mt-4 pt-3 border-t">
                <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
                  <Lightbulb className="h-3 w-3" /> Núcleos sem empresa vinculada:
                </p>
                {orphanNuclei.map(n => (
                  <NucleusRow
                    key={n.id}
                    nucleus={n}
                    products={products}
                    boards={funnelBoards}
                    onEdit={() => {}}
                    onDelete={() => handleDeleteNucleus(n.id)}
                    onAddProduct={(data) => handleAddProduct(n.id, data)}
                    onDeleteProduct={handleDeleteProduct}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
