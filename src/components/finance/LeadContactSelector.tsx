import { useState, useMemo, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from '@/components/ui/select';
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
import { 
  Search, 
  Users, 
  Briefcase, 
  MapPin, 
  Plus, 
  Edit, 
  Trash2,
  Phone,
  Mail,
  Instagram,
  User,
  X,
  Filter,
  Check,
} from 'lucide-react';
import { Lead, useLeads } from '@/hooks/useLeads';
import { Contact, useContacts } from '@/hooks/useContacts';
import { useBrazilianLocations } from '@/hooks/useBrazilianLocations';
import { toast } from 'sonner';

interface LeadContactSelectorProps {
  linkType: 'lead' | 'contact';
  onLinkTypeChange: (type: 'lead' | 'contact') => void;
  selectedLead: string | null;
  onSelectLead: (leadId: string | null) => void;
  selectedContact: string | null;
  onSelectContact: (contactId: string | null) => void;
  leads: Lead[];
  contacts: Contact[];
  onLeadsChange?: () => void;
  onContactsChange?: () => void;
}

interface LeadFormData {
  lead_name: string;
  lead_phone: string;
  lead_email: string;
  instagram_username: string;
  city: string;
  state: string;
  notes: string;
  source: string;
}

interface ContactFormData {
  full_name: string;
  phone: string;
  email: string;
  instagram_username: string;
  city: string;
  state: string;
  notes: string;
}

const initialLeadForm: LeadFormData = {
  lead_name: '',
  lead_phone: '',
  lead_email: '',
  instagram_username: '',
  city: '',
  state: '',
  notes: '',
  source: 'manual',
};

const initialContactForm: ContactFormData = {
  full_name: '',
  phone: '',
  email: '',
  instagram_username: '',
  city: '',
  state: '',
  notes: '',
};

export function LeadContactSelector({
  linkType,
  onLinkTypeChange,
  selectedLead,
  onSelectLead,
  selectedContact,
  onSelectContact,
  leads,
  contacts,
  onLeadsChange,
  onContactsChange,
}: LeadContactSelectorProps) {
  const { addLead, updateLead, deleteLead } = useLeads();
  const { addContact, updateContact, deleteContact } = useContacts();
  const { states, cities, loadingCities, fetchCities } = useBrazilianLocations();

  // Search & Filter states
  const [searchLead, setSearchLead] = useState('');
  const [searchContact, setSearchContact] = useState('');
  const [filterState, setFilterState] = useState<string>('');
  const [filterCity, setFilterCity] = useState<string>('');
  const [showFilters, setShowFilters] = useState(false);

  // Dialog states
  const [leadDialogOpen, setLeadDialogOpen] = useState(false);
  const [contactDialogOpen, setContactDialogOpen] = useState(false);
  const [deleteLeadDialogOpen, setDeleteLeadDialogOpen] = useState(false);
  const [deleteContactDialogOpen, setDeleteContactDialogOpen] = useState(false);
  const [editingLead, setEditingLead] = useState<Lead | null>(null);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [leadToDelete, setLeadToDelete] = useState<Lead | null>(null);
  const [contactToDelete, setContactToDelete] = useState<Contact | null>(null);

  // Form states
  const [leadForm, setLeadForm] = useState<LeadFormData>(initialLeadForm);
  const [contactForm, setContactForm] = useState<ContactFormData>(initialContactForm);
  const [saving, setSaving] = useState(false);

  // Fetch cities when filter state changes
  useEffect(() => {
    if (filterState) {
      fetchCities(filterState);
    }
  }, [filterState, fetchCities]);

  // Fetch cities when form state changes
  useEffect(() => {
    if (leadForm.state) {
      fetchCities(leadForm.state);
    }
  }, [leadForm.state, fetchCities]);

  useEffect(() => {
    if (contactForm.state) {
      fetchCities(contactForm.state);
    }
  }, [contactForm.state, fetchCities]);

  // Filter leads
  const filteredLeads = useMemo(() => {
    let result = leads;
    
    // Text search
    if (searchLead.trim()) {
      const search = searchLead.toLowerCase();
      result = result.filter(l => 
        l.lead_name?.toLowerCase().includes(search) ||
        l.lead_email?.toLowerCase().includes(search) ||
        l.lead_phone?.toLowerCase().includes(search) ||
        l.instagram_username?.toLowerCase().includes(search) ||
        l.city?.toLowerCase().includes(search)
      );
    }
    
    // State filter
    if (filterState) {
      result = result.filter(l => l.state === filterState);
    }
    
    // City filter
    if (filterCity) {
      result = result.filter(l => l.city === filterCity);
    }
    
    return result.slice(0, 20);
  }, [leads, searchLead, filterState, filterCity]);

  // Filter contacts
  const filteredContacts = useMemo(() => {
    let result = contacts;
    
    // Text search
    if (searchContact.trim()) {
      const search = searchContact.toLowerCase();
      result = result.filter(c => 
        c.full_name?.toLowerCase().includes(search) ||
        c.email?.toLowerCase().includes(search) ||
        c.phone?.toLowerCase().includes(search) ||
        c.instagram_username?.toLowerCase().includes(search) ||
        c.city?.toLowerCase().includes(search)
      );
    }
    
    // State filter
    if (filterState) {
      result = result.filter(c => c.state === filterState);
    }
    
    // City filter
    if (filterCity) {
      result = result.filter(c => c.city === filterCity);
    }
    
    return result.slice(0, 20);
  }, [contacts, searchContact, filterState, filterCity]);

  // Lead CRUD handlers
  const handleOpenLeadDialog = (lead?: Lead) => {
    if (lead) {
      setEditingLead(lead);
      setLeadForm({
        lead_name: lead.lead_name || '',
        lead_phone: lead.lead_phone || '',
        lead_email: lead.lead_email || '',
        instagram_username: lead.instagram_username || '',
        city: lead.city || '',
        state: lead.state || '',
        notes: lead.notes || '',
        source: lead.source || 'manual',
      });
    } else {
      setEditingLead(null);
      setLeadForm(initialLeadForm);
    }
    setLeadDialogOpen(true);
  };

  const handleSaveLead = async () => {
    if (!leadForm.lead_name.trim()) {
      toast.error('Nome é obrigatório');
      return;
    }

    setSaving(true);
    try {
      if (editingLead) {
        await updateLead(editingLead.id, {
          lead_name: leadForm.lead_name.trim(),
          lead_phone: leadForm.lead_phone || null,
          lead_email: leadForm.lead_email || null,
          instagram_username: leadForm.instagram_username || null,
          city: leadForm.city || null,
          state: leadForm.state || null,
          notes: leadForm.notes || null,
          source: leadForm.source || 'manual',
        });
        toast.success('Lead atualizado!');
      } else {
        const newLead = await addLead({
          lead_name: leadForm.lead_name.trim(),
          lead_phone: leadForm.lead_phone || null,
          lead_email: leadForm.lead_email || null,
          instagram_username: leadForm.instagram_username || null,
          city: leadForm.city || null,
          state: leadForm.state || null,
          notes: leadForm.notes || null,
          source: leadForm.source || 'manual',
        });
        if (newLead) {
          onSelectLead(newLead.id);
        }
        toast.success('Lead criado!');
      }
      setLeadDialogOpen(false);
      onLeadsChange?.();
    } catch (err) {
      console.error('Error saving lead:', err);
      toast.error('Erro ao salvar lead');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteLead = async () => {
    if (!leadToDelete) return;
    
    try {
      await deleteLead(leadToDelete.id);
      if (selectedLead === leadToDelete.id) {
        onSelectLead(null);
      }
      toast.success('Lead excluído!');
      onLeadsChange?.();
    } catch (err) {
      console.error('Error deleting lead:', err);
      toast.error('Erro ao excluir lead');
    } finally {
      setDeleteLeadDialogOpen(false);
      setLeadToDelete(null);
    }
  };

  // Contact CRUD handlers
  const handleOpenContactDialog = (contact?: Contact) => {
    if (contact) {
      setEditingContact(contact);
      setContactForm({
        full_name: contact.full_name || '',
        phone: contact.phone || '',
        email: contact.email || '',
        instagram_username: contact.instagram_username || '',
        city: contact.city || '',
        state: contact.state || '',
        notes: contact.notes || '',
      });
    } else {
      setEditingContact(null);
      setContactForm(initialContactForm);
    }
    setContactDialogOpen(true);
  };

  const handleSaveContact = async () => {
    if (!contactForm.full_name.trim()) {
      toast.error('Nome é obrigatório');
      return;
    }

    setSaving(true);
    try {
      if (editingContact) {
        await updateContact(editingContact.id, {
          full_name: contactForm.full_name.trim(),
          phone: contactForm.phone || null,
          email: contactForm.email || null,
          instagram_username: contactForm.instagram_username || null,
          city: contactForm.city || null,
          state: contactForm.state || null,
          notes: contactForm.notes || null,
        });
        toast.success('Contato atualizado!');
      } else {
        const newContact = await addContact({
          full_name: contactForm.full_name.trim(),
          phone: contactForm.phone || null,
          email: contactForm.email || null,
          instagram_username: contactForm.instagram_username || null,
          city: contactForm.city || null,
          state: contactForm.state || null,
          notes: contactForm.notes || null,
        });
        if (newContact) {
          onSelectContact(newContact.id);
        }
        toast.success('Contato criado!');
      }
      setContactDialogOpen(false);
      onContactsChange?.();
    } catch (err) {
      console.error('Error saving contact:', err);
      toast.error('Erro ao salvar contato');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteContact = async () => {
    if (!contactToDelete) return;
    
    try {
      await deleteContact(contactToDelete.id);
      if (selectedContact === contactToDelete.id) {
        onSelectContact(null);
      }
      toast.success('Contato excluído!');
      onContactsChange?.();
    } catch (err) {
      console.error('Error deleting contact:', err);
      toast.error('Erro ao excluir contato');
    } finally {
      setDeleteContactDialogOpen(false);
      setContactToDelete(null);
    }
  };

  const clearFilters = () => {
    setFilterState('');
    setFilterCity('');
    setSearchLead('');
    setSearchContact('');
  };

  const hasFilters = filterState || filterCity;

  return (
    <div className="space-y-3">
      <Tabs value={linkType} onValueChange={(v) => onLinkTypeChange(v as 'lead' | 'contact')}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="lead" className="gap-2">
            <Briefcase className="h-4 w-4" />
            Lead
          </TabsTrigger>
          <TabsTrigger value="contact" className="gap-2">
            <Users className="h-4 w-4" />
            Contato
          </TabsTrigger>
        </TabsList>

        {/* Filter Section */}
        <div className="mt-3 space-y-2">
          <div className="flex items-center gap-2">
            <Button
              variant={showFilters ? 'secondary' : 'outline'}
              size="sm"
              onClick={() => setShowFilters(!showFilters)}
              className="gap-1"
            >
              <Filter className="h-4 w-4" />
              Filtros
              {hasFilters && (
                <Badge variant="secondary" className="ml-1 h-5 w-5 p-0 text-xs">
                  {[filterState, filterCity].filter(Boolean).length}
                </Badge>
              )}
            </Button>
            {hasFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                <X className="h-4 w-4 mr-1" />
                Limpar
              </Button>
            )}
          </div>

          {showFilters && (
            <div className="flex gap-2 p-2 bg-muted/50 rounded-lg">
              <Select
                value={filterState || '__all__'}
                onValueChange={(v) => {
                  setFilterState(v === '__all__' ? '' : v);
                  setFilterCity('');
                }}
              >
                <SelectTrigger className="w-24">
                  <SelectValue placeholder="UF" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Todos UFs</SelectItem>
                  {states.map((state) => (
                    <SelectItem key={state.sigla} value={state.sigla}>
                      {state.sigla}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={filterCity || '__all__'}
                onValueChange={(v) => setFilterCity(v === '__all__' ? '' : v)}
                disabled={!filterState || loadingCities}
              >
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder={loadingCities ? "Carregando..." : "Cidade"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Todas cidades</SelectItem>
                  {cities.map((city) => (
                    <SelectItem key={city.id} value={city.nome}>
                      {city.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        {/* Lead Tab */}
        <TabsContent value="lead" className="space-y-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar lead..."
                value={searchLead}
                onChange={(e) => setSearchLead(e.target.value)}
                className="pl-9"
              />
            </div>
            <Button size="icon" variant="outline" onClick={() => handleOpenLeadDialog()}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          
          <ScrollArea className="h-40 border rounded-lg">
            <div className="p-2 space-y-1">
              {filteredLeads.map(lead => (
                <div
                  key={lead.id}
                  className={`p-2 rounded-lg cursor-pointer transition-colors group ${
                    selectedLead === lead.id 
                      ? 'bg-primary text-primary-foreground' 
                      : 'hover:bg-muted'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1" onClick={() => onSelectLead(lead.id)}>
                      <div className="font-medium flex items-center gap-2">
                        {lead.lead_name || 'Sem nome'}
                        {selectedLead === lead.id && <Check className="h-4 w-4" />}
                      </div>
                      <div className="text-xs opacity-70 flex items-center gap-2 flex-wrap">
                        {lead.city && (
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            {lead.city}{lead.state && `, ${lead.state}`}
                          </span>
                        )}
                        {lead.lead_phone && (
                          <span className="flex items-center gap-1">
                            <Phone className="h-3 w-3" />
                            {lead.lead_phone}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className={`flex gap-1 ${selectedLead === lead.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                      <Button 
                        size="icon" 
                        variant="ghost" 
                        className="h-7 w-7"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenLeadDialog(lead);
                        }}
                      >
                        <Edit className="h-3 w-3" />
                      </Button>
                      <Button 
                        size="icon" 
                        variant="ghost" 
                        className="h-7 w-7 text-destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          setLeadToDelete(lead);
                          setDeleteLeadDialogOpen(true);
                        }}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
              {filteredLeads.length === 0 && (
                <div className="text-center text-muted-foreground py-4">
                  <p>Nenhum lead encontrado</p>
                  <Button 
                    variant="link" 
                    size="sm" 
                    onClick={() => handleOpenLeadDialog()}
                    className="mt-1"
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Criar novo lead
                  </Button>
                </div>
              )}
            </div>
          </ScrollArea>

          {selectedLead && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground p-2 bg-muted/50 rounded">
              <MapPin className="h-4 w-4" />
              <span>
                Destino: {leads.find(l => l.id === selectedLead)?.city || 'Cidade não cadastrada'}
                {leads.find(l => l.id === selectedLead)?.state && 
                  `, ${leads.find(l => l.id === selectedLead)?.state}`}
              </span>
            </div>
          )}
        </TabsContent>

        {/* Contact Tab */}
        <TabsContent value="contact" className="space-y-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar contato..."
                value={searchContact}
                onChange={(e) => setSearchContact(e.target.value)}
                className="pl-9"
              />
            </div>
            <Button size="icon" variant="outline" onClick={() => handleOpenContactDialog()}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>

          <ScrollArea className="h-40 border rounded-lg">
            <div className="p-2 space-y-1">
              {filteredContacts.map(contact => (
                <div
                  key={contact.id}
                  className={`p-2 rounded-lg cursor-pointer transition-colors group ${
                    selectedContact === contact.id 
                      ? 'bg-primary text-primary-foreground' 
                      : 'hover:bg-muted'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1" onClick={() => onSelectContact(contact.id)}>
                      <div className="font-medium flex items-center gap-2">
                        {contact.full_name}
                        {selectedContact === contact.id && <Check className="h-4 w-4" />}
                      </div>
                      <div className="text-xs opacity-70 flex items-center gap-2 flex-wrap">
                        {contact.city && (
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            {contact.city}{contact.state && `, ${contact.state}`}
                          </span>
                        )}
                        {contact.phone && (
                          <span className="flex items-center gap-1">
                            <Phone className="h-3 w-3" />
                            {contact.phone}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className={`flex gap-1 ${selectedContact === contact.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                      <Button 
                        size="icon" 
                        variant="ghost" 
                        className="h-7 w-7"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenContactDialog(contact);
                        }}
                      >
                        <Edit className="h-3 w-3" />
                      </Button>
                      <Button 
                        size="icon" 
                        variant="ghost" 
                        className="h-7 w-7 text-destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          setContactToDelete(contact);
                          setDeleteContactDialogOpen(true);
                        }}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
              {filteredContacts.length === 0 && (
                <div className="text-center text-muted-foreground py-4">
                  <p>Nenhum contato encontrado</p>
                  <Button 
                    variant="link" 
                    size="sm" 
                    onClick={() => handleOpenContactDialog()}
                    className="mt-1"
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Criar novo contato
                  </Button>
                </div>
              )}
            </div>
          </ScrollArea>

          {selectedContact && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground p-2 bg-muted/50 rounded">
              <MapPin className="h-4 w-4" />
              <span>
                Destino: {contacts.find(c => c.id === selectedContact)?.city || 'Cidade não cadastrada'}
                {contacts.find(c => c.id === selectedContact)?.state && 
                  `, ${contacts.find(c => c.id === selectedContact)?.state}`}
              </span>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Lead Dialog */}
      <Dialog open={leadDialogOpen} onOpenChange={setLeadDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Briefcase className="h-5 w-5" />
              {editingLead ? 'Editar Lead' : 'Novo Lead'}
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div>
              <Label className="flex items-center gap-1">
                <User className="h-3 w-3" />
                Nome *
              </Label>
              <Input
                value={leadForm.lead_name}
                onChange={(e) => setLeadForm(f => ({ ...f, lead_name: e.target.value }))}
                placeholder="Nome do lead"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="flex items-center gap-1">
                  <Phone className="h-3 w-3" />
                  Telefone
                </Label>
                <Input
                  value={leadForm.lead_phone}
                  onChange={(e) => setLeadForm(f => ({ ...f, lead_phone: e.target.value }))}
                  placeholder="(00) 00000-0000"
                />
              </div>
              <div>
                <Label className="flex items-center gap-1">
                  <Mail className="h-3 w-3" />
                  Email
                </Label>
                <Input
                  type="email"
                  value={leadForm.lead_email}
                  onChange={(e) => setLeadForm(f => ({ ...f, lead_email: e.target.value }))}
                  placeholder="email@exemplo.com"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="flex items-center gap-1">
                  <Instagram className="h-3 w-3" />
                  Instagram
                </Label>
                <Input
                  value={leadForm.instagram_username}
                  onChange={(e) => setLeadForm(f => ({ ...f, instagram_username: e.target.value }))}
                  placeholder="@usuario"
                />
              </div>
              <div>
                <Label>Origem</Label>
                <Select 
                  value={leadForm.source} 
                  onValueChange={(v) => setLeadForm(f => ({ ...f, source: v }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual">Manual</SelectItem>
                    <SelectItem value="instagram">Instagram</SelectItem>
                    <SelectItem value="whatsapp">WhatsApp</SelectItem>
                    <SelectItem value="referral">Indicação</SelectItem>
                    <SelectItem value="facebook">Facebook</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Estado</Label>
                <Select 
                  value={leadForm.state || '__none__'} 
                  onValueChange={(v) => {
                    setLeadForm(f => ({ ...f, state: v === '__none__' ? '' : v, city: '' }));
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="UF" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Selecione...</SelectItem>
                    {states.map((state) => (
                      <SelectItem key={state.sigla} value={state.sigla}>
                        {state.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Cidade</Label>
                <Select 
                  value={leadForm.city || '__none__'} 
                  onValueChange={(v) => setLeadForm(f => ({ ...f, city: v === '__none__' ? '' : v }))}
                  disabled={!leadForm.state || loadingCities}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={loadingCities ? "Carregando..." : "Cidade"} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Selecione...</SelectItem>
                    {cities.map((city) => (
                      <SelectItem key={city.id} value={city.nome}>
                        {city.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label>Observações</Label>
              <Textarea
                value={leadForm.notes}
                onChange={(e) => setLeadForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Notas sobre o lead..."
                rows={2}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setLeadDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSaveLead} disabled={saving}>
              {saving ? 'Salvando...' : editingLead ? 'Salvar' : 'Criar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Contact Dialog */}
      <Dialog open={contactDialogOpen} onOpenChange={setContactDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              {editingContact ? 'Editar Contato' : 'Novo Contato'}
            </DialogTitle>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div>
              <Label className="flex items-center gap-1">
                <User className="h-3 w-3" />
                Nome *
              </Label>
              <Input
                value={contactForm.full_name}
                onChange={(e) => setContactForm(f => ({ ...f, full_name: e.target.value }))}
                placeholder="Nome completo"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="flex items-center gap-1">
                  <Phone className="h-3 w-3" />
                  Telefone
                </Label>
                <Input
                  value={contactForm.phone}
                  onChange={(e) => setContactForm(f => ({ ...f, phone: e.target.value }))}
                  placeholder="(00) 00000-0000"
                />
              </div>
              <div>
                <Label className="flex items-center gap-1">
                  <Mail className="h-3 w-3" />
                  Email
                </Label>
                <Input
                  type="email"
                  value={contactForm.email}
                  onChange={(e) => setContactForm(f => ({ ...f, email: e.target.value }))}
                  placeholder="email@exemplo.com"
                />
              </div>
            </div>

            <div>
              <Label className="flex items-center gap-1">
                <Instagram className="h-3 w-3" />
                Instagram
              </Label>
              <Input
                value={contactForm.instagram_username}
                onChange={(e) => setContactForm(f => ({ ...f, instagram_username: e.target.value }))}
                placeholder="@usuario"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Estado</Label>
                <Select 
                  value={contactForm.state || '__none__'} 
                  onValueChange={(v) => {
                    setContactForm(f => ({ ...f, state: v === '__none__' ? '' : v, city: '' }));
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="UF" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Selecione...</SelectItem>
                    {states.map((state) => (
                      <SelectItem key={state.sigla} value={state.sigla}>
                        {state.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Cidade</Label>
                <Select 
                  value={contactForm.city || '__none__'} 
                  onValueChange={(v) => setContactForm(f => ({ ...f, city: v === '__none__' ? '' : v }))}
                  disabled={!contactForm.state || loadingCities}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={loadingCities ? "Carregando..." : "Cidade"} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Selecione...</SelectItem>
                    {cities.map((city) => (
                      <SelectItem key={city.id} value={city.nome}>
                        {city.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label>Observações</Label>
              <Textarea
                value={contactForm.notes}
                onChange={(e) => setContactForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Notas sobre o contato..."
                rows={2}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setContactDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSaveContact} disabled={saving}>
              {saving ? 'Salvando...' : editingContact ? 'Salvar' : 'Criar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Lead Confirmation */}
      <AlertDialog open={deleteLeadDialogOpen} onOpenChange={setDeleteLeadDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir Lead</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir o lead "{leadToDelete?.lead_name}"? 
              Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteLead} className="bg-destructive text-destructive-foreground">
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Contact Confirmation */}
      <AlertDialog open={deleteContactDialogOpen} onOpenChange={setDeleteContactDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir Contato</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir o contato "{contactToDelete?.full_name}"? 
              Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteContact} className="bg-destructive text-destructive-foreground">
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
