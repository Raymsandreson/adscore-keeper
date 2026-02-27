import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Users, Trash2, Search, Filter, Edit2 } from 'lucide-react';
import { toast } from 'sonner';

interface BroadcastList {
  id: string;
  name: string;
  description: string | null;
  filter_criteria: any;
  created_at: string;
  contact_count?: number;
}

interface ContactOption {
  id: string;
  full_name: string;
  phone: string | null;
  classifications?: string[];
}

export function BroadcastListManager({ onSelectList }: { onSelectList?: (list: BroadcastList) => void }) {
  const [lists, setLists] = useState<BroadcastList[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editingList, setEditingList] = useState<BroadcastList | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  // Contact selection
  const [showContactPicker, setShowContactPicker] = useState(false);
  const [pickerListId, setPickerListId] = useState<string | null>(null);
  const [contacts, setContacts] = useState<ContactOption[]>([]);
  const [selectedContacts, setSelectedContacts] = useState<Set<string>>(new Set());
  const [existingContacts, setExistingContacts] = useState<Set<string>>(new Set());
  const [contactSearch, setContactSearch] = useState('');
  const [filterMode, setFilterMode] = useState<'manual' | 'classification'>('manual');
  const [classifications, setClassifications] = useState<{ id: string; name: string; color: string }[]>([]);
  const [selectedClassification, setSelectedClassification] = useState<string>('');
  const [contactsLoading, setContactsLoading] = useState(false);

  const fetchLists = async () => {
    const { data } = await supabase
      .from('whatsapp_broadcast_lists')
      .select('*')
      .order('created_at', { ascending: false });

    if (data) {
      // Get contact counts
      const listsWithCounts = await Promise.all(
        (data as any[]).map(async (list) => {
          const { count } = await supabase
            .from('whatsapp_broadcast_list_contacts')
            .select('*', { count: 'exact', head: true })
            .eq('list_id', list.id);
          return { ...list, contact_count: count || 0 };
        })
      );
      setLists(listsWithCounts);
    }
    setLoading(false);
  };

  useEffect(() => { fetchLists(); }, []);

  const handleCreate = async () => {
    if (!name.trim()) { toast.error('Nome é obrigatório'); return; }
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from('whatsapp_broadcast_lists')
        .insert({ name: name.trim(), description: description.trim() || null, created_by: user?.id } as any)
        .select()
        .single();
      if (error) throw error;
      toast.success('Lista criada!');
      setName(''); setDescription(''); setShowCreate(false);
      fetchLists();
      // Open contact picker for new list
      if (data) {
        setPickerListId((data as any).id);
        setShowContactPicker(true);
      }
    } catch (e: any) {
      toast.error('Erro ao criar lista');
      console.error(e);
    } finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Excluir esta lista?')) return;
    await supabase.from('whatsapp_broadcast_lists').delete().eq('id', id);
    toast.success('Lista excluída');
    fetchLists();
  };

  const openContactPicker = async (listId: string) => {
    setPickerListId(listId);
    setContactsLoading(true);
    setShowContactPicker(true);
    setContactSearch('');
    setSelectedContacts(new Set());
    setFilterMode('manual');

    // Fetch all contacts with phone
    const { data: contactsData } = await supabase
      .from('contacts')
      .select('id, full_name, phone')
      .not('phone', 'is', null)
      .order('full_name');

    setContacts((contactsData || []) as ContactOption[]);

    // Fetch existing contacts in list
    const { data: existing } = await supabase
      .from('whatsapp_broadcast_list_contacts')
      .select('contact_id')
      .eq('list_id', listId);

    const existingSet = new Set((existing || []).map((e: any) => e.contact_id).filter(Boolean));
    setExistingContacts(existingSet);

    // Fetch classifications
    const { data: classData } = await supabase
      .from('contact_classifications')
      .select('id, name, color')
      .order('name');
    setClassifications((classData || []) as any[]);

    setContactsLoading(false);
  };

  const handleAddByClassification = async () => {
    if (!selectedClassification || !pickerListId) return;
    setSaving(true);
    try {
      // Get contacts with this classification via bridge table
      const { data: bridges } = await (supabase as any)
        .from('contact_classification_bridges')
        .select('contact_id')
        .eq('classification_id', selectedClassification);

      if (!bridges || bridges.length === 0) {
        toast.error('Nenhum contato com esta classificação');
        setSaving(false);
        return;
      }

      const contactIds = bridges.map((b: any) => b.contact_id);
      
      // Get phone numbers
      const { data: contactsWithPhone } = await supabase
        .from('contacts')
        .select('id, full_name, phone')
        .in('id', contactIds)
        .not('phone', 'is', null);

      if (!contactsWithPhone || contactsWithPhone.length === 0) {
        toast.error('Nenhum contato com telefone nesta classificação');
        setSaving(false);
        return;
      }

      // Filter out already in list
      const toAdd = contactsWithPhone.filter(c => !existingContacts.has(c.id));
      if (toAdd.length === 0) {
        toast.info('Todos os contatos já estão na lista');
        setSaving(false);
        return;
      }

      const rows = toAdd.map(c => ({
        list_id: pickerListId,
        contact_id: c.id,
        phone: c.phone!.replace(/\D/g, ''),
        contact_name: c.full_name,
      }));

      const { error } = await supabase.from('whatsapp_broadcast_list_contacts').insert(rows as any);
      if (error) throw error;
      toast.success(`${toAdd.length} contato(s) adicionados!`);
      setShowContactPicker(false);
      fetchLists();
    } catch (e) {
      toast.error('Erro ao adicionar contatos');
      console.error(e);
    } finally { setSaving(false); }
  };

  const handleAddManual = async () => {
    if (selectedContacts.size === 0 || !pickerListId) return;
    setSaving(true);
    try {
      const selected = contacts.filter(c => selectedContacts.has(c.id) && !existingContacts.has(c.id));
      if (selected.length === 0) {
        toast.info('Contatos já estão na lista');
        setSaving(false);
        return;
      }

      const rows = selected.map(c => ({
        list_id: pickerListId,
        contact_id: c.id,
        phone: c.phone!.replace(/\D/g, ''),
        contact_name: c.full_name,
      }));

      const { error } = await supabase.from('whatsapp_broadcast_list_contacts').insert(rows as any);
      if (error) throw error;
      toast.success(`${selected.length} contato(s) adicionados!`);
      setShowContactPicker(false);
      fetchLists();
    } catch (e) {
      toast.error('Erro ao adicionar contatos');
      console.error(e);
    } finally { setSaving(false); }
  };

  const filteredContacts = contacts.filter(c =>
    c.full_name?.toLowerCase().includes(contactSearch.toLowerCase()) ||
    c.phone?.includes(contactSearch)
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Users className="h-5 w-5 text-primary" />
          Listas de Transmissão
        </h2>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4 mr-1" /> Nova Lista
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Carregando...</p>
      ) : lists.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground text-sm">
            Nenhuma lista criada ainda. Crie sua primeira lista de transmissão.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {lists.map(list => (
            <Card key={list.id} className="cursor-pointer hover:border-primary/50 transition-colors" onClick={() => onSelectList?.(list)}>
              <CardContent className="p-4 flex items-center justify-between">
                <div>
                  <p className="font-medium text-sm">{list.name}</p>
                  {list.description && <p className="text-xs text-muted-foreground">{list.description}</p>}
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-xs">
                    {list.contact_count || 0} contatos
                  </Badge>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); openContactPicker(list.id); }}>
                    <Edit2 className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={(e) => { e.stopPropagation(); handleDelete(list.id); }}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Nova Lista de Transmissão</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Nome</Label><Input value={name} onChange={e => setName(e.target.value)} placeholder="Ex: Clientes VIP" /></div>
            <div><Label>Descrição (opcional)</Label><Textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Descrição da lista" rows={2} /></div>
          </div>
          <DialogFooter>
            <Button onClick={handleCreate} disabled={saving}>{saving ? 'Criando...' : 'Criar Lista'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Contact Picker Dialog */}
      <Dialog open={showContactPicker} onOpenChange={setShowContactPicker}>
        <DialogContent className="max-w-lg max-h-[80vh]">
          <DialogHeader><DialogTitle>Adicionar Contatos à Lista</DialogTitle></DialogHeader>

          <div className="flex gap-2 mb-3">
            <Button variant={filterMode === 'manual' ? 'default' : 'outline'} size="sm" onClick={() => setFilterMode('manual')}>
              <Search className="h-3.5 w-3.5 mr-1" /> Manual
            </Button>
            <Button variant={filterMode === 'classification' ? 'default' : 'outline'} size="sm" onClick={() => setFilterMode('classification')}>
              <Filter className="h-3.5 w-3.5 mr-1" /> Por Classificação
            </Button>
          </div>

          {filterMode === 'classification' ? (
            <div className="space-y-3">
              <Select value={selectedClassification} onValueChange={setSelectedClassification}>
                <SelectTrigger><SelectValue placeholder="Selecione classificação" /></SelectTrigger>
                <SelectContent>
                  {classifications.map(c => (
                    <SelectItem key={c.id} value={c.id}>
                      <div className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: c.color }} />
                        {c.name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button onClick={handleAddByClassification} disabled={saving || !selectedClassification} className="w-full">
                {saving ? 'Adicionando...' : 'Adicionar Contatos da Classificação'}
              </Button>
            </div>
          ) : (
            <>
              <Input placeholder="Buscar por nome ou telefone..." value={contactSearch} onChange={e => setContactSearch(e.target.value)} className="mb-2" />
              {contactsLoading ? (
                <p className="text-sm text-muted-foreground py-4 text-center">Carregando contatos...</p>
              ) : (
                <ScrollArea className="h-[300px] border rounded-md p-2">
                  {filteredContacts.map(c => {
                    const alreadyIn = existingContacts.has(c.id);
                    return (
                      <label key={c.id} className={`flex items-center gap-3 py-2 px-2 rounded hover:bg-accent cursor-pointer ${alreadyIn ? 'opacity-50' : ''}`}>
                        <Checkbox
                          checked={selectedContacts.has(c.id) || alreadyIn}
                          disabled={alreadyIn}
                          onCheckedChange={(checked) => {
                            setSelectedContacts(prev => {
                              const next = new Set(prev);
                              if (checked) next.add(c.id); else next.delete(c.id);
                              return next;
                            });
                          }}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{c.full_name}</p>
                          <p className="text-xs text-muted-foreground">{c.phone}</p>
                        </div>
                        {alreadyIn && <Badge variant="outline" className="text-[10px]">Já na lista</Badge>}
                      </label>
                    );
                  })}
                  {filteredContacts.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">Nenhum contato encontrado</p>}
                </ScrollArea>
              )}
              <DialogFooter>
                <Button onClick={handleAddManual} disabled={saving || selectedContacts.size === 0}>
                  {saving ? 'Adicionando...' : `Adicionar ${selectedContacts.size} contato(s)`}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
