import { useState, useMemo } from 'react';
import { useAmbassadors, Ambassador } from '@/hooks/useAmbassadors';
import { useTeamMembers } from '@/hooks/useTeamMembers';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Plus, Search, Phone, Mail, MapPin, Instagram,
  UserPlus, UserMinus, Loader2, Pencil, Trash2, Users
} from 'lucide-react';
import { toast } from 'sonner';

export function AmbassadorsList() {
  const {
    ambassadors, links, loading,
    createAmbassador, updateAmbassador, deleteAmbassador,
    linkAmbassadorToMember, unlinkAmbassador
  } = useAmbassadors();

  // Access members from the existing hook (cast to avoid TS issues with hook internals)
  const teamHook = useTeamMembers();
  const members = (teamHook as any).members || [];

  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [editingAmbassador, setEditingAmbassador] = useState<Ambassador | null>(null);
  const [linkingAmbassadorId, setLinkingAmbassadorId] = useState<string | null>(null);
  const [selectedMemberId, setSelectedMemberId] = useState<string>('');
  const [form, setForm] = useState({
    full_name: '', phone: '', email: '', instagram_username: '',
    city: '', state: '', notes: '', is_active: true,
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
    setEditingAmbassador(null);
    setForm({ full_name: '', phone: '', email: '', instagram_username: '', city: '', state: '', notes: '', is_active: true });
    setDialogOpen(true);
  };

  const openEdit = (amb: Ambassador) => {
    setEditingAmbassador(amb);
    setForm({
      full_name: amb.full_name,
      phone: amb.phone || '',
      email: amb.email || '',
      instagram_username: amb.instagram_username || '',
      city: amb.city || '',
      state: amb.state || '',
      notes: amb.notes || '',
      is_active: amb.is_active,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.full_name.trim()) { toast.error('Nome é obrigatório'); return; }
    try {
      if (editingAmbassador) {
        await updateAmbassador(editingAmbassador.id, form);
      } else {
        await createAmbassador(form);
      }
      setDialogOpen(false);
    } catch {}
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Remover este embaixador?')) return;
    await deleteAmbassador(id);
  };

  const openLinkDialog = (ambassadorId: string) => {
    setLinkingAmbassadorId(ambassadorId);
    setSelectedMemberId('');
    setLinkDialogOpen(true);
  };

  const handleLink = async () => {
    if (!linkingAmbassadorId || !selectedMemberId) return;
    await linkAmbassadorToMember(linkingAmbassadorId, selectedMemberId);
    setLinkDialogOpen(false);
  };

  const getMemberLinks = (ambassadorId: string) => {
    return links.filter(l => l.ambassador_id === ambassadorId && l.is_active);
  };

  const getMemberName = (userId: string) => {
    const m = members.find((m: any) => m.user_id === userId);
    return m?.full_name || m?.email || userId.slice(0, 8);
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
        {filtered.map(amb => {
          const memberLinks = getMemberLinks(amb.id);
          return (
            <Card key={amb.id} className="relative">
              <CardContent className="pt-4 pb-3 px-4 space-y-2">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-semibold text-sm">{amb.full_name}</p>
                    {!amb.is_active && <Badge variant="secondary" className="text-[10px]">Inativo</Badge>}
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(amb)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDelete(amb.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                <div className="space-y-1 text-xs text-muted-foreground">
                  {amb.phone && <div className="flex items-center gap-1.5"><Phone className="h-3 w-3" />{amb.phone}</div>}
                  {amb.email && <div className="flex items-center gap-1.5"><Mail className="h-3 w-3" />{amb.email}</div>}
                  {amb.instagram_username && <div className="flex items-center gap-1.5"><Instagram className="h-3 w-3" />@{amb.instagram_username}</div>}
                  {(amb.city || amb.state) && <div className="flex items-center gap-1.5"><MapPin className="h-3 w-3" />{[amb.city, amb.state].filter(Boolean).join(', ')}</div>}
                </div>

                {/* Member links */}
                <div className="pt-1 border-t">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                      <Users className="h-3 w-3" /> Vinculado a:
                    </span>
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => openLinkDialog(amb.id)}>
                      <UserPlus className="h-3 w-3" />
                    </Button>
                  </div>
                  {memberLinks.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">Nenhum membro vinculado</p>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {memberLinks.map(link => (
                        <Badge key={link.id} variant="outline" className="text-[10px] gap-1 pr-0.5">
                          {getMemberName(link.member_user_id)}
                          <button
                            className="ml-1 hover:text-destructive"
                            onClick={() => unlinkAmbassador(amb.id, link.member_user_id)}
                          >
                            <UserMinus className="h-2.5 w-2.5" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            {search ? 'Nenhum embaixador encontrado.' : 'Nenhum embaixador cadastrado. Clique em "Novo Embaixador" para começar.'}
          </CardContent>
        </Card>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingAmbassador ? 'Editar Embaixador' : 'Novo Embaixador'}</DialogTitle>
          </DialogHeader>
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
            <div>
              <Label>Instagram</Label>
              <Input value={form.instagram_username} onChange={e => setForm(f => ({ ...f, instagram_username: e.target.value }))} placeholder="@usuario" />
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
            {editingAmbassador && (
              <div className="flex items-center gap-2">
                <Switch checked={form.is_active} onCheckedChange={v => setForm(f => ({ ...f, is_active: v }))} />
                <Label>Ativo</Label>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleSave}>{editingAmbassador ? 'Salvar' : 'Criar'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Link to Member Dialog */}
      <Dialog open={linkDialogOpen} onOpenChange={setLinkDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Vincular a Membro</DialogTitle>
          </DialogHeader>
          <div>
            <Label>Membro do time</Label>
            <Select value={selectedMemberId} onValueChange={setSelectedMemberId}>
              <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
              <SelectContent>
                {members.map((m: any) => (
                  <SelectItem key={m.user_id} value={m.user_id}>
                    {m.full_name || m.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLinkDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleLink} disabled={!selectedMemberId}>Vincular</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
