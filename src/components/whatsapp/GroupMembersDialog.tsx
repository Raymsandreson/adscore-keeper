import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Users, User, UserPlus, Loader2, MapPin, Briefcase, Tag, Heart, ChevronDown, ChevronUp, Check, Phone, Search, ExternalLink, Link2, FileText, RefreshCw, Save, ArrowUpFromLine, ShieldCheck, ShieldOff, UserMinus, Crown, Plus, X } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';
import { ContactDetailSheet } from '@/components/contacts/ContactDetailSheet';
import type { Contact } from '@/hooks/useContacts';

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
  const [primaryPhone, setPrimaryPhone] = useState<string | null>(null);
  const [settingPrimary, setSettingPrimary] = useState<string | null>(null);
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
  const [groupDescription, setGroupDescription] = useState<string>('');
  const [groupDescriptionInitial, setGroupDescriptionInitial] = useState<string>('');
  const [descLoading, setDescLoading] = useState(false);
  const [descSaving, setDescSaving] = useState(false);
  const [descPulling, setDescPulling] = useState(false);
  const [descriptionUpdatedAt, setDescriptionUpdatedAt] = useState<string | null>(null);
  const [quickContact, setQuickContact] = useState<Contact | null>(null);
  const [quickContactOpen, setQuickContactOpen] = useState(false);
  const [quickContactLoading, setQuickContactLoading] = useState<string | null>(null);
  const [managingPhone, setManagingPhone] = useState<string | null>(null);
  const [bulkPromoting, setBulkPromoting] = useState(false);
  const [showAddMember, setShowAddMember] = useState(false);
  const [newMemberPhone, setNewMemberPhone] = useState('');
  const [addingMember, setAddingMember] = useState(false);

  const callManage = async (action: 'add' | 'remove' | 'promote' | 'demote', numbers: string[]) => {
    if (!groupJid || !instanceName) throw new Error('Grupo ou instância não definidos');
    const { data, error } = await (supabase as any).functions.invoke('manage-whatsapp-group-participants', {
      body: { instance_name: instanceName, group_jid: groupJid, action, numbers },
    });
    if (error) throw new Error(error.message);
    if (data?.success === false) throw new Error(data.error || 'Falha na operação');
    return data;
  };

  const handlePromote = async (p: GroupParticipant) => {
    setManagingPhone(p.phone);
    try {
      const r = await callManage('promote', [p.phone]);
      if (r.ok_count > 0) {
        toast.success(`${p.name || p.phone} promovido a admin`);
        setParticipants(prev => prev.map(x => x.phone === p.phone ? { ...x, admin: 'admin' } : x));
      } else {
        toast.error('Não foi possível promover (verifique se você é admin do grupo)');
      }
    } catch (e: any) {
      toast.error(e.message);
    } finally { setManagingPhone(null); }
  };

  const handleDemote = async (p: GroupParticipant) => {
    setManagingPhone(p.phone);
    try {
      const r = await callManage('demote', [p.phone]);
      if (r.ok_count > 0) {
        toast.success(`${p.name || p.phone} rebaixado a membro`);
        setParticipants(prev => prev.map(x => x.phone === p.phone ? { ...x, admin: undefined } : x));
      } else {
        toast.error('Não foi possível rebaixar');
      }
    } catch (e: any) {
      toast.error(e.message);
    } finally { setManagingPhone(null); }
  };

  const handleRemove = async (p: GroupParticipant) => {
    if (!confirm(`Remover ${p.name || p.phone} do grupo?`)) return;
    setManagingPhone(p.phone);
    try {
      const r = await callManage('remove', [p.phone]);
      if (r.ok_count > 0) {
        toast.success(`${p.name || p.phone} removido do grupo`);
        setParticipants(prev => prev.filter(x => x.phone !== p.phone));
      } else {
        toast.error('Não foi possível remover');
      }
    } catch (e: any) {
      toast.error(e.message);
    } finally { setManagingPhone(null); }
  };

  const handlePromoteAll = async () => {
    const targets = participants.filter(p => !p.admin).map(p => p.phone);
    if (targets.length === 0) { toast.info('Todos já são admin'); return; }
    if (!confirm(`Promover ${targets.length} membro(s) a admin?`)) return;
    setBulkPromoting(true);
    try {
      const r = await callManage('promote', targets);
      toast.success(`${r.ok_count}/${targets.length} promovido(s) a admin`);
      // refetch para refletir status real
      await fetchParticipants(true);
    } catch (e: any) {
      toast.error(e.message);
    } finally { setBulkPromoting(false); }
  };

  const handleAddMember = async () => {
    const digits = newMemberPhone.replace(/\D/g, '');
    if (digits.length < 10) { toast.error('Informe um número válido com DDD'); return; }
    setAddingMember(true);
    try {
      const r = await callManage('add', [digits]);
      if (r.ok_count > 0) {
        toast.success('Membro adicionado');
        setNewMemberPhone('');
        setShowAddMember(false);
        await fetchParticipants(true);
      } else {
        const detail = r.details?.[0];
        toast.error(detail?.message || 'Não foi possível adicionar (número pode não ter WhatsApp ou bloqueou convites)');
      }
    } catch (e: any) {
      toast.error(e.message);
    } finally { setAddingMember(false); }
  };


  const openQuickContact = async (contactId: string) => {
    setQuickContactLoading(contactId);
    try {
      const { data, error } = await supabase
        .from('contacts')
        .select('*')
        .eq('id', contactId)
        .maybeSingle();
      if (error) throw error;
      if (!data) { toast.error('Contato não encontrado'); return; }
      setQuickContact(data as Contact);
      setQuickContactOpen(true);
    } catch (e: any) {
      toast.error(e?.message || 'Erro ao abrir ficha');
    } finally {
      setQuickContactLoading(null);
    }
  };

  const groupJid = isGroup && conversationPhone ? (conversationPhone.includes('@g.us') ? conversationPhone : `${conversationPhone}@g.us`) : null;

  const loadDescription = async (mode: 'get' | 'pull' = 'get') => {
    if (!groupJid || !instanceName) return;
    if (mode === 'pull') setDescPulling(true); else setDescLoading(true);
    try {
      const { data, error } = await (supabase as any).functions.invoke('sync-whatsapp-group-description', {
        body: { mode, group_jid: groupJid, instance_name: instanceName },
      });
      if (error) throw new Error(error.message);
      if (data?.success === false) throw new Error(data.error || 'Falha');
      const desc = data?.description ?? '';
      setGroupDescription(desc);
      setGroupDescriptionInitial(desc);
      setDescriptionUpdatedAt(data?.description_updated_at ?? null);
      if (mode === 'pull') toast.success('Descrição atualizada do WhatsApp');
    } catch (e: any) {
      if (mode === 'pull') toast.error(`Erro ao buscar do WhatsApp: ${e.message}`);
    } finally {
      setDescLoading(false);
      setDescPulling(false);
    }
  };

  const saveDescription = async () => {
    if (!groupJid || !instanceName) return;
    setDescSaving(true);
    try {
      const { data, error } = await (supabase as any).functions.invoke('sync-whatsapp-group-description', {
        body: { mode: 'push', group_jid: groupJid, instance_name: instanceName, description: groupDescription },
      });
      if (error) throw new Error(error.message);
      if (data?.success === false) throw new Error(data.error || 'Falha');
      setGroupDescriptionInitial(groupDescription);
      toast.success('Descrição enviada para o WhatsApp');
    } catch (e: any) {
      toast.error(`Erro ao enviar: ${e.message}`);
    } finally {
      setDescSaving(false);
    }
  };

  useEffect(() => {
    if (open && isGroup && groupJid && instanceName) {
      loadDescription('get');
    }
  }, [open, isGroup, groupJid, instanceName]);

  useEffect(() => {
    if (open && isGroup) {
      fetchParticipants();
      fetchClassificationsAndTypes();
    }
  }, [open, isGroup, groupJid, instanceName]);

  // Realtime: quando o webhook atualizar o cache do grupo (entrou/saiu/promoveu membro),
  // refaz a leitura automaticamente — sem o usuário precisar clicar em nada.
  useEffect(() => {
    if (!open || !isGroup || !groupJid || !instanceName) return;
    const channel = supabase
      .channel(`group-cache-${groupJid}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'whatsapp_groups_cache',
          filter: `group_jid=eq.${groupJid}`,
        },
        () => {
          // Lê do cache (instantâneo); sem refresh forçado pra não bater na UazAPI toda hora.
          readFromCacheAndMerge();
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [open, isGroup, groupJid, instanceName]);

  const fetchClassificationsAndTypes = async () => {
    const [classRes, relRes] = await Promise.all([
      (supabase as any).from('contact_classifications').select('id, name, color').order('display_order'),
      (supabase as any).from('contact_relationship_types').select('id, name').order('display_order'),
    ]);
    if (classRes.data) setClassifications(classRes.data);
    if (relRes.data) setRelationshipTypes(relRes.data);
  };

  // Mapeia a resposta enriquecida do edge get-group-participants ou linhas do cache puro.
  const mapApiParticipants = (list: any[]): GroupParticipant[] => {
    return (list || [])
      .map((p: any) => {
        const phone = String(p.phone || '').replace(/\D/g, '');
        if (!phone || phone.length < 4) return null;
        const name = p.name || p.display_name || p.notify || p.pushName || phone;
        const isAdmin = !!(p.is_admin || p.admin === 'admin' || p.admin === 'superadmin' || p.IsAdmin);
        return { phone, name, admin: isAdmin ? 'admin' : undefined, lid: p.lid || undefined } as GroupParticipant;
      })
      .filter(Boolean) as GroupParticipant[];
  };

  const mergeWithMessages = (apiList: GroupParticipant[]): GroupParticipant[] => {
    const merged = new Map<string, GroupParticipant>();
    for (const p of apiList) merged.set(p.phone, p);
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
    return Array.from(merged.values())
      .filter(p => p.name !== 'Você')
      .sort((a, b) => {
        if (a.admin && !b.admin) return -1;
        if (!a.admin && b.admin) return 1;
        return a.name.localeCompare(b.name);
      });
  };

  // Leitura instantânea do cache local (sem chamar UazAPI).
  const readFromCacheAndMerge = async () => {
    if (!groupJid) return false;
    const { data } = await supabase
      .from('whatsapp_groups_cache')
      .select('participants')
      .eq('group_jid', groupJid)
      .order('fetched_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const raw = Array.isArray((data as any)?.participants) ? (data as any).participants : [];
    if (raw.length === 0) return false;
    // O cache guarda o payload bruto da UazAPI — precisa extrair phone/admin.
    const apiList: GroupParticipant[] = raw
      .map((p: any) => {
        const rawId = p?.JID || p?.jid || p?.id || p?.participant || '';
        let phone = String(p?.PhoneNumber || p?.phoneNumber || p?.phone || rawId).replace('@s.whatsapp.net', '').replace('@lid', '').replace(/\D/g, '');
        if (!phone || phone.length < 4) return null;
        const name = p?.DisplayName || p?.displayName || p?.Name || p?.name || p?.PushName || p?.pushName || phone;
        const isAdmin = !!(p?.IsAdmin || p?.isAdmin || p?.admin || p?.IsSuperAdmin || p?.superAdmin);
        const isLid = String(rawId).includes('@lid');
        return { phone, name, admin: isAdmin ? 'admin' : undefined, lid: isLid ? rawId : undefined };
      })
      .filter(Boolean) as GroupParticipant[];
    const merged = mergeWithMessages(apiList);
    setParticipants(merged);
    enrichWithContactData(merged).catch(() => {});
    return merged.length > 0;
  };

  const fetchParticipants = async (forceRefresh = false) => {
    setLoading(true);
    try {
      // 1) Render instantâneo a partir do cache local (se não estiver forçando refresh).
      if (!forceRefresh) {
        await readFromCacheAndMerge();
      }

      // 2) Chama o edge get-group-participants (usa cache de 24h + enriquece nomes/fotos via /chat/details).
      if (!groupJid || !instanceName) return;
      const { data, error } = await (supabase as any).functions.invoke('get-group-participants', {
        body: { group_jid: groupJid, instance_name: instanceName, refresh: forceRefresh },
      });
      if (error) {
        console.warn('[GroupMembers] get-group-participants error:', error);
        return;
      }
      if (data?.success && Array.isArray(data?.participants)) {
        const apiList = mapApiParticipants(data.participants);
        const allParticipants = mergeWithMessages(apiList);
        setParticipants(allParticipants);
        await enrichWithContactData(allParticipants);
      }
    } catch (e) {
      console.error('Error fetching group participants:', e);
      if (participants.length === 0) {
        setParticipants(messageParticipants.filter(p => p.name !== 'Você').map(p => ({ ...p })));
      }
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

    // Fetch relationships to lead (cliente principal + relação ao principal)
    if (leadId) {
      const contactIds = Array.from(cMap.values()).map(c => c.id);
      if (contactIds.length > 0) {
        const { data: links } = await (supabase as any)
          .from('contact_leads')
          .select('contact_id, relationship_to_primary, relationship_to_victim, is_primary_client')
          .eq('lead_id', leadId)
          .in('contact_id', contactIds);

        const rMap = new Map<string, string>();
        let primary: string | null = null;
        for (const link of links || []) {
          for (const [phone, contact] of cMap.entries()) {
            if (contact.id === link.contact_id) {
              const rel = link.relationship_to_primary || link.relationship_to_victim;
              if (rel) rMap.set(phone, rel);
              if (link.is_primary_client) primary = phone;
            }
          }
        }
        setRelationshipsMap(rMap);
        setPrimaryPhone(primary);
      }
    }
  };

  const handleAddAsContact = async (participant: GroupParticipant) => {
    // Bloqueia criar "Grupo" como contato — grupo é vinculado ao lead pela aba Grupos.
    if (/^\s*grupo\b/i.test(participant.name?.trim() || '')) {
      toast.error('Grupos não podem ser salvos como contato. Vincule o grupo ao lead pela aba "Grupos".');
      return;
    }
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
          .update({ relationship_to_primary: value || null })
          .eq('id', existing.id);
      } else {
        await (supabase as any)
          .from('contact_leads')
          .insert({ contact_id: contact.id, lead_id: leadId, relationship_to_primary: value || null });
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

  const handleSetPrimary = async (phone: string) => {
    const contact = contactsMap.get(phone);
    if (!contact || !leadId) return;
    setSettingPrimary(phone);
    try {
      // Desmarca qualquer principal anterior
      await (supabase as any)
        .from('contact_leads')
        .update({ is_primary_client: false })
        .eq('lead_id', leadId);

      // Garante link e marca este como principal
      const { data: existing } = await (supabase as any)
        .from('contact_leads')
        .select('id')
        .eq('contact_id', contact.id)
        .eq('lead_id', leadId)
        .maybeSingle();

      if (existing) {
        await (supabase as any)
          .from('contact_leads')
          .update({ is_primary_client: true, relationship_to_primary: null })
          .eq('id', existing.id);
      } else {
        await (supabase as any)
          .from('contact_leads')
          .insert({ contact_id: contact.id, lead_id: leadId, is_primary_client: true });
      }

      setPrimaryPhone(phone);
      setRelationshipsMap(prev => {
        const newMap = new Map(prev);
        newMap.delete(phone);
        return newMap;
      });
      toast.success(`${contact.full_name} agora é o cliente principal`);
    } catch (e: any) {
      toast.error('Erro ao marcar cliente principal: ' + (e?.message || ''));
    } finally {
      setSettingPrimary(null);
    }
  };

  const handleUnsetPrimary = async () => {
    if (!leadId) return;
    try {
      await (supabase as any)
        .from('contact_leads')
        .update({ is_primary_client: false })
        .eq('lead_id', leadId);
      setPrimaryPhone(null);
      toast.success('Cliente principal removido');
    } catch {
      toast.error('Erro ao remover cliente principal');
    }
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

  const formatUpdatedAt = (iso: string | null) => {
    if (!iso) return null;
    const d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    return d.toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  };

  // Grupos não são contatos — esconder qualquer participante cujo nome (ou contato vinculado) comece com "Grupo"
  const isGroupLikeName = (name?: string | null) =>
    !!name && /^\s*grupo\b/i.test(name.trim());

  const nonGroupParticipants = participants.filter(p => {
    const contact = contactsMap.get(p.phone);
    return !isGroupLikeName(p.name) && !isGroupLikeName(contact?.full_name);
  });

  const filteredParticipants = searchQuery
    ? nonGroupParticipants.filter(p =>
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.phone.includes(searchQuery)
      )
    : nonGroupParticipants;

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            <span>Membros do grupo ({participants.length})</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 ml-auto"
                  onClick={() => fetchParticipants(true)}
                  disabled={loading}
                  aria-label="Atualizar lista"
                >
                  <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Forçar atualização (sincroniza com o WhatsApp)</TooltipContent>
            </Tooltip>
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

        {/* Group management toolbar */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs gap-1"
            onClick={() => { setShowAddMember(v => !v); setNewMemberPhone(''); }}
          >
            <Plus className="h-3.5 w-3.5" /> Adicionar membro
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs gap-1"
            onClick={handlePromoteAll}
            disabled={bulkPromoting || participants.filter(p => !p.admin).length === 0}
          >
            {bulkPromoting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Crown className="h-3.5 w-3.5" />}
            Promover todos a admin
          </Button>
        </div>

        {showAddMember && (
          <div className="flex items-center gap-2 rounded-md border bg-muted/30 p-2">
            <Input
              autoFocus
              placeholder="Ex: 5511999998888 (com DDI+DDD)"
              value={newMemberPhone}
              onChange={(e) => setNewMemberPhone(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddMember(); }}
              className="h-8 text-xs flex-1"
              disabled={addingMember}
            />
            <Button size="sm" className="h-8 text-xs" onClick={handleAddMember} disabled={addingMember}>
              {addingMember ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            </Button>
            <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => { setShowAddMember(false); setNewMemberPhone(''); }}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}

        {/* Group description (sync with WhatsApp) */}
        <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <FileText className="h-3.5 w-3.5" />
              Descrição do grupo
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs gap-1"
              onClick={() => loadDescription('pull')}
              disabled={descPulling || descSaving}
              title="Buscar a descrição atual diretamente do WhatsApp"
            >
              {descPulling ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              Buscar do WhatsApp
            </Button>
          </div>
          <Textarea
            value={groupDescription}
            onChange={(e) => setGroupDescription(e.target.value)}
            placeholder={descLoading ? 'Carregando…' : 'Este grupo não tem descrição. Escreva aqui e clique em Salvar para enviar ao WhatsApp.'}
            disabled={descLoading || descSaving}
            maxLength={512}
            rows={3}
            className="text-sm resize-none"
          />
          {!descLoading && !descPulling && groupDescription.trim() === '' && (
            <p className="text-[11px] text-muted-foreground italic">
              Este grupo ainda não tem descrição no WhatsApp.
            </p>
          )}
          {descriptionUpdatedAt && (
            <p className="text-[10px] text-muted-foreground">
              Descrição atualizada em {formatUpdatedAt(descriptionUpdatedAt)}
            </p>
          )}
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground">{groupDescription.length}/512</span>
            <Button
              size="sm"
              className="h-7 px-3 text-xs gap-1"
              onClick={saveDescription}
              disabled={descSaving || descLoading || groupDescription === groupDescriptionInitial}
            >
              {descSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              Salvar no WhatsApp
            </Button>
          </div>
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
              const isPrimary = primaryPhone === p.phone;
              const primaryContact = primaryPhone ? contactsMap.get(primaryPhone) : null;
              const primaryName = primaryContact?.full_name || (primaryPhone ? 'cliente principal' : null);

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
                        {isPrimary ? (
                          <Badge variant="default" className="text-[10px] px-1.5 py-0 bg-amber-500 hover:bg-amber-500">
                            <Crown className="h-2.5 w-2.5 mr-0.5" />
                            Cliente principal
                          </Badge>
                        ) : relationship && (
                          <Badge variant="default" className="text-[10px] px-1.5 py-0">
                            <Heart className="h-2.5 w-2.5 mr-0.5" />
                            {relationship}
                          </Badge>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      {hasContact && leadId && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              disabled={settingPrimary === p.phone}
                              onClick={(e) => {
                                e.stopPropagation();
                                isPrimary ? handleUnsetPrimary() : handleSetPrimary(p.phone);
                              }}
                            >
                              {settingPrimary === p.phone ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Crown className={cn("h-3.5 w-3.5", isPrimary ? "text-amber-500 fill-amber-500" : "text-muted-foreground")} />
                              )}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>{isPrimary ? 'Remover como cliente principal' : 'Marcar como cliente principal'}</TooltipContent>
                        </Tooltip>
                      )}
                      {/* Group admin actions */}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            disabled={managingPhone === p.phone}
                            onClick={(e) => {
                              e.stopPropagation();
                              p.admin ? handleDemote(p) : handlePromote(p);
                            }}
                          >
                            {managingPhone === p.phone ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : p.admin ? (
                              <ShieldOff className="h-3.5 w-3.5 text-muted-foreground" />
                            ) : (
                              <ShieldCheck className="h-3.5 w-3.5 text-amber-600" />
                            )}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{p.admin ? 'Rebaixar (remover admin)' : 'Tornar admin'}</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            disabled={managingPhone === p.phone}
                            onClick={(e) => { e.stopPropagation(); handleRemove(p); }}
                          >
                            <UserMinus className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Remover do grupo</TooltipContent>
                      </Tooltip>

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
                      {hasContact && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              disabled={quickContactLoading === contact!.id}
                              onClick={(e) => {
                                e.stopPropagation();
                                openQuickContact(contact!.id);
                              }}
                            >
                              {quickContactLoading === contact!.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <ArrowUpFromLine className="h-3.5 w-3.5 text-primary" />
                              )}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Abrir ficha aqui (deslizar de baixo)</TooltipContent>
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

    <ContactDetailSheet
      contact={quickContact}
      open={quickContactOpen}
      onOpenChange={(o) => { setQuickContactOpen(o); if (!o) setQuickContact(null); }}
      mode="sheet"
      side="bottom"
    />
    </>
  );
}
