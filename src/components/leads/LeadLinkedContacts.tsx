import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { ContactDetailSheet } from '@/components/contacts/ContactDetailSheet';
import { WhatsAppCallRecorder } from '@/components/whatsapp/WhatsAppCallRecorder';
import { toast } from 'sonner';
import { Users, ExternalLink, Instagram, Phone, Mail, Plus, Search, Loader2, X, UserPlus, Heart, Mic, PhoneCall, Clock } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface ContactCallStats {
  totalCalls: number;
  lastAnsweredDuration: number | null;
}

const RELATIONSHIP_OPTIONS = [
  'Vítima',
  'Cônjuge',
  'Pai/Mãe',
  'Filho(a)',
  'Irmão(ã)',
  'Familiar',
  'Amigo(a)',
  'Colega de Trabalho',
  'Advogado(a)',
  'Testemunha',
  'Responsável',
  'Outro',
];

interface LinkedContact {
  id: string;
  contact_id: string;
  relationship_to_victim: string | null;
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

// Module-level cache: instant render on re-open
const contactsCache = new Map<string, { contacts: LinkedContact[]; callStats: Record<string, ContactCallStats> }>();

export function LeadLinkedContacts({ leadId }: LeadLinkedContactsProps) {
  const cached = contactsCache.get(leadId);
  const [contacts, setContacts] = useState<LinkedContact[]>(() => cached?.contacts || []);
  const [loading, setLoading] = useState(() => !cached);
  const [selectedContact, setSelectedContact] = useState<any>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [callStats, setCallStats] = useState<Record<string, ContactCallStats>>(() => cached?.callStats || {});

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
      const { data, error } = await (supabase as any)
        .from('contact_leads')
        .select('id, contact_id, relationship_to_victim, contacts:contact_id(id, full_name, instagram_username, phone, email, classification, classifications)')
        .eq('lead_id', leadId);

      if (!error && data) {
        const mapped = data
          .filter((d: any) => d.contacts)
          .map((d: any) => ({
            id: d.id,
            contact_id: d.contact_id,
            relationship_to_victim: d.relationship_to_victim || null,
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

  // Fetch call stats for all linked contacts
  const fetchCallStats = useCallback(async (contactIds: string[]) => {
    if (contactIds.length === 0) {
      setCallStats({});
      return;
    }
    try {
      const { data, error } = await supabase
        .from('call_records')
        .select('contact_id, call_result, duration_seconds, created_at')
        .in('contact_id', contactIds)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const stats: Record<string, ContactCallStats> = {};
      for (const cid of contactIds) {
        const contactCalls = (data || []).filter(r => r.contact_id === cid);
        const answeredCall = contactCalls.find(r => r.call_result === 'answered' && r.duration_seconds && r.duration_seconds > 0);
        stats[cid] = {
          totalCalls: contactCalls.length,
          lastAnsweredDuration: answeredCall?.duration_seconds ?? null,
        };
      }
      setCallStats(stats);
    } catch (err) {
      console.error('Error fetching call stats:', err);
    }
  }, []);

  useEffect(() => {
    const contactIds = contacts.map(c => c.contact_id);
    if (contactIds.length > 0) fetchCallStats(contactIds);
  }, [contacts, fetchCallStats]);

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
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      const { data: newContact, error: createError } = await supabase
        .from('contacts')
        .insert({
          full_name: newName.trim(),
          phone: newPhone || null,
          instagram_username: newInstagram ? (newInstagram.startsWith('@') ? newInstagram : `@${newInstagram}`) : null,
          created_by: currentUser?.id || null,
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

  const handleUpdateRelationship = async (linkId: string, value: string) => {
    try {
      const { error } = await (supabase as any)
        .from('contact_leads')
        .update({ relationship_to_victim: value || null })
        .eq('id', linkId);

      if (error) throw error;
      setContacts(prev => prev.map(c => c.id === linkId ? { ...c, relationship_to_victim: value || null } : c));
    } catch {
      toast.error('Erro ao atualizar relação');
    }
  };

  const handleOpenContact = async (contact: any) => {
    const { data } = await supabase
      .from('contacts')
      .select('*')
      .eq('id', contact.id)
      .maybeSingle();
    
    setSelectedContact(data || contact);
    setSheetOpen(true);
  };

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m > 0 ? `${m}min ${s}s` : `${s}s`;
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
                className="p-2.5 rounded-lg border bg-card hover:bg-accent/50 transition-colors group space-y-2"
              >
                <div className="flex items-center gap-3">
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
                          <a
                            href={`tel:${cl.contact.phone?.replace(/\D/g, '').replace(/^55/, '')}`}
                            className="callface-dial flex items-center gap-0.5 hover:underline"
                            data-phone={cl.contact.phone?.replace(/\D/g, '').replace(/^55/, '')}
                          >
                            <Phone className="h-3 w-3" />
                            {cl.contact.phone}
                          </a>
                        )}
                      </div>
                      {/* Call stats */}
                      {callStats[cl.contact.id] && callStats[cl.contact.id].totalCalls > 0 && (
                        <div className="flex items-center gap-2 text-xs mt-0.5">
                          <span className="flex items-center gap-0.5 text-muted-foreground">
                            <PhoneCall className="h-3 w-3" />
                            {callStats[cl.contact.id].totalCalls} chamada{callStats[cl.contact.id].totalCalls !== 1 ? 's' : ''}
                          </span>
                          {callStats[cl.contact.id].lastAnsweredDuration !== null && (
                            <span className="flex items-center gap-0.5 text-green-600">
                              <Clock className="h-3 w-3" />
                              Última atendida: {formatDuration(callStats[cl.contact.id].lastAnsweredDuration!)}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    <ExternalLink className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                  </button>
                  {cl.contact.phone && (
                    <WhatsAppCallRecorder
                      phone={cl.contact.phone}
                      contactName={cl.contact.full_name}
                      contactId={cl.contact.id}
                      leadId={leadId}
                    />
                  )}
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
                <div className="flex items-center gap-2 pl-11">
                  <Heart className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                  <Select
                    value={cl.relationship_to_victim || ''}
                    onValueChange={(val) => handleUpdateRelationship(cl.id, val)}
                  >
                    <SelectTrigger className="h-7 text-xs w-auto min-w-[140px]">
                      <SelectValue placeholder="Relação com a vítima" />
                    </SelectTrigger>
                    <SelectContent>
                      {RELATIONSHIP_OPTIONS.map((opt) => (
                        <SelectItem key={opt} value={opt} className="text-xs">{opt}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
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
