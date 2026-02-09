import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { ContactDetailSheet } from '@/components/contacts/ContactDetailSheet';
import { toast } from 'sonner';
import { Users, ExternalLink, Instagram, Phone, Mail, Plus, Search, Loader2, X, UserPlus } from 'lucide-react';

interface LinkedContact {
  id: string;
  contact_id: string;
  contact: {
    id: string;
    full_name: string;
    instagram_username: string | null;
    phone: string | null;
    email: string | null;
    classification: string | null;
    classifications: string[] | null;
  };
}

interface LeadLinkedContactsProps {
  leadId: string;
}

export function LeadLinkedContacts({ leadId }: LeadLinkedContactsProps) {
  const [contacts, setContacts] = useState<LinkedContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedContact, setSelectedContact] = useState<any>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  // Search & link existing contact
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [linking, setLinking] = useState(false);

  // Create new contact
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newInstagram, setNewInstagram] = useState('');
  const [creating, setCreating] = useState(false);

  const fetchContacts = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('contact_leads')
        .select('id, contact_id, contacts:contact_id(id, full_name, instagram_username, phone, email, classification, classifications)')
        .eq('lead_id', leadId);

      if (!error && data) {
        const mapped = data
          .filter((d: any) => d.contacts)
          .map((d: any) => ({
            id: d.id,
            contact_id: d.contact_id,
            contact: d.contacts,
          }));
        setContacts(mapped);
      }
    } catch (err) {
      console.error('Error fetching linked contacts:', err);
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  useEffect(() => {
    if (leadId) fetchContacts();
  }, [leadId, fetchContacts]);

  // Search contacts
  useEffect(() => {
    if (!showSearch || !searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const linkedIds = contacts.map(c => c.contact_id);
        const { data } = await supabase
          .from('contacts')
          .select('id, full_name, instagram_username, phone, email')
          .or(`full_name.ilike.%${searchQuery}%,instagram_username.ilike.%${searchQuery}%,phone.ilike.%${searchQuery}%`)
          .limit(8);

        if (data) {
          setSearchResults(data.filter(c => !linkedIds.includes(c.id)));
        }
      } catch {
        // ignore
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, showSearch, contacts]);

  const handleLinkContact = async (contactId: string) => {
    setLinking(true);
    try {
      const { error } = await (supabase as any)
        .from('contact_leads')
        .insert({ contact_id: contactId, lead_id: leadId });

      if (error) {
        if (error.code === '23505') {
          toast.info('Contato já vinculado');
        } else throw error;
      } else {
        toast.success('Contato vinculado!');
        setShowSearch(false);
        setSearchQuery('');
        fetchContacts();
      }
    } catch {
      toast.error('Erro ao vincular contato');
    } finally {
      setLinking(false);
    }
  };

  const handleUnlinkContact = async (linkId: string) => {
    try {
      const { error } = await (supabase as any)
        .from('contact_leads')
        .delete()
        .eq('id', linkId);

      if (error) throw error;
      toast.success('Contato desvinculado');
      fetchContacts();
    } catch {
      toast.error('Erro ao desvincular');
    }
  };

  const handleCreateAndLink = async () => {
    if (!newName.trim()) {
      toast.error('Nome é obrigatório');
      return;
    }
    setCreating(true);
    try {
      const { data: newContact, error: createError } = await supabase
        .from('contacts')
        .insert({
          full_name: newName.trim(),
          phone: newPhone || null,
          instagram_username: newInstagram ? (newInstagram.startsWith('@') ? newInstagram : `@${newInstagram}`) : null,
        })
        .select('id')
        .single();

      if (createError) throw createError;

      if (newContact) {
        await (supabase as any)
          .from('contact_leads')
          .insert({ contact_id: newContact.id, lead_id: leadId });

        toast.success('Contato criado e vinculado!');
        setShowCreate(false);
        setNewName('');
        setNewPhone('');
        setNewInstagram('');
        fetchContacts();
      }
    } catch (err) {
      console.error(err);
      toast.error('Erro ao criar contato');
    } finally {
      setCreating(false);
    }
  };

  const handleOpenContact = async (contact: any) => {
    // Fetch full contact data to avoid missing fields (created_at, updated_at, etc.)
    const { data } = await supabase
      .from('contacts')
      .select('*')
      .eq('id', contact.id)
      .maybeSingle();
    
    setSelectedContact(data || contact);
    setSheetOpen(true);
  };

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  return (
    <>
      <div className="space-y-3">
        {/* Header with actions */}
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium flex items-center gap-2">
            <Users className="h-4 w-4" />
            Contatos Vinculados
            {contacts.length > 0 && (
              <Badge variant="secondary" className="text-xs">{contacts.length}</Badge>
            )}
          </h4>
          <div className="flex gap-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => { setShowSearch(!showSearch); setShowCreate(false); }}
            >
              <Search className="h-3 w-3 mr-1" />
              Vincular
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => { setShowCreate(!showCreate); setShowSearch(false); }}
            >
              <UserPlus className="h-3 w-3 mr-1" />
              Novo
            </Button>
          </div>
        </div>

        {/* Search existing contacts */}
        {showSearch && (
          <div className="border rounded-lg p-3 space-y-2 bg-muted/30">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar contato por nome, Instagram, telefone..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 h-9"
                autoFocus
              />
            </div>
            {searching ? (
              <div className="flex justify-center py-3">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : searchResults.length > 0 ? (
              <div className="space-y-1 max-h-[150px] overflow-y-auto">
                {searchResults.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className="w-full flex items-center justify-between p-2 rounded-md border bg-card hover:bg-accent/50 text-left text-sm disabled:opacity-50"
                    onClick={() => handleLinkContact(c.id)}
                    disabled={linking}
                  >
                    <div className="min-w-0">
                      <p className="font-medium truncate">{c.full_name}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {c.instagram_username || c.phone || c.email || ''}
                      </p>
                    </div>
                    {linking ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                  </button>
                ))}
              </div>
            ) : searchQuery.trim() ? (
              <p className="text-xs text-muted-foreground text-center py-2">Nenhum contato encontrado</p>
            ) : null}
          </div>
        )}

        {/* Create new contact */}
        {showCreate && (
          <div className="border rounded-lg p-3 space-y-2 bg-muted/30">
            <Input
              placeholder="Nome *"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="h-9"
              autoFocus
            />
            <div className="grid grid-cols-2 gap-2">
              <Input
                placeholder="Telefone"
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                className="h-9"
              />
              <Input
                placeholder="@instagram"
                value={newInstagram}
                onChange={(e) => setNewInstagram(e.target.value)}
                className="h-9"
              />
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleCreateAndLink} disabled={creating || !newName.trim()}>
                {creating ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <UserPlus className="h-3 w-3 mr-1" />}
                Criar e Vincular
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowCreate(false)}>
                Cancelar
              </Button>
            </div>
          </div>
        )}

        {/* Contact list */}
        {contacts.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-6">
            Nenhum contato vinculado a este lead.
          </p>
        ) : (
          <div className="space-y-1.5">
            {contacts.map((cl) => (
              <div
                key={cl.id}
                className="flex items-center gap-3 p-2.5 rounded-lg border bg-card hover:bg-accent/50 transition-colors group"
              >
                <button
                  type="button"
                  onClick={() => handleOpenContact(cl.contact)}
                  className="flex items-center gap-3 flex-1 min-w-0 text-left"
                >
                  <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Users className="h-4 w-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{cl.contact.full_name}</p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      {cl.contact.instagram_username && (
                        <span className="flex items-center gap-0.5">
                          <Instagram className="h-3 w-3" />
                          {cl.contact.instagram_username}
                        </span>
                      )}
                      {cl.contact.phone && (
                        <span className="flex items-center gap-0.5">
                          <Phone className="h-3 w-3" />
                          {cl.contact.phone}
                        </span>
                      )}
                    </div>
                  </div>
                  <ExternalLink className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                </button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                  onClick={() => handleUnlinkContact(cl.id)}
                  title="Desvincular contato"
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <ContactDetailSheet
        contact={selectedContact}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onContactUpdated={fetchContacts}
      />
    </>
  );
}
