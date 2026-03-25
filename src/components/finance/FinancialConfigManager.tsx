import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useCompanies, Company } from '@/hooks/useCompanies';
import { useCostCenters, CostCenter } from '@/hooks/useCostCenters';
import { useBeneficiaries, Beneficiary } from '@/hooks/useBeneficiaries';
import { useSpecializedNuclei, SpecializedNucleus } from '@/hooks/useSpecializedNuclei';
import { Building2, Layers, Users, Plus, Edit2, Trash2, Save, X, Check, Target } from 'lucide-react';
import { toast } from 'sonner';

export function FinancialConfigManager() {
  return (
    <Tabs defaultValue="nuclei" className="space-y-4">
      <TabsList>
        <TabsTrigger value="nuclei"><Target className="h-4 w-4 mr-1" /> Núcleos</TabsTrigger>
        <TabsTrigger value="companies"><Building2 className="h-4 w-4 mr-1" /> Empresas</TabsTrigger>
        <TabsTrigger value="cost_centers"><Layers className="h-4 w-4 mr-1" /> Centros de Custo</TabsTrigger>
        <TabsTrigger value="beneficiaries"><Users className="h-4 w-4 mr-1" /> Beneficiários</TabsTrigger>
      </TabsList>

      <TabsContent value="nuclei"><NucleiTab /></TabsContent>
      <TabsContent value="companies"><CompaniesTab /></TabsContent>
      <TabsContent value="cost_centers"><CostCentersTab /></TabsContent>
      <TabsContent value="beneficiaries"><BeneficiariesTab /></TabsContent>
    </Tabs>
  );
}

function CompaniesTab() {
  const { companies, addCompany, updateCompany, deleteCompany } = useCompanies();
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', cnpj: '', trading_name: '' });

  const handleAdd = async () => {
    if (!form.name.trim()) { toast.error('Nome é obrigatório'); return; }
    await addCompany({ name: form.name, cnpj: form.cnpj || null, trading_name: form.trading_name || null });
    setForm({ name: '', cnpj: '', trading_name: '' });
  };

  const handleSaveEdit = async (id: string) => {
    await updateCompany(id, { name: form.name, cnpj: form.cnpj || null, trading_name: form.trading_name || null });
    setEditing(null);
  };

  const startEdit = (c: Company) => {
    setEditing(c.id);
    setForm({ name: c.name, cnpj: c.cnpj || '', trading_name: c.trading_name || '' });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Empresas do Grupo</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-2">
          <Input placeholder="Razão Social" value={editing ? '' : form.name} onChange={e => !editing && setForm(p => ({ ...p, name: e.target.value }))} disabled={!!editing} />
          <Input placeholder="CNPJ" value={editing ? '' : form.cnpj} onChange={e => !editing && setForm(p => ({ ...p, cnpj: e.target.value }))} disabled={!!editing} />
          <div className="flex gap-1">
            <Input placeholder="Nome Fantasia" value={editing ? '' : form.trading_name} onChange={e => !editing && setForm(p => ({ ...p, trading_name: e.target.value }))} disabled={!!editing} />
            <Button size="sm" onClick={handleAdd} disabled={!!editing}><Plus className="h-4 w-4" /></Button>
          </div>
        </div>
        <ScrollArea className="max-h-[300px]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Razão Social</TableHead>
                <TableHead>CNPJ</TableHead>
                <TableHead>Nome Fantasia</TableHead>
                <TableHead className="w-20">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {companies.map(c => (
                <TableRow key={c.id}>
                  {editing === c.id ? (
                    <>
                      <TableCell><Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} className="h-8" /></TableCell>
                      <TableCell><Input value={form.cnpj} onChange={e => setForm(p => ({ ...p, cnpj: e.target.value }))} className="h-8" /></TableCell>
                      <TableCell><Input value={form.trading_name} onChange={e => setForm(p => ({ ...p, trading_name: e.target.value }))} className="h-8" /></TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleSaveEdit(c.id)}><Check className="h-3 w-3" /></Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditing(null)}><X className="h-3 w-3" /></Button>
                        </div>
                      </TableCell>
                    </>
                  ) : (
                    <>
                      <TableCell className="font-medium">{c.name}</TableCell>
                      <TableCell className="text-muted-foreground text-xs">{c.cnpj || '—'}</TableCell>
                      <TableCell>{c.trading_name || '—'}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => startEdit(c)}><Edit2 className="h-3 w-3" /></Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => deleteCompany(c.id)}><Trash2 className="h-3 w-3" /></Button>
                        </div>
                      </TableCell>
                    </>
                  )}
                </TableRow>
              ))}
              {companies.length === 0 && (
                <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">Nenhuma empresa cadastrada</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

function CostCentersTab() {
  const { costCenters, addCostCenter, updateCostCenter, deleteCostCenter } = useCostCenters();
  const { activeCompanies } = useCompanies();
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', company_id: '', description: '' });

  const handleAdd = async () => {
    if (!form.name.trim()) { toast.error('Nome é obrigatório'); return; }
    await addCostCenter({ name: form.name, company_id: form.company_id || null, description: form.description || null });
    setForm({ name: '', company_id: '', description: '' });
  };

  const handleSaveEdit = async (id: string) => {
    await updateCostCenter(id, { name: form.name, company_id: form.company_id || null, description: form.description || null });
    setEditing(null);
  };

  const startEdit = (cc: CostCenter) => {
    setEditing(cc.id);
    setForm({ name: cc.name, company_id: cc.company_id || '', description: cc.description || '' });
  };

  const getCompanyName = (id: string | null) => activeCompanies.find(c => c.id === id)?.trading_name || activeCompanies.find(c => c.id === id)?.name || '—';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Centros de Custo / Setores</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-2">
          <Input placeholder="Nome do setor" value={editing ? '' : form.name} onChange={e => !editing && setForm(p => ({ ...p, name: e.target.value }))} disabled={!!editing} />
          <Select value={editing ? '' : form.company_id} onValueChange={v => !editing && setForm(p => ({ ...p, company_id: v }))} disabled={!!editing}>
            <SelectTrigger><SelectValue placeholder="Empresa (opcional)" /></SelectTrigger>
            <SelectContent>
              {activeCompanies.map(c => <SelectItem key={c.id} value={c.id}>{c.trading_name || c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="flex gap-1">
            <Input placeholder="Descrição" value={editing ? '' : form.description} onChange={e => !editing && setForm(p => ({ ...p, description: e.target.value }))} disabled={!!editing} />
            <Button size="sm" onClick={handleAdd} disabled={!!editing}><Plus className="h-4 w-4" /></Button>
          </div>
        </div>
        <ScrollArea className="max-h-[300px]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Setor</TableHead>
                <TableHead>Empresa</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead className="w-20">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {costCenters.map(cc => (
                <TableRow key={cc.id}>
                  {editing === cc.id ? (
                    <>
                      <TableCell><Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} className="h-8" /></TableCell>
                      <TableCell>
                        <Select value={form.company_id} onValueChange={v => setForm(p => ({ ...p, company_id: v }))}>
                          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {activeCompanies.map(c => <SelectItem key={c.id} value={c.id}>{c.trading_name || c.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell><Input value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} className="h-8" /></TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleSaveEdit(cc.id)}><Check className="h-3 w-3" /></Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditing(null)}><X className="h-3 w-3" /></Button>
                        </div>
                      </TableCell>
                    </>
                  ) : (
                    <>
                      <TableCell className="font-medium">{cc.name}</TableCell>
                      <TableCell className="text-xs">{getCompanyName(cc.company_id)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{cc.description || '—'}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => startEdit(cc)}><Edit2 className="h-3 w-3" /></Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => deleteCostCenter(cc.id)}><Trash2 className="h-3 w-3" /></Button>
                        </div>
                      </TableCell>
                    </>
                  )}
                </TableRow>
              ))}
              {costCenters.length === 0 && (
                <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">Nenhum centro de custo cadastrado</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

function BeneficiariesTab() {
  const { beneficiaries, addBeneficiary, updateBeneficiary, deleteBeneficiary } = useBeneficiaries();
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', document: '', person_type: 'juridica' as 'fisica' | 'juridica' });

  const handleAdd = async () => {
    if (!form.name.trim()) { toast.error('Nome é obrigatório'); return; }
    await addBeneficiary({ name: form.name, document: form.document || null, person_type: form.person_type });
    setForm({ name: '', document: '', person_type: 'juridica' });
  };

  const handleSaveEdit = async (id: string) => {
    await updateBeneficiary(id, { name: form.name, document: form.document || null, person_type: form.person_type });
    setEditing(null);
  };

  const startEdit = (b: Beneficiary) => {
    setEditing(b.id);
    setForm({ name: b.name, document: b.document || '', person_type: b.person_type });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Beneficiários (Fornecedores / Recebedores)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-2">
          <Input placeholder="Nome" value={editing ? '' : form.name} onChange={e => !editing && setForm(p => ({ ...p, name: e.target.value }))} disabled={!!editing} />
          <Input placeholder="CPF/CNPJ" value={editing ? '' : form.document} onChange={e => !editing && setForm(p => ({ ...p, document: e.target.value }))} disabled={!!editing} />
          <div className="flex gap-1">
            <Select value={editing ? '' : form.person_type} onValueChange={v => !editing && setForm(p => ({ ...p, person_type: v as any }))} disabled={!!editing}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="juridica">PJ</SelectItem>
                <SelectItem value="fisica">PF</SelectItem>
              </SelectContent>
            </Select>
            <Button size="sm" onClick={handleAdd} disabled={!!editing}><Plus className="h-4 w-4" /></Button>
          </div>
        </div>
        <ScrollArea className="max-h-[300px]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>CPF/CNPJ</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead className="w-20">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {beneficiaries.map(b => (
                <TableRow key={b.id}>
                  {editing === b.id ? (
                    <>
                      <TableCell><Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} className="h-8" /></TableCell>
                      <TableCell><Input value={form.document} onChange={e => setForm(p => ({ ...p, document: e.target.value }))} className="h-8" /></TableCell>
                      <TableCell>
                        <Select value={form.person_type} onValueChange={v => setForm(p => ({ ...p, person_type: v as any }))}>
                          <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="juridica">PJ</SelectItem>
                            <SelectItem value="fisica">PF</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleSaveEdit(b.id)}><Check className="h-3 w-3" /></Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditing(null)}><X className="h-3 w-3" /></Button>
                        </div>
                      </TableCell>
                    </>
                  ) : (
                    <>
                      <TableCell className="font-medium">{b.name}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{b.document || '—'}</TableCell>
                      <TableCell><Badge variant="outline">{b.person_type === 'fisica' ? 'PF' : 'PJ'}</Badge></TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => startEdit(b)}><Edit2 className="h-3 w-3" /></Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => deleteBeneficiary(b.id)}><Trash2 className="h-3 w-3" /></Button>
                        </div>
                      </TableCell>
                    </>
                  )}
                </TableRow>
              ))}
              {beneficiaries.length === 0 && (
                <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-8">Nenhum beneficiário cadastrado</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
