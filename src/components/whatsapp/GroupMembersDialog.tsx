import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Users, User, UserPlus, Loader2, MapPin, Briefcase, Tag, Heart, ChevronDown, ChevronUp, Check, Phone, Search, ExternalLink, Link2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';

interface GroupParticipant {
  phone: string;
  name: string;
  admin?: string;
  lid?: string;
}

interface ContactInfo {
  id: string;
  full_name: string;
  phone: string | null;
  classification: string | null;
  classifications: string[] | null;
  profession: string | null;
  city: string | null;
  state: string | null;
  tags: string[] | null;
}

interface ContactLeadLink {
  relationship_to_victim: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationPhone: string;
  instanceName: string | null;
  leadId: string | null;
  isGroup: boolean;
  messageParticipants: Array<{ phone: string; name: string }>;
  onViewContact?: (contactId: string) => void;
}

export function GroupMembersDialog({ open, onOpenChange, conversationPhone, instanceName, leadId, isGroup, messageParticipants, onViewContact }: Props) {
  const [loading, setLoading] = useState(false);
  const [participants, setParticipants] = useState<GroupParticipant[]>([]);
  const [contactsMap, setContactsMap] = useState<Map<string, ContactInfo>>(new Map());
  const [relationshipsMap, setRelationshipsMap] = useState<Map<string, string>>(new Map());
  const [classifications, setClassifications] = useState<Array<{ id: string; name: string; color: string }>>([]);
  const [relationshipTypes, setRelationshipTypes] = useState<Array<{ id: string; name: string }>>([]);
  const [expandedPhone, setExpandedPhone] = useState<string | null>(null);
  const [addingPhone, setAddingPhone] = useState<string | null>(null);
  const [editingField, setEditingField] = useState<{ phone: string; field: string } | null>(null);
  const [editValue, setEditValue] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [linkingPhone, setLinkingPhone] = useState<string | null>(null);
  const [linkSearchQuery, setLinkSearchQuery] = useState('');
  const [linkSearchResults, setLinkSearchResults] = useState<Array<{ id: string; full_name: string; phone: string | null; notes: string | null }>>([]);

  useEffect(() => {
    if (open && isGroup) {
      fetchParticipants();
      fetchClassificationsAndTypes();
    }
  }, [open, isGroup]);

  const fetchClassificationsAndTypes = async () => {
    const [classRes, relRes] = await Promise.all([
      (supabase as any).from('contact_classifications').select('id, name, color').order('display_order'),
      (supabase as any).from('contact_relationship_types').select('id, name').order('display_order'),
    ]);
    if (classRes.data) setClassifications(classRes.data);
    if (relRes.data) setRelationshipTypes(relRes.data);
  };

  const fetchParticipants = async () => {
    setLoading(true);
    try {
      // Get instance
      let instId: string | null = null;
      if (instanceName) {
        const { data: inst } = await supabase
          .from('whatsapp_instances')
          .select('id')
          .eq('instance_name', instanceName)
          .eq('is_active', true)
          .maybeSingle();
        instId = inst?.id || null;
      }

      // Fetch from API
      const { data, error } = await cloudFunctions.invoke('send-whatsapp', {
        body: { action: 'fetch_group_participants', group_id: conversationPhone, instance_id: instId },
      });

      let apiParticipants: GroupParticipant[] = [];
      if (!error && data?.success && data.participants) {
        apiParticipants = data.participants.map((p: any) => {
          const rawId = p.id || p.phone || '';
          // Handle @s.whatsapp.net format
          let phone = rawId.replace('@s.whatsapp.net', '').replace(/\D/g, '');
          const isLid = rawId.includes('@lid');
          // For @lid entries, extract the numeric part
          if (isLid) {
            phone = rawId.replace('@lid', '').replace(/\D/g, '');
          }
          const name = p.name || p.notify || p.pushName || phone || 'Desconhecido';
          return { phone, name, admin: p.admin || undefined, lid: isLid ? rawId : undefined };
        }).filter((p: GroupParticipant) => p.phone && p.phone.length >= 4);
      }

      // Merge with message-extracted participants
      const merged = new Map<string, GroupParticipant>();
      for (const p of apiParticipants) {
        merged.set(p.phone, p);
      }
      for (const p of messageParticipants) {
        if (!merged.has(p.phone) && p.phone.length >= 8) {
          merged.set(p.phone, { phone: p.phone, name: p.name });
        } else if (merged.has(p.phone)) {
          const existing = merged.get(p.phone)!;
          if ((existing.name === existing.phone || !existing.name || existing.name === 'Desconhecido') && p.name !== p.phone) {
            existing.name = p.name;
          }
        }
      }

      const allParticipants = Array.from(merged.values())
        .filter(p => p.name !== 'Você')
        .sort((a, b) => {
          if (a.admin && !b.admin) return -1;
          if (!a.admin && b.admin) return 1;
          return a.name.localeCompare(b.name);
        });

      setParticipants(allParticipants);

      // Enrich with contact data
      await enrichWithContactData(allParticipants);
    } catch (e) {
      console.error('Error fetching group participants:', e);
      // Fallback to message participants
      setParticipants(messageParticipants.filter(p => p.name !== 'Você').map(p => ({ ...p })));
    } finally {
      setLoading(false);
    }
  };

  const enrichWithContactData = async (parts: GroupParticipant[]) => {
    if (parts.length === 0) return;

    const phones = parts.map(p => p.phone);
    const orConditions = phones.flatMap(ph => [
      `phone.eq.${ph}`,
      `phone.eq.+${ph}`,
      `phone.eq.+55${ph}`,
    ]).join(',');

    const { data: contacts } = await supabase
      .from('contacts')
      .select('id, full_name, phone, classification, classifications, profession, city, state, tags')
      .or(orConditions);

    const cMap = new Map<string, ContactInfo>();
    for (const c of contacts || []) {
      const normalized = (c.phone || '').replace(/\D/g, '');
      // Map by various phone formats
      for (const ph of phones) {
        if (normalized === ph || normalized === `55${ph}` || normalized.endsWith(ph)) {
          cMap.set(ph, c as ContactInfo);
          break;
        }
      }
    }
    setContactsMap(cMap);

    // Fetch relationships to lead
    if (leadId) {
      const contactIds = Array.from(cMap.values()).map(c => c.id);
      if (contactIds.length > 0) {
        const { data: links } = await (supabase as any)
          .from('contact_leads')
          .select('contact_id, relationship_to_victim')
          .eq('lead_id', leadId)
          .in('contact_id', contactIds);

        const rMap = new Map<string, string>();
        for (const link of links || []) {
          // Find phone for this contact
          for (const [phone, contact] of cMap.entries()) {
            if (contact.id === link.contact_id && link.relationship_to_victim) {
              rMap.set(phone, link.relationship_to_victim);
            }
          }
        }
        setRelationshipsMap(rMap);
      }
    }
  };

  const handleAddAsContact = async (participant: GroupParticipant) => {
    setAddingPhone(participant.phone);
    try {
      const normalizedPhone = participant.phone.replace(/\D/g, '');
      
      // Check existing
      const { data: existing } = await supabase
        .from('contacts')
        .select('id, full_name')
        .or(`phone.eq.${normalizedPhone},phone.eq.+${normalizedPhone},phone.eq.+55${normalizedPhone}`)
        .maybeSingle();

      let contactId: string;

      if (existing) {
        contactId = existing.id;
        toast.info(`Contato "${existing.full_name}" já existe!`);
      } else {
        const { data: newContact, error } = await supabase
          .from('contacts')
          .insert({ full_name: participant.name, phone: normalizedPhone })
          .select()
          .single();
        if (error) throw error;
        contactId = newContact.id;
        toast.success(`Contato "${participant.name}" criado!`);
      }

      // Link to lead if applicable
      if (leadId) {
        const { data: linkExists } = await (supabase as any)
          .from('contact_leads')
          .select('id')
          .eq('contact_id', contactId)
          .eq('lead_id', leadId)
          .maybeSingle();

        if (!linkExists) {
          await (supabase as any).from('contact_leads').insert({ contact_id: contactId, lead_id: leadId });
          toast.success('Contato vinculado ao lead!');
        }
      }

      // Refresh contact data
      await enrichWithContactData(participants);
    } catch (e: any) {
      console.error('Error:', e);
      toast.error('Erro ao criar contato: ' + (e.message || 'Erro'));
    } finally {
      setAddingPhone(null);
    }
  };

  const handleUpdateContact = async (phone: string, field: string, value: string) => {
    const contact = contactsMap.get(phone);
    if (!contact) return;

    try {
      const updateData: any = {};
      if (field === 'classification') {
        updateData.classification = value || null;
      } else if (field === 'profession') {
        updateData.profession = value || null;
      } else if (field === 'city') {
        updateData.city = value || null;
      } else if (field === 'state') {
        updateData.state = value || null;
      }

      const { error } = await supabase
        .from('contacts')
        .update(updateData)
        .eq('id', contact.id);

      if (error) throw error;

      // Update local state
      setContactsMap(prev => {
        const newMap = new Map(prev);
        newMap.set(phone, { ...contact, ...updateData });
        return newMap;
      });

      toast.success('Atualizado!');
    } catch (e: any) {
      toast.error('Erro ao atualizar');
    }
    setEditingField(null);
  };

  const handleUpdateRelationship = async (phone: string, value: string) => {
    const contact = contactsMap.get(phone);
    if (!contact || !leadId) return;

    try {
      const { data: existing } = await (supabase as any)
        .from('contact_leads')
        .select('id')
        .eq('contact_id', contact.id)
        .eq('lead_id', leadId)
        .maybeSingle();

      if (existing) {
        await (supabase as any)
          .from('contact_leads')
          .update({ relationship_to_victim: value || null })
          .eq('id', existing.id);
      }

      setRelationshipsMap(prev => {
        const newMap = new Map(prev);
        if (value) newMap.set(phone, value);
        else newMap.delete(phone);
        return newMap;
      });

      toast.success('Relação atualizada!');
    } catch (e) {
      toast.error('Erro ao atualizar relação');
    }
    setEditingField(null);
  };

  const handleSearchExistingContacts = async (query: string) => {
    setLinkSearchQuery(query);
    if (query.length < 2) {
      setLinkSearchResults([]);
      return;
    }
    const { data } = await supabase
      .from('contacts')
      .select('id, full_name, phone, notes')
      .ilike('full_name', `%${query}%`)
      .order('full_name')
      .limit(10);
    setLinkSearchResults(data || []);
  };

  const handleLinkToExistingContact = async (participant: GroupParticipant, contactId: string) => {
    setAddingPhone(participant.phone);
    try {
      const normalizedPhone = participant.phone.replace(/\D/g, '');
      
      // Update existing contact with this phone number
      const { error } = await supabase
        .from('contacts')
        .update({ phone: normalizedPhone })
        .eq('id', contactId);
      if (error) throw error;

      // Link to lead if applicable
      if (leadId) {
        const { data: linkExists } = await (supabase as any)
          .from('contact_leads')
          .select('id')
          .eq('contact_id', contactId)
          .eq('lead_id', leadId)
          .maybeSingle();

        if (!linkExists) {
          await (supabase as any).from('contact_leads').insert({ contact_id: contactId, lead_id: leadId });
        }
      }

      toast.success('Número vinculado ao contato!');
      setLinkingPhone(null);
      setLinkSearchQuery('');
      setLinkSearchResults([]);
      await enrichWithContactData(participants);
    } catch (e: any) {
      console.error('Error linking:', e);
      toast.error('Erro ao vincular: ' + (e.message || 'Erro'));
    } finally {
      setAddingPhone(null);
    }
  };

  const formatPhone = (phone: string) => {
    if (phone.length === 13) return `+${phone.slice(0, 2)} (${phone.slice(2, 4)}) ${phone.slice(4, 9)}-${phone.slice(9)}`;
    if (phone.length === 12) return `+${phone.slice(0, 2)} (${phone.slice(2, 4)}) ${phone.slice(4, 8)}-${phone.slice(8)}`;
    return phone;
  };

  const filteredParticipants = searchQuery
    ? participants.filter(p =>
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.phone.includes(searchQuery)
      )
    : participants;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Membros do grupo ({participants.length})
          </DialogTitle>
        </DialogHeader>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar membro..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9"
          />
        </div>

        <ScrollArea className="flex-1 -mx-6 px-6">
          {loading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">Buscando membros...</span>
            </div>
          )}

          <div className="space-y-1 pb-4">
            {filteredParticipants.map(p => {
              const contact = contactsMap.get(p.phone);
              const relationship = relationshipsMap.get(p.phone);
              const isExpanded = expandedPhone === p.phone;
              const hasContact = !!contact;

              return (
                <div
                  key={p.phone}
                  className={cn(
                    "rounded-lg border transition-colors",
                    isExpanded ? "bg-muted/30 border-border" : "border-transparent hover:bg-muted/30"
                  )}
                >
                  {/* Main row */}
                  <div
                    className="flex items-center gap-3 py-2.5 px-3 cursor-pointer"
                    onClick={() => setExpandedPhone(isExpanded ? null : p.phone)}
                  >
                    <div className={cn(
                      "h-9 w-9 rounded-full flex items-center justify-center shrink-0 text-xs font-semibold",
                      hasContact ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                    )}>
                      {hasContact ? (contact.full_name || p.name).charAt(0).toUpperCase() : <User className="h-4 w-4" />}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium truncate">
                          {hasContact ? contact.full_name : p.name}
                        </p>
                        {p.admin && (
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">
                            Admin
                          </Badge>
                        )}
                      </div>

                      <div className="flex items-center gap-2 flex-wrap mt-0.5">
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Phone className="h-3 w-3" />
                          {formatPhone(p.phone)}
                        </span>

                        {/* Quick info badges */}
                        {contact?.classification && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                            <Tag className="h-2.5 w-2.5 mr-0.5" />
                            {contact.classification}
                          </Badge>
                        )}
                        {contact?.profession && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                            <Briefcase className="h-2.5 w-2.5 mr-0.5" />
                            {contact.profession}
                          </Badge>
                        )}
                        {(contact?.city || contact?.state) && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                            <MapPin className="h-2.5 w-2.5 mr-0.5" />
                            {[contact.city, contact.state].filter(Boolean).join('/')}
                          </Badge>
                        )}
                        {relationship && (
                          <Badge variant="default" className="text-[10px] px-1.5 py-0">
                            <Heart className="h-2.5 w-2.5 mr-0.5" />
                            {relationship}
                          </Badge>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      {!hasContact && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              disabled={addingPhone === p.phone}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleAddAsContact(p);
                              }}
                            >
                              {addingPhone === p.phone ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <UserPlus className="h-3.5 w-3.5" />
                              )}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Criar contato{leadId ? ' e vincular ao lead' : ''}</TooltipContent>
                        </Tooltip>
                      )}
                      {hasContact && onViewContact && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={(e) => {
                                e.stopPropagation();
                                onViewContact(contact!.id);
                                onOpenChange(false);
                              }}
                            >
                              <ExternalLink className="h-3.5 w-3.5 text-primary" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Abrir ficha do contato</TooltipContent>
                        </Tooltip>
                      )}
                      {hasContact && !onViewContact && (
                        <Check className="h-4 w-4 text-primary" />
                      )}
                      {isExpanded ? (
                        <ChevronUp className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      )}
                    </div>
                  </div>

                  {/* Expanded details */}
                  {isExpanded && hasContact && (
                    <div className="px-3 pb-3 pt-1 border-t border-border/50 mx-3 space-y-2">
                      {/* Classification */}
                      <div className="flex items-center gap-2">
                        <Tag className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="text-xs text-muted-foreground w-20 shrink-0">Relacionamento</span>
                        <Select
                          value={contact.classification || ''}
                          onValueChange={(val) => handleUpdateContact(p.phone, 'classification', val)}
                        >
                          <SelectTrigger className="h-7 text-xs flex-1">
                            <SelectValue placeholder="Selecionar..." />
                          </SelectTrigger>
                          <SelectContent>
                            {classifications.map(c => (
                              <SelectItem key={c.id} value={c.name} className="text-xs">
                                <div className="flex items-center gap-2">
                                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: c.color }} />
                                  {c.name}
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Relationship */}
                      {leadId && (
                        <div className="flex items-center gap-2">
                          <Heart className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <span className="text-xs text-muted-foreground w-20 shrink-0">Relação</span>
                          <Select
                            value={relationship || ''}
                            onValueChange={(val) => handleUpdateRelationship(p.phone, val)}
                          >
                            <SelectTrigger className="h-7 text-xs flex-1">
                              <SelectValue placeholder="Relação com a vítima..." />
                            </SelectTrigger>
                            <SelectContent>
                              {relationshipTypes.map(r => (
                                <SelectItem key={r.id} value={r.name} className="text-xs">{r.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}

                      {/* Profession */}
                      <div className="flex items-center gap-2">
                        <Briefcase className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="text-xs text-muted-foreground w-20 shrink-0">Profissão</span>
                        {editingField?.phone === p.phone && editingField?.field === 'profession' ? (
                          <div className="flex gap-1 flex-1">
                            <Input
                              className="h-7 text-xs flex-1"
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleUpdateContact(p.phone, 'profession', editValue);
                                if (e.key === 'Escape') setEditingField(null);
                              }}
                              autoFocus
                            />
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleUpdateContact(p.phone, 'profession', editValue)}>
                              <Check className="h-3 w-3" />
                            </Button>
                          </div>
                        ) : (
                          <button
                            className="text-xs text-left flex-1 px-2 py-1 rounded hover:bg-muted transition-colors"
                            onClick={() => {
                              setEditingField({ phone: p.phone, field: 'profession' });
                              setEditValue(contact.profession || '');
                            }}
                          >
                            {contact.profession || <span className="text-muted-foreground italic">Adicionar...</span>}
                          </button>
                        )}
                      </div>

                      {/* City / State */}
                      <div className="flex items-center gap-2">
                        <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="text-xs text-muted-foreground w-20 shrink-0">Localização</span>
                        {editingField?.phone === p.phone && editingField?.field === 'city' ? (
                          <div className="flex gap-1 flex-1">
                            <Input
                              className="h-7 text-xs flex-1"
                              placeholder="Cidade"
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleUpdateContact(p.phone, 'city', editValue);
                                if (e.key === 'Escape') setEditingField(null);
                              }}
                              autoFocus
                            />
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleUpdateContact(p.phone, 'city', editValue)}>
                              <Check className="h-3 w-3" />
                            </Button>
                          </div>
                        ) : (
                          <button
                            className="text-xs text-left flex-1 px-2 py-1 rounded hover:bg-muted transition-colors"
                            onClick={() => {
                              setEditingField({ phone: p.phone, field: 'city' });
                              setEditValue(contact.city || '');
                            }}
                          >
                            {[contact.city, contact.state].filter(Boolean).join('/') || <span className="text-muted-foreground italic">Adicionar...</span>}
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Expanded but no contact yet */}
                  {isExpanded && !hasContact && (
                    <div className="px-3 pb-3 pt-1 border-t border-border/50 mx-3 space-y-2">
                      <div className="flex items-center gap-2 py-2">
                        <p className="text-xs text-muted-foreground flex-1">
                          Este participante ainda não é um contato salvo.
                        </p>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          disabled={addingPhone === p.phone}
                          onClick={() => handleAddAsContact(p)}
                        >
                          {addingPhone === p.phone ? (
                            <Loader2 className="h-3 w-3 animate-spin mr-1" />
                          ) : (
                            <UserPlus className="h-3 w-3 mr-1" />
                          )}
                          Criar contato
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => {
                            setLinkingPhone(linkingPhone === p.phone ? null : p.phone);
                            setLinkSearchQuery(p.name !== p.phone ? p.name : '');
                            if (p.name !== p.phone && p.name.length >= 2) {
                              handleSearchExistingContacts(p.name);
                            } else {
                              setLinkSearchResults([]);
                            }
                          }}
                        >
                          <Link2 className="h-3 w-3 mr-1" />
                          Vincular existente
                        </Button>
                      </div>

                      {/* Link to existing contact search */}
                      {linkingPhone === p.phone && (
                        <div className="space-y-2 pb-1">
                          <div className="relative">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                            <Input
                              placeholder="Buscar contato por nome..."
                              value={linkSearchQuery}
                              onChange={(e) => handleSearchExistingContacts(e.target.value)}
                              className="h-8 text-xs pl-8"
                              autoFocus
                            />
                          </div>
                          {linkSearchResults.length > 0 && (
                            <div className="max-h-32 overflow-y-auto space-y-0.5 rounded-md border p-1">
                              {linkSearchResults.map(c => (
                                <button
                                  key={c.id}
                                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-left hover:bg-muted transition-colors"
                                  onClick={() => handleLinkToExistingContact(p, c.id)}
                                  disabled={addingPhone === p.phone}
                                >
                                  <div className="h-6 w-6 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0 text-[10px] font-semibold">
                                    {c.full_name.charAt(0).toUpperCase()}
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <p className="text-xs font-medium truncate">{c.full_name}</p>
                                    <p className="text-[10px] text-muted-foreground truncate">
                                      {c.phone ? `Tel: ${c.phone}` : 'Sem telefone'}
                                      {c.notes?.includes('Escavador') ? ' • via Escavador' : ''}
                                    </p>
                                  </div>
                                  <Link2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                                </button>
                              ))}
                            </div>
                          )}
                          {linkSearchQuery.length >= 2 && linkSearchResults.length === 0 && (
                            <p className="text-[10px] text-muted-foreground text-center py-1">Nenhum contato encontrado.</p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {filteredParticipants.length === 0 && !loading && (
              <p className="text-sm text-muted-foreground text-center py-8">
                {searchQuery ? 'Nenhum membro encontrado.' : 'Nenhum participante identificado.'}
              </p>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
