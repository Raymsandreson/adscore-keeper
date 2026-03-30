import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { MultiProfessionSelector } from './MultiProfessionSelector';
import { useBrazilianLocations } from '@/hooks/useBrazilianLocations';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Loader2, Link2, Plus, UserPlus, UserMinus, Users2, UserCheck, Users, Handshake, Package, X } from 'lucide-react';
import type { ContactClassification, FollowerStatus } from '@/hooks/useContacts';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';

interface CreateContactDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultPhone?: string;
  defaultName?: string;
  defaultData?: Record<string, string>;
  onContactCreated?: (contact: { id: string; full_name: string; phone: string | null; lead_id?: string | null }) => void;
}

type LeadLinkMode = 'none' | 'existing' | 'new';

export function CreateContactDialog({ open, onOpenChange, defaultPhone, defaultName, defaultData, onContactCreated }: CreateContactDialogProps) {
  const { states } = useBrazilianLocations();
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    full_name: defaultName || '',
    phone: defaultPhone || '',
    email: '',
    instagram_url: '',
    classification: 'prospect' as ContactClassification,
    city: '',
    state: '',
    notes: '',
    follower_status: 'none' as FollowerStatus,
    professions: [] as { cbo_code: string; title: string; is_primary: boolean }[],
  });

  const [cities, setCities] = useState<{ id: number; nome: string }[]>([]);
  const [loadingCities, setLoadingCities] = useState(false);

  // Lead linking
  const [leadLinkMode, setLeadLinkMode] = useState<LeadLinkMode>('none');
  const [existingLeads, setExistingLeads] = useState<Array<{ id: string; lead_name: string | null }>>([]);
  const [selectedLeadId, setSelectedLeadId] = useState('');
  const [newLeadName, setNewLeadName] = useState('');
  const [selectedRelationship, setSelectedRelationship] = useState('');
  const [boards, setBoards] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedBoardId, setSelectedBoardId] = useState('');
  const [loadingLeads, setLoadingLeads] = useState(false);

  // Sync defaults when dialog opens
  useEffect(() => {
    if (open) {
      setForm(f => ({
        ...f,
        full_name: defaultData?.full_name || defaultName || '',
        phone: defaultPhone || '',
        email: defaultData?.email || '',
        instagram_url: defaultData?.instagram_url || '',
        city: defaultData?.city || '',
        state: defaultData?.state || '',
        notes: defaultData?.notes || '',
        // Keep existing classification and follower_status defaults
      }));
      setLeadLinkMode('none');
      setSelectedLeadId('');
      setSelectedRelationship('');
      setNewLeadName('');
    }
  }, [open, defaultName, defaultPhone, defaultData]);

  // Fetch cities when state changes
  useEffect(() => {
    if (!form.state) { setCities([]); return; }
    const state = states.find(s => s.sigla === form.state);
    if (!state) return;
    setLoadingCities(true);
    fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${state.id}/municipios?orderBy=nome`)
      .then(r => r.json())
      .then(data => { setCities(data); setLoadingCities(false); })
      .catch(() => { setCities([]); setLoadingCities(false); });
  }, [form.state, states]);

  // Fetch leads/boards when link mode changes
  useEffect(() => {
    if (leadLinkMode === 'existing') {
      setLoadingLeads(true);
      supabase.from('leads').select('id, lead_name').order('created_at', { ascending: false }).limit(200)
        .then(({ data }) => { setExistingLeads(data || []); setLoadingLeads(false); });
    }
    if (leadLinkMode === 'new') {
      supabase.from('kanban_boards').select('id, name').order('created_at')
        .then(({ data }) => {
          setBoards(data || []);
          if (data && data.length === 1) setSelectedBoardId(data[0].id);
        });
    }
  }, [leadLinkMode]);

  const handleSave = async () => {
    if (!form.full_name.trim()) { toast.error('Nome é obrigatório'); return; }
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();

      // Check for duplicate phone
      if (form.phone.trim()) {
        const normalizedPhone = form.phone.replace(/\D/g, '');
        const { data: existingContacts } = await supabase
          .from('contacts')
          .select('id, full_name, phone')
          .or(`phone.eq.${normalizedPhone},phone.eq.${form.phone.trim()}`)
          .limit(1);
        
        if (existingContacts && existingContacts.length > 0) {
          const existing = existingContacts[0];
          toast.error(`Já existe um contato com este telefone: "${existing.full_name}"`, { duration: 5000 });
          // Offer to use existing contact
          onContactCreated?.({ id: existing.id, full_name: existing.full_name, phone: existing.phone });
          onOpenChange(false);
          setSaving(false);
          return;
        }
      }

      // Extract instagram username
      let igUsername: string | null = null;
      let igUrl: string | null = form.instagram_url || null;
      if (igUrl) {
        if (igUrl.startsWith('@')) {
          igUsername = igUrl.slice(1);
          igUrl = `https://instagram.com/${igUsername}`;
        } else {
          const match = igUrl.match(/instagram\.com\/([^/?]+)/);
          if (match) igUsername = match[1];
        }
      }

      const primaryProf = form.professions.find(p => p.is_primary);

      // 1. Create contact
      const { data: contact, error } = await supabase
        .from('contacts')
        .insert({
          full_name: form.full_name,
          phone: form.phone || null,
          email: form.email || null,
          instagram_url: igUrl,
          instagram_username: igUsername,
          classification: form.classification,
          city: form.city || null,
          state: form.state || null,
          notes: form.notes || null,
          follower_status: form.follower_status !== 'none' ? form.follower_status : null,
          profession: primaryProf?.title || null,
          profession_cbo_code: primaryProf?.cbo_code || null,
          created_by: user?.id || null,
        })
        .select()
        .single();

      if (error) throw error;

      // Add professions
      if (form.professions.length > 0) {
        for (const prof of form.professions) {
          await supabase.from('contact_professions' as any).insert({
            contact_id: contact.id,
            cbo_code: prof.cbo_code,
            profession_title: prof.title,
            is_primary: prof.is_primary,
          });
        }
      }

      // Auto-sync to Google Contacts (only if connected)
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          const { data: googleCheck } = await cloudFunctions.invoke('google-check-connection');
          if (googleCheck?.connected) {
            cloudFunctions.invoke('google-save-contact', {
              body: { name: form.full_name, phone: form.phone || undefined, email: form.email || undefined, instagram_username: igUsername || undefined, notes: form.notes || undefined },
            }).catch(() => {});
          }
        }
      } catch {}

      let linkedLeadId: string | null = null;

      // 2. Handle lead linking
      if (leadLinkMode === 'existing' && selectedLeadId) {
        // Link contact to existing lead via contact_leads with relationship
        await supabase.from('contact_leads').insert({
          contact_id: contact.id,
          lead_id: selectedLeadId,
          ...(selectedRelationship ? { relationship_to_victim: selectedRelationship } : {}),
        } as any);
        // Also update contacts.lead_id
        await supabase.from('contacts').update({ lead_id: selectedLeadId }).eq('id', contact.id);
        linkedLeadId = selectedLeadId;
      } else if (leadLinkMode === 'new') {
        const leadName = newLeadName.trim() || form.full_name;
        const boardId = selectedBoardId || boards[0]?.id;
        const { data: lead, error: leadError } = await supabase
          .from('leads')
          .insert({
            lead_name: leadName,
            source: 'contato',
            board_id: boardId || null,
            created_by: user?.id || null,
          })
          .select('id')
          .single();

        if (!leadError && lead) {
          await supabase.from('contact_leads').insert({
            contact_id: contact.id,
            lead_id: lead.id,
            ...(selectedRelationship ? { relationship_to_victim: selectedRelationship } : {}),
          } as any);
          await supabase.from('contacts').update({ lead_id: lead.id }).eq('id', contact.id);
          linkedLeadId = lead.id;
        }
      }

      toast.success('Contato criado com sucesso!');
      onContactCreated?.({ id: contact.id, full_name: contact.full_name, phone: contact.phone, lead_id: linkedLeadId });
      onOpenChange(false);

      // Reset
      setForm({ full_name: '', phone: '', email: '', instagram_url: '', classification: 'prospect', city: '', state: '', notes: '', follower_status: 'none', professions: [] });
      setLeadLinkMode('none');
      setSelectedLeadId('');
      setSelectedRelationship('');
      setNewLeadName('');
    } catch (e) {
      console.error(e);
      toast.error('Erro ao criar contato');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle>Novo Contato</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 pr-1">
          {/* Basic fields */}
          <div>
            <Label>Nome *</Label>
            <Input value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} placeholder="Nome completo" autoFocus />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Telefone</Label>
              <Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="11999998888" />
            </div>
            <div>
              <Label>Email</Label>
              <Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="email@exemplo.com" />
            </div>
          </div>

          <div>
            <Label>Instagram (URL ou @username)</Label>
            <Input value={form.instagram_url} onChange={e => setForm(f => ({ ...f, instagram_url: e.target.value }))} placeholder="@username ou instagram.com/username" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Estado</Label>
              <Select value={form.state || 'none'} onValueChange={v => setForm(f => ({ ...f, state: v === 'none' ? '' : v, city: '' }))}>
                <SelectTrigger><SelectValue placeholder="Selecione o estado" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Selecione o estado</SelectItem>
                  {states.map(s => <SelectItem key={s.sigla} value={s.sigla}>{s.sigla} - {s.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Cidade</Label>
              <Select value={form.city || 'none'} onValueChange={v => setForm(f => ({ ...f, city: v === 'none' ? '' : v }))} disabled={!form.state || loadingCities}>
                <SelectTrigger>
                  {loadingCities ? <span className="flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" />...</span> : <SelectValue placeholder={form.state ? 'Selecione a cidade' : 'Primeiro o estado'} />}
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Selecione a cidade</SelectItem>
                  {cities.map(c => <SelectItem key={c.id} value={c.nome}>{c.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Status de Seguidor</Label>
              <Select value={form.follower_status} onValueChange={v => setForm(f => ({ ...f, follower_status: v as FollowerStatus }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Não definido</SelectItem>
                  <SelectItem value="follower"><div className="flex items-center gap-2"><UserPlus className="h-4 w-4 text-pink-500" />Seguidor (me segue)</div></SelectItem>
                  <SelectItem value="following"><div className="flex items-center gap-2"><UserMinus className="h-4 w-4 text-indigo-500" />Seguindo (eu sigo)</div></SelectItem>
                  <SelectItem value="mutual"><div className="flex items-center gap-2"><Users2 className="h-4 w-4 text-emerald-500" />Mútuo (ambos)</div></SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Status</Label>
              <Select value={form.classification || 'prospect'} onValueChange={v => setForm(f => ({ ...f, classification: v as ContactClassification }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="prospect"><div className="flex items-center gap-2"><UserPlus className="h-4 w-4" />Prospect</div></SelectItem>
                  <SelectItem value="client"><div className="flex items-center gap-2"><UserCheck className="h-4 w-4" />Cliente</div></SelectItem>
                  <SelectItem value="non_client"><div className="flex items-center gap-2"><Users className="h-4 w-4" />Não-Cliente</div></SelectItem>
                  <SelectItem value="partner"><div className="flex items-center gap-2"><Handshake className="h-4 w-4" />Parceiro</div></SelectItem>
                  <SelectItem value="supplier"><div className="flex items-center gap-2"><Package className="h-4 w-4" />Fornecedor</div></SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label>Profissões</Label>
            <MultiProfessionSelector value={form.professions} onChange={professions => setForm(f => ({ ...f, professions }))} placeholder="Selecione profissões..." />
          </div>

          <div>
            <Label>Notas</Label>
            <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Observações sobre o contato..." rows={2} />
          </div>

          {/* Lead linking section */}
          <Separator />
          <div className="space-y-3">
            <Label className="text-sm font-medium">Vincular a um Lead</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={leadLinkMode === 'none' ? 'default' : 'outline'}
                className="flex-1 text-xs"
                onClick={() => setLeadLinkMode('none')}
              >
                <X className="h-3 w-3 mr-1" />
                Nenhum
              </Button>
              <Button
                type="button"
                size="sm"
                variant={leadLinkMode === 'existing' ? 'default' : 'outline'}
                className="flex-1 text-xs"
                onClick={() => setLeadLinkMode('existing')}
              >
                <Link2 className="h-3 w-3 mr-1" />
                Vincular Lead
              </Button>
              <Button
                type="button"
                size="sm"
                variant={leadLinkMode === 'new' ? 'default' : 'outline'}
                className="flex-1 text-xs"
                onClick={() => setLeadLinkMode('new')}
              >
                <Plus className="h-3 w-3 mr-1" />
                Criar Lead
              </Button>
            </div>

            {leadLinkMode === 'existing' && (
              <div>
                {loadingLeads ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Carregando leads...</div>
                ) : (
                  <Select value={selectedLeadId} onValueChange={setSelectedLeadId}>
                    <SelectTrigger><SelectValue placeholder="Selecione um lead..." /></SelectTrigger>
                    <SelectContent>
                      {existingLeads.map(lead => (
                        <SelectItem key={lead.id} value={lead.id}>{lead.lead_name || 'Lead sem nome'}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}

            {(leadLinkMode === 'existing' || leadLinkMode === 'new') && (
              <div className="mt-2">
                <Label className="text-xs">Relação com a vítima</Label>
                <Select value={selectedRelationship} onValueChange={setSelectedRelationship}>
                  <SelectTrigger><SelectValue placeholder="Selecione a relação..." /></SelectTrigger>
                  <SelectContent>
                    {['Vítima', 'Cônjuge', 'Pai/Mãe', 'Filho(a)', 'Irmão(ã)', 'Familiar', 'Amigo(a)', 'Colega de Trabalho', 'Advogado(a)', 'Testemunha', 'Responsável', 'Outro'].map(r => (
                      <SelectItem key={r} value={r}>{r}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {leadLinkMode === 'new' && (
              <div className="space-y-2">
                <div>
                  <Label className="text-xs">Nome do Lead (opcional)</Label>
                  <Input
                    value={newLeadName}
                    onChange={e => setNewLeadName(e.target.value)}
                    placeholder={`Padrão: "${form.full_name || 'Nome do contato'}"`}
                  />
                </div>
                {boards.length > 1 && (
                  <div>
                    <Label className="text-xs">Funil</Label>
                    <Select value={selectedBoardId} onValueChange={setSelectedBoardId}>
                      <SelectTrigger><SelectValue placeholder="Selecione o funil..." /></SelectTrigger>
                      <SelectContent>
                        {boards.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            )}
          </div>

          <Button onClick={handleSave} disabled={saving} className="w-full">
            {saving ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Salvando...</> : 'Adicionar Contato'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
