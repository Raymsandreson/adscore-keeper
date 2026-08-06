import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Users, User, UserPlus, Loader2, MapPin, Briefcase, Tag, Heart, ChevronDown, ChevronUp, Check, Phone, Search, ExternalLink, Link2, FileText, RefreshCw, Save, ArrowUpFromLine, ShieldCheck, ShieldOff, UserMinus, Crown, Plus, X, MessageSquare } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { externalSupabase } from '@/integrations/supabase/external-client';
import { remapToExternal } from '@/integrations/supabase/uuid-remap';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';
import { ContactDetailSheet } from '@/components/contacts/ContactDetailSheet';
import { useConfirmDelete } from '@/hooks/useConfirmDelete';
import type { Contact } from '@/hooks/useContacts';

interface GroupParticipant {
  // Identidade do participante na lista. É o telefone quando existe; para quem o
  // WhatsApp só identifica por LID (conta já migrada), é `lid:<digitos>`.
  key: string;
  phone: string;
  name: string;
  admin?: string;
  lid?: string;
  // Chip de uma instância nossa (Atendimento Previdenciário, João Manoel…).
  // Marcado, não escondido — ver comentário em `teamKeys`.
  isTeam?: boolean;
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
  /** Abre a conversa individual do membro — o número do grupo não serve de atalho. */
  onOpenChat?: (phone: string) => void;
}

export function GroupMembersDialog({ open, onOpenChange, conversationPhone, instanceName, leadId, isGroup, messageParticipants, onViewContact, onOpenChat }: Props) {
  const { confirmDelete, ConfirmDeleteDialog } = useConfirmDelete();
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
  const [showDescription, setShowDescription] = useState(false);
  const [quickContact, setQuickContact] = useState<Contact | null>(null);
  const [quickContactOpen, setQuickContactOpen] = useState(false);
  const [quickContactLoading, setQuickContactLoading] = useState<string | null>(null);
  const [managingPhone, setManagingPhone] = useState<string | null>(null);
  const [bulkPromoting, setBulkPromoting] = useState(false);
  const [showAddMember, setShowAddMember] = useState(false);
  const [newMemberPhone, setNewMemberPhone] = useState('');
  const [addingMember, setAddingMember] = useState(false);
  // tail do telefone (8 dígitos) → nome da instância
  const [teamKeys, setTeamKeys] = useState<Map<string, string>>(new Map());

  const callManage = async (action: 'add' | 'remove' | 'promote' | 'demote', numbers: string[]) => {
    if (!groupJid || !instanceName) throw new Error('Grupo ou instância não definidos');
    const { data, error } = await cloudFunctions.invoke<any>('manage-whatsapp-group-participants', {
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
    confirmDelete(
      'Remover do grupo',
      `Deseja remover ${p.name || p.phone} do grupo? Essa ação não pode ser desfeita.`,
      async () => {
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
      },
      'Remover'
    );
  };

  const handlePromoteAll = async () => {
    const targets = participants.filter(p => !p.admin).map(p => p.phone);
    if (targets.length === 0) { toast.info('Todos já são admin'); return; }
    confirmDelete(
      'Promover todos a admin',
      `Deseja promover ${targets.length} membro(s) a administrador do grupo?`,
      async () => {
        setBulkPromoting(true);
        try {
          const r = await callManage('promote', targets);
          toast.success(`${r.ok_count}/${targets.length} promovido(s) a admin`);
          // refetch para refletir status real
          await fetchParticipants(true);
        } catch (e: any) {
          toast.error(e.message);
        } finally { setBulkPromoting(false); }
      },
      'Promover'
    );
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
      const { data, error } = await externalSupabase
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

  // Carrega o owner_phone de TODAS as instâncias, não só a da conversa.
  // Antes só a instância atual era reconhecida, então os chips das outras
  // apareciam como se fossem membros do caso — com o nome de contatos antigos
  // cadastrados naquele número (ex.: "Gisele Santos" era o Atendimento
  // Previdenciário 2).
  useEffect(() => {
    if (!open) { setTeamKeys(new Map()); return; }
    (async () => {
      const { data } = await (externalSupabase as any)
        .from('whatsapp_instances')
        .select('instance_name, owner_phone');
      const keys = new Map<string, string>();
      for (const row of (data as any[]) || []) {
        const d = String(row?.owner_phone || '').replace(/\D/g, '');
        if (d.length >= 8) keys.set(d.slice(-8), String(row?.instance_name || ''));
      }
      setTeamKeys(keys);
    })();
  }, [open]);

  const isTeamPhone = (phone: string) =>
    !!phone && phone.length >= 8 && teamKeys.has(phone.slice(-8));

  // Para um chip nosso, o nome certo é o da instância. O contato cadastrado
  // naquele número costuma ser antigo e de outra pessoa.
  const teamNameFor = (phone: string) =>
    (phone && phone.length >= 8 ? teamKeys.get(phone.slice(-8)) : '') || '';

  // Realtime: quando o webhook atualizar o cache do grupo (entrou/saiu/promoveu membro),
  // refaz a leitura automaticamente — sem o usuário precisar clicar em nada.
  useEffect(() => {
    if (!open || !isGroup || !groupJid || !instanceName) return;
    const channel = externalSupabase
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
    return () => { externalSupabase.removeChannel(channel); };
  }, [open, isGroup, groupJid, instanceName]);

  const fetchClassificationsAndTypes = async () => {
    const [classRes, relRes] = await Promise.all([
      (externalSupabase as any).from('contact_classifications').select('id, name, color').order('display_order'),
      (supabase as any).from('contact_relationship_types').select('id, name').order('display_order'),
    ]);
    if (classRes.data) setClassifications(classRes.data);
    if (relRes.data) setRelationshipTypes(relRes.data);
  };

  // Mapeia a resposta enriquecida de get-group-participants ou linhas do cache puro.
  const mapApiParticipants = (list: any[]): GroupParticipant[] => {
    return (list || [])
      .map((p: any) => {
        const phone = String(p.phone || '').replace(/\D/g, '');
        const lid = p.lid ? String(p.lid).replace(/\D/g, '') : '';
        // Sem telefone o membro continua na lista, identificado pelo LID.
        const key = String(p.key || '') || (phone.length >= 4 ? phone : (lid ? `lid:${lid}` : ''));
        if (!key) return null;
        const name = p.name || p.display_name || p.notify || p.pushName || phone || 'Sem nome';
        const isAdmin = !!(p.is_admin || p.admin === 'admin' || p.admin === 'superadmin' || p.IsAdmin);
        return {
          key, phone, name,
          admin: isAdmin ? 'admin' : undefined,
          lid: lid || undefined,
          isTeam: p.is_team ?? isTeamPhone(phone),
        } as GroupParticipant;
      })
      .filter(Boolean) as GroupParticipant[];
  };

  // `rosterIsComplete`: a lista veio do /group/info, então ela é a verdade sobre
  // quem está no grupo. Nesse caso as mensagens só completam nomes — quem falou
  // no grupo e não consta do roster (saiu, ou é chip que só passou por lá) não
  // pode ser inventado como membro. Era assim que entrava gente que não está no
  // grupo.
  const mergeWithMessages = (apiList: GroupParticipant[], rosterIsComplete = false): GroupParticipant[] => {
    const merged = new Map<string, GroupParticipant>();
    for (const p of apiList) merged.set(p.key, p);
    for (const p of messageParticipants) {
      if (!merged.has(p.phone) && p.phone.length >= 8) {
        if (rosterIsComplete) continue;
        merged.set(p.phone, { key: p.phone, phone: p.phone, name: p.name, isTeam: isTeamPhone(p.phone) });
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
  // O cache vive no Externo — é dado de negócio, não metadado de auth.
  const readFromCacheAndMerge = async () => {
    if (!groupJid) return false;
    const { data } = await externalSupabase
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
        const rawId = String(p?.JID || p?.jid || p?.id || p?.participant || '');
        const isLid = rawId.includes('@lid');
        // Dígitos de um @lid não são telefone — tratar como tal já exibiu número
        // falso na ficha do membro.
        const phoneSource = p?.PhoneNumber || p?.phoneNumber || p?.phone || (isLid ? '' : rawId);
        const phone = String(phoneSource).replace('@s.whatsapp.net', '').replace(/\D/g, '');
        const lid = isLid ? rawId.replace('@lid', '').replace(/\D/g, '') : '';
        const key = phone.length >= 4 ? phone : (lid ? `lid:${lid}` : '');
        if (!key) return null;
        const name = p?.DisplayName || p?.displayName || p?.Name || p?.name || p?.PushName || p?.pushName || phone || 'Sem nome';
        const isAdmin = !!(p?.IsAdmin || p?.isAdmin || p?.admin || p?.IsSuperAdmin || p?.superAdmin);
        const finalPhone = phone.length >= 4 ? phone : '';
        return {
          key, phone: finalPhone, name,
          admin: isAdmin ? 'admin' : undefined,
          lid: lid || undefined,
          isTeam: isTeamPhone(finalPhone),
        };
      })
      .filter(Boolean) as GroupParticipant[];
    // O cache também guarda o roster do /group/info — é lista completa.
    const merged = mergeWithMessages(apiList, true);
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

      // 2) Chama get-group-participants pelo router (Railway) — cache de 24h +
      //    enriquecimento de nomes/fotos via /chat/details.
      if (!groupJid || !instanceName) return;
      const { data, error } = await cloudFunctions.invoke<any>('get-group-participants', {
        body: { group_jid: groupJid, instance_name: instanceName, refresh: forceRefresh },
      });
      if (error) {
        console.warn('[GroupMembers] get-group-participants error:', error);
        // Mensagem crua no toast de propósito: sem ela, "não foi possível
        // sincronizar" não diz se o problema é rota inexistente, instância fora
        // do grupo ou falha da UazAPI.
        toast.error(`Falha ao sincronizar membros: ${String(error.message || error).slice(0, 160)}`);
        return;
      }
      // A função responde HTTP 200 mesmo em falha de regra de negócio; sem este
      // aviso a lista ficava silenciosamente incompleta.
      if (data && data.success === false) {
        console.warn('[GroupMembers] get-group-participants falhou:', data);
        const tried = Array.isArray(data.tried_instances) && data.tried_instances.length
          ? ` (tentadas: ${data.tried_instances.join('; ').slice(0, 200)})`
          : '';
        toast.error(`Não foi possível ler os membros: ${data.error || 'erro desconhecido'}${tried}`);
        return;
      }
      if (data?.success && Array.isArray(data?.participants)) {
        const apiList = mapApiParticipants(data.participants);
        const allParticipants = mergeWithMessages(apiList, true);
        setParticipants(allParticipants);
        await enrichWithContactData(allParticipants);
      }
    } catch (e) {
      console.error('Error fetching group participants:', e);
      if (participants.length === 0) {
        setParticipants(messageParticipants.filter(p => p.name !== 'Você').map(p => ({ ...p, key: p.phone })));
      }
    } finally {
      setLoading(false);
    }
  };

  const enrichWithContactData = async (parts: GroupParticipant[]) => {
    if (parts.length === 0) return;

    // Membro só-LID não tem telefone para casar com `contacts`.
    const phones = parts.map(p => p.phone).filter(ph => ph && ph.length >= 8);
    if (phones.length === 0) return;
    const orConditions = phones.flatMap(ph => [
      `phone.eq.${ph}`,
      `phone.eq.+${ph}`,
      `phone.eq.+55${ph}`,
    ]).join(',');

    const { data: contacts } = await externalSupabase
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
        const { data: links } = await (externalSupabase as any)
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
      const { data: existing } = await externalSupabase
        .from('contacts')
        .select('id, full_name')
        .or(`phone.eq.${normalizedPhone},phone.eq.+${normalizedPhone},phone.eq.+55${normalizedPhone}`)
        .maybeSingle();

      let contactId: string;

      if (existing) {
        contactId = existing.id;
        toast.info(`Contato "${existing.full_name}" já existe!`);
      } else {
        const { data: newContact, error } = await externalSupabase
          .from('contacts')
          .insert({
            full_name: participant.name,
            phone: normalizedPhone,
            created_by: await remapToExternal((await supabase.auth.getUser()).data.user?.id),
            action_source: 'whatsapp_group',
            action_source_detail: 'Participantes do grupo',
          })
          .select()
          .single();
        if (error) throw error;
        contactId = newContact.id;
        toast.success(`Contato "${participant.name}" criado!`);
      }

      // Link to lead if applicable
      if (leadId) {
        const { data: linkExists } = await (externalSupabase as any)
          .from('contact_leads')
          .select('id')
          .eq('contact_id', contactId)
          .eq('lead_id', leadId)
          .maybeSingle();

        if (!linkExists) {
          await (externalSupabase as any).from('contact_leads').insert({ contact_id: contactId, lead_id: leadId });
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

      const { error } = await externalSupabase
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
      const { data: existing } = await (externalSupabase as any)
        .from('contact_leads')
        .select('id')
        .eq('contact_id', contact.id)
        .eq('lead_id', leadId)
        .maybeSingle();

      if (existing) {
        await (externalSupabase as any)
          .from('contact_leads')
          .update({ relationship_to_primary: value || null })
          .eq('id', existing.id);
      } else {
        await (externalSupabase as any)
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
      await (externalSupabase as any)
        .from('contact_leads')
        .update({ is_primary_client: false })
        .eq('lead_id', leadId);

      // Garante link e marca este como principal
      const { data: existing } = await (externalSupabase as any)
        .from('contact_leads')
        .select('id')
        .eq('contact_id', contact.id)
        .eq('lead_id', leadId)
        .maybeSingle();

      if (existing) {
        await (externalSupabase as any)
          .from('contact_leads')
          .update({ is_primary_client: true, relationship_to_primary: null })
          .eq('id', existing.id);
      } else {
        await (externalSupabase as any)
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
      await (externalSupabase as any)
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
    const { data } = await externalSupabase
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
      const { error } = await externalSupabase
        .from('contacts')
        .update({ phone: normalizedPhone })
        .eq('id', contactId);
      if (error) throw error;

      // Link to lead if applicable
      if (leadId) {
        const { data: linkExists } = await (externalSupabase as any)
          .from('contact_leads')
          .select('id')
          .eq('contact_id', contactId)
          .eq('lead_id', leadId)
          .maybeSingle();

        if (!linkExists) {
          await (externalSupabase as any).from('contact_leads').insert({ contact_id: contactId, lead_id: leadId });
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

  // Instâncias nossas continuam na lista (com selo "Equipe") para o total bater
  // com o do WhatsApp. Só grupos-como-contato saem daqui.
  const nonGroupParticipants = participants.filter(p => {
    const contact = contactsMap.get(p.phone);
    return !(isGroupLikeName(p.name) || isGroupLikeName(contact?.full_name));
  });

  const filteredParticipants = searchQuery
    ? nonGroupParticipants.filter(p =>
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.phone.includes(searchQuery)
      )
    : nonGroupParticipants;

  return (
    <>
      <ConfirmDeleteDialog />
      <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            <span>Membros do grupo ({nonGroupParticipants.length})</span>
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
        <div className="relative shrink-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar membro..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9"
          />
        </div>

        {/* Group management toolbar */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
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
          <div className="flex items-center gap-2 rounded-md border bg-muted/30 p-2 shrink-0">
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

        {/* Group description (sync with WhatsApp) — recolhida por padrão.
            Aberta, o bloco ocupava metade do modal e empurrava os membros para
            fora da área visível. */}
        <div className="rounded-lg border bg-muted/30 p-3 space-y-2 shrink-0">
          <div className="flex items-center justify-between">
            <button
              type="button"
              className="flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setShowDescription(v => !v)}
            >
              <FileText className="h-3.5 w-3.5" />
              Descrição do grupo
              {!showDescription && groupDescription.trim() !== '' && (
                <span className="max-w-[140px] truncate italic opacity-70">— {groupDescription}</span>
              )}
              {showDescription ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
            {showDescription && (
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
            )}
          </div>
          {showDescription && (
          <>
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
          </>
          )}
        </div>

        {/* `min-h-0` é obrigatório: num flex column com altura máxima, o item
            flex-1 tem min-height:auto e não encolhe abaixo do próprio conteúdo,
            então a lista era cortada sem nunca rolar. */}
        <ScrollArea className="flex-1 min-h-0 -mx-6 px-6">
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
              const isExpanded = expandedPhone === p.key;
              const hasContact = !!contact;
              // Membro que o WhatsApp só identifica por LID: sem número, as ações
              // que dependem dele (admin, remover, virar contato) não se aplicam.
              const hasPhone = !!p.phone;
              const isPrimary = primaryPhone === p.phone;
              const primaryContact = primaryPhone ? contactsMap.get(primaryPhone) : null;
              const primaryName = primaryContact?.full_name || (primaryPhone ? 'cliente principal' : null);

              return (
                <div
                  key={p.key}
                  className={cn(
                    "rounded-lg border transition-colors",
                    isExpanded ? "bg-muted/30 border-border" : "border-transparent hover:bg-muted/30"
                  )}
                >
                  {/* Main row */}
                  <div
                    className="flex items-center gap-3 py-2.5 px-3 cursor-pointer"
                    onClick={() => setExpandedPhone(isExpanded ? null : p.key)}
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
                          {p.isTeam
                            ? (teamNameFor(p.phone) || p.name)
                            : (hasContact ? contact.full_name : p.name)}
                        </p>
                        {p.admin && (
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">
                            Admin
                          </Badge>
                        )}
                        {p.isTeam && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0 border-primary/40 text-primary">
                            Equipe
                          </Badge>
                        )}
                      </div>

                      <div className="flex items-center gap-2 flex-wrap mt-0.5">
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Phone className="h-3 w-3" />
                          {hasPhone ? formatPhone(p.phone) : 'Número oculto pelo WhatsApp'}
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
                            disabled={managingPhone === p.phone || !hasPhone}
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
                        <TooltipContent>
                          {!hasPhone
                            ? 'Sem número visível — o WhatsApp não permite gerenciar este membro por aqui'
                            : p.admin ? 'Rebaixar (remover admin)' : 'Tornar admin'}
                        </TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            disabled={managingPhone === p.phone || !hasPhone}
                            onClick={(e) => { e.stopPropagation(); handleRemove(p); }}
                          >
                            <UserMinus className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Remover do grupo</TooltipContent>
                      </Tooltip>

                      {!hasContact && hasPhone && (
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
                      {onOpenChat && p.phone && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7"
                              onClick={(e) => {
                                e.stopPropagation();
                                onOpenChat(p.phone);
                                onOpenChange(false);
                              }}
                            >
                              <MessageSquare className="h-3.5 w-3.5 text-primary" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Abrir a conversa individual deste membro</TooltipContent>
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

                      {/* Relationship to primary client */}
                      {leadId && !isPrimary && (
                        <div className="flex items-center gap-2">
                          <Heart className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <span className="text-xs text-muted-foreground w-20 shrink-0">Relação</span>
                          <Select
                            value={relationship || ''}
                            onValueChange={(val) => handleUpdateRelationship(p.phone, val)}
                            disabled={!primaryPhone}
                          >
                            <SelectTrigger className="h-7 text-xs flex-1">
                              <SelectValue placeholder={primaryPhone ? `Relação com ${primaryName}...` : 'Defina o cliente principal antes'} />
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
                          {hasPhone
                            ? 'Este participante ainda não é um contato salvo.'
                            : 'O WhatsApp não expõe o número deste membro. Ele aparece quando enviar uma mensagem no grupo.'}
                        </p>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          disabled={addingPhone === p.phone || !hasPhone}
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
                          disabled={!hasPhone}
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
