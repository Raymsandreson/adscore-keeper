import { useState, useEffect, useRef, useMemo } from 'react';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent } from '@/components/ui/dropdown-menu';
import { supabase } from '@/integrations/supabase/client';
import { format, parseISO, isToday, isYesterday } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Loader2, User, Send, MoreVertical, Link2, UserPlus, Plus, Scale, Sparkles, X, Users, Bot, BotOff, Paperclip, Image, FileUp, Lock, LockOpen, FileSignature, Volume2, VolumeX, BellOff, Trash2 } from 'lucide-react';
import { Phone as PhoneIcon, PhoneIncoming, PhoneOutgoing, PhoneMissed } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useAuthContext } from '@/contexts/AuthContext';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';
import { LeadEditDialog } from '@/components/kanban/LeadEditDialog';
import { ContactDetailSheet } from '@/components/contacts/ContactDetailSheet';
import { ZapSignDocumentDialog } from '@/components/whatsapp/ZapSignDocumentDialog';
import type { Lead } from '@/hooks/useLeads';
import type { Contact } from '@/hooks/useContacts';

const TREATMENT_OPTIONS = ['', 'Dr.', 'Dra.', 'Sr.', 'Sra.', 'Prof.', 'Profa.'];
const NAME_FORMAT_OPTIONS = [
  { value: 'full', label: 'Nome completo' },
  { value: 'first', label: 'Primeiro nome' },
  { value: 'first_last', label: 'Primeiro e último' },
  { value: 'nickname', label: 'Apelido' },
];

interface Message {
  id: string;
  message_text: string | null;
  direction: string;
  created_at: string;
  message_type: string;
  media_url: string | null;
  media_type: string | null;
  instance_name: string | null;
}

interface CallRecord {
  id: string;
  call_type: string;
  call_result: string;
  duration_seconds: number | null;
  notes: string | null;
  ai_summary: string | null;
  created_at: string;
  contact_name: string | null;
  phone_used: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  phone: string | null;
  contactName: string | null;
  instanceName: string | null;
  hasLead: boolean;
  hasContact: boolean;
  wasResponded: boolean;
  responseTimeMinutes: number | null;
  onConversationUpdated?: () => void;
  onOpenChat?: (phone: string) => void;
  campaignBoardId?: string | null;
  campaignStageId?: string | null;
}

export function DashboardChatPreview({ open, onOpenChange, phone, contactName, instanceName, hasLead, hasContact, wasResponded, responseTimeMinutes, onConversationUpdated, onOpenChat, campaignBoardId, campaignStageId }: Props) {
  const { user, profile } = useAuthContext();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [newMessage, setNewMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<string | null>(null);
  const [loadingSuggestion, setLoadingSuggestion] = useState(false);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [creatingLead, setCreatingLead] = useState(false);
  const [agentInfo, setAgentInfo] = useState<{ name: string; activated_by: string | null; is_active: boolean } | null>(null);
  const [callRecords, setCallRecords] = useState<CallRecord[]>([]);
  const [identifySender, setIdentifySender] = useState(true);
  const [treatmentTitle, setTreatmentTitle] = useState<string>('');
  const [nameFormat, setNameFormat] = useState<string>('first_last');
  const [nicknames, setNicknames] = useState<string[]>([]);
  const [selectedNickname, setSelectedNickname] = useState<string>('');
  const [newNickname, setNewNickname] = useState('');
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [linkedLead, setLinkedLead] = useState<Lead | null>(null);
  const [linkedContact, setLinkedContact] = useState<Contact | null>(null);
  const [showLeadEdit, setShowLeadEdit] = useState(false);
  const [showContactEdit, setShowContactEdit] = useState(false);
  const [isPrivate, setIsPrivate] = useState(false);
  const [togglingPrivate, setTogglingPrivate] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [muteLoading, setMuteLoading] = useState(false);
  const [showZapSign, setShowZapSign] = useState(false);
  const [selectedMsgId, setSelectedMsgId] = useState<string | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const mediaInputRef = useRef<HTMLInputElement>(null);

  // Load identity preferences when phone changes
  useEffect(() => {
    if (!phone) return;
    const storageKey = `wa-identify-sender:${phone}`;
    const savedPref = localStorage.getItem(storageKey);
    setIdentifySender(savedPref !== 'false');

    const profileGender = (profile as any)?.gender;
    const defaultTreatment = profileGender === 'female' ? 'Dra.' : profileGender === 'male' ? 'Dr.' : '';
    const treatmentKey = `wa-treatment:${phone}`;
    const savedTreatment = localStorage.getItem(treatmentKey);
    setTreatmentTitle(savedTreatment ?? defaultTreatment);

    const nameFormatKey = `wa-name-format:${phone}`;
    const savedFormat = localStorage.getItem(nameFormatKey);
    setNameFormat(savedFormat || 'first_last');

    const nicknamesKey = `wa-nicknames`;
    const savedNicknames = localStorage.getItem(nicknamesKey);
    setNicknames(savedNicknames ? JSON.parse(savedNicknames) : []);

    const selectedNicknameKey = `wa-selected-nickname:${phone}`;
    const savedSelectedNickname = localStorage.getItem(selectedNicknameKey);
    setSelectedNickname(savedSelectedNickname || '');
  }, [phone, profile]);

  useEffect(() => {
    if (!open || !phone) return;
    setLoading(true);
    setAiSuggestion(null);
    setAgentInfo(null);
    setCallRecords([]);
    setLinkedLead(null);
    setLinkedContact(null);
    const normalizedPhone = phone.replace(/\D/g, '');
    const fetchMessages = async () => {
      const { data } = await supabase
        .from('whatsapp_messages')
        .select('id, message_text, direction, created_at, message_type, media_url, media_type, instance_name')
        .eq('phone', phone)
        .order('created_at', { ascending: true })
        .limit(200);
      setMessages(data || []);
      setLoading(false);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'auto' }), 100);
    };
    const fetchAgent = async () => {
      const { data } = await supabase
        .from('whatsapp_conversation_agents')
        .select('agent_id, is_active, activated_by')
        .or(`phone.eq.${normalizedPhone},phone.ilike.%${normalizedPhone.slice(-8)}%`)
        .limit(1)
        .maybeSingle();
      if (data) {
        const { data: agent } = await supabase
          .from('whatsapp_ai_agents' as any)
          .select('name')
          .eq('id', data.agent_id)
          .maybeSingle();
        const activatedByLabel = data.activated_by === 'stage_auto' ? 'Troca de Etapa'
          : (data.activated_by === 'ctwa_campaign' || data.activated_by === 'campaign_auto') ? 'Anúncio Meta'
          : data.activated_by === 'broadcast' ? 'Lista de Transmissão'
          : (data.activated_by === 'campaign_instance_auto' || data.activated_by === 'instance_default') ? 'Instância'
          : data.activated_by === 'manual' ? 'Manual'
          : data.activated_by || 'Automático';
        setAgentInfo({
          name: (agent as any)?.name || 'Agente',
          activated_by: activatedByLabel,
          is_active: data.is_active,
        });
      }
    };
    const fetchCallRecords = async () => {
      const last8 = normalizedPhone.slice(-8);
      const { data } = await supabase
        .from('call_records')
        .select('id, call_type, call_result, duration_seconds, notes, ai_summary, created_at, contact_name, phone_used, contact_phone')
        .or(`contact_phone.ilike.%${last8}%,phone_used.ilike.%${last8}%`)
        .order('created_at', { ascending: true });
      setCallRecords((data || []) as CallRecord[]);
    };
    fetchMessages();
    fetchAgent();
    fetchCallRecords();

    // Fetch linked lead & contact
    const fetchLinkedData = async () => {
      const last8 = normalizedPhone.slice(-8);
      const { data: leadData } = await supabase
        .from('leads')
        .select('*')
        .or(`lead_phone.eq.${normalizedPhone},lead_phone.ilike.%${last8}%`)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (leadData) setLinkedLead(leadData as any);

      const { data: contactData } = await supabase
        .from('contacts')
        .select('*')
        .or(`phone.eq.${phone},phone.eq.${normalizedPhone},phone.ilike.%${last8}%`)
        .limit(1)
        .maybeSingle();
      if (contactData) setLinkedContact(contactData as any);
    };
    fetchLinkedData();

    // Fetch private/mute status
    const fetchConversationStatus = async () => {
      const { data } = await supabase
        .from('whatsapp_conversations' as any)
        .select('is_private, is_muted')
        .eq('phone', normalizedPhone)
        .maybeSingle();
      if (data) {
        setIsPrivate(!!(data as any).is_private);
        setIsMuted(!!(data as any).is_muted);
      } else {
        setIsPrivate(false);
        setIsMuted(false);
      }
    };
    fetchConversationStatus();

  }, [open, phone]);

  // Realtime
  useEffect(() => {
    if (!open || !phone) return;
    const channel = supabase
      .channel(`dashboard-chat-${phone}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'whatsapp_messages',
        filter: `phone=eq.${phone}`,
      }, (payload) => {
        const msg = payload.new as any;
        setMessages(prev => [...prev, msg]);
        setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [open, phone]);

  const formatDateSeparator = (dateStr: string) => {
    const date = parseISO(dateStr);
    if (isToday(date)) return 'Hoje';
    if (isYesterday(date)) return 'Ontem';
    return format(date, "dd 'de' MMMM", { locale: ptBR });
  };

  const handleToggleIdentifySender = (checked: boolean) => {
    setIdentifySender(checked);
    if (phone) localStorage.setItem(`wa-identify-sender:${phone}`, checked ? 'true' : 'false');
  };

  const handleTreatmentChange = (value: string) => {
    const v = value === 'none' ? '' : value;
    setTreatmentTitle(v);
    if (phone) localStorage.setItem(`wa-treatment:${phone}`, v);
  };

  const handleNameFormatChange = (value: string) => {
    setNameFormat(value);
    if (phone) localStorage.setItem(`wa-name-format:${phone}`, value);
  };

  const handleAddNickname = () => {
    const trimmed = newNickname.trim();
    if (!trimmed || nicknames.includes(trimmed)) return;
    const updated = [...nicknames, trimmed];
    setNicknames(updated);
    localStorage.setItem('wa-nicknames', JSON.stringify(updated));
    setSelectedNickname(trimmed);
    if (phone) localStorage.setItem(`wa-selected-nickname:${phone}`, trimmed);
    setNewNickname('');
  };

  const handleRemoveNickname = (nick: string) => {
    const updated = nicknames.filter(n => n !== nick);
    setNicknames(updated);
    localStorage.setItem('wa-nicknames', JSON.stringify(updated));
    if (selectedNickname === nick) {
      setSelectedNickname(updated[0] || '');
      if (phone) localStorage.setItem(`wa-selected-nickname:${phone}`, updated[0] || '');
    }
  };

  const handleSelectNickname = (value: string) => {
    setSelectedNickname(value);
    if (phone) localStorage.setItem(`wa-selected-nickname:${phone}`, value);
  };

  const buildFinalMessage = async (message: string): Promise<string> => {
    if (!user || !identifySender) return message;

    if (nameFormat === 'nickname' && selectedNickname) {
      return `*${selectedNickname}:*\n${message}`;
    }

    const { data: prof } = await supabase
      .from('profiles')
      .select('full_name, treatment_title')
      .eq('user_id', user.id)
      .single();

    if (!prof?.full_name) return message;

    let displayName = prof.full_name;
    if (nameFormat === 'first') {
      displayName = prof.full_name.split(' ')[0];
    } else if (nameFormat === 'first_last') {
      const parts = prof.full_name.split(' ');
      displayName = parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1]}` : parts[0];
    }
    const title = treatmentTitle || '';
    const senderName = title ? `${title} ${displayName}` : displayName;
    return `*${senderName}:*\n${message}`;
  };

  const resolveInstanceId = async (): Promise<string | undefined> => {
    const msgInstanceName = instanceName || messages.find(m => m.instance_name)?.instance_name;
    if (msgInstanceName) {
      const { data: inst } = await supabase
        .from('whatsapp_instances')
        .select('id')
        .eq('instance_name', msgInstanceName)
        .eq('is_active', true)
        .maybeSingle();
      if (inst) return inst.id;
    }
    const { data: firstInst } = await supabase
      .from('whatsapp_instances')
      .select('id')
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();
    return firstInst?.id;
  };

  const handleSend = async () => {
    if (!newMessage.trim() || !phone || sending) return;
    setSending(true);
    try {
      const instanceId = await resolveInstanceId();
      const finalMessage = await buildFinalMessage(newMessage.trim());
      const msgInstanceName = instanceName || messages.find(m => m.instance_name)?.instance_name;

      const { data, error } = await cloudFunctions.invoke('send-whatsapp', {
        body: { phone, message: finalMessage, instance_id: instanceId },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Erro ao enviar');

      setMessages(prev => [...prev, {
        id: data.message_id || crypto.randomUUID(),
        message_text: finalMessage,
        direction: 'outbound',
        created_at: new Date().toISOString(),
        message_type: 'text',
        media_url: null,
        media_type: null,
        instance_name: msgInstanceName || null,
      }]);
      setNewMessage('');
      toast.success('Mensagem enviada!');
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    } catch (e: any) {
      console.error('Error sending:', e);
      toast.error('Erro ao enviar mensagem');
    } finally {
      setSending(false);
    }
  };

  const handleMediaUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !phone) return;
    setUploadingMedia(true);
    setShowAttachMenu(false);
    try {
      const ext = file.name.split('.').pop() || 'bin';
      const path = `whatsapp-media/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
      const { error: uploadError } = await supabase.storage.from('whatsapp-media').upload(path, file);
      if (uploadError) throw uploadError;
      const { data: urlData } = supabase.storage.from('whatsapp-media').getPublicUrl(path);
      const mediaUrl = urlData.publicUrl;

      const instanceId = await resolveInstanceId();
      const msgInstanceName = instanceName || messages.find(m => m.instance_name)?.instance_name;

      const { data, error } = await cloudFunctions.invoke('send-whatsapp', {
        body: {
          action: 'send_media',
          phone,
          media_url: mediaUrl,
          media_type: file.type,
          file_name: file.name,
          instance_id: instanceId,
        },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Erro ao enviar mídia');

      const msgType = file.type.startsWith('audio') ? 'audio' : file.type.startsWith('image') ? 'image' : file.type.startsWith('video') ? 'video' : 'document';
      setMessages(prev => [...prev, {
        id: data.message_id || crypto.randomUUID(),
        message_text: null,
        direction: 'outbound',
        created_at: new Date().toISOString(),
        message_type: msgType,
        media_url: mediaUrl,
        media_type: file.type,
        instance_name: msgInstanceName || null,
      }]);
      toast.success('Mídia enviada!');
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    } catch (e: any) {
      console.error('Error uploading media:', e);
      toast.error('Erro ao enviar mídia');
    } finally {
      setUploadingMedia(false);
      if (e.target) e.target.value = '';
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleAction = (action: string) => {
    if (action === 'create_lead') {
      handleCreateLeadAndContact();
      return;
    }
    if (phone && onOpenChat) {
      onOpenChange(false);
      onOpenChat(phone);
    }
  };

  const handleCreateLeadAndContact = async () => {
    if (!phone || creatingLead) return;
    setCreatingLead(true);
    try {
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      const recentMessages = messages.slice(-50).map(m => ({
        direction: m.direction,
        message_text: m.message_text,
      }));

      let leadExtracted: Record<string, any> = {};
      let contactExtracted: Record<string, any> = {};

      if (recentMessages.length > 0) {
        const [leadRes, contactRes] = await Promise.all([
          cloudFunctions.invoke('extract-conversation-data', {
            body: { messages: recentMessages, targetType: 'lead' },
          }),
          cloudFunctions.invoke('extract-conversation-data', {
            body: { messages: recentMessages, targetType: 'contact' },
          }),
        ]);
        leadExtracted = leadRes.data?.data || {};
        contactExtracted = contactRes.data?.data || {};
      }

      let boardId = campaignBoardId || null;
      if (!boardId) {
        const boardQuery = supabase
          .from('kanban_boards' as any)
          .select('id')
          .neq('board_type', 'workflow')
          .eq('is_active', true)
          .order('display_order')
          .limit(1);
        const { data: availableBoards } = await boardQuery;
        boardId = (availableBoards as any)?.[0]?.id;
      }
      if (!boardId) {
        toast.error('Nenhum funil disponível para criar o lead');
        return;
      }

      const insertData: Record<string, any> = {
        lead_name: leadExtracted.lead_name || contactExtracted.full_name || contactName || 'Novo Lead - WhatsApp',
        lead_phone: phone,
        lead_email: leadExtracted.lead_email || contactExtracted.email || null,
        source: 'whatsapp',
        created_by: currentUser?.id || null,
        board_id: boardId,
        city: leadExtracted.city || contactExtracted.city || null,
        state: leadExtracted.state || contactExtracted.state || null,
        neighborhood: leadExtracted.neighborhood || contactExtracted.neighborhood || null,
        action_source: 'system',
      };
      if (campaignStageId) insertData.status = campaignStageId;

      const leadFields = [
        'victim_name', 'main_company', 'contractor_company', 'accident_address', 'accident_date',
        'damage_description', 'case_number', 'case_type', 'notes', 'sector',
        'visit_city', 'visit_state', 'visit_address', 'liability_type', 'news_link',
      ];
      for (const field of leadFields) {
        if (leadExtracted[field]) insertData[field] = leadExtracted[field];
      }

      const { data: newLead, error: leadError } = await supabase
        .from('leads')
        .insert(insertData)
        .select('*')
        .single();
      if (leadError) throw leadError;

      const normalizedPhone = phone.replace(/\D/g, '');
      await supabase
        .from('whatsapp_messages')
        .update({ lead_id: newLead.id })
        .or(`phone.eq.${phone},phone.eq.${normalizedPhone}`)
        .is('lead_id', null);

      const contactFullName = contactExtracted.full_name || contactName || 'Contato WhatsApp';
      const { data: existingContact } = await supabase
        .from('contacts')
        .select('id, full_name')
        .or(`phone.eq.${phone},phone.eq.${normalizedPhone},phone.ilike.%${normalizedPhone.slice(-8)}%`)
        .limit(1)
        .maybeSingle();

      let contactId: string;
      if (existingContact) {
        contactId = existingContact.id;
        const contactUpdates: Record<string, any> = {};
        if (contactExtracted.full_name && existingContact.full_name?.match(/^\d/)) contactUpdates.full_name = contactExtracted.full_name;
        if (contactExtracted.email) contactUpdates.email = contactExtracted.email;
        if (contactExtracted.city) contactUpdates.city = contactExtracted.city;
        if (contactExtracted.state) contactUpdates.state = contactExtracted.state;
        if (contactExtracted.cpf) contactUpdates.cpf = contactExtracted.cpf;
        if (contactExtracted.birth_date) contactUpdates.birth_date = contactExtracted.birth_date;
        if (Object.keys(contactUpdates).length > 0) {
          await supabase.from('contacts').update(contactUpdates).eq('id', contactId);
        }
      } else {
        const contactInsert: Record<string, any> = {
          full_name: contactFullName,
          phone: phone,
          created_by: currentUser?.id || null,
        };
        if (contactExtracted.email) contactInsert.email = contactExtracted.email;
        if (contactExtracted.city) contactInsert.city = contactExtracted.city;
        if (contactExtracted.state) contactInsert.state = contactExtracted.state;
        if (contactExtracted.cpf) contactInsert.cpf = contactExtracted.cpf;
        if (contactExtracted.birth_date) contactInsert.birth_date = contactExtracted.birth_date;
        if (contactExtracted.neighborhood) contactInsert.neighborhood = contactExtracted.neighborhood;
        if (contactExtracted.instagram_url) contactInsert.instagram_url = contactExtracted.instagram_url;

        const { data: newContact, error: contactError } = await supabase
          .from('contacts')
          .insert([contactInsert] as any)
          .select('id')
          .single();
        if (contactError) throw contactError;
        contactId = newContact.id;
      }

      await supabase.from('contact_leads').insert({
        contact_id: contactId,
        lead_id: newLead.id,
        relationship_to_victim: 'Vítima',
      });

      await supabase
        .from('whatsapp_messages')
        .update({ contact_id: contactId })
        .or(`phone.eq.${phone},phone.eq.${normalizedPhone}`)
        .is('contact_id', null);

      toast.success('Lead e contato criados com dados da conversa!');
    } catch (e: any) {
      console.error('Error creating lead+contact:', e);
      toast.error('Erro ao criar lead: ' + (e.message || ''));
    } finally {
      setCreatingLead(false);
    }
  };

  const handleCreateGroup = async () => {
    if (!phone || creatingGroup) return;
    setCreatingGroup(true);
    try {
      const normalizedPhone = phone.replace(/\D/g, '');
      let leadName = contactName || normalizedPhone;
      let boardId: string | undefined;

      const { data: lead } = await supabase
        .from('leads')
        .select('id, lead_name, board_id')
        .or(`lead_phone.eq.${normalizedPhone},lead_phone.ilike.%${normalizedPhone.slice(-8)}%`)
        .limit(1)
        .maybeSingle();

      if (lead) {
        leadName = lead.lead_name || leadName;
        boardId = lead.board_id || undefined;
      }

      let instanceId: string | undefined;
      const msgInstanceName = instanceName || messages.find(m => m.instance_name)?.instance_name;
      if (msgInstanceName) {
        const { data: inst } = await supabase
          .from('whatsapp_instances')
          .select('id')
          .eq('instance_name', msgInstanceName)
          .eq('is_active', true)
          .maybeSingle();
        if (inst) instanceId = inst.id;
      }

      const { data, error } = await cloudFunctions.invoke('create-whatsapp-group', {
        body: {
          phone: normalizedPhone,
          lead_name: leadName,
          board_id: boardId,
          contact_phone: normalizedPhone,
          creator_instance_id: instanceId,
        },
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Erro ao criar grupo');

      if (lead?.id && data.group_id) {
        await supabase
          .from('leads')
          .update({ whatsapp_group_id: data.group_id } as any)
          .eq('id', lead.id);
      }

      if (data.group_id) {
        const { data: contact } = await supabase
          .from('contacts')
          .select('id')
          .eq('phone', normalizedPhone)
          .maybeSingle();
        if (contact) {
          await supabase
            .from('contacts')
            .update({ whatsapp_group_id: data.group_id } as any)
            .eq('id', contact.id);
        }
      }

      toast.success(`Grupo "${leadName}" criado com ${data.participants_count} participantes!`);
    } catch (e: any) {
      console.error('Error creating group:', e);
      toast.error(e.message || 'Erro ao criar grupo');
    } finally {
      setCreatingGroup(false);
    }
  };

  const handleSuggestNextStep = async () => {
    if (!phone || loadingSuggestion) return;
    setLoadingSuggestion(true);
    setAiSuggestion(null);
    try {
      const { data, error } = await cloudFunctions.invoke('suggest-next-step', {
        body: { phone },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setAiSuggestion(data.suggestion);
    } catch (e: any) {
      console.error('Error suggesting:', e);
      toast.error('Erro ao gerar sugestão');
    } finally {
      setLoadingSuggestion(false);
    }
  };

  const handleToggleAgent = async () => {
    if (!phone || !agentInfo) return;
    const normalizedPhone = phone.replace(/\D/g, '');
    const newActive = !agentInfo.is_active;
    try {
      await supabase
        .from('whatsapp_conversation_agents')
        .update({ is_active: newActive, human_paused_until: newActive ? null : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString() } as any)
        .or(`phone.eq.${normalizedPhone},phone.ilike.%${normalizedPhone.slice(-8)}%`);
      setAgentInfo({ ...agentInfo, is_active: newActive });
      onConversationUpdated?.();
      toast.success(newActive ? 'Agente ativado!' : 'Agente desativado!');
    } catch (e) {
      toast.error('Erro ao alterar agente');
    }
  };

  const handleTogglePrivate = async () => {
    if (!phone) return;
    setTogglingPrivate(true);
    const normalizedPhone = phone.replace(/\D/g, '');
    const newVal = !isPrivate;
    try {
      const { data: existing } = await supabase
        .from('whatsapp_conversations' as any)
        .select('id')
        .eq('phone', normalizedPhone)
        .maybeSingle();
      if (existing) {
        await supabase.from('whatsapp_conversations' as any).update({ is_private: newVal } as any).eq('id', (existing as any).id);
      } else {
        await supabase.from('whatsapp_conversations' as any).insert({ phone: normalizedPhone, is_private: newVal } as any);
      }
      setIsPrivate(newVal);
      toast.success(newVal ? 'Conversa trancada!' : 'Conversa desbloqueada!');
    } catch {
      toast.error('Erro ao alterar privacidade');
    } finally {
      setTogglingPrivate(false);
    }
  };

  const handleToggleMute = async (mode: string | null) => {
    if (!phone) return;
    setMuteLoading(true);
    const normalizedPhone = phone.replace(/\D/g, '');
    const newMuted = mode !== null;
    try {
      const { data: existing } = await supabase
        .from('whatsapp_conversations' as any)
        .select('id')
        .eq('phone', normalizedPhone)
        .maybeSingle();
      if (existing) {
        await supabase.from('whatsapp_conversations' as any).update({ is_muted: newMuted, mute_mode: mode } as any).eq('id', (existing as any).id);
      } else {
        await supabase.from('whatsapp_conversations' as any).insert({ phone: normalizedPhone, is_muted: newMuted, mute_mode: mode } as any);
      }
      setIsMuted(newMuted);
      toast.success(newMuted ? 'Conversa silenciada!' : 'Conversa reativada!');
    } catch {
      toast.error('Erro ao silenciar');
    } finally {
      setMuteLoading(false);
    }
  };

  const handleClearConversation = async () => {
    if (!phone) return;
    if (!confirm('Tem certeza que deseja limpar todos os dados desta conversa? Esta ação não pode ser desfeita.')) return;
    const normalizedPhone = phone.replace(/\D/g, '');
    try {
      await supabase.from('whatsapp_messages').delete().eq('phone', normalizedPhone);
      await supabase.from('whatsapp_conversation_agents').delete()
        .or(`phone.eq.${normalizedPhone},phone.ilike.%${normalizedPhone.slice(-8)}%`);
      setMessages([]);
      setAgentInfo(null);
      toast.success('Conversa limpa!');
      onOpenChange(false);
    } catch {
      toast.error('Erro ao limpar conversa');
    }
  };

  // Merge messages and call records into unified timeline
  const timelineItems = useMemo(() => {
    const items: Array<{ type: 'message'; data: Message } | { type: 'call'; data: CallRecord }> = [];
    messages.forEach(m => items.push({ type: 'message', data: m }));
    callRecords.forEach(c => items.push({ type: 'call', data: c }));
    items.sort((a, b) => new Date(a.data.created_at).getTime() - new Date(b.data.created_at).getTime());
    return items;
  }, [messages, callRecords]);

  const callResultLabel = (result: string) => {
    switch (result) {
      case 'answered': return 'Atendida';
      case 'no_answer': return 'Não atendida';
      case 'busy': return 'Ocupado';
      case 'voicemail': return 'Caixa postal';
      case 'failed': return 'Falhou';
      default: return result || 'Ligação';
    }
  };

  const callResultIcon = (result: string) => {
    switch (result) {
      case 'answered': return <PhoneIncoming className="h-3.5 w-3.5 text-emerald-600" />;
      case 'no_answer': return <PhoneMissed className="h-3.5 w-3.5 text-red-500" />;
      case 'busy': return <PhoneMissed className="h-3.5 w-3.5 text-amber-500" />;
      default: return <PhoneIcon className="h-3.5 w-3.5 text-muted-foreground" />;
    }
  };

  const renderMediaContent = (msg: Message) => {
    if (!msg.media_url) return null;
    const type = msg.media_type || msg.message_type;
    if (type?.startsWith('image') || msg.message_type === 'image') {
      return (
        <a href={msg.media_url} target="_blank" rel="noopener noreferrer">
          <img src={msg.media_url} alt="Imagem" className="max-w-[200px] max-h-[200px] rounded-md object-cover" loading="lazy" />
        </a>
      );
    }
    if (type?.startsWith('video') || msg.message_type === 'video') {
      return <video src={msg.media_url} controls className="max-w-[200px] max-h-[200px] rounded-md" />;
    }
    if (type?.startsWith('audio') || msg.message_type === 'audio') {
      return <audio src={msg.media_url} controls className="max-w-[220px]" />;
    }
    // Document
    const fileName = msg.media_url.split('/').pop() || 'Documento';
    return (
      <a href={msg.media_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-[11px] underline">
        📄 {fileName.length > 30 ? fileName.slice(0, 30) + '...' : fileName}
      </a>
    );
  };

  let lastDateLabel = '';

  return (
    <>
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[92vh] flex flex-col">
        <DrawerHeader className="pb-2 shrink-0">
          <div className="flex items-center justify-between">
            <div className="min-w-0 flex-1">
              <DrawerTitle className="text-base truncate flex items-center gap-2">
                <User className="h-4 w-4 text-muted-foreground shrink-0" />
                {contactName || phone}
              </DrawerTitle>
              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                {phone && contactName && <span className="text-xs text-muted-foreground">{phone}</span>}
                {instanceName && <span className="text-[10px] text-muted-foreground">• {instanceName}</span>}
              </div>
              <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                {hasLead && (
                  <Badge
                    variant="default"
                    className="text-[10px] px-1.5 py-0 h-4 cursor-pointer hover:opacity-80"
                    onClick={() => { if (linkedLead) setShowLeadEdit(true); }}
                    title={linkedLead ? `Abrir lead: ${linkedLead.lead_name}` : 'Lead'}
                  >
                    Lead {linkedLead?.lead_name ? `• ${linkedLead.lead_name.slice(0, 20)}` : ''}
                  </Badge>
                )}
                {hasContact && (
                  <Badge
                    variant="secondary"
                    className="text-[10px] px-1.5 py-0 h-4 cursor-pointer hover:opacity-80"
                    onClick={() => { if (linkedContact) setShowContactEdit(true); }}
                    title={linkedContact ? `Abrir contato: ${linkedContact.full_name}` : 'Contato'}
                  >
                    Contato {linkedContact?.full_name ? `• ${linkedContact.full_name.slice(0, 20)}` : ''}
                  </Badge>
                )}
                {!hasLead && !hasContact && <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 text-muted-foreground">Sem vínculo</Badge>}
                {wasResponded ? (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-400 dark:border-emerald-800">
                    ✓ Respondido {responseTimeMinutes != null && responseTimeMinutes < 60 ? `em ${responseTimeMinutes}min` : responseTimeMinutes != null ? `em ${Math.floor(responseTimeMinutes / 60)}h` : ''}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-400 dark:border-amber-800">
                    ⏳ Aguardando
                  </Badge>
                )}
              </div>
              {agentInfo && (
                <div className="flex items-center gap-1.5 mt-1.5">
                  <Badge
                    variant={agentInfo.is_active ? "default" : "secondary"}
                    className="text-[10px] px-1.5 py-0 h-4 gap-1 cursor-pointer select-none"
                    onClick={handleToggleAgent}
                    title={agentInfo.is_active ? 'Clique para desativar o agente' : 'Clique para ativar o agente'}
                  >
                    <Bot className="h-3 w-3" />
                    {agentInfo.name}
                    {!agentInfo.is_active && ' (desativado)'}
                  </Badge>
                  {agentInfo.activated_by && (
                    <span className="text-[9px] text-muted-foreground">via {agentInfo.activated_by}</span>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center gap-1 shrink-0 ml-2">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={handleSuggestNextStep}
                disabled={loadingSuggestion}
                title="Sugerir próximo passo com IA"
              >
                {loadingSuggestion ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4 text-amber-500" />}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" className="h-8 w-8">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem onClick={() => handleAction('link')}>
                    <Link2 className="h-4 w-4 mr-2" /> Vincular Lead
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleAction('create_lead')}>
                    <Plus className="h-4 w-4 mr-2" /> {creatingLead ? 'Criando...' : 'Criar Lead + Contato'}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleAction('create_contact')}>
                    <UserPlus className="h-4 w-4 mr-2" /> Criar Contato
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleAction('create_case')}>
                    <Scale className="h-4 w-4 mr-2" /> Criar Caso Jurídico
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleTogglePrivate} disabled={togglingPrivate}>
                    {isPrivate ? <LockOpen className="h-4 w-4 mr-2" /> : <Lock className="h-4 w-4 mr-2" />}
                    {isPrivate ? 'Tornar pública' : 'Trancar conversa'}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setShowZapSign(true)}>
                    <FileSignature className="h-4 w-4 mr-2" /> Gerar Documento para Assinatura
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleCreateGroup} disabled={creatingGroup}>
                    {creatingGroup ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Users className="h-4 w-4 mr-2" />}
                    Criar Grupo WhatsApp
                  </DropdownMenuItem>
                  {agentInfo && (
                    <>
                      <DropdownMenuSeparator />
                      {agentInfo && agentInfo.is_active ? (
                        <DropdownMenuItem onClick={handleToggleAgent}>
                          <BotOff className="h-4 w-4 mr-2" /> Desativar Agente ({agentInfo.name})
                        </DropdownMenuItem>
                      ) : agentInfo && !agentInfo.is_active ? (
                        <DropdownMenuItem onClick={handleToggleAgent}>
                          <Bot className="h-4 w-4 mr-2" /> Reativar Agente ({agentInfo.name})
                        </DropdownMenuItem>
                      ) : null}
                    </>
                  )}
                  <DropdownMenuSeparator />
                  {isMuted ? (
                    <DropdownMenuItem onClick={() => handleToggleMute(null)} disabled={muteLoading}>
                      <Volume2 className="h-4 w-4 mr-2" /> Reativar Conversa
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>
                        <VolumeX className="h-4 w-4 mr-2" /> Silenciar Conversa
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent>
                        <DropdownMenuItem onClick={() => handleToggleMute('all')}>
                          <BellOff className="h-3.5 w-3.5 mr-2" /> Silenciar tudo
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleToggleMute('receive')}>
                          <VolumeX className="h-3.5 w-3.5 mr-2" /> Desativar recebimento
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleToggleMute('send')}>
                          <VolumeX className="h-3.5 w-3.5 mr-2" /> Desativar envio
                        </DropdownMenuItem>
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  )}
                  <DropdownMenuItem onClick={handleClearConversation} className="text-destructive focus:text-destructive">
                    <Trash2 className="h-4 w-4 mr-2" /> Limpar Conversa
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </DrawerHeader>

        {/* AI Suggestion Banner */}
        {aiSuggestion && (
          <div className="mx-4 mb-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 relative">
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-1 right-1 h-5 w-5"
              onClick={() => setAiSuggestion(null)}
            >
              <X className="h-3 w-3" />
            </Button>
            <div className="flex items-start gap-2 pr-5">
              <Sparkles className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-[10px] font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wide mb-0.5">Próximo passo sugerido</p>
                <p className="text-xs text-amber-900 dark:text-amber-200">{aiSuggestion}</p>
              </div>
            </div>
          </div>
        )}

        {/* Messages & Call Records Timeline */}
        <div className="flex-1 min-h-0 px-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : timelineItems.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">Nenhuma mensagem encontrada</p>
          ) : (
            <ScrollArea className="h-[50vh]">
              <div className="space-y-1 pr-3">
                {timelineItems.map((item) => {
                  const dateLabel = formatDateSeparator(item.data.created_at);
                  const showDateSep = dateLabel !== lastDateLabel;
                  if (showDateSep) lastDateLabel = dateLabel;

                  if (item.type === 'call') {
                    const call = item.data as CallRecord;
                    const duration = call.duration_seconds ? `${Math.floor(call.duration_seconds / 60)}:${String(call.duration_seconds % 60).padStart(2, '0')}` : null;
                    return (
                      <div key={`call-${call.id}`}>
                        {showDateSep && (
                          <div className="flex justify-center my-2">
                            <span className="text-[10px] bg-muted px-2 py-0.5 rounded-full text-muted-foreground">{dateLabel}</span>
                          </div>
                        )}
                        <div className="flex justify-center my-2">
                          <div className="flex items-center gap-2 bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800 rounded-lg px-3 py-2 max-w-[85%]">
                            {callResultIcon(call.call_result)}
                            <div className="text-[11px]">
                              <span className="font-medium text-blue-700 dark:text-blue-300">
                                📞 {call.call_type === 'inbound' ? 'Ligação recebida' : 'Ligação realizada'}
                              </span>
                              <span className="text-blue-600 dark:text-blue-400 ml-1">
                                — {callResultLabel(call.call_result)}
                              </span>
                              {duration && <span className="text-muted-foreground ml-1">({duration})</span>}
                              {call.ai_summary && (
                                <p className="text-[10px] text-muted-foreground mt-0.5 whitespace-pre-wrap">{call.ai_summary}</p>
                              )}
                              {call.notes && !call.ai_summary && (
                                <p className="text-[10px] text-muted-foreground mt-0.5">{call.notes}</p>
                              )}
                            </div>
                            <span className="text-[9px] text-muted-foreground ml-auto shrink-0">
                              {format(parseISO(call.created_at), 'HH:mm')}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  }

                  const msg = item.data as Message;
                  const isInbound = msg.direction === 'inbound';
                  return (
                    <div key={msg.id}>
                      {showDateSep && (
                        <div className="flex justify-center my-2">
                          <span className="text-[10px] bg-muted px-2 py-0.5 rounded-full text-muted-foreground">{dateLabel}</span>
                        </div>
                      )}
                      <div className={cn("flex", isInbound ? "justify-start" : "justify-end")}>
                        <div
                          className={cn(
                            "max-w-[80%] rounded-lg px-3 py-1.5 text-xs cursor-pointer select-text active:opacity-70 transition-opacity",
                            isInbound
                              ? "bg-muted text-foreground rounded-tl-none"
                              : "bg-primary text-primary-foreground rounded-tr-none"
                          )}
                          onClick={() => {
                            if (msg.message_text) {
                              navigator.clipboard.writeText(msg.message_text);
                              toast.success('Mensagem copiada!');
                            }
                          }}
                          onContextMenu={(e) => {
                            if (msg.message_text) {
                              e.preventDefault();
                              navigator.clipboard.writeText(msg.message_text);
                              toast.success('Mensagem copiada!');
                            }
                          }}
                          title="Toque para copiar"
                        >
                          {renderMediaContent(msg)}
                          {!msg.media_url && msg.media_type && !msg.message_text && (
                            <span className="italic text-[10px] opacity-70">
                              {msg.media_type === 'image' ? '📷 Imagem' : msg.media_type === 'audio' ? '🎵 Áudio' : msg.media_type === 'video' ? '🎬 Vídeo' : msg.media_type === 'document' ? '📄 Documento' : '📎 Mídia'}
                            </span>
                          )}
                          {msg.message_text && <p className="whitespace-pre-wrap break-words">{msg.message_text}</p>}
                          <p className={cn("text-[9px] mt-0.5", isInbound ? "text-muted-foreground" : "text-primary-foreground/70")}>
                            {format(parseISO(msg.created_at), 'HH:mm')}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={bottomRef} />
              </div>
            </ScrollArea>
          )}
        </div>

        {/* Identity controls + Message input */}
        <div className="px-4 pb-4 pt-2 shrink-0 border-t space-y-2">
          {/* Identity row */}
          <div className="flex items-center justify-end gap-2 flex-wrap">
            {identifySender && (
              <>
                <Select value={nameFormat} onValueChange={handleNameFormatChange}>
                  <SelectTrigger className="h-7 w-[130px] text-xs">
                    <SelectValue placeholder="Nome" />
                  </SelectTrigger>
                  <SelectContent>
                    {NAME_FORMAT_OPTIONS.map(o => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {nameFormat === 'nickname' ? (
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className="h-7 text-xs gap-1 max-w-[150px]">
                        <User className="h-3 w-3 shrink-0" />
                        <span className="truncate">{selectedNickname || 'Escolher apelido'}</span>
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-64 p-3 space-y-3" align="end">
                      <p className="text-xs font-medium">Apelidos cadastrados</p>
                      {nicknames.length > 0 ? (
                        <div className="space-y-1 max-h-[120px] overflow-y-auto">
                          {nicknames.map(nick => (
                            <div key={nick} className="flex items-center justify-between gap-1">
                              <Button
                                variant={selectedNickname === nick ? "default" : "ghost"}
                                size="sm"
                                className="flex-1 justify-start h-7 text-xs"
                                onClick={() => handleSelectNickname(nick)}
                              >
                                {nick}
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
                                onClick={() => handleRemoveNickname(nick)}
                              >
                                <X className="h-3 w-3" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">Nenhum apelido cadastrado</p>
                      )}
                      <div className="flex gap-1">
                        <Input
                          placeholder="Novo apelido..."
                          value={newNickname}
                          onChange={e => setNewNickname(e.target.value)}
                          className="h-7 text-xs"
                          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddNickname(); } }}
                        />
                        <Button size="sm" className="h-7 text-xs px-2" onClick={handleAddNickname} disabled={!newNickname.trim()}>
                          <Plus className="h-3 w-3" />
                        </Button>
                      </div>
                    </PopoverContent>
                  </Popover>
                ) : (
                  <Select value={treatmentTitle || 'none'} onValueChange={handleTreatmentChange}>
                    <SelectTrigger className="h-7 w-[100px] text-xs">
                      <SelectValue placeholder="Título" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Sem título</SelectItem>
                      {TREATMENT_OPTIONS.filter(t => t).map(t => (
                        <SelectItem key={t} value={t}>{t}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </>
            )}
            <Label htmlFor="dash-identify-sender" className="text-xs text-muted-foreground cursor-pointer">
              Identificar remetente
            </Label>
            <Switch
              id="dash-identify-sender"
              checked={identifySender}
              onCheckedChange={handleToggleIdentifySender}
            />
          </div>

          {/* Input row */}
          <div className="flex items-end gap-1">
            <DropdownMenu open={showAttachMenu} onOpenChange={setShowAttachMenu}>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-10 w-10 shrink-0 text-muted-foreground">
                  {uploadingMedia ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-48">
                <DropdownMenuItem onClick={() => { mediaInputRef.current?.click(); setShowAttachMenu(false); }} className="gap-2">
                  <Image className="h-4 w-4" /> Foto / Vídeo
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => {
                  const input = document.createElement('input');
                  input.type = 'file';
                  input.accept = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip';
                  input.onchange = (e: any) => handleMediaUpload(e);
                  input.click();
                  setShowAttachMenu(false);
                }} className="gap-2">
                  <FileUp className="h-4 w-4" /> Documento
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <input ref={mediaInputRef} type="file" accept="image/*,video/*" className="hidden" onChange={handleMediaUpload} />
            <Textarea
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Digite uma mensagem..."
              className="min-h-[40px] max-h-[100px] resize-none text-sm flex-1"
              rows={1}
            />
            <Button
              size="icon"
              className="shrink-0 h-10 w-10 bg-green-600 hover:bg-green-700"
              onClick={handleSend}
              disabled={!newMessage.trim() || sending}
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </DrawerContent>
    </Drawer>

    {/* Lead Edit Dialog */}
    <LeadEditDialog
      open={showLeadEdit}
      onOpenChange={(open) => {
        setShowLeadEdit(open);
        if (!open && phone) {
          // Refresh lead data
          const normalizedPhone = phone.replace(/\D/g, '');
          const last8 = normalizedPhone.slice(-8);
          supabase.from('leads').select('*')
            .or(`lead_phone.eq.${normalizedPhone},lead_phone.ilike.%${last8}%`)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()
            .then(({ data }) => { if (data) setLinkedLead(data as any); });
        }
      }}
      lead={linkedLead}
      onSave={async (leadId, updates) => {
        const { error } = await supabase.from('leads').update(updates as any).eq('id', leadId);
        if (error) {
          console.error('[DashboardChatPreview] Lead save error:', JSON.stringify(error));
          throw error;
        }
        if (linkedLead) setLinkedLead({ ...linkedLead, ...updates } as Lead);
      }}
      mode="sheet"
    />

    {/* Contact Detail Sheet */}
    <ContactDetailSheet
      contact={linkedContact}
      open={showContactEdit}
      onOpenChange={(open) => {
        setShowContactEdit(open);
        if (!open && phone) {
          // Refresh contact data
          const normalizedPhone = phone.replace(/\D/g, '');
          const last8 = normalizedPhone.slice(-8);
          supabase.from('contacts').select('*')
            .or(`phone.eq.${phone},phone.eq.${normalizedPhone},phone.ilike.%${last8}%`)
            .limit(1)
            .maybeSingle()
            .then(({ data }) => { if (data) setLinkedContact(data as any); });
        }
      }}
      onContactUpdated={() => {
        if (phone) {
          const normalizedPhone = phone.replace(/\D/g, '');
          const last8 = normalizedPhone.slice(-8);
          supabase.from('contacts').select('*')
            .or(`phone.eq.${phone},phone.eq.${normalizedPhone},phone.ilike.%${last8}%`)
            .limit(1)
            .maybeSingle()
            .then(({ data }) => { if (data) setLinkedContact(data as any); });
        }
      }}
      mode="sheet"
    />

    {/* ZapSign Document Dialog */}
    {showZapSign && phone && (
      <ZapSignDocumentDialog
        open={showZapSign}
        onOpenChange={setShowZapSign}
        phone={phone}
        leadId={linkedLead?.id}
        contactId={linkedContact?.id}
        contactName={linkedContact?.full_name || contactName || undefined}
        instanceName={instanceName || messages.find(m => m.instance_name)?.instance_name || undefined}
      />
    )}
    </>
  );
}