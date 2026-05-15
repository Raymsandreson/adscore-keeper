import { useState, useRef, useEffect, useMemo } from 'react';
import { WhatsAppConversation } from '@/hooks/useWhatsAppMessages';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Send, User, Users, Link2, UserPlus, ExternalLink, Plus, Loader2, Phone, PhoneIncoming, PhoneOutgoing, PhoneMissed, Clock, X, Lock, LockOpen, Share2, Sparkles, Scale, MoreVertical, FileSignature, Download, Paperclip, Mic, MapPin, Image, FileUp, Trash2, StopCircle, StickyNote, MessageSquare, AtSign, MessageCircle, ClipboardList, Search, ArrowLeft, Bot, BotOff, VolumeX, Volume2, BellOff, Pencil, RefreshCw } from 'lucide-react';
import { FastForward, FileText } from 'lucide-react';
import { DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger } from '@/components/ui/dropdown-menu';
import { useWhatsAppInternalNotes } from '@/hooks/useWhatsAppInternalNotes';
import { openZapSignDialog } from '@/lib/zapsignDialogEvent';
import { SessionFieldEditor } from './SessionFieldEditor';
import { GroupMembersDialog } from './GroupMembersDialog';
import { WhatsAppConversationShareDialog } from './WhatsAppConversationShareDialog';
import { CopyableText } from '@/components/ui/copyable-text';
import { WhatsAppLeadPreview } from './WhatsAppLeadPreview';
import { WhatsAppLeadProgressBar } from './WhatsAppLeadProgressBar';
import { LeadEditDialog } from '@/components/kanban/LeadEditDialog';
import { WhatsAppCallRecorder } from './WhatsAppCallRecorder';
import { format, isToday, isYesterday, isSameDay } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { WhatsAppMediaGallery } from './WhatsAppMediaGallery';
import { cn } from '@/lib/utils';
import { canonicalizeChatTarget } from '@/lib/whatsappPhone';
import { supabase } from '@/integrations/supabase/client';
import { externalSupabase } from '@/integrations/supabase/external-client';
import { toast } from 'sonner';
import { useAuthContext } from '@/contexts/AuthContext';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';
import { useKanbanBoards } from '@/hooks/useKanbanBoards';
import { logGroupAudit } from '@/lib/groupAuditLog';

const TREATMENT_OPTIONS = ['', 'Dr.', 'Dra.', 'Sr.', 'Sra.', 'Prof.', 'Profa.'];
const NAME_FORMAT_OPTIONS = [
  { value: 'full', label: 'Nome completo' },
  { value: 'first', label: 'Primeiro nome' },
  { value: 'first_last', label: 'Primeiro e último' },
  { value: 'nickname', label: 'Apelido' },
];

interface ConvShareInfo {
  phone: string;
  instance_name: string;
  identify_sender: boolean;
  can_reshare: boolean;
  shared_by: string;
}

interface Props {
  conversation: WhatsAppConversation;
  onBack?: () => void;
  onSendMessage: (
    phone: string,
    message: string,
    contactId?: string,
    leadId?: string,
    conversationInstanceName?: string | null,
    identifySender?: boolean,
    chatId?: string,
    treatmentOverride?: string | null,
    nameFormatOverride?: string,
    nicknameOverride?: string | null
  ) => Promise<boolean>;
  onSendMedia: (
    phone: string, mediaUrl: string, mediaType: string, caption?: string, fileName?: string,
    contactId?: string, leadId?: string, conversationInstanceName?: string | null, chatId?: string
  ) => Promise<boolean>;
  onSendLocation: (
    phone: string, latitude: number, longitude: number, name?: string, address?: string,
    contactId?: string, leadId?: string, conversationInstanceName?: string | null, chatId?: string
  ) => Promise<boolean>;
  onDeleteMessage: (messageId: string, instanceName?: string | null, externalMessageId?: string | null) => Promise<boolean>;
  onLinkToLead: (phone: string, leadId: string) => void;
  onLinkToContact: (phone: string, contactId: string) => void;
  onCreateLead: () => void;
  onCreateContact: () => void;
  onCreateCase?: () => void;
  extractingData?: boolean;
  extractionStep?: string;
  onCreateActivity?: (leadId: string, leadName: string, contactId?: string, contactName?: string) => void;
  onNavigateToLead?: (leadId: string) => void;
  onViewContact?: (contactId: string) => void;
  onPrivacyChanged?: () => void;
  shareInfo?: ConvShareInfo | null;
  onUpdateWithAI?: () => void;
  onOpenChat?: (phone: string) => void;
  onClearConversation?: (phone: string, instanceName?: string) => Promise<boolean>;
}

export function WhatsAppChat({ conversation, onBack, onSendMessage, onSendMedia, onSendLocation, onDeleteMessage, onLinkToLead, onLinkToContact, onCreateLead, onCreateContact, onCreateCase, extractingData, extractionStep, onCreateActivity, onNavigateToLead, onViewContact, onPrivacyChanged, shareInfo, onUpdateWithAI, onOpenChat, onClearConversation }: Props) {
  const { profile } = useAuthContext();
  const { boards: kanbanBoards } = useKanbanBoards();
  const [newMessage, setNewMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [showLinkDialog, setShowLinkDialog] = useState(false);
  const [showLeadPanel, setShowLeadPanel] = useState(false);
  const [showLeadEdit, setShowLeadEdit] = useState(false);
  const [editingLeadData, setEditingLeadData] = useState<any | null>(null);
  const [contactLinkedLeadIds, setContactLinkedLeadIds] = useState<string[]>([]);
  const [leads, setLeads] = useState<Array<{ id: string; lead_name: string | null; lead_phone: string | null }>>([]);
  const [selectedLeadId, setSelectedLeadId] = useState('');
  const [leadSearchQuery, setLeadSearchQuery] = useState('');
  const [selectedRelationship, setSelectedRelationship] = useState('');
  const [selectedParticipantPhone, setSelectedParticipantPhone] = useState('');
  const [callRecords, setCallRecords] = useState<any[]>([]);
  const [identifySender, setIdentifySender] = useState(true);
  const [treatmentTitle, setTreatmentTitle] = useState<string>('');
  const [nameFormat, setNameFormat] = useState<string>('first_last');
  const [nicknames, setNicknames] = useState<string[]>([]);
  const [selectedNickname, setSelectedNickname] = useState<string>('');
  const [newNickname, setNewNickname] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [togglingPrivate, setTogglingPrivate] = useState(false);
  const [showGroupMembers, setShowGroupMembers] = useState(false);
  
  const [showSessionEditor, setShowSessionEditor] = useState(false);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [linkedGroupId, setLinkedGroupId] = useState<string | null>(null);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [showLocationDialog, setShowLocationDialog] = useState(false);
  const [locationName, setLocationName] = useState('');
  const [locationAddress, setLocationAddress] = useState('');
  const [locationLat, setLocationLat] = useState('');
  const [locationLng, setLocationLng] = useState('');
  const [deletingMessageId, setDeletingMessageId] = useState<string | null>(null);
  const [resyncingMsgId, setResyncingMsgId] = useState<string | null>(null);
  const [bulkResyncing, setBulkResyncing] = useState(false);
  const [bulkResyncProgress, setBulkResyncProgress] = useState<{ done: number; total: number } | null>(null);
  const [savingDriveMsgId, setSavingDriveMsgId] = useState<string | null>(null);
  const [driveTargetMsg, setDriveTargetMsg] = useState<any | null>(null);
  const [showDriveTargetDialog, setShowDriveTargetDialog] = useState(false);
  const [creatingDriveLead, setCreatingDriveLead] = useState(false);
  // Marca local de mensagens salvas no Drive nesta sessão (id -> link)
  const [driveSavedById, setDriveSavedById] = useState<Record<string, { link?: string; name?: string }>>({});

  const runDriveUpload = async (msg: any, leadId: string, leadNameInput?: string) => {
    if (!msg?.media_url) {
      toast.error('Mensagem sem mídia para salvar.');
      return;
    }
    setSavingDriveMsgId(msg.id);
    const tId = toast.loading('Enviando para o Google Drive…');
    try {
      let leadName = leadNameInput;
      if (!leadName) {
        const { data: leadRow } = await externalSupabase
          .from('leads')
          .select('lead_name')
          .eq('id', leadId)
          .maybeSingle();
        leadName = (leadRow as any)?.lead_name || conversation.contact_name || 'Lead';
      }

      const urlBase = (msg.media_url.split('/').pop()?.split('?')[0]) || '';
      const hasExt = /\.[a-z0-9]{2,5}$/i.test(urlBase);
      const mime = msg.media_type || '';
      const extFromMime = mime.includes('pdf') ? '.pdf'
        : mime.startsWith('image/jpeg') ? '.jpg'
        : mime.startsWith('image/png') ? '.png'
        : mime.startsWith('image/webp') ? '.webp'
        : mime.startsWith('video/') ? '.mp4'
        : mime.startsWith('audio/') ? '.ogg'
        : '';
      const baseName = (msg.message_text && msg.message_text.length < 120 ? msg.message_text : urlBase || `whatsapp_${msg.id}`).replace(/[\\/:*?"<>|]/g, '_');
      const fileName = hasExt ? baseName : `${baseName}${extFromMime}`;

      const { data: upData, error: upErr } = await supabase.functions.invoke('lead-drive', {
        body: {
          action: 'upload_url',
          lead_id: leadId,
          lead_name: leadName,
          file_name: fileName,
          source_url: msg.media_url,
          mime_type: mime || undefined,
        },
      });
      if (upErr) throw upErr;
      if ((upData as any)?.error) throw new Error((upData as any).error);
      const file = (upData as any).file;

      let analyzedName: string | null = null;
      try {
        const { data: anData } = await supabase.functions.invoke('lead-drive', {
          body: {
            action: 'analyze_file',
            lead_id: leadId,
            lead_name: leadName,
            file_id: file.id,
          },
        });
        analyzedName = ((anData as any)?.renamed as string) || null;
      } catch (e) {
        console.warn('[saveToDrive] analyze_file falhou:', e);
      }

      toast.success(
        `Salvo no Drive: ${analyzedName || file.name}`,
        {
          id: tId,
          action: file.webViewLink
            ? { label: 'Abrir', onClick: () => window.open(file.webViewLink, '_blank') }
            : undefined,
        },
      );
    } catch (err: any) {
      console.error('[saveToDrive] erro:', err);
      toast.error(`Erro ao salvar no Drive: ${err.message || err}`, { id: tId });
    } finally {
      setSavingDriveMsgId(null);
    }
  };

  const handleSaveToDrive = async (msg: any) => {
    if (!msg.media_url) {
      toast.error('Mensagem sem mídia para salvar.');
      return;
    }
    if (conversation.lead_id) {
      await runDriveUpload(msg, conversation.lead_id);
      return;
    }
    // Sem lead vinculado: abre seletor / criação
    setDriveTargetMsg(msg);
    setLeadSearchQuery('');
    setSelectedLeadId('');
    setShowDriveTargetDialog(true);
    fetchLeads('');
  };

  const handlePickExistingLeadForDrive = async () => {
    if (!selectedLeadId) return;
    const lead = leads.find(l => l.id === selectedLeadId);
    const leadName = (lead as any)?.lead_name;
    setShowDriveTargetDialog(false);
    try { onLinkToLead(conversation.phone, selectedLeadId); } catch (e) { console.warn('link conversa falhou:', e); }
    if (pendingBatchAfterLead) {
      setPendingBatchAfterLead(false);
      await runBatchDriveUpload(selectedLeadId, leadName);
      return;
    }
    if (!driveTargetMsg) return;
    const msg = driveTargetMsg;
    setDriveTargetMsg(null);
    await runDriveUpload(msg, selectedLeadId, leadName);
  };

  const handleCreateLeadForDrive = async () => {
    setCreatingDriveLead(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const fallbackName = isGroup
        ? (conversation.contact_name || `Grupo ${conversation.phone}`)
        : (conversation.contact_name || `Contato ${conversation.phone}`);
      const extCreatedBy = user?.id || null;
      const { data: newLead, error } = await externalSupabase
        .from('leads')
        .insert({
          lead_name: fallbackName,
          lead_phone: isGroup ? null : conversation.phone,
          source: 'whatsapp',
          lead_status: 'new',
          created_by: extCreatedBy,
          notes: 'Lead criado automaticamente para salvar documento no Drive.',
        } as any)
        .select('id, lead_name')
        .single();
      if (error) throw error;
      setShowDriveTargetDialog(false);
      try { onLinkToLead(conversation.phone, (newLead as any).id); } catch (e) { console.warn('link conversa falhou:', e); }
      toast.success(`Lead "${(newLead as any).lead_name}" criado`);
      if (pendingBatchAfterLead) {
        setPendingBatchAfterLead(false);
        await runBatchDriveUpload((newLead as any).id, (newLead as any).lead_name);
        return;
      }
      if (!driveTargetMsg) return;
      const msg = driveTargetMsg;
      setDriveTargetMsg(null);
      await runDriveUpload(msg, (newLead as any).id, (newLead as any).lead_name);
    } catch (e: any) {
      console.error('[saveToDrive] criar lead falhou:', e);
      toast.error(`Erro ao criar lead: ${e?.message || e}`);
    } finally {
      setCreatingDriveLead(false);
    }
  };

  // ===== Seleção múltipla de mídias para Drive =====
  const [driveSelectionMode, setDriveSelectionMode] = useState(false);
  // Ordem da seleção segue a sequência de cliques (1º clique = #1, 2º = #2…)
  const [selectionOrder, setSelectionOrder] = useState<string[]>([]);
  const selectedDriveMsgIds = useMemo(() => new Set(selectionOrder), [selectionOrder]);
  const getSelectionIndex = (msgId: string) => {
    const i = selectionOrder.indexOf(msgId);
    return i === -1 ? null : i + 1;
  };
  const [showBatchDriveDialog, setShowBatchDriveDialog] = useState(false);
  const [batchDriveMode, setBatchDriveMode] = useState<'merge' | 'separate'>('merge');
  const [batchFileName, setBatchFileName] = useState('');
  const [aiNamingFile, setAiNamingFile] = useState(false);
  const [batchUploading, setBatchUploading] = useState(false);
  const [pendingBatchAfterLead, setPendingBatchAfterLead] = useState(false);
  const [batchDriveOrder, setBatchDriveOrder] = useState<Array<{ id: string; media_url: string; media_type: string; message_text: string; message_type: string }>>([]);
  const [batchAnalysis, setBatchAnalysis] = useState<{ type?: string; title?: string; holder_name?: string | null; holder_cpf?: string | null; description?: string | null; pages_label?: string | null } | null>(null);

  // Long-press p/ ativar seleção (mobile) — usa um único timer compartilhado
  const longPressTimerRef = useRef<number | null>(null);
  const longPressFiredRef = useRef(false);
  const startLongPress = (msgId: string) => {
    longPressFiredRef.current = false;
    if (longPressTimerRef.current) window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = window.setTimeout(() => {
      longPressFiredRef.current = true;
      setDriveSelectionMode(true);
      setSelectionOrder(prev => prev.includes(msgId) ? prev : [...prev, msgId]);
    }, 450);
  };
  const cancelLongPress = () => {
    if (longPressTimerRef.current) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const toggleDriveSelection = (msgId: string) => {
    setSelectionOrder(prev => prev.includes(msgId) ? prev.filter(x => x !== msgId) : [...prev, msgId]);
  };

  const exitDriveSelection = () => {
    setDriveSelectionMode(false);
    setSelectionOrder([]);
    setBatchDriveOrder([]);
    setBatchAnalysis(null);
  };

  // Pede pra IA analisar TODAS as mídias selecionadas (imagens) e devolver
  // título + titular + descrição. Filename = só o título (titular já está dentro do doc).
  const analyzeBatchWithAi = async (selected: Array<any>) => {
    const imgs = selected.filter((m: any) => {
      const mt = (m.media_type || '').toLowerCase();
      return mt.startsWith('image/'); // PDFs não dá pra mandar como image_url
    });
    if (imgs.length === 0) return;
    setAiNamingFile(true);
    setBatchAnalysis(null);
    try {
      const total = imgs.length;
      const urls = imgs.map((m: any, i: number) => ({
        url: m.media_url,
        label: `página ${i + 1} de ${total}`,
      }));
      const { data } = await supabase.functions.invoke('classify-document', {
        body: { urls, name: imgs[0].message_text || '' },
      });
      const a = data as any;
      if (a?.success) {
        setBatchAnalysis({
          type: a.type,
          title: a.title,
          holder_name: a.holder_name,
          holder_cpf: a.holder_cpf,
          description: a.description,
          pages_label: a.pages_label,
        });
        if (a.title) {
          const holder = a.holder_name ? ` - ${String(a.holder_name).trim()}` : '';
          const composed = `${String(a.title)}${holder}`.replace(/[\\/:*?"<>|]/g, '_').slice(0, 120);
          setBatchFileName(composed);
        }
      }
    } catch (e) {
      console.warn('[ai-analyze-batch] falhou:', e);
    } finally {
      setAiNamingFile(false);
    }
  };

  const openBatchDialogIfReady = () => {
    if (selectionOrder.length === 0) return;
    // Mantém ordem de clique
    const msgMap = new Map((messages || []).map((m: any) => [m.id, m]));
    const selected = selectionOrder
      .map((id) => msgMap.get(id))
      .filter((m: any) => m && m.media_url && !isEncUrl(m.media_url));
    if (selected.length === 0) return;
    const today = new Date().toISOString().slice(0, 10);
    setBatchFileName(`Documentos ${today}`.replace(/[\\/:*?"<>|]/g, '_'));
    setBatchDriveMode('merge');
    setBatchAnalysis(null);
    setBatchDriveOrder(selected.map((m: any) => ({ id: m.id, media_url: m.media_url, media_type: m.media_type || '', message_text: m.message_text || '', message_type: m.message_type })));
    setShowBatchDriveDialog(true);
    // Dispara IA p/ analisar conteúdo + sugerir título
    void analyzeBatchWithAi(selected);
  };

  const runBatchDriveUpload = async (leadId: string, leadNameInput?: string) => {
    const selected = batchDriveOrder;
    if (selected.length === 0) {
      toast.error('Nenhuma mídia válida selecionada.');
      return;
    }
    setBatchUploading(true);
    const tId = toast.loading(`Enviando ${selected.length} arquivo(s) para o Drive…`);
    try {
      let leadName = leadNameInput;
      if (!leadName) {
        const { data: leadRow } = await externalSupabase
          .from('leads').select('lead_name').eq('id', leadId).maybeSingle();
        leadName = (leadRow as any)?.lead_name || conversation.contact_name || 'Lead';
      }

      if (batchDriveMode === 'merge') {
        const sources = selected
          .filter((m: any) => {
            const mt = (m.media_type || '').toLowerCase();
            return mt.includes('pdf') || mt.startsWith('image/');
          })
          .map((m: any) => ({ url: m.media_url, mime_type: m.media_type || undefined }));
        if (sources.length === 0) {
          toast.error('Selecione imagens ou PDFs para juntar (vídeo/áudio não viram PDF).', { id: tId });
          return;
        }
        const finalName = batchFileName.trim() || `Documentos ${Date.now()}`;
        const { data, error } = await supabase.functions.invoke('lead-drive', {
          body: {
            action: 'merge_pdf_upload',
            lead_id: leadId,
            lead_name: leadName,
            file_name: finalName,
            sources,
          },
        });
        if (error) throw error;
        if ((data as any)?.error) throw new Error((data as any).error);
        const file = (data as any).file;
        const skipped = ((data as any)?.skipped || []) as Array<{ url: string; reason: string }>;
        toast.success(
          `PDF salvo: ${file.name}${skipped.length ? ` (${skipped.length} ignorado${skipped.length > 1 ? 's' : ''})` : ''}`,
          {
            id: tId,
            action: file.webViewLink ? { label: 'Abrir', onClick: () => window.open(file.webViewLink, '_blank') } : undefined,
          },
        );
      } else {
        let okCount = 0;
        const errors: string[] = [];
        for (const m of selected) {
          try {
            const urlBase = (m.media_url.split('/').pop()?.split('?')[0]) || '';
            const hasExt = /\.[a-z0-9]{2,5}$/i.test(urlBase);
            const mime = m.media_type || '';
            const extFromMime = mime.includes('pdf') ? '.pdf'
              : mime.startsWith('image/jpeg') ? '.jpg'
              : mime.startsWith('image/png') ? '.png'
              : mime.startsWith('image/webp') ? '.webp'
              : mime.startsWith('video/') ? '.mp4'
              : mime.startsWith('audio/') ? '.ogg' : '';
            const baseName = (m.message_text && m.message_text.length < 100 ? m.message_text : urlBase || `whatsapp_${m.id}`).replace(/[\\/:*?"<>|]/g, '_');
            const fileName = hasExt ? baseName : `${baseName}${extFromMime}`;
            const { data, error } = await supabase.functions.invoke('lead-drive', {
              body: { action: 'upload_url', lead_id: leadId, lead_name: leadName, file_name: fileName, source_url: m.media_url, mime_type: mime || undefined },
            });
            if (error || (data as any)?.error) throw new Error((data as any)?.error || error?.message);
            okCount++;
          } catch (e: any) {
            errors.push(e?.message || String(e));
          }
        }
        if (okCount > 0) {
          toast.success(`${okCount} arquivo(s) salvos no Drive${errors.length ? ` — ${errors.length} falha(s)` : ''}`, { id: tId });
        } else {
          toast.error(`Falha ao salvar: ${errors[0] || 'erro desconhecido'}`, { id: tId });
        }
      }
      setShowBatchDriveDialog(false);
      exitDriveSelection();
    } catch (err: any) {
      console.error('[batchSaveToDrive] erro:', err);
      toast.error(`Erro ao salvar no Drive: ${err.message || err}`, { id: tId });
    } finally {
      setBatchUploading(false);
    }
  };

  const handleConfirmBatchDrive = async () => {
    if (conversation.lead_id) {
      await runBatchDriveUpload(conversation.lead_id);
      return;
    }
    setShowBatchDriveDialog(false);
    setPendingBatchAfterLead(true);
    setLeadSearchQuery('');
    setSelectedLeadId('');
    setShowDriveTargetDialog(true);
    fetchLeads('');
  };

  const isEncUrl = (u?: string | null) => !!u && /\.enc(?:\?|$)/i.test(u);
  const isMissingMedia = (m: any) =>
    ['image', 'video', 'audio', 'document'].includes(m?.message_type) &&
    (!m.media_url || isEncUrl(m.media_url));

  const handleResyncMedia = async (msg: any) => {
    if (resyncingMsgId) return;
    setResyncingMsgId(msg.id);
    const t = toast.loading('Sincronizando mídia...');
    try {
      const rawId = msg.external_message_id?.split(':').pop();
      const { data, error } = await supabase.functions.invoke('whatsapp-fetch-history', {
        body: {
          phone: conversation.phone,
          instance_name: conversation.instance_name,
          mode: rawId ? 'exact' : 'history',
          messageid: rawId,
          count: 5,
        },
      });
      if (error) throw error;
      if (data?.success === false) throw new Error(data?.error || 'Falha ao sincronizar');
      toast.success('Sync solicitado! A mídia chega em alguns segundos.', { id: t });
    } catch (e: any) {
      toast.error(e?.message || 'Erro ao sincronizar mídia', { id: t });
    } finally {
      setResyncingMsgId(null);
    }
  };

  const handleBulkResyncMissingMedia = async () => {
    if (bulkResyncing) return;
    const missing = (conversation.messages || []).filter((m: any) => isMissingMedia(m) && m.external_message_id);
    if (missing.length === 0) {
      toast.info('Nenhuma mídia pendente nesta conversa');
      return;
    }
    setBulkResyncing(true);
    setBulkResyncProgress({ done: 0, total: missing.length });
    const t = toast.loading(`Sincronizando ${missing.length} mídia(s) antiga(s)...`);
    let ok = 0;
    let fail = 0;
    for (let i = 0; i < missing.length; i++) {
      const msg = missing[i];
      try {
        const rawId = msg.external_message_id?.split(':').pop();
        const { data, error } = await supabase.functions.invoke('whatsapp-fetch-history', {
          body: {
            phone: conversation.phone,
            instance_name: conversation.instance_name,
            mode: rawId ? 'exact' : 'history',
            messageid: rawId,
            count: 5,
          },
        });
        if (error || data?.success === false) fail++;
        else ok++;
      } catch {
        fail++;
      }
      setBulkResyncProgress({ done: i + 1, total: missing.length });
      // Throttle: 350ms entre chamadas para não saturar a UazAPI
      await new Promise((r) => setTimeout(r, 350));
    }
    toast.success(`Sync solicitado: ${ok} ok, ${fail} falha(s). As mídias chegam pelo webhook em alguns segundos.`, { id: t });
    setBulkResyncing(false);
    setBulkResyncProgress(null);
  };
  const [pastedImage, setPastedImage] = useState<{ file: File; previewUrl: string } | null>(null);
  const [pastedCaption, setPastedCaption] = useState('');
  const [inputMode, setInputMode] = useState<'message' | 'note' | 'chat'>('message');
  const [mentionUserId, setMentionUserId] = useState<string | null>(null);
  const [mentionUserName, setMentionUserName] = useState<string | null>(null);
  const [teamMembers, setTeamMembers] = useState<Array<{ user_id: string; full_name: string | null }>>([]);
  const [showMentionPicker, setShowMentionPicker] = useState(false);
  const [agentEnabled, setAgentEnabled] = useState(false);
  const [activeAgentName, setActiveAgentName] = useState<string | null>(null);
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null);
  const [humanPausedUntil, setHumanPausedUntil] = useState<string | null>(null);
  const [availableAgents, setAvailableAgents] = useState<Array<{ id: string; name: string }>>([]);
  const [agentLoading, setAgentLoading] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [muteType, setMuteType] = useState<string | null>(null);
  const [muteLoading, setMuteLoading] = useState(false);
  const [adOrigin, setAdOrigin] = useState<{ adset_name: string | null; ad_name: string | null; campaign_name: string | null } | null>(null);
  const { notes, addNote, deleteNote } = useWhatsAppInternalNotes(conversation.phone);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const conversationKeyRef = useRef<string>('');
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const messages = [...conversation.messages].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  // Fetch leads already linked to this contact (to hide redundant "Vincular Lead" actions)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!conversation.contact_id) {
        setContactLinkedLeadIds([]);
        return;
      }
      const { data } = await externalSupabase
        .from('contact_leads' as any)
        .select('lead_id')
        .eq('contact_id', conversation.contact_id);
      if (!cancelled) {
        setContactLinkedLeadIds(((data as any[]) || []).map(r => r.lead_id).filter(Boolean));
      }
    })();
    return () => { cancelled = true; };
  }, [conversation.contact_id]);

  const handleOpenLeadEdit = async () => {
    if (!conversation.lead_id) return;
    const { data, error } = await externalSupabase.from('leads').select('*').eq('id', conversation.lead_id).maybeSingle();
    if (data) {
      setEditingLeadData(data);
      setShowLeadEdit(true);
    } else {
      console.error('Lead não encontrado no banco externo', { lead_id: conversation.lead_id, error });
      toast.error('Lead não encontrado');
    }
  };

  // Fetch ad origin (adset/campaign) for header display
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!conversation.lead_id) {
        setAdOrigin(null);
        return;
      }
      const { data } = await externalSupabase
        .from('leads')
        .select('adset_name, ad_name, campaign_name')
        .eq('id', conversation.lead_id)
        .maybeSingle();
      if (cancelled) return;
      if (data && (data.adset_name || data.ad_name || data.campaign_name)) {
        setAdOrigin({
          adset_name: (data as any).adset_name || null,
          ad_name: (data as any).ad_name || null,
          campaign_name: (data as any).campaign_name || null,
        });
      } else {
        setAdOrigin(null);
      }
    })();
    return () => { cancelled = true; };
  }, [conversation.lead_id]);

  // Auto-fetch de histórico em background quando a instância da conversa
  // teve uma desconexão recente (últimos 7 dias) que cruza com a janela de
  // atividade desta conversa. Dispara silenciosamente, no máximo 1x por
  // (phone+instance) por sessão, com count=20 (leve).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const phone = conversation.phone;
      const instanceName = conversation.instance_name;
      if (!phone || !instanceName) return;

      const sessionKey = `wa-auto-history:${phone}__${instanceName.toLowerCase()}`;
      try {
        if (sessionStorage.getItem(sessionKey)) return;
      } catch {}

      try {
        // Janela da conversa (com folga de 1h dos dois lados)
        const lastAt = conversation.last_message_at
          ? new Date(conversation.last_message_at)
          : new Date();
        const convStart = new Date(lastAt.getTime() - 60 * 60 * 1000).toISOString();
        const convEnd = new Date(lastAt.getTime() + 60 * 60 * 1000).toISOString();
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

        // Procura desconexão da instância que cruza com a janela da conversa
        const { data: disconnects, error } = await externalSupabase
          .from('instance_connection_log' as any)
          .select('disconnected_at, reconnected_at')
          .ilike('instance_name', instanceName)
          .gte('disconnected_at', sevenDaysAgo)
          .lte('disconnected_at', convEnd)
          .limit(5);

        if (cancelled || error || !disconnects || disconnects.length === 0) return;

        // Confere se alguma desconexão termina (ou continua aberta) após o
        // início da janela — i.e. instância estava caída quando a conversa
        // estava ativa.
        const overlaps = (disconnects as any[]).some((d) => {
          const recoveredAt = d.reconnected_at ? new Date(d.reconnected_at).getTime() : Date.now();
          return recoveredAt >= new Date(convStart).getTime();
        });
        if (!overlaps) return;

        // Marca antes de disparar pra evitar corrida em re-render rápido
        try { sessionStorage.setItem(sessionKey, String(Date.now())); } catch {}

        console.log('[auto-history] Disparando fetch silencioso', { phone, instanceName });
        // Fire-and-forget — sem toast, sem bloquear UI
        supabase.functions.invoke('whatsapp-fetch-history', {
          body: { phone, instance_name: instanceName, count: 20 },
        }).catch((e) => console.warn('[auto-history] falhou:', e));
      } catch (e) {
        console.warn('[auto-history] erro ao verificar desconexão:', e);
      }
    })();
    return () => { cancelled = true; };
  }, [conversation.phone, conversation.instance_name, conversation.last_message_at]);

  // Fetch agent state for this conversation
  useEffect(() => {
    const fetchAgentState = async () => {
      const [{ data: agentsData }, { data: assignment }] = await Promise.all([
        supabase.from('whatsapp_ai_agents').select('id, name').eq('is_active', true).order('name'),
        supabase.from('whatsapp_conversation_agents').select('agent_id, is_active, human_paused_until')
          .eq('phone', conversation.phone).eq('instance_name', conversation.instance_name).maybeSingle()
      ]);
      setAvailableAgents((agentsData as any[]) || []);
      if (assignment) {
        setActiveAgentId((assignment as any).agent_id);
        setAgentEnabled((assignment as any).is_active);
        setHumanPausedUntil((assignment as any).human_paused_until || null);
        const agent = (agentsData as any[])?.find((a: any) => a.id === (assignment as any).agent_id);
        setActiveAgentName(agent?.name || null);
      } else {
        setActiveAgentId(null);
        setAgentEnabled(false);
        setActiveAgentName(null);
        setHumanPausedUntil(null);
      }
    };
    fetchAgentState();

    // Subscribe to realtime changes on conversation_agents for this phone
    const agentChannel = supabase
      .channel(`agent-pause-${conversation.phone}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'whatsapp_conversation_agents',
          filter: `phone=eq.${conversation.phone}`,
        },
        (payload: any) => {
          const row = payload.new;
          if (row.instance_name === conversation.instance_name) {
            setAgentEnabled(row.is_active);
            setHumanPausedUntil(row.human_paused_until || null);
            if (row.agent_id !== activeAgentId) {
              setActiveAgentId(row.agent_id);
              // Re-fetch agent name
              supabase.from('whatsapp_ai_agents').select('name').eq('id', row.agent_id).single()
                .then(({ data }) => { if (data) setActiveAgentName((data as any).name); });
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(agentChannel);
    };
  }, [conversation.phone, conversation.instance_name]);

  const handleAgentToggle = async () => {
    if (!activeAgentId) return;
    setAgentLoading(true);
    try {
      const newState = !agentEnabled;
      await supabase.from('whatsapp_conversation_agents')
        .update({ is_active: newState, human_paused_until: newState ? null : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString() } as any)
        .eq('phone', conversation.phone).eq('instance_name', conversation.instance_name);
      setAgentEnabled(newState);
      if (newState) setHumanPausedUntil(null);
      if (newState) {
        // Trigger AI reply from last inbound message
        try {
          const { data: lastInbound } = await supabase
            .from('whatsapp_messages')
            .select('message_text, message_type')
            .eq('phone', conversation.phone)
            .eq('instance_name', conversation.instance_name)
            .eq('direction', 'inbound')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          if (lastInbound) {
            await cloudFunctions.invoke('whatsapp-ai-agent-reply', {
              body: {
                phone: conversation.phone,
                instance_name: conversation.instance_name,
                message_text: lastInbound.message_text || '',
                message_type: lastInbound.message_type || 'text',
              },
            });
          }
        } catch (replyErr) {
          console.error('Error triggering agent reply on reactivation:', replyErr);
        }
      }
      toast.success(newState ? `🤖 Agente "${activeAgentName}" ativado e retomando...` : 'Agente desativado');
    } catch (e: any) { toast.error('Erro: ' + e.message); }
    finally { setAgentLoading(false); }
  };

  const handleSelectAgent = async (agentId: string) => {
    setAgentLoading(true);
    try {
      const agent = availableAgents.find(a => a.id === agentId);
      await supabase.from('whatsapp_conversation_agents')
        .upsert({ phone: conversation.phone, instance_name: conversation.instance_name, agent_id: agentId, is_active: true } as any, { onConflict: 'phone,instance_name' });
      setActiveAgentId(agentId);
      setActiveAgentName(agent?.name || null);
      setAgentEnabled(true);
      toast.success(`🤖 Agente "${agent?.name}" ativado`);
    } catch (e: any) { toast.error('Erro: ' + e.message); }
    finally { setAgentLoading(false); }
  };

  const handleRemoveAgent = async () => {
    setAgentLoading(true);
    try {
      await supabase.from('whatsapp_conversation_agents')
        .delete().eq('phone', conversation.phone).eq('instance_name', conversation.instance_name);
      setActiveAgentId(null); setActiveAgentName(null); setAgentEnabled(false);
      toast.success('Agente removido');
    } catch (e: any) { toast.error('Erro: ' + e.message); }
    finally { setAgentLoading(false); }
  };

  // ========== MUTE STATE (Cloud DB) ==========
  const CLOUD_URL = 'https://gliigkupoebmlbwyvijp.supabase.co';
  const CLOUD_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdsaWlna3Vwb2VibWxid3l2aWpwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYwMDAxNDcsImV4cCI6MjA4MTU3NjE0N30.HnhqYYFjW9DjFUsUkrZDuCShCOU2P73o_DqvkVyVr38';

  useEffect(() => {
    const fetchMuteState = async () => {
      try {
        const res = await fetch(
          `${CLOUD_URL}/rest/v1/whatsapp_muted_chats?phone=eq.${conversation.phone}&instance_name=eq.${encodeURIComponent(conversation.instance_name)}&select=mute_type&limit=1`,
          { headers: { 'apikey': CLOUD_ANON, 'Authorization': `Bearer ${CLOUD_ANON}` } }
        );
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          setIsMuted(true);
          setMuteType(data[0].mute_type);
        } else {
          setIsMuted(false);
          setMuteType(null);
        }
      } catch { /* ignore */ }
    };
    fetchMuteState();
  }, [conversation.phone, conversation.instance_name]);

  const handleToggleMute = async (newMuteType: string | null) => {
    setMuteLoading(true);
    try {
      if (newMuteType === null) {
        // Unmute
        await fetch(
          `${CLOUD_URL}/rest/v1/whatsapp_muted_chats?phone=eq.${conversation.phone}&instance_name=eq.${encodeURIComponent(conversation.instance_name)}`,
          { method: 'DELETE', headers: { 'apikey': CLOUD_ANON, 'Authorization': `Bearer ${CLOUD_ANON}` } }
        );
        setIsMuted(false);
        setMuteType(null);
        toast.success('🔔 Conversa reativada');
      } else {
        // Mute (upsert)
        await fetch(`${CLOUD_URL}/rest/v1/whatsapp_muted_chats`, {
          method: 'POST',
          headers: {
            'apikey': CLOUD_ANON,
            'Authorization': `Bearer ${CLOUD_ANON}`,
            'Content-Type': 'application/json',
            'Prefer': 'resolution=merge-duplicates',
          },
          body: JSON.stringify({
            phone: conversation.phone,
            instance_name: conversation.instance_name,
            mute_type: newMuteType,
            muted_by: profile?.full_name || null,
          }),
        });
        setIsMuted(true);
        setMuteType(newMuteType);
        const labels: Record<string, string> = { all: '🔇 Conversa silenciada (envio + recebimento)', receive: '🔇 Recebimento desativado', send: '🔇 Envio desativado' };
        toast.success(labels[newMuteType] || '🔇 Conversa silenciada');
      }
    } catch (e: any) {
      toast.error('Erro ao alterar mute: ' + e.message);
    } finally {
      setMuteLoading(false);
    }
  };


  const isGroup = messages.some(msg => {
    const meta = msg.metadata;
    if (!meta) return false;
    // UazAPI: chat.wa_isGroup or message.isGroup or chatid contains @g.us
    return meta?.chat?.wa_isGroup === true 
      || meta?.message?.isGroup === true 
      || (meta?.chat?.wa_chatid || '').includes('@g.us');
  });

  // Extract sender info from group message metadata (UazAPI format)
  const getGroupSenderInfo = (msg: any): { name: string | null; phone: string | null } => {
    const meta = msg.metadata;
    if (!meta || msg.direction === 'outbound') return { name: null, phone: null };
    
    // UazAPI: sender phone is in message.sender_pn (e.g. "5588...@s.whatsapp.net")
    const senderPn = meta?.message?.sender_pn || meta?.sender_pn || '';
    const senderPhone = senderPn.replace('@s.whatsapp.net', '').replace(/\D/g, '');
    
    // UazAPI: sender name is in message.senderName or message.groupName is the group name
    const senderName = meta?.message?.senderName || meta?.senderName || meta?.chat?.pushName || null;
    
    return { name: senderName, phone: senderPhone || null };
  };

  // Extract unique group participants from messages metadata
  const groupParticipants = isGroup ? (() => {
    const participantMap = new Map<string, string>();
    for (const msg of messages) {
      const meta = msg.metadata;
      if (!meta) continue;
      
      if (msg.direction === 'inbound') {
        const { name, phone } = getGroupSenderInfo(msg);
        if (phone && !participantMap.has(phone)) {
          participantMap.set(phone, name || phone);
        }
      } else {
        // Outbound: owner phone
        const ownerPhone = (meta?.owner || meta?.message?.owner || '').replace(/\D/g, '');
        if (ownerPhone && !participantMap.has(ownerPhone)) {
          participantMap.set(ownerPhone, 'Você');
        }
      }
    }
    return Array.from(participantMap.entries()).map(([phone, name]) => ({ phone, name })).sort((a, b) => a.name.localeCompare(b.name));
  })() : [];

  // Color assignment for group senders
  const senderColors = ['text-blue-600', 'text-emerald-600', 'text-purple-600', 'text-orange-600', 'text-pink-600', 'text-teal-600', 'text-amber-600', 'text-indigo-600'];
  const getSenderColor = (phone: string) => {
    let hash = 0;
    for (let i = 0; i < phone.length; i++) hash = phone.charCodeAt(i) + ((hash << 5) - hash);
    return senderColors[Math.abs(hash) % senderColors.length];
  };

  // Fetch team members for @mention picker
  useEffect(() => {
    supabase.from('profiles').select('user_id, full_name').order('full_name').then(({ data }) => {
      setTeamMembers((data || []).filter((p: any) => p.full_name));
    });
  }, []);


  useEffect(() => {
    const storageKey = `wa-identify-sender:${conversation.phone}`;
    const savedPreference = localStorage.getItem(storageKey);
    setIdentifySender(savedPreference !== 'false');

    const treatmentKey = `wa-treatment:${conversation.phone}`;
    const savedTreatment = localStorage.getItem(treatmentKey);
    // Default treatment: Dr. for male, Dra. for female, based on profile gender
    const profileGender = (profile as any)?.gender;
    const defaultTreatment = profileGender === 'female' ? 'Dra.' : profileGender === 'male' ? 'Dr.' : '';
    setTreatmentTitle(savedTreatment ?? defaultTreatment);

    const nameFormatKey = `wa-name-format:${conversation.phone}`;
    const savedFormat = localStorage.getItem(nameFormatKey);
    setNameFormat(savedFormat || 'first_last');

    // Load nicknames list (global) and selected nickname (per conversation)
    const nicknamesKey = `wa-nicknames`;
    const savedNicknames = localStorage.getItem(nicknamesKey);
    setNicknames(savedNicknames ? JSON.parse(savedNicknames) : []);

    const selectedNicknameKey = `wa-selected-nickname:${conversation.phone}`;
    const savedSelectedNickname = localStorage.getItem(selectedNicknameKey);
    setSelectedNickname(savedSelectedNickname || '');
  }, [conversation.phone, profile]);

  // Check if conversation is private
  useEffect(() => {
    if (!conversation.phone || !conversation.instance_name) return;
    const checkPrivate = async () => {
      const { data } = await supabase
        .from('whatsapp_private_conversations')
        .select('id')
        .eq('phone', conversation.phone)
        .eq('instance_name', conversation.instance_name)
        .maybeSingle();
      setIsPrivate(!!data);
    };
    checkPrivate();
  }, [conversation.phone, conversation.instance_name]);

  // Check if contact/lead has a linked group that actually exists
  useEffect(() => {
    const checkLinkedGroup = async () => {
      const normalizedPhone = conversation.phone?.replace(/\D/g, '') || '';
      if (!normalizedPhone) return;
      
      let candidateGroupId: string | null = null;
      
      // Check contact first
      const { data: contact } = await supabase
        .from('contacts')
        .select('whatsapp_group_id')
        .eq('phone', normalizedPhone)
        .not('whatsapp_group_id', 'is', null)
        .maybeSingle();
      if (contact?.whatsapp_group_id) {
        candidateGroupId = contact.whatsapp_group_id;
      }
      
      // Check lead if no contact group
      if (!candidateGroupId) {
        const { data: lead } = await (supabase as any)
          .from('leads')
          .select('whatsapp_group_id')
          .or(`lead_phone.eq.${normalizedPhone},lead_phone.ilike.%${normalizedPhone.slice(-8)}%`)
          .not('whatsapp_group_id', 'is', null)
          .limit(1)
          .maybeSingle();
        if (lead?.whatsapp_group_id) {
          candidateGroupId = lead.whatsapp_group_id;
        }
      }
      
      // Verify the group actually exists by checking for messages
      if (candidateGroupId) {
        const { count } = await supabase
          .from('whatsapp_messages')
          .select('id', { count: 'exact', head: true })
          .eq('phone', candidateGroupId)
          .limit(1);
        if (count && count > 0) {
          setLinkedGroupId(candidateGroupId);
        } else {
          setLinkedGroupId(null);
        }
      } else {
        setLinkedGroupId(null);
      }
    };
    checkLinkedGroup();
  }, [conversation.phone]);

  const handleTogglePrivate = async () => {
    if (!conversation.instance_name) return;
    setTogglingPrivate(true);
    try {
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      if (!currentUser) return;
      
      if (isPrivate) {
        await supabase.from('whatsapp_private_conversations')
          .delete()
          .eq('phone', conversation.phone)
          .eq('instance_name', conversation.instance_name);
        setIsPrivate(false);
        toast.success('Conversa tornada pública');
      } else {
        await supabase.from('whatsapp_private_conversations')
          .insert({ phone: conversation.phone, instance_name: conversation.instance_name, private_by: currentUser.id });
        setIsPrivate(true);
        toast.success('Conversa marcada como privada');
      }
      onPrivacyChanged?.();
    } catch (e) {
      toast.error('Erro ao alterar privacidade');
    } finally {
      setTogglingPrivate(false);
    }
  };

  const handleCreateGroup = async () => {
    if (!conversation.phone || creatingGroup) return;
    setCreatingGroup(true);
    try {
      const normalizedPhone = conversation.phone.replace(/\D/g, '');
      let leadName = conversation.contact_name || normalizedPhone;
      let boardId: string | undefined;
      let leadId: string | undefined;

      const { data: lead } = await (supabase as any)
        .from('leads')
        .select('id, lead_name, board_id')
        .or(`lead_phone.eq.${normalizedPhone},lead_phone.ilike.%${normalizedPhone.slice(-8)}%`)
        .limit(1)
        .maybeSingle();

      if (lead) {
        leadName = lead.lead_name || leadName;
        boardId = lead.board_id || undefined;
        leadId = lead.id;
      }

      // If sync is OFF, allow user to set a custom lead name manually
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
            // user cancelled
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
      if (conversation.instance_name) {
        const { data: inst } = await (supabase as any)
          .from('whatsapp_instances')
          .select('id')
          .eq('instance_name', conversation.instance_name)
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

      if (leadId && data.group_id) {
        const updates: any = { whatsapp_group_id: data.group_id };
        if (customLeadName) updates.lead_name = customLeadName;
        await (supabase as any).from('leads').update(updates).eq('id', leadId);
      }
      if (data.group_id) {
        const { data: contact } = await supabase.from('contacts').select('id').eq('phone', normalizedPhone).maybeSingle();
        if (contact) {
          await supabase.from('contacts').update({ whatsapp_group_id: data.group_id } as any).eq('id', contact.id);
        }
      }

      setLinkedGroupId(data.group_id || null);
      toast.success(`Grupo "${leadName}" criado com ${data.participants_count} participantes!`);
    } catch (e: any) {
      console.error('Error creating group:', e);
      toast.error(e.message || 'Erro ao criar grupo');
    } finally {
      setCreatingGroup(false);
    }
  };

  useEffect(() => {
    const phone = conversation.phone;
    if (!phone) return;
    const phoneSuffix = phone.replace(/\D/g, '').slice(-8);
    const fetchCalls = async () => {
      // Use ilike for fuzzy matching on phone suffix to catch format differences
      const { data } = await supabase
        .from('call_records')
        .select('*')
        .or(`contact_phone.ilike.%${phoneSuffix}%,phone_used.ilike.%${conversation.instance_name || ''}%`)
        .ilike('contact_phone', `%${phoneSuffix}%`)
        .order('created_at', { ascending: true });
      setCallRecords(data || []);
    };
    fetchCalls();

    const channel = supabase
      .channel(`call_records_chat_${phone}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'call_records' }, (payload) => {
        // Check if the changed record matches this conversation
        const changed = payload.new as any;
        if (changed?.contact_phone?.includes(phoneSuffix)) {
          fetchCalls();
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [conversation.phone, conversation.instance_name]);

  // Merge messages, call records and internal notes into a unified timeline
  const timelineItems = (() => {
    const items: Array<{ type: 'message' | 'call' | 'note'; data: any; timestamp: string }> = [];
    for (const msg of messages) {
      items.push({ type: 'message', data: msg, timestamp: msg.created_at });
    }
    for (const call of callRecords) {
      items.push({ type: 'call', data: call, timestamp: call.created_at });
    }
    for (const note of notes) {
      items.push({ type: 'note', data: note, timestamp: note.created_at });
    }
    items.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    return items;
  })();

  const prevItemsCountRef = useRef(0);
  useEffect(() => {
    if (timelineItems.length === 0) return;
    const currentKey = `${conversation.phone}__${conversation.instance_name || ''}`;
    const isConversationSwitch = conversationKeyRef.current !== currentKey;
    const isInitialLoad = isConversationSwitch || prevItemsCountRef.current === 0;
    conversationKeyRef.current = currentKey;
    prevItemsCountRef.current = timelineItems.length;

    const jumpToBottom = (smooth = false) => {
      const container = messagesContainerRef.current;
      if (container) {
        container.scrollTop = container.scrollHeight;
      } else {
        messagesEndRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'end' });
      }
    };

    if (isInitialLoad) {
      // Salto instantâneo direto para o fim, repetido para cobrir lazy-load de mídias/imagens
      jumpToBottom(false);
      requestAnimationFrame(() => jumpToBottom(false));
      const t1 = setTimeout(() => jumpToBottom(false), 50);
      const t2 = setTimeout(() => jumpToBottom(false), 200);
      const t3 = setTimeout(() => jumpToBottom(false), 600);
      return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
    } else {
      // Nova mensagem: scroll suave
      requestAnimationFrame(() => jumpToBottom(true));
    }
  }, [timelineItems.length, conversation.phone, conversation.instance_name]);

  const handleToggleIdentifySender = (checked: boolean) => {
    setIdentifySender(checked);
    const storageKey = `wa-identify-sender:${conversation.phone}`;
    localStorage.setItem(storageKey, checked ? 'true' : 'false');
  };

  const handleTreatmentChange = (value: string) => {
    const v = value === 'none' ? '' : value;
    setTreatmentTitle(v);
    const treatmentKey = `wa-treatment:${conversation.phone}`;
    localStorage.setItem(treatmentKey, v);
  };

  const handleNameFormatChange = (value: string) => {
    setNameFormat(value);
    const nameFormatKey = `wa-name-format:${conversation.phone}`;
    localStorage.setItem(nameFormatKey, value);
  };

  const handleAddNickname = () => {
    const trimmed = newNickname.trim();
    if (!trimmed || nicknames.includes(trimmed)) return;
    const updated = [...nicknames, trimmed];
    setNicknames(updated);
    localStorage.setItem('wa-nicknames', JSON.stringify(updated));
    setSelectedNickname(trimmed);
    localStorage.setItem(`wa-selected-nickname:${conversation.phone}`, trimmed);
    setNewNickname('');
  };

  const handleRemoveNickname = (nick: string) => {
    const updated = nicknames.filter(n => n !== nick);
    setNicknames(updated);
    localStorage.setItem('wa-nicknames', JSON.stringify(updated));
    if (selectedNickname === nick) {
      setSelectedNickname(updated[0] || '');
      localStorage.setItem(`wa-selected-nickname:${conversation.phone}`, updated[0] || '');
    }
  };

  const handleSelectNickname = (value: string) => {
    setSelectedNickname(value);
    localStorage.setItem(`wa-selected-nickname:${conversation.phone}`, value);
  };

  const handleWjiaCommand = async (command: string) => {
    setSending(true);
    setNewMessage('');
    toast.info('🤖 Processando comando @wjia...', { duration: 5000 });
    try {
      const { data, error } = await cloudFunctions.invoke('wjia-agent', {
        body: {
          phone: conversation.phone,
          instance_name: conversation.instance_name,
          command: command.replace(/^@wjia\s*/i, '').trim(),
          contact_id: conversation.contact_id || null,
          lead_id: conversation.lead_id || null,
        },
      });
      if (error) throw error;
      if (data?.success) {
        toast.success(data.message || 'Comando processado!', { duration: 8000 });
      } else {
        toast.error(data?.message || 'Erro ao processar comando');
      }
    } catch (err: any) {
      console.error('WJIA command error:', err);
      toast.error(`Erro: ${err.message}`);
    } finally {
      setSending(false);
    }
  };

  const handleSend = async () => {
    if (!newMessage.trim() || sending) return;

    // If in note or chat mode, save as internal note instead of sending
    if (inputMode === 'note' || inputMode === 'chat') {
      setSending(true);
      const noteType = inputMode === 'chat' ? 'chat' : 'note';
      const content = inputMode === 'chat' && mentionUserName
        ? `@${mentionUserName} ${newMessage.trim()}`
        : newMessage.trim();
      await addNote(content, noteType);
      setNewMessage('');
      setSending(false);
      return;
    }

    // Intercept @wjia commands - don't send to client
    if (newMessage.trim().toLowerCase().startsWith('@wjia')) {
      await handleWjiaCommand(newMessage.trim());
      return;
    }

    const rawChatId =
      conversation.messages.find((msg) => typeof msg.metadata?.chat?.wa_chatid === 'string')?.metadata?.chat?.wa_chatid ||
      conversation.messages.find((msg) => typeof msg.metadata?.message?.chatid === 'string')?.metadata?.message?.chatid;
    const conversationChatId = canonicalizeChatTarget(rawChatId);

    setSending(true);
    try {
      const success = await onSendMessage(
        conversation.phone,
        newMessage.trim(),
        conversation.contact_id || undefined,
        conversation.lead_id || undefined,
        conversation.instance_name,
        identifySender,
        conversationChatId,
        nameFormat === 'nickname' ? null : (treatmentTitle || null),
        nameFormat,
        nameFormat === 'nickname' ? (selectedNickname || null) : null
      );
      if (success) setNewMessage('');
    } catch (err) {
      console.error('handleSend error:', err);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (pastedImage) {
        handleSendPastedImage();
      } else {
        handleSend();
      }
    }
  };

  // Handle paste from clipboard (screenshots / print screen)
  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        e.preventDefault();
        const file = items[i].getAsFile();
        if (!file) return;
        const previewUrl = URL.createObjectURL(file);
        setPastedImage({ file, previewUrl });
        setPastedCaption(newMessage);
        return;
      }
    }
  };

  const handleSendPastedImage = async () => {
    if (!pastedImage) return;
    setUploadingMedia(true);
    try {
      const ext = pastedImage.file.type.split('/')[1] || 'png';
      const path = `outbound/${Date.now()}_paste.${ext}`;
      const { error: uploadError } = await supabase.storage.from('whatsapp-media').upload(path, pastedImage.file);
      if (uploadError) throw uploadError;
      const { data: { publicUrl } } = supabase.storage.from('whatsapp-media').getPublicUrl(path);
      await onSendMedia(
        conversation.phone, publicUrl, pastedImage.file.type, pastedCaption || undefined, `screenshot.${ext}`,
        conversation.contact_id || undefined, conversation.lead_id || undefined,
        conversation.instance_name, conversationChatId
      );
      handleCancelPastedImage();
      setNewMessage('');
    } catch (err: any) {
      toast.error('Erro ao enviar imagem: ' + err.message);
    } finally {
      setUploadingMedia(false);
    }
  };

  const handleCancelPastedImage = () => {
    if (pastedImage) URL.revokeObjectURL(pastedImage.previewUrl);
    setPastedImage(null);
    setPastedCaption('');
  };

  const rawChatId =
    conversation.messages.find((msg) => typeof msg.metadata?.chat?.wa_chatid === 'string')?.metadata?.chat?.wa_chatid ||
    conversation.messages.find((msg) => typeof msg.metadata?.message?.chatid === 'string')?.metadata?.message?.chatid;
  const conversationChatId = canonicalizeChatTarget(rawChatId);

  // Media upload handler
  const handleMediaUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingMedia(true);
    setShowAttachMenu(false);
    try {
      const ext = file.name.split('.').pop() || 'bin';
      const path = `outbound/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
      const { error: uploadError } = await supabase.storage.from('whatsapp-media').upload(path, file);
      if (uploadError) throw uploadError;
      const { data: { publicUrl } } = supabase.storage.from('whatsapp-media').getPublicUrl(path);

      await onSendMedia(
        conversation.phone, publicUrl, file.type, '', file.name,
        conversation.contact_id || undefined, conversation.lead_id || undefined,
        conversation.instance_name, conversationChatId
      );
    } catch (err: any) {
      toast.error('Erro ao enviar mídia: ' + err.message);
    } finally {
      setUploadingMedia(false);
      if (mediaInputRef.current) mediaInputRef.current.value = '';
    }
  };

  // Audio recording
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      audioChunksRef.current = [];
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        if (recordingIntervalRef.current) clearInterval(recordingIntervalRef.current);
        setRecordingTime(0);
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        if (blob.size < 100) return;
        setUploadingMedia(true);
        try {
          const path = `outbound/audio_${Date.now()}.webm`;
          const { error: uploadError } = await supabase.storage.from('whatsapp-media').upload(path, blob);
          if (uploadError) throw uploadError;
          const { data: { publicUrl } } = supabase.storage.from('whatsapp-media').getPublicUrl(path);
          await onSendMedia(
            conversation.phone, publicUrl, 'audio/webm', undefined, undefined,
            conversation.contact_id || undefined, conversation.lead_id || undefined,
            conversation.instance_name, conversationChatId
          );
        } catch (err: any) {
          toast.error('Erro ao enviar áudio: ' + err.message);
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

  // Location send
  const handleSendLocation = async () => {
    const lat = parseFloat(locationLat);
    const lng = parseFloat(locationLng);
    if (isNaN(lat) || isNaN(lng)) {
      toast.error('Informe latitude e longitude válidos');
      return;
    }
    await onSendLocation(
      conversation.phone, lat, lng, locationName || undefined, locationAddress || undefined,
      conversation.contact_id || undefined, conversation.lead_id || undefined,
      conversation.instance_name, conversationChatId
    );
    setShowLocationDialog(false);
    setLocationName(''); setLocationAddress(''); setLocationLat(''); setLocationLng('');
  };

  const handleGetCurrentLocation = () => {
    if (!navigator.geolocation) { toast.error('Geolocalização não suportada'); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocationLat(pos.coords.latitude.toString());
        setLocationLng(pos.coords.longitude.toString());
        toast.success('Localização obtida!');
      },
      () => toast.error('Não foi possível obter sua localização')
    );
  };

  // Delete message
  const handleDeleteMessage = async (msg: any) => {
    if (deletingMessageId) return;
    setDeletingMessageId(msg.id);
    try {
      await onDeleteMessage(msg.id, msg.instance_name || conversation.instance_name, msg.external_message_id);
    } finally {
      setDeletingMessageId(null);
    }
  };

  const fetchLeads = async (search?: string) => {
    let query = supabase
      .from('leads')
      .select('id, lead_name, lead_phone')
      .order('created_at', { ascending: false });
    
    if (search && search.trim().length >= 2) {
      query = query.ilike('lead_name', `%${search.trim()}%`);
    }
    
    const { data } = await query.limit(50);
    // Dedup defensivo por id (caso algum join futuro repita)
    const seen = new Set<string>();
    const unique = (data || []).filter(l => {
      if (seen.has(l.id)) return false;
      seen.add(l.id);
      return true;
    });
    setLeads(unique);
  };

  const handleLinkLead = async () => {
    if (!selectedLeadId) return;
    
    // Caso a conversa seja um GRUPO e nenhum participante específico foi escolhido,
    // vincular APENAS o GRUPO ao lead (lead_whatsapp_groups).
    // NÃO chamar onLinkToLead pois ele vincularia o JID do grupo como se fosse contato individual.
    if (isGroup && !selectedParticipantPhone) {
      const groupJid = conversation.phone;
      const groupName = conversation.contact_name || null;
      const leadName = leads.find(l => l.id === selectedLeadId)?.lead_name || null;
      try {
        const { data: existingGroup } = await externalSupabase
          .from('lead_whatsapp_groups')
          .select('id')
          .eq('lead_id', selectedLeadId)
          .eq('group_jid', groupJid)
          .maybeSingle();
        if (!existingGroup) {
          const { error: insertErr } = await externalSupabase.from('lead_whatsapp_groups').insert({
            lead_id: selectedLeadId,
            group_jid: groupJid,
            group_name: groupName,
          } as any);
          if (insertErr) throw insertErr;
          await logGroupAudit({
            action: 'link', group_jid: groupJid, group_name: groupName,
            lead_id: selectedLeadId, lead_name: leadName, result: 'success',
            source: 'WhatsAppChat.handleLinkLead',
          });
        } else {
          await logGroupAudit({
            action: 'link', group_jid: groupJid, group_name: groupName,
            lead_id: selectedLeadId, lead_name: leadName, result: 'duplicate_skipped',
            source: 'WhatsAppChat.handleLinkLead',
          });
        }
        toast.success('Grupo WhatsApp vinculado ao lead');
        setShowLinkDialog(false);
        setSelectedLeadId('');
      } catch (e: any) {
        console.error('Error linking group to lead:', e);
        await logGroupAudit({
          action: 'link', group_jid: groupJid, group_name: groupName,
          lead_id: selectedLeadId, lead_name: leadName, result: 'error',
          error_message: e?.message || String(e),
          source: 'WhatsAppChat.handleLinkLead',
        });
        toast.error(`Erro ao vincular grupo: ${e?.message || 'desconhecido'}`);
      }
      return;
    }
    
    // Conversa individual ou grupo com participante selecionado: usa fluxo normal
    onLinkToLead(conversation.phone, selectedLeadId);
    // For groups: create/find contact from selected participant and link to lead
    if (isGroup && selectedParticipantPhone) {
      try {
        const participant = groupParticipants.find(p => p.phone === selectedParticipantPhone);
        const participantName = participant?.name || selectedParticipantPhone;
        
        // Find existing contact by phone
        const normalizedPhone = selectedParticipantPhone.replace(/\D/g, '');
        const { data: existingContact } = await supabase
          .from('contacts')
          .select('id')
          .eq('phone', normalizedPhone)
          .maybeSingle();
        
        let contactId = existingContact?.id;
        
        if (!contactId) {
          const { data: { user } } = await supabase.auth.getUser();
          const { data: newContact } = await supabase
            .from('contacts')
            .insert({
              full_name: participantName !== selectedParticipantPhone ? participantName : `Contato ${normalizedPhone}`,
              phone: normalizedPhone,
              created_by: user?.id || null,
            })
            .select('id')
            .single();
          contactId = newContact?.id;
        }
        
        if (contactId) {
          const { data: existing } = await externalSupabase
            .from('contact_leads')
            .select('id')
            .eq('contact_id', contactId)
            .eq('lead_id', selectedLeadId)
            .maybeSingle();
          
          if (!existing) {
            await externalSupabase.from('contact_leads').insert({
              contact_id: contactId,
              lead_id: selectedLeadId,
              relationship_to_victim: selectedRelationship || null,
            } as any);
          }
          
          // Also link messages from this phone to the contact
          await supabase
            .from('whatsapp_messages')
            .update({ contact_id: contactId } as any)
            .eq('phone', conversation.phone);
        }
      } catch (e) {
        console.error('Error linking group participant to lead:', e);
      }
    } else if (conversation.contact_id && selectedRelationship) {
      // Non-group: existing flow
      try {
        const { data: existing } = await externalSupabase
          .from('contact_leads')
          .select('id')
          .eq('contact_id', conversation.contact_id)
          .eq('lead_id', selectedLeadId)
          .maybeSingle();
        
        if (existing) {
          await externalSupabase.from('contact_leads')
            .update({ relationship_to_victim: selectedRelationship } as any)
            .eq('id', existing.id);
        } else {
          await externalSupabase.from('contact_leads').insert({
            contact_id: conversation.contact_id,
            lead_id: selectedLeadId,
            relationship_to_victim: selectedRelationship,
          } as any);
        }
      } catch (e) {
        console.error('Error linking contact to lead:', e);
      }
    }
    
    setShowLinkDialog(false);
    setSelectedLeadId('');
    setSelectedRelationship('');
    setSelectedParticipantPhone('');
  };

  const formatPhone = (phone: string) => {
    if (phone.length === 13) {
      return `+${phone.slice(0, 2)} (${phone.slice(2, 4)}) ${phone.slice(4, 9)}-${phone.slice(9)}`;
    }
    return phone;
  };

  const phoneDigits = conversation.phone.replace(/\D/g, '');
  const whatsappPhone = phoneDigits.startsWith('55') ? phoneDigits : `55${phoneDigits}`;
  const pwaDialPhone = whatsappPhone.startsWith('55') ? whatsappPhone.slice(2) : phoneDigits;

  return (
    <div className="flex flex-col h-full">
      {/* Chat Header */}
      <div className="flex items-center gap-2 md:gap-3 p-3 border-b bg-card shrink-0">
        {onBack && (
          <Button variant="ghost" size="icon" className="md:hidden h-8 w-8 shrink-0" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
        )}
        <div className="h-10 w-10 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center shrink-0">
          <User className="h-5 w-5 text-green-600" />
        </div>
        <div className="flex-1 min-w-0">
          <CopyableText copyValue={conversation.contact_name || formatPhone(conversation.phone)} label="Nome" className="font-medium text-sm truncate" as="p">
            {conversation.contact_name || formatPhone(conversation.phone)}
          </CopyableText>
          <div className="flex items-center gap-2 flex-wrap">
            <a
              href={`https://wa.me/${whatsappPhone}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs bg-green-600 text-white px-2 py-0.5 rounded-full hover:bg-green-700 transition-colors inline-flex items-center gap-1 no-underline"
              title="Abrir WhatsApp"
            >
              📱 WhatsApp
            </a>
            <button
              type="button"
              className="callface-dial text-xs bg-blue-600 text-white px-2 py-0.5 rounded-full hover:bg-blue-700 transition-colors inline-flex items-center gap-1 cursor-pointer border-0"
              data-phone={whatsappPhone?.replace(/^55/, '')}
              title="Ligar via CallFace"
              onClick={(e) => {
                // CallFace extension intercepts via callface-dial class + data-phone
                // If extension not installed, show hint
                setTimeout(() => {
                  // Extension should have handled it; if not, notify user
                }, 500);
              }}
            >
              📞 CallFace
            </button>
            <CopyableText copyValue={conversation.phone} label="Telefone" className="text-xs text-muted-foreground" as="span">
              📋 Copiar
            </CopyableText>
          </div>
          {adOrigin && (
            <div
              className="mt-1 text-[10px] text-muted-foreground truncate"
              title={[adOrigin.campaign_name, adOrigin.adset_name, adOrigin.ad_name].filter(Boolean).join(' › ')}
            >
              📢 {adOrigin.adset_name || adOrigin.ad_name || adOrigin.campaign_name}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {isPrivate && <Lock className="h-4 w-4 text-amber-500" />}
          {isMuted && (
            <Badge variant="outline" className="text-[9px] gap-1 text-destructive border-destructive/30 px-1.5 py-0 cursor-pointer" onClick={() => handleToggleMute(null)}>
              <VolumeX className="h-3 w-3" /> Mudo
            </Badge>
          )}
          {conversation.lead_id && (
            <Badge
              className="text-[10px] gap-1 px-2 py-0.5 cursor-pointer bg-blue-600 hover:bg-blue-700 text-white border-0 shadow-sm"
              onClick={handleOpenLeadEdit}
              title="Clique para abrir o formulário de edição do lead"
            >
              <Link2 className="h-3 w-3" /> Ver Lead
            </Badge>
          )}
          {agentEnabled && activeAgentName && (
            <Badge variant="default" className="text-[9px] gap-1 bg-emerald-600 hover:bg-emerald-700 px-1.5 py-0 cursor-pointer" onClick={handleAgentToggle}>
              <Bot className="h-3 w-3" /> {activeAgentName}
            </Badge>
          )}
          {agentEnabled && humanPausedUntil && new Date(humanPausedUntil) > new Date() && (
            <Badge
              variant="outline"
              className="text-[9px] gap-1 border-orange-400 text-orange-600 bg-orange-50 px-1.5 py-0 cursor-pointer"
              title="Clique para interromper a pausa e reativar o agente"
              onClick={async () => {
                try {
                  await supabase.from('whatsapp_conversation_agents')
                    .update({ human_paused_until: null } as any)
                    .eq('phone', conversation.phone).eq('instance_name', conversation.instance_name);
                  setHumanPausedUntil(null);
                  toast.success('Pausa interrompida! Agente retomando...');
                } catch (e) {
                  toast.error('Erro ao interromper pausa');
                }
              }}
            >
              ⏸️ Pausa ({Math.max(1, Math.ceil((new Date(humanPausedUntil).getTime() - Date.now()) / 60000))}min)
              <FastForward className="h-3 w-3" />
            </Badge>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem
                onClick={async () => {
                  const t = toast.loading('Buscando histórico de mensagens antigas...');
                  try {
                    const { data, error } = await supabase.functions.invoke('whatsapp-fetch-history', {
                      body: {
                        phone: conversation.phone,
                        instance_name: conversation.instance_name,
                        count: 50,
                      },
                    });
                    if (error) throw error;
                    if (data?.success === false) throw new Error(data?.error || 'Falha ao solicitar histórico');
                    toast.success('Sync solicitado! As mensagens antigas chegarão em alguns segundos.', { id: t });
                  } catch (e: any) {
                    toast.error(e?.message || 'Erro ao buscar histórico', { id: t });
                  }
                }}
                className="gap-2"
              >
                <RefreshCw className="h-4 w-4" /> Buscar histórico (msgs antigas)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => { setDriveSelectionMode(true); setSelectionOrder([]); }} className="gap-2">
                <Sparkles className="h-4 w-4 text-blue-500" /> Selecionar mídias p/ Drive
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {!conversation.lead_id && contactLinkedLeadIds.length === 0 && (
                <DropdownMenuItem onClick={() => { setShowLinkDialog(true); fetchLeads(); }} className="gap-2">
                  <Link2 className="h-4 w-4" /> Vincular Lead
                </DropdownMenuItem>
              )}
              {!conversation.lead_id && contactLinkedLeadIds.length === 0 && (
                <DropdownMenuItem onClick={onCreateLead} className="gap-2">
                  <Plus className="h-4 w-4" /> Criar Lead + Contato
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={onCreateContact} className="gap-2">
                <UserPlus className="h-4 w-4" /> Criar Contato
              </DropdownMenuItem>
              {onCreateCase && (
                <DropdownMenuItem onClick={onCreateCase} className="gap-2">
                  <Scale className="h-4 w-4" /> Criar Caso Jurídico
                </DropdownMenuItem>
              )}
              {(conversation.lead_id || conversation.contact_id) && (
                <DropdownMenuItem onClick={onUpdateWithAI} disabled={extractingData} className="gap-2">
                  {extractingData ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Atualizar com IA
                </DropdownMenuItem>
              )}
              {conversation.contact_id && (
                <DropdownMenuItem onClick={() => onViewContact?.(conversation.contact_id!)} className="gap-2">
                  <User className="h-4 w-4" /> Ver Contato
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={handleTogglePrivate} disabled={togglingPrivate} className="gap-2">
                {isPrivate ? <LockOpen className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
                {isPrivate ? 'Tornar pública' : 'Trancar conversa'}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => {
                openZapSignDialog({
                  phone: conversation.phone,
                  contactName: conversation.contact_name || undefined,
                  contactId: conversation.contact_id || undefined,
                  leadId: conversation.lead_id || undefined,
                  instanceName: conversation.instance_name || undefined,
                  messages: conversation.messages.map(m => ({
                    direction: m.direction,
                    message_text: m.message_text,
                    media_url: m.media_url,
                    media_type: m.media_type,
                    created_at: (m as any).created_at || (m as any).timestamp,
                  })),
                  onSendMessage: async (msg: string) => {
                    const rawChatId =
                      conversation.messages.find((message) => typeof message.metadata?.chat?.wa_chatid === 'string')?.metadata?.chat?.wa_chatid ||
                      conversation.messages.find((message) => typeof message.metadata?.message?.chatid === 'string')?.metadata?.message?.chatid;
                    const conversationChatId = canonicalizeChatTarget(rawChatId);
                    return await onSendMessage(
                      conversation.phone, msg,
                      conversation.contact_id || undefined,
                      conversation.lead_id || undefined,
                      conversation.instance_name,
                      identifySender,
                      conversationChatId,
                      nameFormat === 'nickname' ? null : (treatmentTitle || null),
                      nameFormat,
                      nameFormat === 'nickname' ? (selectedNickname || null) : null
                    );
                  },
                });
              }} className="gap-2">
                <FileSignature className="h-4 w-4" /> Gerar Documento para Assinatura
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setShowSessionEditor(true)} className="gap-2">
                <Pencil className="h-4 w-4" /> Editar Campos da Sessão
              </DropdownMenuItem>
              {!isGroup && linkedGroupId && (
                <DropdownMenuItem onClick={() => onOpenChat?.(linkedGroupId)} className="gap-2">
                  <Users className="h-4 w-4" /> Acessar Grupo
                </DropdownMenuItem>
              )}
              {!isGroup && !linkedGroupId && (
                <DropdownMenuItem onClick={handleCreateGroup} disabled={creatingGroup} className="gap-2">
                  {creatingGroup ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />}
                  Criar Grupo WhatsApp
                </DropdownMenuItem>
              )}
              {availableAgents.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  {agentEnabled && activeAgentId ? (
                    <DropdownMenuItem onClick={handleAgentToggle} disabled={agentLoading} className="gap-2">
                      <BotOff className="h-4 w-4" /> Desativar Agente ({activeAgentName})
                    </DropdownMenuItem>
                  ) : activeAgentId && !agentEnabled ? (
                    <DropdownMenuItem onClick={handleAgentToggle} disabled={agentLoading} className="gap-2">
                      <Bot className="h-4 w-4" /> Reativar Agente ({activeAgentName})
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger className="gap-2">
                      <Bot className="h-4 w-4" /> {activeAgentId ? 'Trocar Agente' : 'Ativar Agente IA'}
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      {availableAgents.map(agent => (
                        <DropdownMenuItem key={agent.id} onClick={() => handleSelectAgent(agent.id)} className="gap-2">
                          <Bot className="h-3.5 w-3.5" />
                          <span className="flex-1">{agent.name}</span>
                          {activeAgentId === agent.id && <Badge variant="default" className="text-[9px] h-4 px-1">ativo</Badge>}
                        </DropdownMenuItem>
                      ))}
                      {activeAgentId && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={handleRemoveAgent} className="gap-2 text-destructive">
                            <BotOff className="h-3.5 w-3.5" /> Remover agente
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                </>
              )}
              <DropdownMenuSeparator />
              {isMuted ? (
                <DropdownMenuItem onClick={() => handleToggleMute(null)} disabled={muteLoading} className="gap-2">
                  <Volume2 className="h-4 w-4" /> Reativar Conversa
                </DropdownMenuItem>
              ) : (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger className="gap-2">
                    <VolumeX className="h-4 w-4" /> Silenciar Conversa
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuItem onClick={() => handleToggleMute('all')} className="gap-2">
                      <BellOff className="h-3.5 w-3.5" /> Silenciar tudo (envio + recebimento)
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleToggleMute('receive')} className="gap-2">
                      <VolumeX className="h-3.5 w-3.5" /> Desativar recebimento
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleToggleMute('send')} className="gap-2">
                      <VolumeX className="h-3.5 w-3.5" /> Desativar envio
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )}
              {onClearConversation && (
                <DropdownMenuItem
                  onClick={async () => {
                    if (confirm('Tem certeza que deseja limpar todos os dados desta conversa? Esta ação não pode ser desfeita.')) {
                      await onClearConversation(conversation.phone, conversation.instance_name);
                    }
                  }}
                  className="gap-2 text-destructive focus:text-destructive"
                >
                  <Trash2 className="h-4 w-4" /> Limpar Conversa
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <WhatsAppCallRecorder
            phone={conversation.phone}
            contactName={conversation.contact_name}
            contactId={conversation.contact_id}
            leadId={conversation.lead_id}
            instanceName={conversation.instance_name}
          />
          <WhatsAppConversationShareDialog phone={conversation.phone} instanceName={conversation.instance_name} />
          <WhatsAppMediaGallery messages={conversation.messages} />
          {(() => {
            const missingCount = (conversation.messages || []).filter((m: any) => isMissingMedia(m) && m.external_message_id).length;
            if (missingCount === 0) return null;
            return (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8 relative"
                    onClick={handleBulkResyncMissingMedia}
                    disabled={bulkResyncing}
                  >
                    {bulkResyncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                    <span className="absolute -top-0.5 -right-0.5 bg-amber-500 text-white text-[9px] font-bold rounded-full h-4 w-4 flex items-center justify-center">
                      {missingCount > 99 ? '99+' : missingCount}
                    </span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {bulkResyncing && bulkResyncProgress
                    ? `Sincronizando ${bulkResyncProgress.done}/${bulkResyncProgress.total}...`
                    : `Sincronizar ${missingCount} mídia(s) antiga(s)`}
                </TooltipContent>
              </Tooltip>
            );
          })()}
          {isGroup && (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setShowGroupMembers(true)}>
                    <Users className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Membros do grupo</TooltipContent>
              </Tooltip>
              <GroupMembersDialog
                open={showGroupMembers}
                onOpenChange={setShowGroupMembers}
                conversationPhone={conversation.phone}
                instanceName={conversation.instance_name}
                leadId={conversation.lead_id}
                isGroup={isGroup}
                messageParticipants={groupParticipants}
                onViewContact={onViewContact}
              />
            </>
          )}
        </div>
      </div>

      {/* Barra de progresso dos passos do lead - clique para abrir painel lateral */}
      {conversation.lead_id && (
        <WhatsAppLeadProgressBar
          leadId={conversation.lead_id}
          onClick={() => setShowLeadPanel(true)}
        />
      )}

      {/* AI Extraction Progress Banner */}
      {extractingData && extractionStep && (
        <div className="flex items-center gap-2 px-3 py-2 bg-primary/10 border-b text-sm shrink-0">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary flex-shrink-0" />
          <Sparkles className="h-3.5 w-3.5 text-primary flex-shrink-0" />
          <span className="text-primary truncate">{extractionStep}</span>
          <div className="ml-auto flex gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" style={{ animationDelay: '0ms' }} />
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" style={{ animationDelay: '300ms' }} />
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" style={{ animationDelay: '600ms' }} />
          </div>
        </div>
      )}

      <Dialog open={showLinkDialog} onOpenChange={setShowLinkDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Vincular a um Lead</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Lead</label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar lead por nome, cidade..."
                  value={leadSearchQuery}
                  onChange={(e) => {
                    setLeadSearchQuery(e.target.value);
                    fetchLeads(e.target.value);
                  }}
                  className="pl-8 h-9"
                />
              </div>
              {selectedLeadId && (
                <div className="flex items-center gap-2 p-2 rounded-md bg-primary/10 border border-primary/30">
                  <span className="text-sm flex-1 truncate">
                    {leads.find(l => l.id === selectedLeadId)?.lead_name || 'Lead selecionado'}
                  </span>
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => setSelectedLeadId('')}>
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              )}
              <ScrollArea className="max-h-[200px]">
                <div className="space-y-0.5">
                  {leads
                    .filter(l => {
                      if (!leadSearchQuery) return true;
                      const normalize = (v?: string | null) => (v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
                      const q = normalize(leadSearchQuery);
                      return normalize(l.lead_name).includes(q);
                    })
                    .map(lead => (
                      <button
                        key={lead.id}
                        type="button"
                        className={cn(
                          "w-full flex items-center gap-2 p-2 rounded-md text-left text-sm transition-colors",
                          selectedLeadId === lead.id ? "bg-primary/10 border border-primary/30" : "hover:bg-muted"
                        )}
                        onClick={() => setSelectedLeadId(lead.id)}
                      >
                        <span className="truncate flex-1">{lead.lead_name || 'Lead sem nome'}</span>
                        {lead.lead_phone && (
                          <span className="text-xs text-muted-foreground ml-2 shrink-0">{lead.lead_phone}</span>
                        )}
                      </button>
                    ))
                  }
                  {leads.length === 0 && leadSearchQuery.length >= 2 && (
                    <p className="text-xs text-muted-foreground text-center py-4">Nenhum lead encontrado</p>
                  )}
                </div>
              </ScrollArea>
            </div>

            {/* Group participant selector */}
            {isGroup && groupParticipants.length > 0 && (
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">
                  Contato do grupo (será vinculado ao lead)
                </label>
                <ScrollArea className="max-h-[180px] border rounded-md">
                  <div className="p-1 space-y-0.5">
                    {groupParticipants.filter(p => p.name !== 'Você').map(p => (
                      <button
                        key={p.phone}
                        type="button"
                        className={cn(
                          "w-full flex items-center gap-3 p-2 rounded-md text-left transition-colors text-sm",
                          selectedParticipantPhone === p.phone
                            ? "bg-primary/10 border border-primary/30"
                            : "hover:bg-muted/50"
                        )}
                        onClick={() => setSelectedParticipantPhone(
                          selectedParticipantPhone === p.phone ? '' : p.phone
                        )}
                      >
                        <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center shrink-0 text-xs font-medium">
                          {(p.name || '?')[0].toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate text-sm">{p.name || p.phone}</p>
                          {p.name && p.name !== p.phone && (
                            <p className="text-[10px] text-muted-foreground">{p.phone}</p>
                          )}
                        </div>
                        {selectedParticipantPhone === p.phone && (
                          <Badge variant="secondary" className="text-[10px] shrink-0">Selecionado</Badge>
                        )}
                      </button>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}

            {/* Relationship selector - show for groups when participant selected, or non-groups with contact */}
            {((isGroup && selectedParticipantPhone) || (!isGroup && conversation.contact_id)) && (
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Relação com a vítima</label>
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

            <Button className="w-full" onClick={handleLinkLead} disabled={!selectedLeadId}>
              Vincular
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Salvar no Drive: escolher/criar lead alvo */}
      {/* Barra inferior de seleção de mídias para Drive */}
      {driveSelectionMode && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-background border shadow-lg rounded-full px-4 py-2 flex items-center gap-3">
          <span className="text-sm font-medium">{selectedDriveMsgIds.size} selecionada(s)</span>
          <Button size="sm" variant="outline" onClick={exitDriveSelection}>Cancelar</Button>
          <Button size="sm" disabled={selectedDriveMsgIds.size === 0} onClick={openBatchDialogIfReady} className="gap-1">
            <Sparkles className="h-3.5 w-3.5" /> Salvar no Drive
          </Button>
        </div>
      )}

      {/* Dialog batch: modo + nome + reorder */}
      <Dialog open={showBatchDriveDialog} onOpenChange={setShowBatchDriveDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Salvar {selectedDriveMsgIds.size} mídia(s) no Drive</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Como salvar?</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setBatchDriveMode('merge')}
                  className={cn("p-3 rounded-md border text-left text-sm transition-colors", batchDriveMode === 'merge' ? "bg-primary/10 border-primary" : "hover:bg-muted")}
                >
                  <div className="font-medium">Juntar em PDF</div>
                  <div className="text-[11px] text-muted-foreground mt-1">1 arquivo único. Imagens viram páginas.</div>
                </button>
                <button
                  type="button"
                  onClick={() => setBatchDriveMode('separate')}
                  className={cn("p-3 rounded-md border text-left text-sm transition-colors", batchDriveMode === 'separate' ? "bg-primary/10 border-primary" : "hover:bg-muted")}
                >
                  <div className="font-medium">Mandar separado</div>
                  <div className="text-[11px] text-muted-foreground mt-1">Cada arquivo individual no Drive.</div>
                </button>
              </div>
            </div>

            {/* Reorder thumbnails */}
            {batchDriveOrder.length > 0 && (
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Ordem das mídias (arraste para reordenar)</label>
                <div className="flex flex-wrap gap-2">
                  {batchDriveOrder.map((item, idx) => (
                    <div
                      key={item.id}
                      draggable
                      onDragStart={(e) => { e.dataTransfer.setData('text/plain', String(idx)); e.dataTransfer.effectAllowed = 'move'; }}
                      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
                      onDrop={(e) => {
                        e.preventDefault();
                        const from = Number(e.dataTransfer.getData('text/plain'));
                        if (from === idx) return;
                        setBatchDriveOrder(prev => {
                          const next = [...prev];
                          const [removed] = next.splice(from, 1);
                          next.splice(idx, 0, removed);
                          return next;
                        });
                      }}
                      className="relative h-16 w-16 rounded-md border bg-muted overflow-hidden cursor-grab active:cursor-grabbing transition-opacity hover:opacity-90"
                      title={item.message_text || item.message_type}
                    >
                      {item.message_type === 'image' ? (
                        <img src={item.media_url} alt="" className="h-full w-full object-cover" loading="lazy" />
                      ) : (
                        <div className="h-full w-full flex flex-col items-center justify-center gap-0.5">
                          <FileText className="h-5 w-5 text-muted-foreground" />
                          <span className="text-[8px] text-muted-foreground uppercase">{item.message_type}</span>
                        </div>
                      )}
                      <span className="absolute top-0.5 left-0.5 bg-black/60 text-white text-[9px] font-bold rounded px-1">
                        {idx + 1}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Análise IA do conteúdo (igual à aba Documentos do lead) */}
            {(aiNamingFile || batchAnalysis) && (
              <div className="rounded-md border bg-muted/30 p-3 space-y-2">
                <div className="flex items-center gap-2 text-xs font-medium">
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                  Análise IA do documento
                  {aiNamingFile && <Loader2 className="h-3 w-3 animate-spin text-blue-500" />}
                </div>
                {batchAnalysis && (
                  <>
                    <div className="flex flex-wrap gap-1.5">
                      {batchAnalysis.title && <Badge variant="default" className="text-[10px]">{batchAnalysis.title}</Badge>}
                      {batchAnalysis.pages_label && (
                        <Badge variant="secondary" className="text-[10px] font-normal">{batchAnalysis.pages_label}</Badge>
                      )}
                    </div>
                    {batchAnalysis.holder_name && (
                      <div>
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Titular</div>
                        <div className="text-sm font-medium">{batchAnalysis.holder_name}</div>
                      </div>
                    )}
                    {batchAnalysis.holder_cpf && (
                      <div>
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">CPF</div>
                        <div className="text-sm font-mono">{batchAnalysis.holder_cpf}</div>
                      </div>
                    )}
                    {batchAnalysis.description && (
                      <div>
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Descrição</div>
                        <div className="text-xs leading-relaxed">{batchAnalysis.description}</div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {batchDriveMode === 'merge' && (
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                  Nome do PDF
                  {aiNamingFile && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-blue-500">
                      <Loader2 className="h-3 w-3 animate-spin" /> IA analisando…
                    </span>
                  )}
                </label>
                <Input value={batchFileName} onChange={(e) => setBatchFileName(e.target.value)} placeholder="Aguardando IA classificar…" disabled={aiNamingFile} />
              </div>
            )}
            <Button className="w-full" onClick={handleConfirmBatchDrive} disabled={batchUploading}>
              {batchUploading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Sparkles className="h-4 w-4 mr-1" />}
              {batchDriveMode === 'merge' ? 'Gerar PDF e enviar' : 'Enviar separados'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showDriveTargetDialog} onOpenChange={(o) => { setShowDriveTargetDialog(o); if (!o) setDriveTargetMsg(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Salvar no Drive — escolher lead</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Esta conversa não está vinculada a nenhum lead. Escolha um existente ou crie um novo para receber o arquivo na pasta dele.
            </p>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar lead por nome..."
                value={leadSearchQuery}
                onChange={(e) => { setLeadSearchQuery(e.target.value); fetchLeads(e.target.value); }}
                className="pl-8 h-9"
              />
            </div>
            <ScrollArea className="max-h-[220px]">
              <div className="space-y-0.5">
                {leads.map(lead => (
                  <button
                    key={lead.id}
                    type="button"
                    className={cn(
                      "w-full flex items-center gap-2 p-2 rounded-md text-left text-sm transition-colors",
                      selectedLeadId === lead.id ? "bg-primary/10 border border-primary/30" : "hover:bg-muted"
                    )}
                    onClick={() => setSelectedLeadId(lead.id)}
                  >
                    <span className="truncate flex-1">{lead.lead_name || 'Lead sem nome'}</span>
                    {lead.lead_phone && <span className="text-xs text-muted-foreground ml-2 shrink-0">{lead.lead_phone}</span>}
                  </button>
                ))}
                {leads.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-4">Digite para buscar ou crie um novo abaixo.</p>
                )}
              </div>
            </ScrollArea>
            <div className="flex gap-2 pt-2 border-t">
              <Button
                variant="outline"
                className="flex-1"
                onClick={handleCreateLeadForDrive}
                disabled={creatingDriveLead || savingDriveMsgId !== null}
              >
                {creatingDriveLead ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Plus className="h-4 w-4 mr-1" />}
                Criar lead novo
              </Button>
              <Button
                className="flex-1"
                onClick={handlePickExistingLeadForDrive}
                disabled={!selectedLeadId || savingDriveMsgId !== null}
              >
                Salvar neste lead
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground text-center">
              {isGroup ? 'O grupo será vinculado ao lead escolhido.' : 'A conversa será vinculada ao lead escolhido.'}
            </p>
          </div>
        </DialogContent>
      </Dialog>

      {/* Lead Preview - aba lateral */}
      {conversation.lead_id && onCreateActivity && (
        <Sheet open={showLeadPanel} onOpenChange={setShowLeadPanel}>
          <SheetContent side="right" className="w-full sm:w-[480px] p-0 overflow-y-auto">
            <SheetHeader className="px-4 py-3 border-b">
              <SheetTitle className="text-sm">Detalhes do Lead</SheetTitle>
            </SheetHeader>
            <div className="p-3">
              <WhatsAppLeadPreview
                leadId={conversation.lead_id}
                contactId={conversation.contact_id}
                contactName={conversation.contact_name}
                onCreateActivity={(...args) => {
                  setShowLeadPanel(false);
                  onCreateActivity(...args);
                }}
                onNavigateToLead={onNavigateToLead}
              />
            </div>
          </SheetContent>
        </Sheet>
      )}

      {/* Lead Edit Dialog — opens directly when clicking "Ver Lead" */}
      {editingLeadData && (
        <LeadEditDialog
          open={showLeadEdit}
          onOpenChange={(open) => {
            setShowLeadEdit(open);
            if (!open) setEditingLeadData(null);
          }}
          lead={editingLeadData}
          onSave={async (leadId, updates) => {
            await supabase.from('leads').update(updates as any).eq('id', leadId);
            setShowLeadEdit(false);
            setEditingLeadData(null);
            toast.success('Lead atualizado');
          }}
          mode="sheet"
          initialTab="basic"
          boards={kanbanBoards as any}
        />
      )}

      {/* Messages + Call Records Timeline */}
      <div ref={messagesContainerRef} className="flex-1 overflow-y-auto p-4 space-y-2 bg-muted/10">
        {timelineItems.map((item, idx) => {
          // Date separator
          const itemDate = new Date(item.timestamp);
          const prevItemDate = idx > 0 ? new Date(timelineItems[idx - 1].timestamp) : null;
          const showDateSeparator = idx === 0 || (prevItemDate && !isSameDay(itemDate, prevItemDate));
          
          const dateSeparator = showDateSeparator ? (
            <div key={`date-${item.timestamp}`} className="flex items-center justify-center my-4">
              <div className="bg-muted text-muted-foreground text-xs font-semibold px-4 py-1.5 rounded-lg shadow-sm border">
                {isToday(itemDate) ? 'Hoje' : isYesterday(itemDate) ? 'Ontem' : format(itemDate, "EEEE, dd 'de' MMMM 'de' yyyy", { locale: ptBR })}
              </div>
            </div>
          ) : null;
          if (item.type === 'note') {
            const note = item.data;
            const isChat = note.note_type === 'chat';
            const isActivity = note.note_type === 'activity';
            const noteIcon = isActivity
              ? <ClipboardList className="h-3 w-3 text-green-600 dark:text-green-400 shrink-0" />
              : isChat
                ? <MessageCircle className="h-3 w-3 text-blue-600 dark:text-blue-400 shrink-0" />
                : <StickyNote className="h-3 w-3 text-amber-600 dark:text-amber-400 shrink-0" />;
            const noteLabel = isActivity ? 'Atividade Criada' : isChat ? 'Chat Interno' : 'Nota Interna';
            const colorClasses = isActivity
              ? { border: "border-green-300 bg-green-50 dark:bg-green-950/30 dark:border-green-700", title: "text-green-700 dark:text-green-300", dot: "text-green-600/60 dark:text-green-400/60", sender: "text-green-600/80 dark:text-green-400/80", body: "text-green-900 dark:text-green-100", time: "text-green-600/60 dark:text-green-400/60" }
              : isChat
                ? { border: "border-blue-300 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-700", title: "text-blue-700 dark:text-blue-300", dot: "text-blue-600/60 dark:text-blue-400/60", sender: "text-blue-600/80 dark:text-blue-400/80", body: "text-blue-900 dark:text-blue-100", time: "text-blue-600/60 dark:text-blue-400/60" }
                : { border: "border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700", title: "text-amber-700 dark:text-amber-300", dot: "text-amber-600/60 dark:text-amber-400/60", sender: "text-amber-600/80 dark:text-amber-400/80", body: "text-amber-900 dark:text-amber-100", time: "text-amber-600/60 dark:text-amber-400/60" };
            return (
              <div key={`note-${note.id}`}>
                {dateSeparator}
                <div className="flex justify-center">
                  <div className={cn(
                    "max-w-[85%] rounded-xl px-4 py-2 text-xs border group",
                    colorClasses.border
                  )}>
                    <div className="flex items-center gap-1.5 mb-1">
                      {noteIcon}
                      <span className={cn("font-semibold", colorClasses.title)}>
                        {noteLabel}
                      </span>
                      <span className={colorClasses.dot}>•</span>
                      <span className={colorClasses.sender}>{note.sender_name || 'Equipe'}</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 ml-auto opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                        onClick={() => deleteNote(note.id)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                    <p className={cn("whitespace-pre-wrap text-[13px]", colorClasses.body)}>{note.content}</p>
                    <p className={cn("text-[10px] mt-1", colorClasses.time)}>
                      {format(new Date(note.created_at), "HH:mm", { locale: ptBR })}
                    </p>
                  </div>
                </div>
              </div>
            );
          }

          if (item.type === 'call') {
            const call = item.data;
            const isOutbound = call.call_type === 'outbound' || call.call_type === 'realizada';
            const resultMap: Record<string, string> = { atendeu: 'Atendeu', answered: 'Atendeu', 'não_atendeu': 'Não Atendeu', not_answered: 'Não Atendeu', ocupado: 'Ocupado', busy: 'Ocupado' };
            const resultLabel = resultMap[call.call_result] || call.call_result;
            const durationSec = call.duration_seconds || 0;
            const durationStr = `${Math.floor(durationSec / 60)}min ${durationSec % 60}s`;
            const startTime = format(new Date(call.created_at), "HH:mm", { locale: ptBR });
            const endDate = new Date(new Date(call.created_at).getTime() + durationSec * 1000);
            const endTime = format(endDate, "HH:mm", { locale: ptBR });
            const isUnanswered = call.call_result === 'não_atendeu' || call.call_result === 'not_answered';

            return (
              <div key={`call-${call.id}`}>
                {dateSeparator}
                <div className="flex justify-center">
                  <div className={cn(
                    "flex items-center gap-2 rounded-xl px-4 py-2 text-xs max-w-[85%] border",
                    isUnanswered 
                      ? "bg-destructive/10 border-destructive/30 text-destructive"
                      : "bg-primary/10 border-primary/30 text-primary"
                  )}>
                    {isOutbound ? <PhoneOutgoing className="h-3.5 w-3.5 shrink-0" /> : <PhoneIncoming className="h-3.5 w-3.5 shrink-0" />}
                    <div className="flex flex-col gap-0.5">
                      <span className="font-medium">
                        {isOutbound ? 'Chamada Realizada' : 'Chamada Recebida'}
                        {isUnanswered && ' — Não Atendeu'}
                      </span>
                      <div className="flex items-center gap-2 text-[10px] opacity-80">
                        <span>{resultLabel}</span>
                        <span>•</span>
                        <span>{durationStr}</span>
                        <span>•</span>
                        <Clock className="h-2.5 w-2.5 inline" />
                        <span>{startTime} → {endTime}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          }

          // Regular message
          const msg = item.data;
          return (
            <div key={msg.id}>
              {dateSeparator}
              <div className={cn(
                "flex group",
                msg.direction === 'outbound' ? "justify-end" : "justify-start"
              )}>
              {msg.direction === 'outbound' && (
                <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity self-center mr-1 text-muted-foreground hover:text-destructive" onClick={() => handleDeleteMessage(msg)} disabled={deletingMessageId === msg.id}>
                  {deletingMessageId === msg.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                </Button>
              )}
              <div
                className={cn(
                  "max-w-[70%] rounded-2xl px-4 py-2 text-sm relative",
                  msg.direction === 'outbound'
                    ? "bg-green-600 text-white rounded-br-sm"
                    : "bg-card border rounded-bl-sm"
                )}
              >
                {/* Group sender name */}
                {isGroup && msg.direction === 'inbound' && (() => {
                  const sender = getGroupSenderInfo(msg);
                  if (!sender.phone && !sender.name) return null;
                  const handleSenderClick = async () => {
                    if (!sender.phone) return;
                    const normalizedPhone = sender.phone.replace(/\D/g, '');
                    const last8 = normalizedPhone.slice(-8);
                    
                    // Try to find existing contact
                    const { data: contact } = await supabase
                      .from('contacts')
                      .select('id')
                      .or(`phone.like.%${last8}`)
                      .limit(1)
                      .maybeSingle();
                    
                    if (contact) {
                      onViewContact?.(contact.id);
                    } else {
                      // Auto-create contact from group participant data
                      const contactName = sender.name && sender.name !== normalizedPhone
                        ? sender.name
                        : `Contato ${normalizedPhone}`;
                      
                      const { data: newContact, error } = await supabase
                        .from('contacts')
                        .insert({
                          full_name: contactName,
                          phone: normalizedPhone,
                          created_by: profile?.user_id || null,
                        })
                        .select('id')
                        .single();
                      
                      if (error) {
                        toast.error('Erro ao criar contato.');
                        return;
                      }
                      
                      toast.success(`Contato "${contactName}" criado!`);
                      onViewContact?.(newContact.id);
                    }
                  };
                  return (
                    <p
                      className={cn("text-[11px] font-semibold mb-0.5 cursor-pointer hover:underline", sender.phone ? getSenderColor(sender.phone) : 'text-primary')}
                      onClick={handleSenderClick}
                    >
                      {sender.name || formatPhone(sender.phone || '')}
                      {sender.name && sender.phone && (
                        <span className="font-normal text-muted-foreground ml-1">~{formatPhone(sender.phone)}</span>
                      )}
                    </p>
                  );
                })()}
                {/* CTWA Ad Creative Card */}
                {(() => {
                  const meta = (msg as any).metadata;
                  const msgObj = meta?.message || meta?.chat?.message || {};
                  const msgContent = msgObj?.content || msgObj?.extendedTextMessage || {};
                  const ctxInfo = msgContent?.contextInfo || msgObj?.contextInfo || msgObj?.imageMessage?.contextInfo || msgObj?.videoMessage?.contextInfo || {};
                  const adReply = ctxInfo?.externalAdReply;
                  if (!adReply) return null;
                  return (
                    <div className="mb-2 p-2 rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 max-w-[280px]">
                      {adReply.thumbnailUrl && (
                        <img src={adReply.thumbnailUrl} alt="Anúncio" className="w-full rounded-md mb-1.5 max-h-[150px] object-cover" loading="lazy" />
                      )}
                      {adReply.title && (
                        <p className="text-xs font-semibold text-blue-700 dark:text-blue-300">{adReply.title}</p>
                      )}
                      {adReply.body && (
                        <p className="text-[10px] text-blue-600 dark:text-blue-400 mt-0.5 line-clamp-3">{adReply.body}</p>
                      )}
                      <p className="text-[9px] text-blue-500 mt-1 flex items-center gap-1">📢 Click-to-WhatsApp</p>
                    </div>
                  );
                })()}
                {/* Media rendering */}
                {msg.message_type === 'audio' && msg.media_url && !isEncUrl(msg.media_url) && (
                  <div className="mb-1">
                    <audio controls className="max-w-full" preload="metadata">
                      <source
                        src={msg.media_url}
                        type={(!msg.media_type || msg.media_type === 'application/octet-stream') ? 'audio/ogg' : msg.media_type}
                      />
                      <source src={msg.media_url} type="audio/mpeg" />
                      <source src={msg.media_url} />
                      Áudio não suportado
                    </audio>
                    <a href={msg.media_url} download target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[10px] mt-1 opacity-70 hover:opacity-100">
                      <Download className="h-3 w-3" /> Baixar áudio
                    </a>
                  </div>
                )}
                {msg.message_type === 'image' && msg.media_url && !isEncUrl(msg.media_url) && (
                  <div
                    className="mb-1 relative group/img"
                    onTouchStart={() => startLongPress(msg.id)}
                    onTouchEnd={cancelLongPress}
                    onTouchMove={cancelLongPress}
                    onTouchCancel={cancelLongPress}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setDriveSelectionMode(true);
                      toggleDriveSelection(msg.id);
                    }}
                  >
                    {/* Checkbox: visível se em modo seleção, ou ao passar o mouse (desktop) */}
                    <button
                      type="button"
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); setDriveSelectionMode(true); toggleDriveSelection(msg.id); }}
                      className={cn(
                        "absolute top-2 left-2 z-10 h-7 w-7 rounded-md border-2 flex items-center justify-center transition-all text-sm font-bold",
                        selectedDriveMsgIds.has(msg.id)
                          ? "bg-blue-500 border-blue-500 text-white opacity-100"
                          : driveSelectionMode
                            ? "bg-white/90 border-white text-transparent opacity-100"
                            : "bg-white/90 border-white text-transparent opacity-0 group-hover/img:opacity-100"
                      )}
                      title={selectedDriveMsgIds.has(msg.id) ? `Posição #${getSelectionIndex(msg.id)} — clique p/ desmarcar` : 'Selecionar para Drive (Shift+clique também funciona)'}
                    >
                      {selectedDriveMsgIds.has(msg.id) ? getSelectionIndex(msg.id) : '✓'}
                    </button>
                    <a
                      href={msg.media_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => {
                        if (longPressFiredRef.current) { e.preventDefault(); longPressFiredRef.current = false; return; }
                        // Shift+clique no PC = entra no modo seleção e marca/desmarca
                        if (e.shiftKey || driveSelectionMode) {
                          e.preventDefault();
                          setDriveSelectionMode(true);
                          toggleDriveSelection(msg.id);
                        }
                      }}
                    >
                      <img
                        src={msg.media_url}
                        alt="Imagem"
                        className="max-w-full rounded-lg max-h-[320px] w-auto object-contain cursor-pointer bg-black/5"
                        loading="lazy"
                        onError={(e) => {
                          const img = e.currentTarget;
                          img.style.display = 'none';
                          const sibling = img.parentElement?.parentElement?.querySelector('[data-img-fallback]') as HTMLElement | null;
                          if (sibling) sibling.style.display = 'flex';
                        }}
                      />
                    </a>
                    <div data-img-fallback className="hidden items-center gap-2 text-xs italic opacity-70 px-2 py-3 border rounded-lg bg-muted/40">
                      🖼️ Imagem indisponível — abra no link original
                      <a href={msg.media_url} target="_blank" rel="noopener noreferrer" className="underline">abrir</a>
                    </div>
                    <a href={msg.media_url} download target="_blank" rel="noopener noreferrer" className="absolute top-2 right-2 bg-black/60 text-white rounded-full p-1.5 opacity-0 group-hover/img:opacity-100 transition-opacity" title="Baixar">
                      <Download className="h-3.5 w-3.5" />
                    </a>
                    <button
                      type="button"
                      onClick={() => handleSaveToDrive(msg)}
                      disabled={savingDriveMsgId === msg.id}
                      className="absolute top-2 right-11 bg-black/60 text-white rounded-full p-1.5 opacity-0 group-hover/img:opacity-100 transition-opacity disabled:opacity-30"
                      title={conversation.lead_id ? 'Salvar na pasta do lead no Google Drive (com classificação por IA)' : 'Salvar no Drive (escolha ou crie um lead)'}
                    >
                      {savingDriveMsgId === msg.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                )}
                {msg.message_type === 'video' && msg.media_url && !isEncUrl(msg.media_url) && (
                  <div className="mb-1">
                    <video controls className="max-w-full rounded-lg max-h-[320px]" preload="metadata">
                      <source src={msg.media_url} type={msg.media_type || 'video/mp4'} />
                    </video>
                    <a href={msg.media_url} download target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[10px] mt-1 opacity-70 hover:opacity-100">
                      <Download className="h-3 w-3" /> Baixar vídeo
                    </a>
                  </div>
                )}
                {msg.message_type === 'document' && msg.media_url && !isEncUrl(msg.media_url) && (() => {
                  const isPdf = (msg.media_type || '').includes('pdf') || /\.pdf($|\?)/i.test(msg.media_url);
                  const fileName = msg.message_text || (msg.media_url.split('/').pop()?.split('?')[0]) || 'Documento';
                  return (
                    <div
                      className="mb-1 space-y-1"
                      onTouchStart={() => startLongPress(msg.id)}
                      onTouchEnd={cancelLongPress}
                      onTouchMove={cancelLongPress}
                      onTouchCancel={cancelLongPress}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setDriveSelectionMode(true);
                        toggleDriveSelection(msg.id);
                      }}
                    >
                      {isPdf && (
                        <div className="rounded-lg overflow-hidden border bg-white">
                          <object data={msg.media_url} type="application/pdf" className="w-full h-[360px]">
                            <iframe src={msg.media_url} className="w-full h-[360px]" title={fileName} />
                          </object>
                        </div>
                      )}
                      <div className="group/doc flex items-center gap-2 px-2 py-1.5 rounded-md bg-muted/40">
                        <button
                          type="button"
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setDriveSelectionMode(true); toggleDriveSelection(msg.id); }}
                          className={cn(
                            "h-6 w-6 rounded border-2 flex items-center justify-center shrink-0 transition-all text-[11px] font-bold",
                            selectedDriveMsgIds.has(msg.id)
                              ? "bg-blue-500 border-blue-500 text-white opacity-100"
                              : driveSelectionMode
                                ? "bg-background border-muted-foreground/40 text-transparent opacity-100"
                                : "bg-background border-muted-foreground/40 text-transparent opacity-0 group-hover/doc:opacity-100"
                          )}
                          title={selectedDriveMsgIds.has(msg.id) ? `Posição #${getSelectionIndex(msg.id)} — clique p/ desmarcar` : 'Selecionar para Drive (Shift+clique também funciona)'}
                        >
                          {selectedDriveMsgIds.has(msg.id) ? getSelectionIndex(msg.id) : '✓'}
                        </button>
                        <FileText className="h-4 w-4 text-orange-500 shrink-0" />
                        <a
                          href={msg.media_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => {
                            if (e.shiftKey || driveSelectionMode) {
                              e.preventDefault();
                              setDriveSelectionMode(true);
                              toggleDriveSelection(msg.id);
                            }
                          }}
                          className="flex-1 text-xs underline truncate"
                        >
                          {fileName}
                        </a>
                        <a href={msg.media_url} download target="_blank" rel="noopener noreferrer" className="opacity-70 hover:opacity-100" title="Baixar">
                          <Download className="h-3.5 w-3.5" />
                        </a>
                        <button
                          type="button"
                          onClick={() => handleSaveToDrive(msg)}
                          disabled={savingDriveMsgId === msg.id}
                          className="opacity-70 hover:opacity-100 disabled:opacity-40"
                          title={conversation.lead_id ? 'Salvar na pasta do lead no Google Drive (com classificação por IA)' : 'Salvar no Drive (escolha ou crie um lead)'}
                        >
                          {savingDriveMsgId === msg.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Sparkles className="h-3.5 w-3.5 text-blue-500" />
                          )}
                        </button>
                      </div>
                    </div>
                  );
                })()}
                {msg.media_url && msg.message_type === 'text' && (
                  <div className="flex items-center gap-2 mb-1">
                    <a href={msg.media_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs underline">
                      <ExternalLink className="h-3 w-3" /> {msg.media_type || 'Mídia'}
                    </a>
                    <a href={msg.media_url} download target="_blank" rel="noopener noreferrer" className="opacity-70 hover:opacity-100">
                      <Download className="h-3.5 w-3.5" />
                    </a>
                  </div>
                )}
                {msg.message_text && (
                  <p className="whitespace-pre-wrap">
                    {msg.message_type === 'audio' && (
                      <span className="text-[10px] font-medium text-muted-foreground block mb-0.5">🎤 Transcrição:</span>
                    )}
                    {msg.message_text}
                  </p>
                )}
                {isMissingMedia(msg) && (
                  <div className="mb-1 flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed bg-muted/40">
                    <span className="text-xs italic opacity-80 flex-1">
                      📎 {msg.message_type === 'image' ? 'Imagem' : msg.message_type === 'document' ? 'Documento' : msg.message_type === 'video' ? 'Vídeo' : 'Áudio'} criptografado — clique para sincronizar
                    </span>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="h-7 px-2 text-[11px] gap-1"
                      disabled={resyncingMsgId === msg.id}
                      onClick={() => handleResyncMedia(msg)}
                    >
                      {resyncingMsgId === msg.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3 w-3" />
                      )}
                      Sincronizar
                    </Button>
                  </div>
                )}
                <p className={cn(
                  "text-[10px] mt-1",
                  msg.direction === 'outbound' ? "text-green-200" : "text-muted-foreground"
                )}>
                  {format(new Date(msg.created_at), "HH:mm", { locale: ptBR })}
                </p>
              </div>
              {msg.direction === 'inbound' && (
                <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity self-center ml-1 text-muted-foreground hover:text-destructive" onClick={() => handleDeleteMessage(msg)} disabled={deletingMessageId === msg.id}>
                  {deletingMessageId === msg.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                </Button>
              )}
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className={cn(
        "p-3 border-t shrink-0 space-y-2",
        inputMode === 'note' ? "bg-amber-50/80 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800"
          : inputMode === 'chat' ? "bg-blue-50/80 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800"
          : "bg-card"
      )}>
        {/* Internal mode banner */}
        {(inputMode === 'note' || inputMode === 'chat') && (
          <div className={cn(
            "flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs",
            inputMode === 'chat' ? "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300" : "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300"
          )}>
            {inputMode === 'chat' ? <MessageCircle className="h-3.5 w-3.5 shrink-0" /> : <StickyNote className="h-3.5 w-3.5 shrink-0" />}
            <span className="flex-1 font-medium">
              {inputMode === 'chat'
                ? (mentionUserName ? `Chat interno → @${mentionUserName}` : 'Chat interno — selecione um membro')
                : 'Nota interna — não será enviada ao contato'
              }
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 text-current hover:text-destructive"
              onClick={() => { setInputMode('message'); setMentionUserId(null); setMentionUserName(null); setShowMentionPicker(false); }}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        )}
        {/* Mention picker for chat mode */}
        {showMentionPicker && (
          <div className="border rounded-lg bg-card p-2 space-y-1 max-h-[200px] overflow-y-auto">
            <p className="text-xs font-medium text-muted-foreground px-1 mb-1">Selecione o membro da equipe:</p>
            {teamMembers.map(member => (
              <button
                key={member.user_id}
                className={cn(
                  "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-left transition-colors hover:bg-blue-50 dark:hover:bg-blue-950/30",
                  mentionUserId === member.user_id && "bg-blue-100 dark:bg-blue-900/40"
                )}
                onClick={() => {
                  setMentionUserId(member.user_id);
                  setMentionUserName(member.full_name);
                  setShowMentionPicker(false);
                }}
              >
                <div className="h-6 w-6 rounded-full bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center text-xs font-medium text-blue-700 dark:text-blue-300 shrink-0">
                  {(member.full_name || '?')[0].toUpperCase()}
                </div>
                <span className="truncate">{member.full_name}</span>
              </button>
            ))}
          </div>
        )}
        <div className="flex items-center justify-end gap-2 flex-wrap">
          {inputMode === 'message' && identifySender && (
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
          {inputMode === 'message' && (
            <>
              <Label htmlFor="identify-sender" className="text-xs text-muted-foreground cursor-pointer">
                Identificar remetente
              </Label>
              {shareInfo ? (
                <Badge variant={shareInfo.identify_sender ? 'default' : 'secondary'} className="text-[9px]">
                  {shareInfo.identify_sender ? 'Identificado' : 'Anônimo'}
                </Badge>
              ) : (
                <Switch
                  id="identify-sender"
                  checked={identifySender}
                  onCheckedChange={handleToggleIdentifySender}
                />
              )}
            </>
          )}
        </div>
        {/* Pasted image preview */}
        {pastedImage && (
          <div className="flex items-start gap-3 p-2 bg-muted/50 rounded-lg border">
            <img src={pastedImage.previewUrl} alt="Preview" className="h-20 w-20 object-cover rounded-md border" />
            <div className="flex-1 min-w-0 space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Imagem colada da área de transferência</p>
              <Input
                placeholder="Legenda (opcional)..."
                value={pastedCaption}
                onChange={e => setPastedCaption(e.target.value)}
                onKeyDown={handleKeyDown}
                className="h-8 text-sm"
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-1 shrink-0">
              <Button size="icon" className="h-8 w-8 bg-green-600 hover:bg-green-700" onClick={handleSendPastedImage} disabled={uploadingMedia}>
                {uploadingMedia ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
              </Button>
              <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={handleCancelPastedImage}>
                <X className="h-3 w-3" />
              </Button>
            </div>
          </div>
        )}
        {/* Recording UI */}
        {isRecording ? (
          <div className="flex items-center gap-2 bg-destructive/10 rounded-lg px-3 py-2">
            <div className="h-3 w-3 rounded-full bg-destructive animate-pulse" />
            <span className="text-sm font-medium text-destructive flex-1">
              Gravando... {Math.floor(recordingTime / 60).toString().padStart(2, '0')}:{(recordingTime % 60).toString().padStart(2, '0')}
            </span>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={cancelRecording}>
              <Trash2 className="h-4 w-4" />
            </Button>
            <Button size="icon" className="h-8 w-8 bg-green-600 hover:bg-green-700" onClick={stopRecording}>
              <Send className="h-4 w-4" />
            </Button>
          </div>
        ) : !pastedImage && (
          <div className="flex gap-1 items-end">
            {/* Attach menu with internal options */}
            <DropdownMenu open={showAttachMenu} onOpenChange={setShowAttachMenu}>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-10 w-10 shrink-0 text-muted-foreground">
                  {uploadingMedia ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-48">
                {inputMode !== 'message' && (
                  <DropdownMenuItem onClick={() => { setInputMode('message'); setMentionUserId(null); setMentionUserName(null); setShowMentionPicker(false); setShowAttachMenu(false); }} className="gap-2">
                    <MessageSquare className="h-4 w-4" /> Mensagem
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => { mediaInputRef.current?.click(); }} className="gap-2">
                  <Image className="h-4 w-4" /> Foto / Vídeo
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => { 
                  const input = document.createElement('input');
                  input.type = 'file';
                  input.accept = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip';
                  input.onchange = (e: any) => handleMediaUpload(e);
                  input.click();
                }} className="gap-2">
                  <FileUp className="h-4 w-4" /> Documento
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => { setShowLocationDialog(true); setShowAttachMenu(false); }} className="gap-2">
                  <MapPin className="h-4 w-4" /> Localização
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => { setInputMode('note'); setMentionUserId(null); setMentionUserName(null); setShowMentionPicker(false); setShowAttachMenu(false); }} className="gap-2 text-amber-600 dark:text-amber-400">
                  <StickyNote className="h-4 w-4" /> Nota Interna
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => { setInputMode('chat'); setShowMentionPicker(true); setShowAttachMenu(false); }} className="gap-2 text-blue-600 dark:text-blue-400">
                  <AtSign className="h-4 w-4" /> Chat Interno
                </DropdownMenuItem>
                {onCreateActivity && (
                  <DropdownMenuItem onClick={() => {
                    setShowAttachMenu(false);
                    if (conversation.lead_id) {
                      onCreateActivity(conversation.lead_id, conversation.contact_name || conversation.phone, conversation.contact_id || undefined, conversation.contact_name || undefined);
                    } else {
                      onCreateActivity('', conversation.contact_name || conversation.phone, conversation.contact_id || undefined, conversation.contact_name || undefined);
                    }
                  }} className="gap-2 text-green-600 dark:text-green-400">
                    <ClipboardList className="h-4 w-4" /> Criar Atividade
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <input ref={mediaInputRef} type="file" accept="image/*,video/*" className="hidden" onChange={handleMediaUpload} />
            <Textarea
              placeholder={
                inputMode === 'note' ? "Nota interna (não será enviada ao contato)..."
                  : inputMode === 'chat' ? (mentionUserName ? `Mensagem para @${mentionUserName}...` : "Selecione um membro acima...")
                  : "Digite uma mensagem..."
              }
              value={newMessage}
              onChange={e => setNewMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={inputMode === 'message' ? handlePaste : undefined}
              className={cn(
                "min-h-[44px] max-h-[120px] resize-none text-sm flex-1",
                inputMode === 'note' && "border-amber-300 dark:border-amber-700 bg-amber-50/50 dark:bg-amber-950/20",
                inputMode === 'chat' && "border-blue-300 dark:border-blue-700 bg-blue-50/50 dark:bg-blue-950/20"
              )}
              rows={1}
            />
            {newMessage.trim() ? (
              <Button
                size="icon"
                className={cn(
                  "h-10 w-10 shrink-0",
                  inputMode === 'note' ? "bg-amber-500 hover:bg-amber-600"
                    : inputMode === 'chat' ? "bg-blue-600 hover:bg-blue-700"
                    : "bg-green-600 hover:bg-green-700"
                )}
                onClick={handleSend}
                disabled={sending}
              >
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            ) : inputMode === 'message' ? (
              <Button
                size="icon"
                variant="ghost"
                className="h-10 w-10 shrink-0 text-muted-foreground hover:text-green-600"
                onClick={startRecording}
                disabled={uploadingMedia}
              >
                <Mic className="h-4 w-4" />
              </Button>
            ) : null}
          </div>
        )}
        {/* Location Dialog */}
        <Dialog open={showLocationDialog} onOpenChange={setShowLocationDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2"><MapPin className="h-5 w-5" /> Enviar Localização</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <Button variant="outline" className="w-full gap-2" onClick={handleGetCurrentLocation}>
                <MapPin className="h-4 w-4" /> Usar minha localização atual
              </Button>
              <div className="grid grid-cols-2 gap-2">
                <div><Label className="text-xs">Latitude</Label><Input value={locationLat} onChange={e => setLocationLat(e.target.value)} placeholder="-23.5505" className="h-8 text-sm" /></div>
                <div><Label className="text-xs">Longitude</Label><Input value={locationLng} onChange={e => setLocationLng(e.target.value)} placeholder="-46.6333" className="h-8 text-sm" /></div>
              </div>
              <div><Label className="text-xs">Nome do local (opcional)</Label><Input value={locationName} onChange={e => setLocationName(e.target.value)} placeholder="Escritório" className="h-8 text-sm" /></div>
              <div><Label className="text-xs">Endereço (opcional)</Label><Input value={locationAddress} onChange={e => setLocationAddress(e.target.value)} placeholder="Rua..." className="h-8 text-sm" /></div>
              <Button className="w-full bg-green-600 hover:bg-green-700 gap-2" onClick={handleSendLocation} disabled={!locationLat || !locationLng}>
                <Send className="h-4 w-4" /> Enviar localização
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
      <SessionFieldEditor
        open={showSessionEditor}
        onOpenChange={setShowSessionEditor}
        phone={conversation.phone}
        instanceName={conversation.instance_name || undefined}
      />
    </div>
  );
}
