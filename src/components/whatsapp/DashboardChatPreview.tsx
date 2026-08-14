import { useState, useEffect, useRef, useMemo, useCallback, lazy, Suspense } from 'react';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { WhatsAppConversationTeamChat } from './WhatsAppConversationTeamChat';
import { WhatsAppLeadProgressBar } from './WhatsAppLeadProgressBar';
import { ClientCommitmentsBar } from './ClientCommitmentsBar';
import { CommitmentItemCard, type CommitmentCardItem } from './ClientCommitmentsPanel';
import { CommitmentAssigneeDialog } from './CommitmentAssigneeDialog';
import { useClientCommitments } from '@/hooks/useClientCommitments';
import { buildReminderText } from '@/lib/clientCommitments';
import { useProfilesList } from '@/hooks/useProfilesList';
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
import { db } from '@/integrations/supabase';
import { externalSupabase } from '@/integrations/supabase/external-client';
import { format, parseISO, isToday, isYesterday } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Loader2, User, Send, MoreVertical, Link2, UserPlus, Plus, Scale, Sparkles, X, Users, Bot, BotOff, Paperclip, Image, FileUp, Lock, LockOpen, FileSignature, FileText, Volume2, VolumeX, BellOff, Bell, Trash2, FastForward, Mic, Copy, Download, ClipboardList, MessageSquare} from 'lucide-react';
import { Phone as PhoneIcon, PhoneIncoming, PhoneOutgoing, PhoneMissed } from 'lucide-react';
import { cn } from '@/lib/utils';
import { VOICE_AUDIO_CONSTRAINTS, VOICE_RECORDER_BITRATE } from '@/lib/voiceRecording';
import { mediaPreview, handleMediaThumbError } from '@/lib/whatsappMediaTransform';
import { toast } from 'sonner';
import { useAuthContext } from '@/contexts/AuthContext';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';
import { LeadEditDialog } from '@/components/kanban/LeadEditDialog';
import { ContactDetailSheet } from '@/components/contacts/ContactDetailSheet';
import { ZapSignDocumentDialog } from '@/components/whatsapp/ZapSignDocumentDialog';
import { GroupMembersDialog } from '@/components/whatsapp/GroupMembersDialog';
import { MediaLightbox } from '@/components/whatsapp/MediaLightbox';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { Lead } from '@/hooks/useLeads';
import { isWhatsAppGroupId } from '@/lib/whatsappPhone';
import type { Contact } from '@/hooks/useContacts';
import { remapToExternal, remapToCloudSync, ensureRemapCache } from '@/integrations/supabase/uuid-remap';
import { sanitizeLeadDateFields } from '@/utils/sanitizeLeadDateFields';
import { LazyVideo } from '@/components/whatsapp/LazyVideo';
import { AISuggestReply } from '@/components/ui/AISuggestReply';
import { AITextActions } from '@/components/ui/AITextActions';
import { WhatsAppMediaGallery } from '@/components/whatsapp/WhatsAppMediaGallery';
import { WhatsAppCallRecorder } from '@/components/whatsapp/WhatsAppCallRecorder';
import { WhatsAppActivitySheet } from '@/components/whatsapp/WhatsAppActivitySheet';
// Import dinâmico de propósito: a ficha da atividade importa este painel de
// volta (para abrir a conversa), e o lazy quebra o ciclo.
const ActivityFullSheet = lazy(() =>
  import('@/components/activities/ActivityFullSheet').then((m) => ({ default: m.ActivityFullSheet }))
);
import { bindDownload } from '@/lib/downloadFile';

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
  external_message_id?: string | null;
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
  /** Telefone do contato do lead — habilita alternar entre o grupo e o privado unificado (todas as instâncias). */
  privatePhone?: string | null;
  hasLead: boolean;
  hasContact: boolean;
  wasResponded: boolean;
  responseTimeMinutes: number | null;
  onConversationUpdated?: () => void;
  onOpenChat?: (phone: string) => void;
  campaignBoardId?: string | null;
  campaignStageId?: string | null;
  /** Mensagem a destacar ao abrir (ex.: a que gerou a atividade). */
  highlightMessageId?: string | null;
  /** Abre já com a lista de pendências expandida (entrada pela etiqueta de pendência). */
  initialCommitmentsOpen?: boolean;
  /** Lado por onde o drawer entra. `top` = de cima pra baixo (abertura via popup de notificação). */
  direction?: 'top' | 'bottom';
}

export function DashboardChatPreview({ open, onOpenChange, phone: phoneProp, contactName, instanceName, privatePhone, hasLead, hasContact, wasResponded, responseTimeMinutes, onConversationUpdated, onOpenChat, campaignBoardId, campaignStageId, highlightMessageId, initialCommitmentsOpen, direction = 'bottom' }: Props) {
  const { user, profile } = useAuthContext();
  // Visão alternável: conversa principal (grupo) vs privado unificado — todas as conversas
  // individuais da equipe com o contato, sem filtrar instância.
  const [viewMode, setViewMode] = useState<'main' | 'private'>('main');
  const canTogglePrivate = !!(privatePhone && phoneProp && privatePhone.replace(/\D/g, '') !== phoneProp.replace(/\D/g, ''));
  const isPrivateAllView = viewMode === 'private' && canTogglePrivate;
  const phone = (isPrivateAllView ? privatePhone : phoneProp) ?? null;
  /**
   * As mesmas peças da conversa completa. O painel de baixo virou o caminho
   * principal para tratar pendência (vem da caixa de pendências), então não
   * pode ser uma versão capada da conversa.
   */
  const [teamChatOpen, setTeamChatOpen] = useState(false);
  const [commitmentsOpen, setCommitmentsOpen] = useState(false);

  const [instanceOwners, setInstanceOwners] = useState<Record<string, string>>({});
  const [sendAsInstance, setSendAsInstance] = useState<string>('');
  // No privado unificado o envio precisa sair de uma instância explícita; fora dele, mantém o comportamento antigo.
  const preferredInstanceName = isPrivateAllView && sendAsInstance ? sendAsInstance : instanceName;

  useEffect(() => {
    setViewMode('main');
    setSendAsInstance('');
    // Quem entrou pela etiqueta de pendência já quer a lista aberta; quem
    // entrou pela conversa começa com ela recolhida, como sempre foi.
    setCommitmentsOpen(!!initialCommitmentsOpen);
  }, [open, phoneProp, initialCommitmentsOpen]);

  useEffect(() => {
    if (!open || !canTogglePrivate) return;
    supabase
      .from('whatsapp_instances')
      .select('instance_name, owner_name')
      .then(({ data }) => {
        const map: Record<string, string> = {};
        (data || []).forEach((i: any) => {
          if (i.instance_name) map[i.instance_name.toLowerCase()] = i.owner_name || i.instance_name;
        });
        setInstanceOwners(map);
      });
  }, [open, canTogglePrivate]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [newMessage, setNewMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<string | null>(null);
  const [loadingSuggestion, setLoadingSuggestion] = useState(false);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [creatingLead, setCreatingLead] = useState(false);
  const [agentInfo, setAgentInfo] = useState<{ name: string; activated_by: string | null; is_active: boolean; agent_id?: string; human_paused_until?: string | null } | null>(null);
  const [callRecords, setCallRecords] = useState<CallRecord[]>([]);
  const [availableAgents, setAvailableAgents] = useState<{ id: string; name: string }[]>([]);
  const [suggestingAgent, setSuggestingAgent] = useState(false);
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

  /** Pendências do cliente desta conversa — mesma fonte da conversa completa. */
  const commitments = useClientCommitments({
    leadId: linkedLead?.id || null,
    phone,
    instanceName,
    contactId: linkedContact?.id || null,
    clientName: contactName || linkedLead?.lead_name || null,
  });
  /** Pendência que está com o "quem cuida disto?" aberto. */
  const [trocandoDono, setTrocandoDono] = useState<CommitmentCardItem | null>(null);
  /**
   * Cobrança armada: o texto está no campo e o próximo envio sai citando a
   * mensagem da promessa, virando linha do histórico da pendência.
   */
  const [cobranca, setCobranca] = useState<{
    item: CommitmentCardItem;
    sourceMessageId: string | null;
    replyExternalId: string | null;
  } | null>(null);

  const armarCobranca = useCallback((item: CommitmentCardItem) => {
    const origem = item.source_message_id
      ? messages.find((m: any) => m.id === item.source_message_id)
      : null;
    const replyExternalId = (origem as any)?.external_message_id || null;
    setNewMessage(buildReminderText(item, contactName || linkedLead?.lead_name || ''));
    setCobranca({ item, sourceMessageId: item.source_message_id || null, replyExternalId });
    toast.success(
      replyExternalId
        ? 'Cobrança pronta — vai sair respondendo à mensagem da promessa. Revise antes de enviar.'
        : 'Cobrança escrita no campo de mensagem — revise antes de enviar.'
    );
  }, [messages, contactName, linkedLead?.lead_name]);
  /** Pendência que originou a atividade em criação — fecha o ciclo ao salvar. */
  const commitmentOriginRef = useRef<string | null>(null);
  const [activityPrefillFields, setActivityPrefillFields] = useState<{
    title?: string; notes?: string; deadline?: string; assignedTo?: string;
  }>({});
  /** Ficha da atividade gerada a partir de uma pendência, aberta em aba lateral. */
  const [openActivityId, setOpenActivityId] = useState<string | null>(null);
  const teamProfiles = useProfilesList();

  const nomePorId = useMemo(() => {
    const m: Record<string, string> = {};
    for (const p of teamProfiles) if (p.full_name) m[p.user_id] = p.full_name;
    return m;
  }, [teamProfiles]);

  // O remap precisa estar quente antes do primeiro render: `resolveDonoNome` é
  // síncrono e, sem cache, não acha quem tem UUID diferente nos dois bancos.
  useEffect(() => { if (open) void ensureRemapCache(); }, [open]);

  /** `owner_user_id` vem do Externo; os perfis vêm do Cloud — daí o remap. */
  const resolveDonoNome = (item: CommitmentCardItem) => {
    const id = item.owner_user_id;
    if (!id) return null;
    if (nomePorId[id]) return nomePorId[id];
    const cloudId = remapToCloudSync(id);
    if (cloudId && cloudId !== id && nomePorId[cloudId]) return nomePorId[cloudId];
    return null;
  };

  const [groupName, setGroupName] = useState<string | null>(null);
  /** Quantos leads distintos estão vinculados a este grupo (>1 = vínculo sujo, precisa aparecer). */
  const [groupLeadCount, setGroupLeadCount] = useState(0);
  /** Casos jurídicos já criados para o lead desta conversa. */
  const [linkedCases, setLinkedCases] = useState<{ id: string; case_number: string | null; title: string | null }[]>([]);
  const [showLeadEdit, setShowLeadEdit] = useState(false);
  const [leadEditTab, setLeadEditTab] = useState<string | undefined>(undefined);
  const [showContactEdit, setShowContactEdit] = useState(false);
  const [isPrivate, setIsPrivate] = useState(false);
  const [togglingPrivate, setTogglingPrivate] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [muteLoading, setMuteLoading] = useState(false);
  const [showZapSign, setShowZapSign] = useState(false);
  const [showGroupMembers, setShowGroupMembers] = useState(false);
  const [selectedMsgId, setSelectedMsgId] = useState<string | null>(null);
  // Mensagem apontada por quem abriu o painel (ex.: "ver a mensagem que gerou a
  // atividade"): rola até ela e destaca por 2s assim que a lista carrega.
  const [flashMsgId, setFlashMsgId] = useState<string | null>(null);
  const flashedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!open || !highlightMessageId) { flashedForRef.current = null; return; }
    if (flashedForRef.current === highlightMessageId) return;
    if (!messages.some(m => m.id === highlightMessageId)) return;
    const el = document.querySelector(`[data-msg-id="${highlightMessageId}"]`) as HTMLElement | null;
    if (!el) return;
    flashedForRef.current = highlightMessageId;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setFlashMsgId(highlightMessageId);
    const t = setTimeout(() => setFlashMsgId(null), 2000);
    return () => clearTimeout(t);
  }, [open, highlightMessageId, messages]);
  const [replySuggestOpen, setReplySuggestOpen] = useState(false);
  const [replySuggestTarget, setReplySuggestTarget] = useState('');
  const [showActivitySheet, setShowActivitySheet] = useState(false);
  const [activityPrefill, setActivityPrefill] = useState('');
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const messageInputRef = useRef<HTMLTextAreaElement>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const el = messageInputRef.current;
    if (!el) return;

    el.style.height = '0px';
    el.style.height = `${el.scrollHeight}px`;
  }, [newMessage, open]);

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
    setGroupName(null);
    setGroupLeadCount(0);
    setLinkedCases([]);
    const normalizedPhone = phone.replace(/\D/g, '');
    const fetchMessages = async () => {
      // whatsapp_messages vive no Supabase EXTERNO. Usar `supabase` (Cloud) aqui
      // retornava sempre vazio → "nenhuma mensagem encontrada" mesmo com conversa real.
      // phone na tabela whatsapp_messages é sempre só dígitos (mesmo para grupos,
      // sem o sufixo @g.us). Usar `normalizedPhone` aqui — caso contrário, grupos
      // abertos via JID retornavam zero mensagens.
      let query = (externalSupabase as any)
        .from('whatsapp_messages')
        .select('id, message_text, direction, created_at, message_type, media_url, media_type, instance_name, external_message_id')
        .eq('phone', normalizedPhone);
      // No privado unificado NÃO filtra instância: queremos as conversas de todos os membros.
      if (instanceName && !isPrivateAllView) {
        const variants = Array.from(new Set([instanceName, instanceName.toUpperCase(), instanceName.toLowerCase()]));
        query = query.in('instance_name', variants);
      }
      const { data, error } = await query
        .order('created_at', { ascending: true })
        .limit(3000);
      if (error) {
        console.warn('[DashboardChatPreview] fetchMessages error:', error.message);
      }
      // Grupos: a mesma mensagem é gravada por cada instância que está no grupo.
      // O created_at muda entre espelhos, então a chave real é o tail do external_message_id.
      const rows = (data as any[]) || [];
      const seen = new Set<string>();
      const deduped = rows.filter((m) => {
        const msgId = typeof m.external_message_id === 'string' ? m.external_message_id.split(':').pop() : null;
        const key = msgId
          ? `ext:${msgId}`
          : `fallback:${m.direction}|${m.created_at}|${(m.message_text || '').trim()}|${m.media_url || ''}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      setMessages(deduped as any);
      setLoading(false);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'auto' }), 100);
    };
    const fetchAgent = async () => {
      const { data } = await supabase
        .from('whatsapp_conversation_agents')
        .select('agent_id, is_active, activated_by, human_paused_until')
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
          agent_id: data.agent_id,
          human_paused_until: (data as any).human_paused_until || null,
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
    const fetchAvailableAgents = async () => {
      const { data } = await supabase
        .from('whatsapp_ai_agents')
        .select('id, name')
        .eq('is_active', true)
        .order('name');
      setAvailableAgents((data as any[]) || []);
    };
    fetchMessages();
    fetchAgent();
    fetchCallRecords();
    fetchAvailableAgents();

    // Fetch linked lead & contact
    // Grupo tem duas grafias no banco (JID bare "1203..." e "1203...@g.us") e o
    // painel pode receber qualquer uma. Testar só `@g.us` fazia grupo bare cair
    // no ramo de contato individual: o título virava o JID cru e o lead
    // vinculado pelo grupo nunca aparecia.
    const isGroup = isWhatsAppGroupId(phone);
    const groupJids = Array.from(new Set([phone, normalizedPhone, `${normalizedPhone}@g.us`]));
    const fetchLinkedData = async () => {
      const last8 = normalizedPhone.slice(-8);
      let leadData: any = null;

      if (isGroup) {
        // For group conversations, find lead via lead_whatsapp_groups or leads.whatsapp_group_id
        const { data: groupLinks } = await externalSupabase
          .from('lead_whatsapp_groups')
          .select('lead_id, group_name, created_at')
          .in('group_jid', groupJids)
          .order('created_at', { ascending: false });

        const links = (groupLinks as any[]) || [];
        const named = links.find((g) => g.group_name);
        if (named?.group_name) setGroupName(named.group_name);
        setGroupLeadCount(new Set(links.map((g) => g.lead_id).filter(Boolean)).size);

        const linkWithLead = links.find((g) => g.lead_id);
        if (linkWithLead) {
          const { data: ld } = await externalSupabase.from('leads').select('*').eq('id', linkWithLead.lead_id).maybeSingle();
          if (ld) leadData = ld;
        }

        if (!leadData) {
          const { data: ld } = await externalSupabase
            .from('leads')
            .select('*')
            .in('whatsapp_group_id', groupJids)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          if (ld) leadData = ld;
        }

        // Nome atual do grupo no WhatsApp: o cache é sincronizado da UazAPI e é
        // mais confiável que o nome congelado no vínculo.
        const { data: cached } = await externalSupabase
          .from('whatsapp_groups_cache')
          .select('group_name')
          .in('group_jid', groupJids)
          .not('group_name', 'is', null)
          .limit(1)
          .maybeSingle();
        if ((cached as any)?.group_name) setGroupName((cached as any).group_name);
      } else {
        const { data: ld } = await externalSupabase
          .from('leads')
          .select('*')
          .or(`lead_phone.eq.${normalizedPhone},lead_phone.ilike.%${last8}%`)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (ld) leadData = ld;
      }

      if (leadData) {
        setLinkedLead(leadData as any);
        // If group and no group name yet, try from lead name
        if (isGroup) {
          setGroupName(prev => prev || leadData.lead_name || null);
        }
      }

      // Fetch contact: for groups, use linked lead's contacts; for individual, use phone
      if (isGroup) {
        // Grupo nunca casa contato por telefone: o JID é numérico e o `ilike` dos
        // últimos 8 dígitos colava um contato qualquer (ou o próprio "contato"
        // criado com o JID no lugar do telefone) no cabeçalho da conversa.
        if (leadData) {
          const { data: contactLink } = await externalSupabase
            .from('contact_leads')
            .select('contact_id')
            .eq('lead_id', leadData.id)
            .limit(1)
            .maybeSingle();
          if (contactLink) {
            const { data: cd } = await externalSupabase.from('contacts').select('*').eq('id', contactLink.contact_id).maybeSingle();
            if (cd) setLinkedContact(cd as any);
          }
        }
      } else {
        const { data: contactData } = await externalSupabase
          .from('contacts')
          .select('*')
          .or(`phone.eq.${phone},phone.eq.${normalizedPhone},phone.ilike.%${last8}%`)
          .limit(1)
          .maybeSingle();
        if (contactData) setLinkedContact(contactData as any);
      }
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

  // Casos jurídicos do lead — o menu precisa dizer "já criado" em vez de
  // oferecer criar de novo.
  useEffect(() => {
    if (!open || !linkedLead?.id) { setLinkedCases([]); return; }
    let cancelled = false;
    externalSupabase
      .from('legal_cases')
      .select('id, case_number, title')
      .eq('lead_id', linkedLead.id)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .then(({ data }) => { if (!cancelled) setLinkedCases((data as any[]) || []); });
    return () => { cancelled = true; };
  }, [open, linkedLead?.id]);

  // Realtime — assinar no Externo, onde whatsapp_messages realmente mora.
  useEffect(() => {
    if (!open || !phone) return;
    const normalizedPhone = phone.replace(/\D/g, '');
    const channel = externalSupabase
      .channel(`dashboard-chat-${normalizedPhone}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'whatsapp_messages',
        filter: `phone=eq.${normalizedPhone}`,
      }, (payload) => {
        const msg = payload.new as any;
        if (instanceName && !isPrivateAllView && msg.instance_name && msg.instance_name.toLowerCase() !== instanceName.toLowerCase()) return;
        const incomingMsgId = typeof msg.external_message_id === 'string' ? msg.external_message_id.split(':').pop() : null;
        setMessages(prev => {
          const alreadyExists = incomingMsgId
            ? prev.some(m => typeof m.external_message_id === 'string' && m.external_message_id.split(':').pop() === incomingMsgId)
            : prev.some(m =>
                m.direction === msg.direction &&
                m.created_at === msg.created_at &&
                (m.message_text || '').trim() === (msg.message_text || '').trim() &&
                (m.media_url || '') === (msg.media_url || '')
              );
          return alreadyExists ? prev : [...prev, msg];
        });
        setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
      })
      .subscribe();
    return () => { externalSupabase.removeChannel(channel); };
  }, [open, phone, instanceName]);

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

  // Mesmo contexto/estado usados no WhatsAppChat pra IA sugerir resposta.
  const buildReplyContext = (): string => {
    return (messages || [])
      .filter(m => m && m.message_text && String(m.message_text).trim())
      .slice(-20)
      .map(m => {
        const who = m.direction === 'outbound' ? 'Eu' : (contactName || 'Cliente');
        return `${who}: ${String(m.message_text).trim()}`;
      })
      .join('\n');
  };
  const buildReplyState = () => {
    const withText = (messages || []).filter(m => m && m.message_text && String(m.message_text).trim());
    const last = withText[withText.length - 1];
    const lastOutbound = [...withText].reverse().find(m => m.direction === 'outbound');
    const lastClient = [...withText].reverse().find(m => m.direction !== 'outbound');
    return {
      pending: !!last && last.direction !== 'outbound',
      lastOutboundText: lastOutbound ? String(lastOutbound.message_text).trim() : '',
      lastClientText: lastClient ? String(lastClient.message_text).trim() : '',
    };
  };

  const openActivityFromMessage = (prefillText: string) => {
    setActivityPrefill(prefillText);
    setShowActivitySheet(true);
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

  // Grupos: cada mensagem é espelhada por TODAS as instâncias-membro, então o histórico
  // não diz quem "dono" da conversa — pegar o espelho mais antigo fazia o envio sair por
  // Raym/Luiz Abraci. Envio em grupo prioriza Atendimento Previdenciário 1/2 quando forem
  // membros (aparecem no histórico); senão, a instância do espelho mais recente.
  const isGroupTarget = isWhatsAppGroupId(phone);
  const normalizeInstance = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const PREFERRED_GROUP_SENDERS = ['atendimento previdenciario', 'atendimento previdenciario 2'];

  const resolveSendInstanceName = (): string | undefined => {
    if (preferredInstanceName) return preferredInstanceName;
    if (isGroupTarget) {
      const recentFirst = [...messages].reverse();
      const newest = recentFirst.find(m => m.instance_name);
      const preferred = recentFirst.find(
        m => m.instance_name && PREFERRED_GROUP_SENDERS.includes(normalizeInstance(m.instance_name)),
      );
      // Instância que parou de espelhar o grupo há mais de 7 dias (enquanto o grupo
      // seguiu ativo) provavelmente saiu dele — escolhê-la daria NOT_IN_GROUP.
      const SAIU_DO_GRUPO_MS = 7 * 24 * 60 * 60 * 1000;
      const aindaNoGrupo =
        preferred && newest &&
        new Date(newest.created_at).getTime() - new Date(preferred.created_at).getTime() <= SAIU_DO_GRUPO_MS;
      if (aindaNoGrupo && preferred?.instance_name) return preferred.instance_name;
      return newest?.instance_name;
    }
    return messages.find(m => m.instance_name)?.instance_name;
  };

  const resolveInstanceId = async (): Promise<string | undefined> => {
    const msgInstanceName = resolveSendInstanceName();
    if (msgInstanceName) {
      const { data: inst } = await supabase
        .from('whatsapp_instances')
        .select('id')
        .ilike('instance_name', msgInstanceName)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();
      if (inst) return inst.id;
    }
    // Grupo sem instância resolvida no Cloud: omite instance_id — a edge send-whatsapp
    // escolhe a instância-membro com mensagem mais recente no grupo (getInstance etapa 2),
    // em vez de receber uma instância arbitrária daqui.
    if (isGroupTarget) return undefined;
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
    // Cobrança armada pelo card da pendência: sai citando a promessa e vira
    // linha do histórico só depois do envio confirmado.
    const cobrancaEmCurso = cobranca;
    try {
      const instanceId = await resolveInstanceId();
      const finalMessage = await buildFinalMessage(newMessage.trim());
      const msgInstanceName = resolveSendInstanceName();

      const { data, error } = await cloudFunctions.invoke('send-whatsapp', {
        body: {
          phone,
          message: finalMessage,
          instance_id: instanceId,
          replyid: cobrancaEmCurso?.replyExternalId || undefined,
          // Canal Cloud API (Meta oficial) → edge proxy reroteia pra Railway send-whatsapp-cloud.
          channel: msgInstanceName === 'cloud_gerencia' ? 'cloud' : undefined,
        },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Erro ao enviar');

      if (cobrancaEmCurso) {
        setCobranca(null);
        void commitments
          .registerReminder(cobrancaEmCurso.item, {
            messageId: data.message_id || null,
            externalMessageId: data.external_message_id || null,
            text: finalMessage,
            repliedToMessageId: cobrancaEmCurso.sourceMessageId,
            repliedToExternalId: cobrancaEmCurso.replyExternalId,
          })
          .catch(() => toast.error('Mensagem enviada, mas não consegui registrar no histórico'));
      }

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

      // Detect #shortcut_name commands and activate agent
      const hashMatch = finalMessage.match(/^#([a-zA-Z0-9_]+)\s*$/);
      if (hashMatch && msgInstanceName) {
        const shortcutName = hashMatch[1].toLowerCase();
        const { data: shortcut } = await supabase
          .from('wjia_command_shortcuts')
          .select('id, shortcut_name, is_active')
          .eq('shortcut_name', shortcutName)
          .eq('is_active', true)
          .maybeSingle();
        if (shortcut) {
          // Activate agent for this conversation
          await db.from('whatsapp_conversation_agents').upsert({
            phone,
            instance_name: msgInstanceName,
            agent_id: shortcut.id,
            is_active: true,
            activated_by: 'manual_command',
          }, { onConflict: 'phone,instance_name' });
          toast.success(`Agente #${shortcutName} ativado!`);
          // Trigger agent reply with the last inbound message
          try {
            const { data: lastInbound } = await supabase
              .from('whatsapp_messages')
              .select('message_text, message_type')
              .eq('phone', phone)
              .eq('instance_name', msgInstanceName)
              .eq('direction', 'inbound')
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle();
            if (lastInbound) {
              await cloudFunctions.invoke('whatsapp-ai-agent-reply', {
                body: {
                  phone,
                  instance_name: msgInstanceName,
                  message_text: lastInbound.message_text || '',
                  message_type: lastInbound.message_type || 'text',
                },
              });
            }
          } catch (err) {
            console.error('Error triggering agent reply:', err);
          }
        }
      }
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
      const { error: uploadError } = await supabase.storage.from('whatsapp-media').upload(path, file, { cacheControl: '2592000' });
      if (uploadError) throw uploadError;
      const { data: urlData } = supabase.storage.from('whatsapp-media').getPublicUrl(path);
      const mediaUrl = urlData.publicUrl;

      const instanceId = await resolveInstanceId();
      const msgInstanceName = resolveSendInstanceName();

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

  // Audio recording — envia como áudio do WhatsApp via send-whatsapp
  const startRecording = async () => {
    if (!phone) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: VOICE_AUDIO_CONSTRAINTS });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : 'audio/mp4';
      const mediaRecorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: VOICE_RECORDER_BITRATE });
      audioChunksRef.current = [];
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        if (recordingIntervalRef.current) clearInterval(recordingIntervalRef.current);
        setRecordingTime(0);
        const recordedMime = mediaRecorder.mimeType || 'audio/webm';
        const blob = new Blob(audioChunksRef.current, { type: recordedMime });
        if (blob.size < 100) return;
        setUploadingMedia(true);
        try {
          const ext = recordedMime.includes('mp4') ? 'mp4' : 'webm';
          const path = `whatsapp-media/${Date.now()}_audio.${ext}`;
          const { error: uploadError } = await supabase.storage.from('whatsapp-media').upload(path, blob, { cacheControl: '2592000' });
          if (uploadError) throw uploadError;
          const { data: urlData } = supabase.storage.from('whatsapp-media').getPublicUrl(path);
          const mediaUrl = urlData.publicUrl;
          const instanceId = await resolveInstanceId();
          const msgInstanceName = resolveSendInstanceName();
          const { data, error } = await cloudFunctions.invoke('send-whatsapp', {
            body: {
              action: 'send_media',
              phone,
              media_url: mediaUrl,
              media_type: recordedMime,
              file_name: `audio.${ext}`,
              instance_id: instanceId,
            },
          });
          if (error) throw error;
          if (!data?.success) throw new Error(data?.error || 'Erro ao enviar áudio');
          setMessages(prev => [...prev, {
            id: data.message_id || crypto.randomUUID(),
            message_text: null,
            direction: 'outbound',
            created_at: new Date().toISOString(),
            message_type: 'audio',
            media_url: mediaUrl,
            media_type: recordedMime,
            instance_name: msgInstanceName || null,
          }]);
          toast.success('Áudio enviado!');
          setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
        } catch (err: any) {
          console.error('Erro ao enviar áudio:', err);
          toast.error('Erro ao enviar áudio: ' + (err?.message || ''));
        } finally {
          setUploadingMedia(false);
        }
      };
      mediaRecorder.start();
      mediaRecorderRef.current = mediaRecorder;
      setIsRecording(true);
      recordingIntervalRef.current = setInterval(() => setRecordingTime(t => t + 1), 1000);
    } catch {
      toast.error('Não foi possível acessar o microfone');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  };

  const cancelRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.ondataavailable = null;
      mediaRecorderRef.current.onstop = () => {
        mediaRecorderRef.current?.stream?.getTracks().forEach(t => t.stop());
      };
      mediaRecorderRef.current.stop();
    }
    if (recordingIntervalRef.current) clearInterval(recordingIntervalRef.current);
    setIsRecording(false);
    setRecordingTime(0);
  };


  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  /**
   * Recarrega o contato do cabeçalho. Pelo id quando já sabemos qual é — em
   * conversa de grupo o `phone` é o JID e casar por telefone traz contato errado.
   */
  const refreshLinkedContact = () => {
    if (linkedContact?.id) {
      externalSupabase.from('contacts').select('*').eq('id', linkedContact.id).maybeSingle()
        .then(({ data }) => { if (data) setLinkedContact(data as any); });
      return;
    }
    if (!phone || isWhatsAppGroupId(phone)) return;
    const normalizedPhone = phone.replace(/\D/g, '');
    const last8 = normalizedPhone.slice(-8);
    externalSupabase.from('contacts').select('*')
      .or(`phone.eq.${phone},phone.eq.${normalizedPhone},phone.ilike.%${last8}%`)
      .limit(1)
      .maybeSingle()
      .then(({ data }) => { if (data) setLinkedContact(data as any); });
  };

  /**
   * Abre o formulário de atividade já preenchido pela pendência — o mesmo
   * caminho da caixa de pendências, agora sem sair da conversa.
   */
  const abrirAtividadeDaPendencia = (item: CommitmentCardItem) => {
    commitmentOriginRef.current = item.id;
    const hoje = new Date().toISOString().slice(0, 10);
    const donoCloud = item.owner_user_id ? remapToCloudSync(item.owner_user_id) : null;
    setActivityPrefillFields({
      title: `Pendência do cliente: ${item.title}`,
      // Prazo: o combinado com o cliente, mas nunca no passado — atividade que
      // nasce atrasada estraga o indicador.
      deadline: item.due_date && item.due_date > hoje ? item.due_date : undefined,
      assignedTo: donoCloud && nomePorId[donoCloud] ? donoCloud : undefined,
      notes: [
        'Atividade aberta a partir de uma pendência do cliente.',
        `O cliente ficou de: ${item.title}`,
        item.due_date
          ? `Prazo combinado: ${format(parseISO(item.due_date), 'dd/MM/yyyy')}`
          : `Sem prazo marcado — combinado em ${format(new Date(item.promised_at), 'dd/MM/yyyy')}`,
        item.source_message_text ? `O cliente disse: "${item.source_message_text}"` : '',
        item.notes ? `Observação da pendência: ${item.notes}` : '',
      ].filter(Boolean).join('\n'),
    });
    setActivityPrefill('');
    setShowActivitySheet(true);
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
      const extCreatedBy = await remapToExternal(currentUser?.id);
      const recentMessages = messages.slice(-50).map(m => ({
        direction: m.direction,
        message_text: m.message_text,
      }));

      let leadExtracted: Record<string, any> = {};
      let contactExtracted: Record<string, any> = {};

      if (phone && instanceName) {
        const [leadRes, contactRes] = await Promise.all([
          cloudFunctions.invoke('extract-conversation-data', {
            body: { phone, instance_name: instanceName, targetType: 'lead' },
          }),
          cloudFunctions.invoke('extract-conversation-data', {
            body: { phone, instance_name: instanceName, targetType: 'contact' },
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

      const isGroupChat = isWhatsAppGroupId(phone);
      const insertData: Record<string, any> = {
        lead_name: leadExtracted.lead_name || contactExtracted.full_name || contactName || 'Novo Lead - WhatsApp',
        // JID de grupo NÃO entra em lead_phone (não é telefone).
        lead_phone: isGroupChat ? null : phone,
        whatsapp_group_id: isGroupChat ? phone : null,
        lead_email: leadExtracted.lead_email || contactExtracted.email || null,
        source: 'whatsapp',
        created_by: extCreatedBy,
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

      // Mesma rota do WhatsAppInbox: datas vêm da extração por IA e podem vir
      // parciais ("2024"). Sanitiza antes do INSERT.
      const { data: newLead, error: leadError } = await externalSupabase
        .from('leads')
        .insert(sanitizeLeadDateFields(insertData))
        .select('*')
        .single();
      if (leadError) throw leadError;

      const normalizedPhone = phone.replace(/\D/g, '');
      await externalSupabase
        .from('whatsapp_messages')
        .update({ lead_id: newLead.id })
        .or(`phone.eq.${phone},phone.eq.${normalizedPhone}`)
        .is('lead_id', null);

      // Conversa de grupo: o phone é o JID do grupo. Cria só o lead (com
      // whatsapp_group_id acima) e pula o contato — senão nasce um "contato" com
      // o nome e o ID do grupo. O contato do cliente entra pelos participantes.
      if (!isGroupChat) {
        const contactFullName = contactExtracted.full_name || contactName || 'Contato WhatsApp';
        const { data: existingContact } = await externalSupabase
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
            await externalSupabase.from('contacts').update(contactUpdates).eq('id', contactId);
          }
        } else {
          const contactInsert: Record<string, any> = {
            full_name: contactFullName,
            phone: phone,
            created_by: extCreatedBy,
          };
          if (contactExtracted.email) contactInsert.email = contactExtracted.email;
          if (contactExtracted.city) contactInsert.city = contactExtracted.city;
          if (contactExtracted.state) contactInsert.state = contactExtracted.state;
          if (contactExtracted.cpf) contactInsert.cpf = contactExtracted.cpf;
          if (contactExtracted.birth_date) contactInsert.birth_date = contactExtracted.birth_date;
          if (contactExtracted.neighborhood) contactInsert.neighborhood = contactExtracted.neighborhood;
          if (contactExtracted.instagram_url) contactInsert.instagram_url = contactExtracted.instagram_url;

          const { data: newContact, error: contactError } = await externalSupabase
            .from('contacts')
            .insert([contactInsert] as any)
            .select('id')
            .single();
          if (contactError) throw contactError;
          contactId = newContact.id;
        }

        await externalSupabase.from('contact_leads').insert({
          contact_id: contactId,
          lead_id: newLead.id,
          relationship_to_victim: 'Vítima',
        });

        await externalSupabase
          .from('whatsapp_messages')
          .update({ contact_id: contactId })
          .or(`phone.eq.${phone},phone.eq.${normalizedPhone}`)
          .is('contact_id', null);

        if (existingContact) {
          setLinkedContact({ id: existingContact.id, full_name: existingContact.full_name, phone } as Contact);
        } else {
          setLinkedContact({ id: contactId, full_name: contactFullName, phone } as Contact);
        }
      }

      setLinkedLead(newLead as Lead);
      onConversationUpdated?.();

      toast.success(isGroupChat ? 'Lead criado com o grupo vinculado!' : 'Lead e contato criados com dados da conversa!');
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

      // If sync is OFF, ask user for custom lead name
      let customLeadName: string | null = null;
      if (boardId) {
        const { data: bgs } = await (externalSupabase as any)
          .from('board_group_settings')
          .select('sync_lead_name_with_group')
          .eq('board_id', boardId)
          .maybeSingle();
        if (bgs && bgs.sync_lead_name_with_group === false) {
          const input = window.prompt(
            'Sincronização do nome do lead com o grupo está desligada.\nDefina o nome do lead (deixe vazio para manter o atual):',
            leadName
          );
          if (input === null) {
            setCreatingGroup(false);
            return;
          }
          const trimmed = input.trim();
          if (trimmed && trimmed !== leadName) {
            customLeadName = trimmed;
            leadName = trimmed;
          }
        }
      }

      let instanceId: string | undefined;
      const msgInstanceName = preferredInstanceName || messages.find(m => m.instance_name)?.instance_name;
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
          creation_origin: 'manual',
        },
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Erro ao criar grupo');

      if (lead?.id && data.group_id) {
        const updates: any = { whatsapp_group_id: data.group_id };
        if (customLeadName) updates.lead_name = customLeadName;
        await supabase
          .from('leads')
          .update(updates)
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

  const triggerAgentReplyFromLastInbound = async (targetPhone: string, targetInstanceName: string) => {
    const { data: lastInbound, error: lastInboundError } = await supabase
      .from('whatsapp_messages')
      .select('message_text, message_type')
      .eq('phone', targetPhone)
      .eq('instance_name', targetInstanceName)
      .eq('direction', 'inbound')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastInboundError) throw lastInboundError;
    if (!lastInbound) return;

    const { error: replyError } = await cloudFunctions.invoke('whatsapp-ai-agent-reply', {
      body: {
        phone: targetPhone,
        instance_name: targetInstanceName,
        message_text: lastInbound.message_text || '',
        message_type: lastInbound.message_type || 'text',
      },
    });

    if (replyError) throw replyError;
  };

  const handleToggleAgent = async () => {
    if (!phone || !agentInfo || !instanceName) return;
    const normalizedPhone = phone.replace(/\D/g, '');
    const newActive = !agentInfo.is_active;
    try {
      const { error } = await supabase
        .from('whatsapp_conversation_agents')
        .update({ is_active: newActive, human_paused_until: newActive ? null : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString() } as any)
        .eq('instance_name', instanceName)
        .or(`phone.eq.${normalizedPhone},phone.ilike.%${normalizedPhone.slice(-8)}%`);

      if (error) throw error;

      if (newActive) {
        await triggerAgentReplyFromLastInbound(normalizedPhone, instanceName);
      }

      setAgentInfo({ ...agentInfo, is_active: newActive });
      onConversationUpdated?.();
      toast.success(newActive ? 'Agente ativado!' : 'Agente desativado!');
    } catch (e) {
      toast.error('Erro ao alterar agente');
    }
  };

  const handleSelectAgent = async (agentId: string, agentName: string) => {
    if (!phone || !instanceName) return;
    const normalizedPhone = phone.replace(/\D/g, '');
    try {
      await supabase
        .from('whatsapp_conversation_agents')
        .upsert({
          phone: normalizedPhone,
          instance_name: instanceName,
          agent_id: agentId,
          is_active: true,
          activated_by: 'manual',
          human_paused_until: null,
        } as any, { onConflict: 'phone,instance_name' });
      setAgentInfo({ name: agentName, activated_by: 'Manual', is_active: true, agent_id: agentId });
      onConversationUpdated?.();
      toast.success(`🤖 Agente "${agentName}" ativado!`);
    } catch (e) {
      toast.error('Erro ao selecionar agente');
    }
  };

  const handleSuggestBestAgent = async () => {
    if (!phone) return;
    setSuggestingAgent(true);
    try {
      const { data, error } = await cloudFunctions.invoke('suggest-best-agent', {
        body: { phone, instance_name: instanceName },
      });
      if (error) throw error;
      if (data?.agent_id && data?.agent_name) {
        const confirmed = window.confirm(`🤖 IA sugere: "${data.agent_name}"\n\nMotivo: ${data.reason}\n\nDeseja ativar este agente?`);
        if (confirmed) {
          await handleSelectAgent(data.agent_id, data.agent_name);
        }
      } else {
        toast.error('Não foi possível sugerir um agente');
      }
    } catch (e: any) {
      toast.error('Erro ao sugerir agente: ' + (e.message || ''));
    } finally {
      setSuggestingAgent(false);
    }
  };

  const handleAnticipateFollowup = async () => {
    if (!phone || !instanceName) return;
    try {
      toast.info('Antecipando follow-up...');
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/wjia-followup-processor`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
            'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({ target_phone: phone, target_instance: instanceName, force_immediate: true }),
        }
      );
      if (!response.ok) throw new Error('Falha ao antecipar');
      toast.success('⚡ Follow-up antecipado!');
    } catch (e: any) {
      toast.error('Erro: ' + (e.message || 'Falha ao antecipar follow-up'));
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
      await externalSupabase.from('whatsapp_messages').delete().eq('phone', normalizedPhone);
      await db.from('whatsapp_conversation_agents').delete()
        .or(`phone.eq.${normalizedPhone},phone.ilike.%${normalizedPhone.slice(-8)}%`);
      setMessages([]);
      setAgentInfo(null);
      toast.success('Conversa limpa!');
      onOpenChange(false);
    } catch {
      toast.error('Erro ao limpar conversa');
    }
  };

  // Instâncias presentes na conversa privada unificada (pra rotular e escolher por onde enviar).
  const privateInstances = useMemo(() => {
    if (!isPrivateAllView) return [] as string[];
    return Array.from(new Set(messages.map(m => m.instance_name).filter(Boolean))) as string[];
  }, [messages, isPrivateAllView]);

  useEffect(() => {
    if (!isPrivateAllView || sendAsInstance) return;
    const last = [...messages].reverse().find(m => m.instance_name);
    if (last?.instance_name) setSendAsInstance(last.instance_name);
  }, [messages, isPrivateAllView, sendAsInstance]);

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
        <button type="button" onClick={() => setLightboxUrl(msg.media_url!)} className="block">
          <img src={mediaPreview(msg.media_url)} alt="Imagem" className="max-w-[200px] max-h-[200px] rounded-md object-cover cursor-zoom-in" loading="lazy" onError={handleMediaThumbError} />
        </button>
      );
    }
    if (type?.startsWith('video') || msg.message_type === 'video') {
      return <LazyVideo src={msg.media_url} mimeType={type || 'video/mp4'} className="max-w-[200px] max-h-[200px] rounded-md" posterClassName="rounded-md w-[200px] h-[160px]" />;
    }
    if (type?.startsWith('audio') || msg.message_type === 'audio') {
      return <audio src={msg.media_url} controls className="max-w-[220px]" />;
    }
    // Document
    const fileName = msg.media_url.split('/').pop() || 'Documento';
    // Imagem/PDF abrem no visualizador interno; só o resto sai pra outra página.
    const previewable = /\.(pdf|jpe?g|png|webp|gif)($|\?)/i.test(msg.media_url) || /^image\//i.test(type || '');
    return (
      <button
        type="button"
        onClick={() => previewable ? setLightboxUrl(msg.media_url!) : window.open(msg.media_url!, '_blank', 'noopener,noreferrer')}
        className="flex items-center gap-1.5 text-[11px] underline"
      >
        📄 {fileName.length > 30 ? fileName.slice(0, 30) + '...' : fileName}
      </button>
    );
  };

  let lastDateLabel = '';

  // Detecta grupo mesmo quando o sufixo @g.us foi removido em algum ponto do pipeline.
  // IDs de grupos do WhatsApp são numéricos com 15+ dígitos (ex: 120363424314808089),
  // enquanto números BR têm no máximo ~13 dígitos.
  const isGroupChat = !!phone && (phone.includes('@g.us') || /^\d{15,}$/.test(phone.replace(/\D/g, '')));

  // Quem abre o painel às vezes passa o próprio JID como "nome" (a lista não
  // resolveu o grupo). Nesse caso o JID não pode virar título.
  const phoneDigits = (phone || '').replace(/\D/g, '');
  const propNameIsJid = !!contactName && contactName.replace(/\D/g, '') === phoneDigits && !/[a-zA-Z]/.test(contactName.replace('@g.us', ''));
  const displayContactName = propNameIsJid ? null : contactName;
  const headerTitle = isGroupChat
    ? (groupName || displayContactName || linkedLead?.lead_name || (phoneDigits ? `Grupo •••${phoneDigits.slice(-6)}` : 'Grupo WhatsApp'))
    : (displayContactName || linkedContact?.full_name || linkedLead?.lead_name || phone);
  const showLeadBadge = !!linkedLead || hasLead;
  const showContactBadge = !!linkedContact || hasContact;

  return (
    <>
    <Drawer direction={direction} open={open} onOpenChange={(nextOpen) => {
      if (lightboxUrl && !nextOpen) return;
      onOpenChange(nextOpen);
    }}>
      <DrawerContent direction={direction} className="max-h-[92vh] flex flex-col">
        <DrawerHeader className="pb-2 shrink-0">
          <div className="flex items-center justify-between">
            <div className="min-w-0 flex-1">
              <DrawerTitle className="text-base truncate flex items-center gap-2">
                {isGroupChat ? <Users className="h-4 w-4 text-muted-foreground shrink-0" /> : <User className="h-4 w-4 text-muted-foreground shrink-0" />}
                {headerTitle}
              </DrawerTitle>
              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                {isGroupChat && (
                  <span className="text-xs text-muted-foreground">
                    Grupo WhatsApp{linkedLead ? ` • ${linkedLead.lead_name}` : ' • sem lead vinculado'}
                  </span>
                )}
                {phone && !isGroupChat && displayContactName && <span className="text-xs text-muted-foreground">{phone}</span>}
                {instanceName && <span className="text-[10px] text-muted-foreground">• {instanceName}</span>}
              </div>
              {canTogglePrivate && (
                <div className="flex items-center gap-1 mt-1.5">
                  <Button
                    variant={viewMode === 'main' ? 'default' : 'outline'}
                    size="sm"
                    className="h-6 px-2 text-[11px] gap-1"
                    onClick={() => setViewMode('main')}
                  >
                    <Users className="h-3 w-3" /> Grupo
                  </Button>
                  <Button
                    variant={viewMode === 'private' ? 'default' : 'outline'}
                    size="sm"
                    className="h-6 px-2 text-[11px] gap-1"
                    onClick={() => setViewMode('private')}
                    title="Conversas privadas de todos os membros da equipe com o contato, unificadas"
                  >
                    <User className="h-3 w-3" /> Privado (equipe)
                  </Button>
                </div>
              )}
              <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                {showLeadBadge && (
                  <Badge
                    variant="default"
                    className="text-[10px] px-1.5 py-0 h-4 cursor-pointer hover:opacity-80"
                    onClick={() => { if (linkedLead) { setLeadEditTab(undefined); setShowLeadEdit(true); } }}
                    title={linkedLead ? `Abrir lead: ${linkedLead.lead_name}` : 'Lead'}
                  >
                    Lead {linkedLead?.lead_name ? `• ${linkedLead.lead_name.slice(0, 20)}` : ''}
                  </Badge>
                )}
                {groupLeadCount > 1 && (
                  <Badge
                    variant="outline"
                    className="text-[10px] px-1.5 py-0 h-4 bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-400 dark:border-amber-800"
                    title="Este grupo está vinculado a mais de um lead — confira em Vincular Lead"
                  >
                    ⚠ {groupLeadCount} leads no grupo
                  </Badge>
                )}
                {linkedCases.length > 0 && (
                  <Badge
                    variant="secondary"
                    className="text-[10px] px-1.5 py-0 h-4 cursor-pointer hover:opacity-80"
                    onClick={() => { if (linkedLead) { setLeadEditTab('casos'); setShowLeadEdit(true); } }}
                    title="Abrir os casos jurídicos deste lead"
                  >
                    <Scale className="h-2.5 w-2.5 mr-1" />
                    {linkedCases.length > 1 ? `${linkedCases.length} casos` : `Caso${linkedCases[0].case_number ? ` • ${linkedCases[0].case_number}` : ''}`}
                  </Badge>
                )}
                {showContactBadge && (
                  <Badge
                    variant="secondary"
                    className="text-[10px] px-1.5 py-0 h-4 cursor-pointer hover:opacity-80"
                    onClick={() => { if (linkedContact) setShowContactEdit(true); }}
                    title={linkedContact ? `Abrir contato: ${linkedContact.full_name}` : 'Contato'}
                  >
                    Contato {linkedContact?.full_name ? `• ${linkedContact.full_name.slice(0, 20)}` : ''}
                  </Badge>
                )}
                {!showLeadBadge && !showContactBadge && (
                  onOpenChat ? (
                    <Badge
                      variant="outline"
                      className="text-[10px] px-1.5 py-0 h-4 text-muted-foreground cursor-pointer hover:text-foreground"
                      onClick={() => handleAction('link')}
                      title="Abrir a conversa completa para vincular um lead"
                    >
                      Sem vínculo • vincular
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 text-muted-foreground">Sem vínculo</Badge>
                  )
                )}
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
                  {agentInfo.is_active && agentInfo.human_paused_until && new Date(agentInfo.human_paused_until) > new Date() && (
                    <div className="flex items-center gap-1">
                      <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 gap-1 border-orange-400 text-orange-600 bg-orange-50">
                        ⏸️ Pausa humana ({Math.max(1, Math.ceil((new Date(agentInfo.human_paused_until).getTime() - Date.now()) / 60000))}min)
                      </Badge>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-4 w-4 p-0"
                        title="Interromper pausa e reativar agente"
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (!phone || !instanceName) return;
                          const normalizedPhone = phone.replace(/\D/g, '');
                          try {
                            await supabase
                              .from('whatsapp_conversation_agents')
                              .update({ human_paused_until: null } as any)
                              .eq('instance_name', instanceName)
                              .or(`phone.eq.${normalizedPhone},phone.ilike.%${normalizedPhone.slice(-8)}%`);
                            setAgentInfo({ ...agentInfo, human_paused_until: null });
                            await triggerAgentReplyFromLastInbound(normalizedPhone, instanceName);
                            toast.success('Pausa interrompida! Agente retomando...');
                          } catch (err) {
                            toast.error('Erro ao interromper pausa');
                          }
                        }}
                      >
                        <FastForward className="h-3 w-3 text-orange-600" />
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center gap-1 shrink-0 ml-2">
              {!isGroupChat && phone && (
                <WhatsAppCallRecorder
                  phone={phone}
                  contactName={linkedContact?.full_name || contactName}
                  contactId={linkedContact?.id || null}
                  leadId={linkedLead?.id || null}
                  leadName={linkedLead?.lead_name || null}
                  instanceName={instanceName || messages.find(m => m.instance_name)?.instance_name || null}
                />
              )}
              <WhatsAppMediaGallery messages={messages as any} leadId={linkedLead?.id || null} />
              {isGroupChat && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setShowGroupMembers(true)}>
                      <Users className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Membros e descrição do grupo</TooltipContent>
                </Tooltip>
              )}
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
              {phone && (
                <Button
                  variant={teamChatOpen ? 'secondary' : 'outline'}
                  size="sm"
                  className="h-8 gap-1.5 px-2 text-primary"
                  onClick={() => setTeamChatOpen((v) => !v)}
                  title={teamChatOpen ? 'Fechar o chat interno da equipe' : 'Abrir o chat interno da equipe sobre esta conversa'}
                >
                  <MessageSquare className="h-4 w-4" />
                  <span className="text-xs font-medium">Equipe</span>
                </Button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" className="h-8 w-8">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  {/* O que já existe não vira "criar" de novo: o item passa a
                      dizer que já foi criado e abre a ficha. */}
                  {linkedLead ? (
                    <DropdownMenuItem onClick={() => { setLeadEditTab(undefined); setShowLeadEdit(true); }}>
                      <Link2 className="h-4 w-4 mr-2 text-emerald-600" />
                      <span className="truncate">Lead já criado{linkedLead.lead_name ? ` • ${linkedLead.lead_name}` : ''}</span>
                    </DropdownMenuItem>
                  ) : (
                    <>
                      <DropdownMenuItem onClick={() => handleAction('link')}>
                        <Link2 className="h-4 w-4 mr-2" /> Vincular Lead
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleAction('create_lead')}>
                        <Plus className="h-4 w-4 mr-2" /> {creatingLead ? 'Criando...' : 'Criar Lead + Contato'}
                      </DropdownMenuItem>
                    </>
                  )}
                  {linkedContact ? (
                    <DropdownMenuItem onClick={() => setShowContactEdit(true)}>
                      <UserPlus className="h-4 w-4 mr-2 text-emerald-600" />
                      <span className="truncate">Contato já criado{linkedContact.full_name ? ` • ${linkedContact.full_name}` : ''}</span>
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem onClick={() => handleAction('create_contact')}>
                      <UserPlus className="h-4 w-4 mr-2" /> Criar Contato
                    </DropdownMenuItem>
                  )}
                  {linkedCases.length > 0 ? (
                    <DropdownMenuItem onClick={() => { setLeadEditTab('casos'); setShowLeadEdit(true); }}>
                      <Scale className="h-4 w-4 mr-2 text-emerald-600" />
                      <span className="truncate">
                        {linkedCases.length > 1
                          ? `${linkedCases.length} casos já criados`
                          : `Caso já criado${linkedCases[0].case_number ? ` • ${linkedCases[0].case_number}` : linkedCases[0].title ? ` • ${linkedCases[0].title}` : ''}`}
                      </span>
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem onClick={() => handleAction('create_case')}>
                      <Scale className="h-4 w-4 mr-2" /> Criar Caso Jurídico
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={() => { setActivityPrefill(''); setShowActivitySheet(true); }} className="text-green-600 dark:text-green-400">
                    <ClipboardList className="h-4 w-4 mr-2" /> Criar Atividade
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
                  <DropdownMenuSeparator />
                  {agentInfo && agentInfo.is_active && (
                    <DropdownMenuItem onClick={handleToggleAgent}>
                      <BotOff className="h-4 w-4 mr-2" /> Desativar Agente ({agentInfo.name})
                    </DropdownMenuItem>
                  )}
                  {agentInfo && !agentInfo.is_active && (
                    <DropdownMenuItem onClick={handleToggleAgent}>
                      <Bot className="h-4 w-4 mr-2" /> Reativar Agente ({agentInfo.name})
                    </DropdownMenuItem>
                  )}
                  {availableAgents.length > 0 && (
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>
                        <Bot className="h-4 w-4 mr-2" /> Trocar Agente
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent className="w-56">
                        <DropdownMenuItem onClick={handleSuggestBestAgent} disabled={suggestingAgent} className="gap-2 text-amber-600 dark:text-amber-400">
                          {suggestingAgent ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                          Sugerir com IA
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        {availableAgents.map(agent => (
                          <DropdownMenuItem
                            key={agent.id}
                            onClick={() => handleSelectAgent(agent.id, agent.name)}
                            className="gap-2"
                          >
                            <Bot className="h-3.5 w-3.5" />
                            <span className="flex-1">{agent.name}</span>
                            {agentInfo?.agent_id === agent.id && (
                              <Badge variant="default" className="text-[9px] h-4 px-1">atual</Badge>
                            )}
                          </DropdownMenuItem>
                        ))}
                        {agentInfo && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={async () => {
                              if (!phone) return;
                              const normalizedPhone = phone.replace(/\D/g, '');
                              await db.from('whatsapp_conversation_agents').delete().or(`phone.eq.${normalizedPhone},phone.ilike.%${normalizedPhone.slice(-8)}%`);
                              setAgentInfo(null);
                              onConversationUpdated?.();
                              toast.success('Agente removido');
                            }} className="gap-2 text-destructive">
                              <BotOff className="h-3.5 w-3.5" />
                              Remover agente
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  )}
                  <DropdownMenuItem onClick={handleAnticipateFollowup}>
                    <FastForward className="h-4 w-4 mr-2" /> Antecipar Follow-up
                  </DropdownMenuItem>
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

        {/* Progresso do POP e pendências do cliente — as duas barras que a
            conversa completa mostra. */}
        {linkedLead?.id && (
          <div className="shrink-0">
            <WhatsAppLeadProgressBar leadId={linkedLead.id} onClick={() => setShowLeadEdit(true)} />
          </div>
        )}
        {phone && (
          <div className="shrink-0">
            <ClientCommitmentsBar
              open={commitments.open}
              overdue={commitments.overdue}
              doneCount={commitments.done.length}
              analyzing={commitments.analyzing}
              onOpenPanel={() => setCommitmentsOpen((v) => !v)}
            />
          </div>
        )}

        {/* Lista das pendências: expande DENTRO do painel em vez de abrir outro
            modal por cima do Drawer (dois modais brigam por foco e rolagem). */}
        {commitmentsOpen && (
          <div className="shrink-0 max-h-[38vh] overflow-y-auto border-b bg-muted/20 p-3 space-y-2">
            {commitments.summary && (
              <p className="text-[11px] leading-relaxed rounded border bg-background p-2">
                {commitments.summary}
              </p>
            )}
            {commitments.open.length === 0 && !commitments.analyzing && (
              <p className="text-[11px] text-muted-foreground text-center py-2">
                A IA não achou nada em aberto nesta conversa.
              </p>
            )}
            {commitments.open.map((item) => (
              <CommitmentItemCard
                key={item.id}
                item={item}
                clientName={headerTitle || ''}
                onDone={commitments.markDone}
                onGiveUp={commitments.markGivenUp}
                onDismiss={commitments.dismiss}
                onReopen={commitments.reopen}
                onRemind={commitments.registerReminder}
                onRemove={commitments.remove}
                reminders={commitments.reminders[item.id]}
                onStartRemind={(i) => { armarCobranca(i); setCommitmentsOpen(false); }}
                onDraftMessage={(t) => setNewMessage(t)}
                donoNome={resolveDonoNome(item)}
                onTrocarDono={setTrocandoDono}
                onCreateActivity={abrirAtividadeDaPendencia}
                onOpenActivity={(activityId) => setOpenActivityId(activityId)}
              />
            ))}
          </div>
        )}

        {/* Chat interno da equipe: mesma peça da conversa completa, aqui como
            faixa dentro do painel — o Drawer já é o modal, não cabe outro. */}
        {teamChatOpen && phone && (
          <div className="shrink-0 h-[45vh] border-b">
            <WhatsAppConversationTeamChat
              phone={phone}
              instanceName={instanceName}
              contactName={contactName || linkedLead?.lead_name || null}
              onClose={() => setTeamChatOpen(false)}
              className="w-full h-full"
            />
          </div>
        )}

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

        {/* Selection Toolbar - WhatsApp style */}
        {selectedMsgId && (() => {
          const selectedMsg = messages.find(m => m.id === selectedMsgId);
          return (
            <div className="flex items-center justify-between bg-primary px-3 py-2 border-b">
              <Button variant="ghost" size="icon" className="h-7 w-7 text-primary-foreground hover:bg-primary-foreground/20" onClick={() => setSelectedMsgId(null)}>
                <X className="h-4 w-4" />
              </Button>
              <span className="text-xs text-primary-foreground font-medium">1</span>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" className="h-7 w-7 text-primary-foreground hover:bg-primary-foreground/20" onClick={() => {
                  if (selectedMsg?.message_text) {
                    navigator.clipboard.writeText(selectedMsg.message_text);
                    toast.success('Mensagem copiada!');
                  }
                  setSelectedMsgId(null);
                }} title="Copiar">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-primary-foreground hover:bg-primary-foreground/20" onClick={async () => {
                  if (selectedMsg) {
                    await externalSupabase.from('whatsapp_messages').delete().eq('id', selectedMsg.id);
                    setMessages(prev => prev.filter(m => m.id !== selectedMsg.id));
                    toast.success('Mensagem apagada');
                  }
                  setSelectedMsgId(null);
                }} title="Apagar">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          );
        })()}

        {/* Messages & Call Records Timeline.
            overflow-hidden: o ScrollArea filho tem h-[50vh] fixa; quando o composer
            cresce e este wrapper encolhe (min-h-0), sem o clip as mensagens vazavam
            por cima do campo de texto. */}
        <div className="flex-1 min-h-0 px-4 overflow-hidden">
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
                    <div key={msg.id} data-msg-id={msg.id}>
                      {showDateSep && (
                        <div className="flex justify-center my-2">
                          <span className="text-[10px] bg-muted px-2 py-0.5 rounded-full text-muted-foreground">{dateLabel}</span>
                        </div>
                      )}
                      <div className={cn("flex", isInbound ? "justify-start" : "justify-end")}>
                        <div
                          className={cn(
                            "max-w-[80%] rounded-lg px-3 py-1.5 text-xs select-text transition-all",
                            isInbound
                              ? "bg-muted text-foreground rounded-tl-none"
                              : "bg-primary text-primary-foreground rounded-tr-none",
                            selectedMsgId === msg.id && "ring-2 ring-primary/50 opacity-80",
                            flashMsgId === msg.id && "ring-2 ring-yellow-400"
                          )}
                          onPointerDown={() => {
                            longPressTimer.current = setTimeout(() => {
                              setSelectedMsgId(msg.id);
                            }, 500);
                          }}
                          onPointerUp={() => { if (longPressTimer.current) clearTimeout(longPressTimer.current); }}
                          onPointerLeave={() => { if (longPressTimer.current) clearTimeout(longPressTimer.current); }}
                          onClick={() => {
                            if (selectedMsgId && selectedMsgId !== msg.id) {
                              setSelectedMsgId(msg.id);
                            }
                          }}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            setSelectedMsgId(msg.id);
                          }}
                        >
                          {isPrivateAllView && msg.instance_name && (() => {
                            const owner = instanceOwners[msg.instance_name.toLowerCase()] || msg.instance_name;
                            return (
                              <p className={cn('text-[9px] font-semibold mb-0.5', isInbound ? 'text-emerald-600 dark:text-emerald-400' : 'text-primary-foreground/80')}>
                                {isInbound ? `Cliente → ${owner}` : owner}
                              </p>
                            );
                          })()}
                          {renderMediaContent(msg)}
                          {!msg.media_url && msg.media_type && !msg.message_text && (
                            <span className="italic text-[10px] opacity-70">
                              {msg.media_type === 'image' ? '📷 Imagem' : msg.media_type === 'audio' ? '🎵 Áudio' : msg.media_type === 'video' ? '🎬 Vídeo' : msg.media_type === 'document' ? '📄 Documento' : '📎 Mídia'}
                            </span>
                          )}
                          {msg.message_text && (
                            <p className="whitespace-pre-wrap break-words">
                              {msg.message_type === 'audio' && (
                                <span className="text-[10px] font-medium opacity-70 block mb-0.5">🎤 Transcrição:</span>
                              )}
                              {msg.message_text}
                            </p>
                          )}
                          <div className="flex items-center gap-0.5 mt-0.5 flex-wrap">
                            <p className={cn("text-[9px] mr-1", isInbound ? "text-muted-foreground" : "text-primary-foreground/70")}>
                              {format(parseISO(msg.created_at), 'HH:mm')}
                            </p>
                            {msg.message_text && (
                              <>
                                <button
                                  type="button"
                                  title="Copiar texto"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    navigator.clipboard.writeText(msg.message_text!);
                                    toast.success('Mensagem copiada!');
                                  }}
                                  className={cn(
                                    "inline-flex items-center gap-1 text-[9px] px-1 py-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10 transition-colors",
                                    isInbound ? "text-muted-foreground" : "text-primary-foreground/70"
                                  )}
                                >
                                  <Copy className="h-2.5 w-2.5" /> Copiar
                                </button>
                                <button
                                  type="button"
                                  title="Sugerir resposta a esta mensagem com IA"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setReplySuggestTarget(msg.message_text || '');
                                    setReplySuggestOpen(true);
                                  }}
                                  className={cn(
                                    "inline-flex items-center gap-1 text-[9px] px-1 py-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10 transition-colors",
                                    isInbound ? "text-muted-foreground" : "text-primary-foreground/70"
                                  )}
                                >
                                  <Sparkles className="h-2.5 w-2.5" /> Responder c/ IA
                                </button>
                                <button
                                  type="button"
                                  title="Criar atividade a partir desta mensagem"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openActivityFromMessage(msg.message_text || '');
                                  }}
                                  className={cn(
                                    "inline-flex items-center gap-1 text-[9px] px-1 py-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10 transition-colors",
                                    isInbound ? "text-muted-foreground" : "text-primary-foreground/70"
                                  )}
                                >
                                  <ClipboardList className="h-2.5 w-2.5" /> Atividade
                                </button>
                              </>
                            )}
                            {msg.media_url && (
                              <button
                                type="button"
                                title="Baixar"
                                onClick={(e) => bindDownload(msg.media_url!)(e)}
                                className={cn(
                                  "inline-flex items-center gap-1 text-[9px] px-1 py-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10 transition-colors",
                                  isInbound ? "text-muted-foreground" : "text-primary-foreground/70"
                                )}
                              >
                                <Download className="h-2.5 w-2.5" /> Baixar
                              </button>
                            )}
                          </div>
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
            {isPrivateAllView && privateInstances.length > 1 && (
              <Select value={sendAsInstance} onValueChange={setSendAsInstance}>
                <SelectTrigger className="h-7 w-[170px] text-xs" title="Por qual número da equipe a resposta será enviada">
                  <SelectValue placeholder="Enviar pela instância" />
                </SelectTrigger>
                <SelectContent>
                  {privateInstances.map(inst => (
                    <SelectItem key={inst} value={inst}>{instanceOwners[inst.toLowerCase()] || inst}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
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

          {/* Cobrança armada — mesma faixa da conversa completa: o texto no
              campo sozinho não diz que vai citar a promessa nem que entra no
              histórico da pendência. */}
          {cobranca && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50/70 dark:bg-amber-950/30 px-2.5 py-2 mb-2">
              <Bell className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-medium text-amber-800 dark:text-amber-300 break-words">
                  Cobrando: {cobranca.item.title}
                </p>
                <p className="text-[10px] text-amber-700/80 dark:text-amber-400/80">
                  {cobranca.replyExternalId
                    ? 'Vai sair respondendo à mensagem em que ele prometeu.'
                    : 'Sem a mensagem original em mão — vai sair como mensagem normal.'}
                  {' '}Ao enviar, entra no histórico da pendência.
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0 text-amber-700 hover:text-destructive"
                title="Cancelar cobrança (a mensagem continua no campo)"
                onClick={() => setCobranca(null)}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}

          {/* Input row */}
          {isRecording ? (
            <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2">
              <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={cancelRecording} title="Cancelar">
                <X className="h-4 w-4" />
              </Button>
              <span className="h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse" />
              <span className="text-sm flex-1 text-muted-foreground">
                Gravando... {Math.floor(recordingTime / 60).toString().padStart(2, '0')}:{(recordingTime % 60).toString().padStart(2, '0')}
              </span>
              <Button size="icon" className="h-9 w-9 bg-green-600 hover:bg-green-700" onClick={stopRecording} title="Enviar áudio">
                <Send className="h-4 w-4" />
              </Button>
            </div>
          ) : (
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
              <AITextActions value={newMessage} onChange={setNewMessage} />
              <AISuggestReply buildContext={buildReplyContext} getState={buildReplyState} onApply={setNewMessage} />
              {/* Instância controlada: sugestão focada numa mensagem específica (botão por bolha). */}
              <AISuggestReply
                buildContext={buildReplyContext}
                getState={buildReplyState}
                onApply={setNewMessage}
                open={replySuggestOpen}
                onOpenChange={setReplySuggestOpen}
                targetMessage={replySuggestTarget}
                hideTrigger
              />
              <Textarea
                ref={messageInputRef}
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Digite uma mensagem..."
                className="min-h-[40px] max-h-40 resize-none overflow-y-auto text-sm flex-1 min-w-0 leading-relaxed"
                rows={1}
              />
              {newMessage.trim() ? (
                <Button
                  size="icon"
                  className="shrink-0 h-10 w-10 bg-green-600 hover:bg-green-700"
                  onClick={handleSend}
                  disabled={sending}
                >
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              ) : (
                <Button
                  size="icon"
                  variant="ghost"
                  className="shrink-0 h-10 w-10 text-muted-foreground hover:text-foreground"
                  onClick={startRecording}
                  disabled={uploadingMedia || !phone}
                  title="Gravar áudio"
                >
                  <Mic className="h-4 w-4" />
                </Button>
              )}
            </div>
          )}
        </div>
      </DrawerContent>
    </Drawer>

    {/* Lead Edit Dialog */}
    <LeadEditDialog
      open={showLeadEdit}
      onOpenChange={(open) => {
        setShowLeadEdit(open);
        if (!open && phone) {
          // Refresh lead data — pelo id quando já sabemos qual é o lead
          // (conversa de grupo não casa por lead_phone).
          if (linkedLead?.id) {
            externalSupabase.from('leads').select('*').eq('id', linkedLead.id).maybeSingle()
              .then(({ data }) => { if (data) setLinkedLead(data as any); });
            return;
          }
          const normalizedPhone = phone.replace(/\D/g, '');
          const last8 = normalizedPhone.slice(-8);
          externalSupabase.from('leads').select('*')
            .or(`lead_phone.eq.${normalizedPhone},lead_phone.ilike.%${last8}%`)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()
            .then(({ data }) => { if (data) setLinkedLead(data as any); });
        }
      }}
      initialTab={leadEditTab}
      lead={linkedLead}
      onSave={async (leadId, updates) => {
        const { error } = await externalSupabase.from('leads').update(updates as any).eq('id', leadId);
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
        if (!open) refreshLinkedContact();
      }}
      onContactUpdated={refreshLinkedContact}
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

    {/* Group Members Dialog (membros + ações) */}
    {isGroupChat && (
      <GroupMembersDialog
        open={showGroupMembers}
        onOpenChange={setShowGroupMembers}
        conversationPhone={phone}
        instanceName={instanceName || messages.find(m => m.instance_name)?.instance_name || null}
        leadId={linkedLead?.id || null}
        isGroup={true}
        messageParticipants={[]}
        onOpenChat={onOpenChat ? (memberPhone) => { onOpenChange(false); onOpenChat(memberPhone); } : undefined}
      />
    )}
    <MediaLightbox url={lightboxUrl} title="Documento" onClose={() => setLightboxUrl(null)} />

    {/* Criar atividade (mesmo formulário da aba WhatsApp) */}
    <WhatsAppActivitySheet
      open={showActivitySheet}
      onOpenChange={(o) => {
        setShowActivitySheet(o);
        if (!o) {
          setActivityPrefill('');
          setActivityPrefillFields({});
          commitmentOriginRef.current = null;
        }
      }}
      defaultLeadId={linkedLead?.id}
      defaultLeadName={linkedLead?.lead_name || undefined}
      defaultContactId={linkedContact?.id}
      defaultContactName={linkedContact?.full_name || contactName || undefined}
      defaultDictationText={activityPrefill || undefined}
      defaultTitle={activityPrefillFields.title}
      defaultNotes={activityPrefillFields.notes}
      defaultDeadline={activityPrefillFields.deadline}
      defaultAssignedTo={activityPrefillFields.assignedTo}
      onActivityCreated={async (_title, _type, _leadName, activityId) => {
        // Fecha o ciclo da pendência: ela segue aberta com o cliente, mas sai
        // da fila de cobrança porque já existe tarefa nossa cuidando disso.
        const origem = commitmentOriginRef.current;
        commitmentOriginRef.current = null;
        if (!origem || !activityId) return;
        try {
          await commitments.markConverted(origem, activityId);
          toast.success('Pendência marcada como tratada — virou atividade');
        } catch {
          toast.error('Atividade criada, mas não consegui marcar a pendência como tratada.');
        }
      }}
    />

    {/* Quem cuida da pendência — mesma troca da caixa de pendências. */}
    <CommitmentAssigneeDialog
      item={trocandoDono}
      onClose={() => setTrocandoDono(null)}
      profiles={teamProfiles}
      onSave={(extId) => commitments.setAssignee(trocandoDono!.id, extId)}
    />

    {/* Ficha da atividade gerada pela pendência — abre ao lado, sem sair da conversa. */}
    {openActivityId && (
      <Suspense fallback={null}>
        <ActivityFullSheet
          open
          onOpenChange={(o) => { if (!o) setOpenActivityId(null); }}
          activityId={openActivityId}
          side="left"
        />
      </Suspense>
    )}
    </>
  );
}