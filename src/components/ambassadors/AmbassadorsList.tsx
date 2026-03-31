import { useState, useMemo } from 'react';
import { useAmbassadors, AmbassadorContact } from '@/hooks/useAmbassadors';
import { useTeamMembers } from '@/hooks/useTeamMembers';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import {
  Plus, Search, Phone, Mail, MapPin,
  Loader2, Trash2, Users
} from 'lucide-react';
import { toast } from 'sonner';

export function AmbassadorsList() {
  const {
    ambassadors, loading,
    createAmbassadorContact, removeAmbassadorClassification
  } = useAmbassadors();

  const teamHook = useTeamMembers();
  const members = (teamHook as any).members || [];

  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({
    full_name: '', phone: '', email: '', city: '', state: '', notes: '',
  });

  const filtered = useMemo(() => {
    if (!search) return ambassadors;
    const s = search.toLowerCase();
    return ambassadors.filter(a =>
      a.full_name.toLowerCase().includes(s) ||
      a.phone?.includes(s) ||
      a.city?.toLowerCase().includes(s)
    );
  }, [ambassadors, search]);

  const openCreate = () => {
    setForm({ full_name: '', phone: '', email: '', city: '', state: '', notes: '' });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.full_name.trim()) { toast.error('Nome é obrigatório'); return; }
    try {
      await createAmbassadorContact(form);
      setDialogOpen(false);
    } catch {}
  };

  const handleRemove = async (id: string) => {
    if (!confirm('Remover classificação de embaixador deste contato?')) return;
    await removeAmbassadorClassification(id);
  };

  const getMemberName = (userId: string) => {
    const m = members.find((m: any) => m.user_id === userId);
    return m?.full_name || m?.email || 'Desconhecido';
  };

  if (loading) {
    return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar embaixador..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button onClick={openCreate} size="sm">
          <Plus className="h-4 w-4 mr-1" /> Novo Embaixador
        </Button>
      </div>

      {/* List */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map(amb => (
          <Card key={amb.id} className="relative">
            <CardContent className="pt-4 pb-3 px-4 space-y-2">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-semibold text-sm">{amb.full_name}</p>
                  <Badge variant="outline" className="text-[10px] mt-0.5">Embaixador</Badge>
                </div>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleRemove(amb.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>

              <div className="space-y-1 text-xs text-muted-foreground">
                {amb.phone && <div className="flex items-center gap-1.5"><Phone className="h-3 w-3" />{amb.phone}</div>}
                {amb.email && <div className="flex items-center gap-1.5"><Mail className="h-3 w-3" />{amb.email}</div>}
                {(amb.city || amb.state) && <div className="flex items-center gap-1.5"><MapPin className="h-3 w-3" />{[amb.city, amb.state].filter(Boolean).join(', ')}</div>}
              </div>

              {/* Member who created this contact */}
              {amb.created_by && (
                <div className="pt-1 border-t">
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Users className="h-3 w-3" /> Vinculado a: <span className="font-medium text-foreground">{getMemberName(amb.created_by)}</span>
                  </span>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {filtered.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {search ? 'Nenhum embaixador encontrado.' : 'Nenhum embaixador cadastrado. Cadastre um contato com classificação "embaixador" ou clique em "Novo Embaixador".'}
          </CardContent>
        </Card>
      )}

      {/* Create Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Novo Embaixador</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            Um contato será criado com a classificação "embaixador", vinculado a você.
          </p>
          <div className="space-y-3">
            <div>
              <Label>Nome completo *</Label>
              <Input value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Telefone</Label>
                <Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
              </div>
              <div>
                <Label>Email</Label>
                <Input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Cidade</Label>
                <Input value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} />
              </div>
              <div>
                <Label>Estado</Label>
                <Input value={form.state} onChange={e => setForm(f => ({ ...f, state: e.target.value }))} maxLength={2} />
              </div>
            </div>
            <div>
              <Label>Observações</Label>
              <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave}>Criar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
