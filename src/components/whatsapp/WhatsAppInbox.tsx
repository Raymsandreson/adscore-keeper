import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useWhatsAppMessages, WhatsAppConversation } from '@/hooks/useWhatsAppMessages';
import { usePageState } from '@/hooks/usePageState';
import { useWhatsAppInstanceStatus } from '@/hooks/useWhatsAppInstanceStatus';
import { WhatsAppConversationList } from './WhatsAppConversationList';
import { WhatsAppChat } from './WhatsAppChat';
import { WhatsAppSetupGuide } from './WhatsAppSetupGuide';
import { WhatsAppSettingsPage } from './WhatsAppSettingsPage';
import { WhatsAppReconnectDialog } from './WhatsAppReconnectDialog';
import { WhatsAppActivitySheet } from './WhatsAppActivitySheet';
import { WhatsAppLeadsDashboard } from './WhatsAppLeadsDashboard';
import { BulkLeadCreationDialog } from './BulkLeadCreationDialog';
import { GoogleIntegrationPanel } from '@/components/GoogleIntegrationPanel';
import { useGoogleIntegration } from '@/hooks/useGoogleIntegration';
import { CreateContactDialog } from '@/components/contacts/CreateContactDialog';
import { CreateCaseFromWhatsAppDialog } from './CreateCaseFromWhatsAppDialog';
import { ZapSignLeadCreationListener } from './ZapSignLeadCreationListener';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { MessageSquare, Settings, RefreshCw, Smartphone, BarChart3, Chrome, ListChecks, AlertTriangle, WifiOff, X, Sparkles, Check, Loader2, Download, Users, List, Contact2 } from 'lucide-react';

import { LeadEditDialog } from '@/components/kanban/LeadEditDialog';
import { ContactDetailSheet } from '@/components/contacts/ContactDetailSheet';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { Lead } from '@/hooks/useLeads';
import type { Contact } from '@/hooks/useContacts';
import { useKanbanBoards } from '@/hooks/useKanbanBoards';
import { useModulePermissions } from '@/hooks/useModulePermissions';
import { useAuthContext } from '@/contexts/AuthContext';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';

const FIELD_LABELS: Record<string, string> = {
  lead_name: 'Nome do Lead', victim_name: 'Nome da Vítima', lead_email: 'E-mail', lead_phone: 'Telefone',
  city: 'Cidade', state: 'Estado', neighborhood: 'Bairro', main_company: 'Empresa Principal',
  contractor_company: 'Empresa Contratante', accident_address: 'Local do Acidente', accident_date: 'Data do Acidente',
  damage_description: 'Descrição do Dano', case_number: 'Nº do Processo', case_type: 'Tipo do Caso',
  notes: 'Observações', sector: 'Setor', visit_city: 'Cidade (Visita)', visit_state: 'Estado (Visita)',
  visit_address: 'Endereço (Visita)', liability_type: 'Tipo de Responsabilidade', news_link: 'Link da Notícia',
  full_name: 'Nome Completo', phone: 'Telefone', email: 'E-mail', instagram_url: 'Instagram', profession: 'Profissão',
};
const fieldLabel = (key: string) => FIELD_LABELS[key] || key.replace(/_/g, ' ');

interface PrivateConv {
  phone: string;
  instance_name: string;
  private_by: string;
}

interface ConvShare {
  phone: string;
  instance_name: string;
  identify_sender: boolean;
  can_reshare: boolean;
  shared_by: string;
}

const getConversationKey = (phone: string, instanceName?: string | null) =>
  `${(phone || '').trim()}__${(instanceName || '').trim().toLowerCase()}`;

// Force clean rebuild
export function WhatsAppInbox() {
  // null = ainda não resolvi qual instância usar (não buscar nada).
  // 'all' ou um id = pronto para buscar.
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);
  const { conversations, loading, instanceSwitching, switchProgress, instances, instanceStats, statsLoading, hasLoaded, sendMessage, sendMedia, sendLocation, deleteMessage, clearConversation, markAsRead, linkToLead, linkToContact, refetch, refetchStats, fetchFullConversation } = useWhatsAppMessages(selectedInstanceId);
  const { statuses, disconnectedInstances, loading: statusLoading, refetchStatus } = useWhatsAppInstanceStatus(instances.length > 0);
  const [dismissedAlert, setDismissedAlert] = useState(false);
  const [reconnectInstance, setReconnectInstance] = useState<{ id: string; name: string } | null>(null);
  const { boards } = useKanbanBoards();
  const { canView } = useModulePermissions();
  const { user } = useAuthContext();
  const { isConnected: googleConnected, importContacts: googleImportContacts } = useGoogleIntegration();
  const [importingGoogle, setImportingGoogle] = useState(false);
  const [importingWhatsApp, setImportingWhatsApp] = useState(false);
  const [creatingLead, setCreatingLead] = useState(false);

  // Default instance do perfil do usuário (fonte da verdade para alertas e fallback).
  const [userDefaultInstanceId, setUserDefaultInstanceId] = useState<string | null>(null);

  // Filtra alertas de desconexão: só mostra se a instância caída é a default do user.
  // Admins continuam vendo todas (não têm default específico ou enxergam o pool inteiro).
  const relevantDisconnectedInstances = useMemo(() => {
    if (!userDefaultInstanceId) return [];
    return disconnectedInstances.filter((inst) => inst.id === userDefaultInstanceId);
  }, [disconnectedInstances, userDefaultInstanceId]);

  const disconnectedSignature = useMemo(
    () => relevantDisconnectedInstances.map((inst) => inst.id).sort().join('|'),
    [relevantDisconnectedInstances]
  );

  useEffect(() => {
    setDismissedAlert(false);
  }, [disconnectedSignature]);

  // Auto-select default instance on mount.
  // Ordem de prioridade (corrigida): perfil.default_instance_id > localStorage > primeira disponível.
  // O default do perfil é soberano: se existir e estiver na lista de instâncias do user, ganha sempre.
  const [defaultInstanceApplied, setDefaultInstanceApplied] = useState(false);
  useEffect(() => {
    if (defaultInstanceApplied || !user || instances.length === 0) return;
    const applyDefault = async () => {
      // 1. Perfil default (fonte primária)
      const { data } = await supabase.from('profiles').select('default_instance_id').eq('user_id', user.id).single();
      const defaultId = (data as any)?.default_instance_id || null;
      setUserDefaultInstanceId(defaultId);

      if (defaultId && instances.some(i => i.id === defaultId)) {
        setSelectedInstanceId(defaultId);
        setDefaultInstanceApplied(true);
        return;
      }
      // 2. Fallback: localStorage da última usada
      const lastUsed = localStorage.getItem('whatsapp_last_instance_id');
      if (lastUsed && instances.some(i => i.id === lastUsed)) {
        setSelectedInstanceId(lastUsed);
        setDefaultInstanceApplied(true);
        return;
      }
      // 3. Fallback final: primeira instância disponível
      setSelectedInstanceId(instances[0].id);
      setDefaultInstanceApplied(true);
    };
    applyDefault();
  }, [user, instances, defaultInstanceApplied]);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedPhone, setSelectedPhone] = usePageState<string | null>('wa_selected_phone', null);

  const handleOpenChatByPhone = useCallback(async (phone: string) => {
    if (!phone) return;

    try {
      const { data: latestMessage } = await supabase
        .from('whatsapp_messages')
        .select('instance_name')
        .eq('phone', phone)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

        const targetInstanceName = latestMessage?.instance_name || null;
      if (targetInstanceName) {
        const targetInstance = instances.find((instance) => instance.instance_name === targetInstanceName);
        if (targetInstance && selectedInstanceId !== targetInstance.id) {
          setSelectedInstanceId(targetInstance.id);
        } else if (!targetInstance && selectedInstanceId !== 'all') {
          setSelectedInstanceId('all');
        }
          setSelectedInstance(targetInstance?.instance_name || targetInstanceName);
      } else {
        if (selectedInstanceId !== 'all') {
          setSelectedInstanceId('all');
        }
        setSelectedInstance(null);
      }

      setSelectedPhone(phone);
      fetchFullConversation(phone, targetInstanceName);
    } catch (error) {
      console.error('Error opening chat by phone:', error);
      setSelectedInstance(null);
      setSelectedPhone(phone);
      fetchFullConversation(phone, null);
    }
  }, [instances, selectedInstanceId, fetchFullConversation]);

  // Deep link: auto-open chat from URL params (openChat, contactId, leadId)
  useEffect(() => {
    if (!hasLoaded) return;
    const openChat = searchParams.get('openChat');
    const contactId = searchParams.get('contactId');
    const leadId = searchParams.get('leadId');

    if (openChat) {
      handleOpenChatByPhone(openChat);
      searchParams.delete('openChat');
      setSearchParams(searchParams, { replace: true });
    } else if (contactId) {
      supabase.from('contacts').select('phone').eq('id', contactId).single().then(({ data }) => {
        if (data?.phone) {
          const normalized = data.phone.replace(/\D/g, '');
          const match = conversations.find(c => c.phone.replace(/\D/g, '').endsWith(normalized.slice(-8)));
          handleOpenChatByPhone(match?.phone || normalized);
        }
      });
      searchParams.delete('contactId');
      setSearchParams(searchParams, { replace: true });
    } else if (leadId) {
      supabase.from('contact_leads').select('contact_id, contacts(phone)').eq('lead_id', leadId).limit(1).single().then(({ data }) => {
        const phone = (data as any)?.contacts?.phone;
        if (phone) {
          const normalized = phone.replace(/\D/g, '');
          const match = conversations.find(c => c.phone.replace(/\D/g, '').endsWith(normalized.slice(-8)));
          handleOpenChatByPhone(match?.phone || normalized);
        }
      });
      searchParams.delete('leadId');
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, hasLoaded, conversations, handleOpenChatByPhone, setSearchParams]);
  const [showSetup, setShowSetup] = useState(false);
  const [showDashboard, setShowDashboard] = useState(false);
  const [showGooglePanel, setShowGooglePanel] = useState(false);
  const [settingsTab, setSettingsTab] = useState<string>('instances');
  // Side panel state
  const [editingLead, setEditingLead] = useState<Lead | null>(null);
  const [showLeadPanel, setShowLeadPanel] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [showContactPanel, setShowContactPanel] = useState(false);
  // Create contact dialog
  const [showCreateContactDialog, setShowCreateContactDialog] = useState(false);
  const [showCreateCaseDialog, setShowCreateCaseDialog] = useState(false);

  // Activity sheet state
  const [showActivitySheet, setShowActivitySheet] = useState(false);
  const [activityDefaults, setActivityDefaults] = useState<{ leadId?: string; leadName?: string; contactId?: string; contactName?: string }>({});
  const [showBoardPicker, setShowBoardPicker] = useState(false);
  const [selectedBoardId, setSelectedBoardId] = useState<string>('');
  const [aiPreview, setAiPreview] = useState<{ leadFields: Record<string, string>; contactFields: Record<string, string> } | null>(null);
  const [showAiPreview, setShowAiPreview] = useState(false);
  // Bulk selection state
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkSelectedPhones, setBulkSelectedPhones] = useState<Set<string>>(new Set());
  const [showBulkDialog, setShowBulkDialog] = useState(false);

  // Private conversations
  const [privateConvs, setPrivateConvs] = useState<PrivateConv[]>([]);
  const canViewPrivate = canView('whatsapp_private');

  // Shared conversations
  const [sharedConvs, setSharedConvs] = useState<ConvShare[]>([]);
  const [sharedMessages, setSharedMessages] = useState<WhatsAppConversation[]>([]);

  useEffect(() => {
    const fetchPrivate = async () => {
      const { data } = await supabase
        .from('whatsapp_private_conversations')
        .select('phone, instance_name, private_by');
      setPrivateConvs((data || []) as PrivateConv[]);
    };
    fetchPrivate();
  }, []);

  // Fetch shared conversation records for this user
  useEffect(() => {
    if (!user) return;
    const fetchShared = async () => {
      const { data } = await supabase
        .from('whatsapp_conversation_shares')
        .select('phone, instance_name, identify_sender, can_reshare, shared_by')
        .eq('shared_with', user.id);
      const shares = (data || []) as ConvShare[];
      setSharedConvs(shares);

      // Fetch messages for shared conversations that may not be in the user's instances
      if (shares.length === 0) {
        setSharedMessages([]);
        return;
      }

      const phones = [...new Set(shares.map(s => s.phone))];
      const { data: msgs } = await supabase
        .from('whatsapp_messages')
        .select('*')
        .in('phone', phones)
        .order('created_at', { ascending: false })
        .limit(500);

      if (!msgs) { setSharedMessages([]); return; }

      // Build conversations from messages — keyed by phone + instance_name to avoid
      // collisions when the same phone exists across multiple WhatsApp instances.
      const convMap = new Map<string, WhatsAppConversation>();
      for (const msg of msgs) {
        // Only include messages from shared instances
        const isShared = shares.some(
          s => getConversationKey(s.phone, s.instance_name) === getConversationKey(msg.phone, msg.instance_name)
        );
        if (!isShared) continue;

        const convKey = getConversationKey(msg.phone, msg.instance_name);
        const existing = convMap.get(convKey);
        if (!existing) {
          convMap.set(convKey, {
            phone: msg.phone,
            contact_name: msg.contact_name,
            contact_id: msg.contact_id,
            lead_id: msg.lead_id,
            last_message: msg.message_text,
            last_message_at: msg.created_at,
            unread_count: !msg.read_at && msg.direction === 'inbound' ? 1 : 0,
            messages: [msg],
            instance_name: msg.instance_name,
          });
        } else {
          existing.messages.push(msg);
          if (!msg.read_at && msg.direction === 'inbound') existing.unread_count++;
          if (!existing.contact_name && msg.contact_name) existing.contact_name = msg.contact_name;
          if (!existing.contact_id && msg.contact_id) existing.contact_id = msg.contact_id;
          if (!existing.lead_id && msg.lead_id) existing.lead_id = msg.lead_id;
          if (new Date(msg.created_at).getTime() > new Date(existing.last_message_at).getTime()) {
            existing.last_message = msg.message_text;
            existing.last_message_at = msg.created_at;
          }
        }
      }
      setSharedMessages(Array.from(convMap.values()));
    };
    fetchShared();
  }, [user, hasLoaded]);

  // Filter out private conversations the user can't see and merge shared conversations
  const visibleConversations = useMemo(() => {
    if (!user) return conversations;

    const filtered = conversations.filter(conv => {
      const priv = privateConvs.find(
        p => getConversationKey(p.phone, p.instance_name) === getConversationKey(conv.phone, conv.instance_name)
      );
      if (!priv) return true;
      if (priv.private_by === user.id) return true;
      if (canViewPrivate) return true;
      return false;
    });

    // Merge shared conversations that aren't already in the list — key by phone + instance
    // so a shared conv on instance B isn't dropped just because the user already has the
    // same phone on instance A.
    const existingKeys = new Set(filtered.map(c => getConversationKey(c.phone, c.instance_name)));
    for (const sharedConv of sharedMessages) {
      const key = getConversationKey(sharedConv.phone, sharedConv.instance_name);
      if (!existingKeys.has(key)) {
        filtered.push(sharedConv);
        existingKeys.add(key);
      }
    }

    return filtered.sort(
      (a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime()
    );
  }, [conversations, privateConvs, sharedMessages, user, canViewPrivate]);

  const [selectedInstance, setSelectedInstance] = usePageState<string | null>('wa_selected_instance', null);
  const selectedConversation = visibleConversations.find(
    c => selectedPhone === c.phone && getConversationKey(c.phone, c.instance_name) === getConversationKey(selectedPhone || '', selectedInstance)
  ) || null;

  // Reidrata o histórico completo ao remontar (reload, troca de aba, navegação interna).
  // Importante: não basta rodar uma vez por chave, porque a lista-resumo pode sobrescrever
  // a conversa depois que a instância padrão é resolvida. Então reidratamos sempre que a
  // conversa ativa existir apenas com a mensagem-resumo.
  const rehydratingKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!hasLoaded || selectedInstanceId === null || !selectedPhone || !selectedInstance) return;

    const key = `${selectedPhone}__${(selectedInstance || '').toLowerCase()}`;
    const needsHydration = !selectedConversation || selectedConversation.messages.length <= 1;

    if (!needsHydration) return;
    if (rehydratingKeyRef.current === key) return;

    rehydratingKeyRef.current = key;
    Promise.resolve(fetchFullConversation(selectedPhone, selectedInstance)).finally(() => {
      if (rehydratingKeyRef.current === key) {
        rehydratingKeyRef.current = null;
      }
    });
  }, [
    hasLoaded,
    selectedInstanceId,
    selectedPhone,
    selectedInstance,
    selectedConversation,
    fetchFullConversation,
  ]);

  const totalUnread = visibleConversations.reduce((sum, c) => sum + c.unread_count, 0);

  const handleSelectConversation = (conv: WhatsAppConversation) => {
    setSelectedPhone(conv.phone);
    setSelectedInstance(conv.instance_name);
    fetchFullConversation(conv.phone, conv.instance_name);
    if (conv.unread_count > 0) {
      markAsRead(conv.phone, conv.instance_name);
    }
  };

  const [extracting, setExtracting] = useState(false);
  const [extractionStep, setExtractionStep] = useState('');
  const [contactDefaults, setContactDefaults] = useState<Record<string, string>>({});

  const extractConversationData = async (targetType: 'lead' | 'contact') => {
    if (!selectedConversation?.phone || !selectedInstance) return {};
    try {
      setExtracting(true);
      setExtractionStep(targetType === 'lead' ? 'Extraindo dados do lead...' : 'Extraindo dados do contato...');
      const { data, error } = await cloudFunctions.invoke('extract-conversation-data', {
        body: {
          phone: selectedConversation.phone,
          instance_name: selectedInstance,
          targetType,
        },
      });
      if (error) throw error;
      setExtractionStep('Dados extraídos!');
      return data?.data || data?.result || {};
    } catch (e) {
      console.error('Extraction error:', e);
      setExtractionStep('');
      return {};
    } finally {
      setExtracting(false);
    }
  };

  const handleCreateLead = () => {
    if (!selectedConversation) return;
    const funnelBoards = boards.filter(b => b.board_type !== 'workflow');
    if (funnelBoards.length === 1) {
      createLeadWithBoard(funnelBoards[0].id);
    } else {
      setSelectedBoardId(funnelBoards[0]?.id || '');
      setShowBoardPicker(true);
    }
  };

  const createLeadWithBoard = async (boardId: string) => {
    if (!selectedConversation || !boardId || creatingLead) return;
    setCreatingLead(true);
    try {
      const { data: { user: currentUser } } = await supabase.auth.getUser();

      // Extract both lead and contact data in parallel
      const [extracted, contactExtracted] = await Promise.all([
        extractConversationData('lead'),
        extractConversationData('contact'),
      ]);

      const insertData: Record<string, any> = {
        lead_name: extracted.lead_name || contactExtracted.full_name || selectedConversation.contact_name || 'Novo Lead - WhatsApp',
        lead_phone: selectedConversation.phone || null,
        lead_email: extracted.lead_email || contactExtracted.email || null,
        source: 'whatsapp',
        created_by: currentUser?.id || null,
        board_id: boardId,
        city: extracted.city || contactExtracted.city || null,
        state: extracted.state || contactExtracted.state || null,
        neighborhood: extracted.neighborhood || contactExtracted.neighborhood || null,
        action_source: 'system',
      };

      // Merge extracted fields
      const leadFields = [
        'victim_name', 'main_company', 'contractor_company', 'accident_address', 'accident_date',
        'damage_description', 'case_number', 'case_type', 'notes', 'sector',
        'visit_city', 'visit_state', 'visit_address', 'liability_type', 'news_link',
      ];
      for (const field of leadFields) {
        if (extracted[field]) {
          insertData[field] = extracted[field];
        }
      }

      const { data, error } = await supabase
        .from('leads')
        .insert(insertData)
        .select('*')
        .single();

      if (error) throw error;

      linkToLead(selectedConversation.phone, data.id, selectedConversation.instance_name);

      // Use already-extracted contact data
      const contactName = contactExtracted.full_name || selectedConversation.contact_name || 'Contato WhatsApp';
      
      // Check if contact with same phone already exists
      const normalizedPhone = selectedConversation.phone.replace(/\D/g, '');
      const { data: existingContact } = await supabase
        .from('contacts')
        .select('id, full_name')
        .or(`phone.eq.${selectedConversation.phone},phone.eq.${normalizedPhone},phone.ilike.%${normalizedPhone.slice(-8)}%`)
        .limit(1)
        .maybeSingle();

      let contactId: string;
      if (existingContact) {
        contactId = existingContact.id;
        toast.info(`Contato "${existingContact.full_name}" já existente foi vinculado`);
      } else {
        const contactInsert: Record<string, any> = {
          full_name: contactName,
          phone: selectedConversation.phone,
          created_by: currentUser?.id || null,
        };
        if (contactExtracted.email) contactInsert.email = contactExtracted.email;
        if (contactExtracted.city) contactInsert.city = contactExtracted.city;
        if (contactExtracted.state) contactInsert.state = contactExtracted.state;
        if (contactExtracted.instagram_url) contactInsert.instagram_url = contactExtracted.instagram_url;

        const { data: newContact, error: contactError } = await supabase
          .from('contacts')
          .insert([contactInsert] as any)
          .select('id')
          .single();
        if (contactError) throw contactError;
        contactId = newContact.id;
      }

      // Link contact to lead
      await supabase.from('contact_leads').insert({
        contact_id: contactId,
        lead_id: data.id,
        relationship_to_victim: 'Vítima',
      });

      // Link contact to conversation
      await linkToContact(selectedConversation.phone, contactId, selectedConversation.instance_name);

      setEditingLead(data as Lead);
      setShowLeadPanel(true);
      setShowBoardPicker(false);
      
      toast.success('Lead e contato criados com dados da conversa!');
    } catch (e) {
      console.error(e);
      toast.error('Erro ao criar lead');
    } finally {
      setCreatingLead(false);
    }
  };

  const handleCreateContact = async () => {
    if (!selectedConversation) return;
    // Extract data from conversation
    const extracted = await extractConversationData('contact');
    setContactDefaults(extracted);
    setShowCreateContactDialog(true);
  };

  const handleUpdateWithAI = async () => {
    if (!selectedConversation) return;
    try {
      const leadFields: Record<string, string> = {};
      const contactFields: Record<string, string> = {};

      if (selectedConversation.lead_id) {
        setExtractionStep('Analisando conversa para o lead...');
        const extracted = await extractConversationData('lead');
        const allowedLeadFields = [
          'lead_name', 'victim_name', 'lead_email', 'city', 'state', 'neighborhood',
          'main_company', 'contractor_company', 'accident_address', 'accident_date',
          'damage_description', 'case_number', 'case_type', 'notes', 'sector',
          'visit_city', 'visit_state', 'visit_address', 'liability_type', 'news_link',
        ];
        for (const field of allowedLeadFields) {
          if (extracted[field]) leadFields[field] = extracted[field];
        }
      }

      if (selectedConversation.contact_id) {
        setExtractionStep('Analisando conversa para o contato...');
        const extracted = await extractConversationData('contact');
        const allowedContactFields = [
          'full_name', 'phone', 'email', 'city', 'state', 'neighborhood',
          'notes', 'instagram_url', 'profession',
        ];
        for (const field of allowedContactFields) {
          if (extracted[field]) contactFields[field] = extracted[field];
        }
      }

      setExtractionStep('');

      if (Object.keys(leadFields).length === 0 && Object.keys(contactFields).length === 0) {
        toast.info('Nenhuma informação nova encontrada na conversa.');
        return;
      }

      setAiPreview({ leadFields, contactFields });
      setShowAiPreview(true);
    } catch (e) {
      console.error('Update with AI error:', e);
      toast.error('Erro ao extrair dados com IA');
      setExtractionStep('');
    }
  };

  const handleConfirmAiUpdate = async () => {
    if (!aiPreview || !selectedConversation) return;
    try {
      const updates: string[] = [];
      if (Object.keys(aiPreview.leadFields).length > 0 && selectedConversation.lead_id) {
        const { error } = await supabase.from('leads').update(aiPreview.leadFields).eq('id', selectedConversation.lead_id);
        if (!error) updates.push('Lead');
      }
      if (Object.keys(aiPreview.contactFields).length > 0 && selectedConversation.contact_id) {
        const { error } = await supabase.from('contacts').update(aiPreview.contactFields).eq('id', selectedConversation.contact_id);
        if (!error) updates.push('Contato');
      }
      if (updates.length > 0) {
        toast.success(`${updates.join(' e ')} atualizado(s)!`);
        refetch();
      }
    } catch (e) {
      toast.error('Erro ao atualizar');
    } finally {
      setShowAiPreview(false);
      setAiPreview(null);
    }
  };

  const handleContactCreated = async (contact: { id: string; full_name: string; phone: string | null; lead_id?: string | null }) => {
    if (selectedConversation) {
      await linkToContact(selectedConversation.phone, contact.id, selectedConversation.instance_name);
    }
    await refetch();
  };

  const handleSaveLead = async (leadId: string, updates: Partial<Lead>) => {
    // Track who updated
    const { data: { user } } = await supabase.auth.getUser();
    const payload = { ...updates } as any;
    if (user?.id) {
      payload.updated_by = user.id;
    }
    
    const { error } = await supabase
      .from('leads')
      .update(payload)
      .eq('id', leadId);
    if (error) {
      console.error('[handleSaveLead] Supabase error:', JSON.stringify(error));
      throw error;
    }
  };

  const handleCloseLeadPanel = (open: boolean) => {
    if (!open) {
      setShowLeadPanel(false);
      setEditingLead(null);
      refetch();
    }
  };

  const handleCloseContactPanel = (open: boolean) => {
    if (!open) {
      setShowContactPanel(false);
      setEditingContact(null);
      refetch();
    }
  };

  const handleCreateActivity = (leadId: string, leadName: string, contactId?: string, contactName?: string) => {
    setActivityDefaults({ leadId, leadName, contactId, contactName });
    setShowActivitySheet(true);
  };

  const handleActivityCreated = async (title: string, type: string, leadName?: string) => {
    if (!selectedConversation) return;
    const { data: { user: currentUser } } = await supabase.auth.getUser();
    const { data: profile } = currentUser ? await supabase.from('profiles').select('full_name').eq('user_id', currentUser.id).single() : { data: null };
    const senderName = profile?.full_name || 'Sistema';
    const typeLabel = type.charAt(0).toUpperCase() + type.slice(1);
    const content = `📋 Atividade criada: "${title}" (${typeLabel})${leadName ? ` — Lead: ${leadName}` : ''}`;
    
    await supabase.from('whatsapp_internal_notes').insert({
      phone: selectedConversation.phone,
      instance_name: selectedConversation.instance_name || '',
      content,
      note_type: 'activity',
      sender_id: currentUser?.id || null,
      sender_name: senderName,
    });
  };

  const handleNavigateToLead = async (leadId: string) => {
    const { data } = await supabase.from('leads').select('*').eq('id', leadId).single();
    if (data) {
      setEditingLead(data as Lead);
      setShowLeadPanel(true);
    }
  };

  const handleViewContact = async (contactId: string) => {
    const { data } = await supabase.from('contacts').select('*').eq('id', contactId).single();
    if (data) {
      setEditingContact(data as Contact);
      setShowContactPanel(true);
    }
  };
  const handleToggleBulkPhone = (phone: string) => {
    setBulkSelectedPhones(prev => {
      const next = new Set(prev);
      if (next.has(phone)) next.delete(phone);
      else next.add(phone);
      return next;
    });
  };

  const handleSelectAllFiltered = (phones: string[]) => {
    setBulkSelectedPhones(prev => {
      const allSelected = phones.every(p => prev.has(p));
      if (allSelected) return new Set();
      return new Set(phones);
    });
  };

  const handleToggleBulkMode = () => {
    if (bulkMode) {
      setBulkMode(false);
      setBulkSelectedPhones(new Set());
    } else {
      setBulkMode(true);
    }
  };

  const handleOpenBulkDialog = () => {
    if (bulkSelectedPhones.size === 0) return;
    setShowBulkDialog(true);
  };

  const handleBulkCreated = () => {
    setBulkMode(false);
    setBulkSelectedPhones(new Set());
    refetch();
  };

  if (showSetup) {
    return (
      <WhatsAppSettingsPage 
        onBack={() => setShowSetup(false)} 
        initialTab={settingsTab}
      />
    );
  }

  return (
    <div className="h-screen h-[100dvh] flex flex-col relative overflow-hidden">
      {/* Header */}
      <div className={`flex items-center gap-2 md:gap-3 p-3 md:p-4 border-b bg-card shrink-0 flex-wrap md:flex-nowrap ${selectedPhone ? 'hidden md:flex' : 'flex'}`}>
        <MessageSquare className="h-6 w-6 text-green-600" />
        <h1 className="text-lg font-semibold">WhatsApp</h1>
        {totalUnread > 0 && (
          <Badge variant="destructive" className="text-xs">{totalUnread}</Badge>
        )}

        {instances.length > 0 && (
          <Select value={selectedInstanceId} onValueChange={(val) => { setSelectedInstanceId(val); setSelectedPhone(null); setSelectedInstance(null); if (val !== 'all') localStorage.setItem('whatsapp_last_instance_id', val); }}>
            <SelectTrigger className="w-52 h-8 text-xs ml-0 md:ml-2">
              <Smartphone className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
              <SelectValue placeholder="Todas instâncias" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">
                <div className="flex items-center gap-2">
                  Todas conectadas
                  {statuses.length > 0 && (
                    <span className="text-[10px] text-muted-foreground">
                      ({statuses.filter(s => s.connected).length}/{statuses.length})
                    </span>
                  )}
                </div>
              </SelectItem>
              {instances.map(inst => {
                const status = statuses.find(s => s.id === inst.id);
                const isConnected = status ? status.connected : true; // assume connected if not checked yet
                return (
                  <SelectItem key={inst.id} value={inst.id}>
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full flex-shrink-0 ${isConnected ? 'bg-green-500' : 'bg-destructive'}`} />
                      <span className={!isConnected ? 'text-muted-foreground' : ''}>{inst.instance_name}</span>
                      {!isConnected && <span className="text-[10px] text-destructive">offline</span>}
                    </div>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        )}

        <div className="w-full md:w-auto md:ml-auto flex flex-wrap md:flex-nowrap gap-0.5 md:gap-1 items-center justify-end">
          {relevantDisconnectedInstances.length > 0 && (
            <Button
              variant="destructive"
              size="sm"
              className="h-8"
              onClick={() => {
                if (relevantDisconnectedInstances.length === 1) {
                  const inst = relevantDisconnectedInstances[0];
                  setReconnectInstance({ id: inst.id, name: inst.instance_name });
                  return;
                }
                setDismissedAlert(false);
              }}
              title="Reconectar instância"
            >
              <WifiOff className="h-3.5 w-3.5 mr-1.5" />
              Reconectar
            </Button>
          )}
          <Button
            variant={bulkMode ? "default" : "ghost"}
            size={bulkMode ? "sm" : "icon"}
            onClick={handleToggleBulkMode}
            title="Seleção em lote"
          >
            <ListChecks className="h-4 w-4" />
            {bulkMode && <span className="ml-1 text-xs">Lote</span>}
          </Button>
          <Button variant="ghost" size="icon" onClick={() => setShowGooglePanel(true)} title="Google Workspace">
            <Chrome className="h-4 w-4" />
          </Button>
          {googleConnected && (
            <Button
              variant="ghost"
              size="icon"
              disabled={importingGoogle}
              title="Importar Contatos do Google"
              onClick={async () => {
                setImportingGoogle(true);
                try {
                  const result = await googleImportContacts();
                  toast.success(`Google: ${result.imported} novos, ${result.skipped} já existentes`);
                } catch {
                  toast.error('Erro ao importar do Google');
                } finally {
                  setImportingGoogle(false);
                }
              }}
            >
              {importingGoogle ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            disabled={importingWhatsApp}
            title="Importar Contatos do WhatsApp"
            onClick={async () => {
              const targetInstance = selectedInstanceId !== 'all' 
                ? instances.find(i => i.id === selectedInstanceId)
                : instances[0];
              
              if (!targetInstance) {
                toast.error('Nenhuma instância encontrada');
                return;
              }

              setImportingWhatsApp(true);
              try {
                const { data: session } = await supabase.auth.getSession();
                const res = await cloudFunctions.invoke('import-whatsapp-contacts', {
                  body: { instance_name: targetInstance.instance_name },
                });
                
                if (res.error) throw res.error;
                const result = res.data;
                
                if (result.error) {
                  toast.error(result.message || 'Erro ao importar contatos');
                  return;
                }
                
                toast.success(`WhatsApp (${result.instance}): ${result.imported} importados, ${result.skipped} já existentes`);
              } catch (err: any) {
                console.error('WhatsApp import error:', err);
                toast.error('Erro ao importar contatos do WhatsApp');
              } finally {
                setImportingWhatsApp(false);
              }
            }}
          >
            {importingWhatsApp ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />}
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigate('/contacts')} title="Contatos & Lista de Transmissão" className="gap-1.5 h-8 text-xs">
            <Contact2 className="h-3.5 w-3.5" />
            Contatos
          </Button>
          <Button variant="ghost" size="icon" onClick={() => setShowDashboard(true)} title="Dashboard">
            <BarChart3 className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={async () => {
              toast.info('Atualizando conversas...');
              await Promise.all([refetch(), refetchStatus()]);
              if (selectedPhone) {
                await fetchFullConversation(selectedPhone, selectedInstance);
              }
              toast.success('Conversas atualizadas');
            }}
            title="Atualizar conversas"
            disabled={loading}
          >
            <RefreshCw className={"h-4 w-4" + (loading ? " animate-spin" : "")} />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => { setSettingsTab('integration'); setShowSetup(true); }} title="Configuração">
            <Settings className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Reconnect Bar - apenas para instância padrão do usuário */}
      {relevantDisconnectedInstances.length > 0 && (
        <div className="flex items-center gap-2 px-4 py-2 border-b bg-destructive/10 shrink-0 animate-in slide-in-from-top">
          <WifiOff className="h-4 w-4 text-destructive flex-shrink-0" />
          <span className="text-sm font-medium text-destructive flex-1">
            {relevantDisconnectedInstances.length === 1 
              ? `${relevantDisconnectedInstances[0].instance_name} está offline`
              : `${relevantDisconnectedInstances.length} instâncias offline`
            }
          </span>
          <Button
            variant="destructive"
            size="sm"
            className="h-7 text-xs"
            onClick={() => {
              if (relevantDisconnectedInstances.length === 1) {
                const inst = relevantDisconnectedInstances[0];
                setReconnectInstance({ id: inst.id, name: inst.instance_name });
              } else {
                setDismissedAlert(false);
              }
            }}
          >
            <RefreshCw className="h-3 w-3 mr-1" />
            Reconectar
          </Button>
        </div>
      )}

      {/* Bulk action bar */}
      {bulkMode && (
        <div className="flex items-center gap-3 px-4 py-2 border-b bg-accent/40 shrink-0">
          <span className="text-sm font-medium">
            {bulkSelectedPhones.size} conversa{bulkSelectedPhones.size !== 1 ? 's' : ''} selecionada{bulkSelectedPhones.size !== 1 ? 's' : ''}
          </span>
          <Button
            size="sm"
            onClick={handleOpenBulkDialog}
            disabled={bulkSelectedPhones.size === 0}
          >
            Criar Leads em Lote
          </Button>
          <Button variant="ghost" size="sm" onClick={handleToggleBulkMode}>
            Cancelar
          </Button>
        </div>
      )}

      {/* Disconnection Alert Overlay - apenas para instância padrão do usuário */}
      {relevantDisconnectedInstances.length > 0 && !dismissedAlert && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm pointer-events-auto">
          <div className="relative bg-card border-2 border-destructive rounded-2xl shadow-2xl p-8 max-w-md w-full mx-4 text-center space-y-4 animate-in fade-in zoom-in-95">
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-3 right-3 h-7 w-7"
              onClick={() => setDismissedAlert(true)}
            >
              <X className="h-4 w-4" />
            </Button>

            <div className="flex justify-center">
              <div className="h-16 w-16 rounded-full bg-destructive/10 flex items-center justify-center">
                <WifiOff className="h-8 w-8 text-destructive" />
              </div>
            </div>

            <h2 className="text-xl font-bold text-destructive">
              {relevantDisconnectedInstances.length === 1 ? 'Instância Desconectada!' : `${relevantDisconnectedInstances.length} Instâncias Desconectadas!`}
            </h2>

            <div className="space-y-2">
              {relevantDisconnectedInstances.map(inst => {
                const since = inst.disconnected_since;
                const elapsedMs = since ? Date.now() - new Date(since).getTime() : 0;
                const elapsedMin = Math.floor(elapsedMs / 60000);
                const elapsedStr = elapsedMin < 1 ? 'agora' : elapsedMin < 60 ? `${elapsedMin}min` : `${Math.floor(elapsedMin / 60)}h ${elapsedMin % 60}min`;
                const sinceStr = since ? new Date(since).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : null;
                return (
                  <div key={inst.id} className="flex flex-col gap-1 text-sm px-3 py-2 rounded-lg bg-destructive/5 border border-destructive/20">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 text-destructive flex-shrink-0" />
                        <span className="font-medium">{inst.instance_name}</span>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => setReconnectInstance({ id: inst.id, name: inst.instance_name })}
                      >
                        <RefreshCw className="h-3 w-3 mr-1" />
                        Reconectar
                      </Button>
                    </div>
                    {sinceStr && (
                      <p className="text-xs text-muted-foreground ml-6">
                        Offline desde {sinceStr} — há {elapsedStr}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            <p className="text-sm text-muted-foreground">
              Clique em "Reconectar" para reiniciar a instância. Se necessário, escaneie o QR Code.
            </p>

            <div className="flex gap-2 justify-center pt-2">
              <Button variant="outline" size="sm" onClick={() => setDismissedAlert(true)}>
                Fechar
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 flex overflow-hidden">
      <div className="flex-1 flex overflow-hidden">
        {/* MOBILE: existing flex layout (list OR chat) */}
        <div className={`md:hidden w-full flex ${selectedPhone ? '' : ''}`}>
          {!selectedPhone ? (
            <div className="w-full border-r flex-shrink-0 overflow-y-auto bg-card flex flex-col">
              <WhatsAppConversationList
                conversations={visibleConversations}
                loading={loading}
                instanceSwitching={instanceSwitching}
                switchProgress={switchProgress}
                selectedPhone={selectedPhone}
                selectedInstanceName={selectedInstance}
                onSelect={handleSelectConversation}
                boards={boards}
                selectedInstanceId={selectedInstanceId}
                bulkMode={bulkMode}
                selectedPhones={bulkSelectedPhones}
                onToggleBulkPhone={handleToggleBulkPhone}
                onSelectAllFiltered={handleSelectAllFiltered}
                privatePhones={new Set(privateConvs.map(p => `${p.phone}__${(p.instance_name || '').toLowerCase()}`))}
              />
            </div>
          ) : (
            <div className="flex flex-1 flex-col overflow-hidden">
              {selectedConversation && (
                <WhatsAppChat
                  conversation={selectedConversation}
                  onBack={() => { setSelectedPhone(null); setSelectedInstance(null); }}
                  onSendMessage={(() => {
                    const share = sharedConvs.find(s => s.phone === selectedConversation.phone && s.instance_name === selectedConversation.instance_name);
                    if (share) {
                      return (phone: string, message: string, contactId?: string, leadId?: string, instanceName?: string | null, _identifySender?: boolean, chatId?: string, treatmentOverride?: string | null, nameFormatOverride?: string, nicknameOverride?: string | null) =>
                        sendMessage(phone, message, contactId, leadId, instanceName, share.identify_sender, chatId, treatmentOverride, nameFormatOverride, nicknameOverride);
                    }
                    return sendMessage;
                  })()}
                  shareInfo={sharedConvs.find(s => s.phone === selectedConversation.phone && s.instance_name === selectedConversation.instance_name) || null}
                  onSendMedia={sendMedia}
                  onSendLocation={sendLocation}
                  onDeleteMessage={deleteMessage}
                  onLinkToLead={linkToLead}
                  onLinkToContact={linkToContact}
                  onCreateLead={handleCreateLead}
                  onCreateContact={handleCreateContact}
                  onCreateCase={() => setShowCreateCaseDialog(true)}
                  extractingData={extracting}
                  extractionStep={extractionStep}
                  onUpdateWithAI={handleUpdateWithAI}
                  onCreateActivity={handleCreateActivity}
                  onNavigateToLead={handleNavigateToLead}
                  onViewContact={handleViewContact}
                  onPrivacyChanged={async () => {
                    const { data } = await supabase
                      .from('whatsapp_private_conversations')
                      .select('phone, instance_name, private_by');
                    setPrivateConvs((data || []) as PrivateConv[]);
                  }}
                  onOpenChat={handleOpenChatByPhone}
                  onClearConversation={clearConversation}
                />
              )}
            </div>
          )}
        </div>

        {/* DESKTOP: resizable layout */}
        <ResizablePanelGroup
          direction="horizontal"
          autoSaveId="whatsapp-inbox-layout"
          className="hidden md:flex flex-1"
        >
          <ResizablePanel defaultSize={25} minSize={18} maxSize={45} className="!overflow-visible">
            <div className="h-full border-r overflow-y-auto bg-card flex flex-col">
              <WhatsAppConversationList
                conversations={visibleConversations}
                loading={loading}
                instanceSwitching={instanceSwitching}
                switchProgress={switchProgress}
                selectedPhone={selectedPhone}
                selectedInstanceName={selectedInstance}
                onSelect={handleSelectConversation}
                boards={boards}
                selectedInstanceId={selectedInstanceId}
                bulkMode={bulkMode}
                selectedPhones={bulkSelectedPhones}
                onToggleBulkPhone={handleToggleBulkPhone}
                onSelectAllFiltered={handleSelectAllFiltered}
                privatePhones={new Set(privateConvs.map(p => `${p.phone}__${(p.instance_name || '').toLowerCase()}`))}
              />
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel defaultSize={75} minSize={40}>
            <div className="h-full flex flex-col overflow-hidden">
              {selectedConversation ? (
                <WhatsAppChat
                  conversation={selectedConversation}
                  onBack={() => { setSelectedPhone(null); setSelectedInstance(null); }}
                  onSendMessage={(() => {
                    const share = sharedConvs.find(s => s.phone === selectedConversation.phone && s.instance_name === selectedConversation.instance_name);
                    if (share) {
                      return (phone: string, message: string, contactId?: string, leadId?: string, instanceName?: string | null, _identifySender?: boolean, chatId?: string, treatmentOverride?: string | null, nameFormatOverride?: string, nicknameOverride?: string | null) =>
                        sendMessage(phone, message, contactId, leadId, instanceName, share.identify_sender, chatId, treatmentOverride, nameFormatOverride, nicknameOverride);
                    }
                    return sendMessage;
                  })()}
                  shareInfo={sharedConvs.find(s => s.phone === selectedConversation.phone && s.instance_name === selectedConversation.instance_name) || null}
                  onSendMedia={sendMedia}
                  onSendLocation={sendLocation}
                  onDeleteMessage={deleteMessage}
                  onLinkToLead={linkToLead}
                  onLinkToContact={linkToContact}
                  onCreateLead={handleCreateLead}
                  onCreateContact={handleCreateContact}
                  onCreateCase={() => setShowCreateCaseDialog(true)}
                  extractingData={extracting}
                  extractionStep={extractionStep}
                  onUpdateWithAI={handleUpdateWithAI}
                  onCreateActivity={handleCreateActivity}
                  onNavigateToLead={handleNavigateToLead}
                  onViewContact={handleViewContact}
                  onPrivacyChanged={async () => {
                    const { data } = await supabase
                      .from('whatsapp_private_conversations')
                      .select('phone, instance_name, private_by');
                    setPrivateConvs((data || []) as PrivateConv[]);
                  }}
                  onOpenChat={handleOpenChatByPhone}
                  onClearConversation={clearConversation}
                />
              ) : (
                <div className="flex-1 flex items-center justify-center bg-muted/20">
                  <div className="text-center space-y-4 max-w-md">
                    <MessageSquare className="h-16 w-16 mx-auto text-muted-foreground/30" />
                    {!hasLoaded ? (
                      <div className="space-y-4">
                        <p className="text-muted-foreground font-medium">Conversas sob demanda</p>
                        <p className="text-xs text-muted-foreground">
                          As conversas não são carregadas automaticamente para melhor performance.
                          Clique abaixo para carregar quando precisar.
                        </p>
                        <Button onClick={() => refetch()} disabled={loading} className="gap-2">
                          {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                          Carregar Conversas
                        </Button>
                        {instanceStats.length > 0 && (
                          <div className="mt-6 space-y-2">
                            <p className="text-xs font-medium text-muted-foreground">Resumo por instância:</p>
                            <div className="grid gap-2">
                              {instanceStats.map(stat => (
                                <div key={stat.instance_name} className="flex items-center justify-between p-3 rounded-lg border bg-card text-left">
                                  <div className="flex items-center gap-2">
                                    <Smartphone className="h-4 w-4 text-muted-foreground" />
                                    <span className="text-sm font-medium">{stat.instance_name}</span>
                                  </div>
                                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                    <span title="Conversas">{stat.conversation_count} 💬</span>
                                    <span title="Enviadas">↑{stat.outbound_count}</span>
                                    <span title="Recebidas">↓{stat.inbound_count}</span>
                                    {stat.unread_count > 0 && (
                                      <Badge variant="destructive" className="text-[10px] h-5">{stat.unread_count} novas</Badge>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {statsLoading && (
                          <div className="flex items-center justify-center py-4">
                            <div className="animate-spin rounded-full h-5 w-5 border-2 border-primary border-t-transparent" />
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <p className="text-muted-foreground">Selecione uma conversa</p>
                        {conversations.length === 0 && !loading && (
                          <div className="space-y-2">
                            <p className="text-sm text-muted-foreground">Nenhuma mensagem encontrada</p>
                            <Button variant="outline" size="sm" onClick={() => { setSettingsTab('integration'); setShowSetup(true); }}>
                              Configurar integração
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      {/* Lead Edit Panel - Full form with all tabs + AI */}
      {editingLead && (
        <LeadEditDialog
          open={showLeadPanel}
          onOpenChange={handleCloseLeadPanel}
          lead={editingLead}
          onSave={handleSaveLead}
          boards={boards}
          mode="sheet"
        />
      )}

      {/* Contact Detail Panel - Full form with all fields */}
      <ContactDetailSheet
        contact={editingContact}
        open={showContactPanel}
        onOpenChange={handleCloseContactPanel}
        onContactUpdated={() => refetch()}
        mode="sheet"
      />

      {/* Create Contact Dialog */}
      <CreateContactDialog
        open={showCreateContactDialog}
        onOpenChange={setShowCreateContactDialog}
        defaultPhone={selectedConversation?.phone}
        defaultName={contactDefaults.full_name || selectedConversation?.contact_name || ''}
        defaultData={contactDefaults}
        onContactCreated={handleContactCreated}
      />

      {/* Create Case Dialog */}
      <CreateCaseFromWhatsAppDialog
        open={showCreateCaseDialog}
        onOpenChange={setShowCreateCaseDialog}
        leadId={selectedConversation?.lead_id}
        leadName={selectedConversation?.contact_name}
        contactName={selectedConversation?.contact_name}
        contactPhone={selectedConversation?.phone}
        contactId={selectedConversation?.contact_id}
        instanceName={selectedInstance}
        messages={selectedConversation?.messages}
        onCaseCreated={() => { toast.success('Caso criado com sucesso!'); refetch(); }}
      />

      {/* Activity Creation Sheet */}
      <WhatsAppActivitySheet
        open={showActivitySheet}
        onOpenChange={setShowActivitySheet}
        defaultLeadId={activityDefaults.leadId}
        defaultLeadName={activityDefaults.leadName}
        defaultContactId={activityDefaults.contactId}
        defaultContactName={activityDefaults.contactName}
        onActivityCreated={handleActivityCreated}
      />

      {/* Board Picker Dialog */}
      <Dialog open={showBoardPicker} onOpenChange={setShowBoardPicker}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Selecionar Funil</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Label>Funil *</Label>
            <Select value={selectedBoardId} onValueChange={setSelectedBoardId}>
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="Selecione um funil" />
              </SelectTrigger>
              <SelectContent>
                {boards.filter(b => b.board_type !== 'workflow').map(b => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBoardPicker(false)}>Cancelar</Button>
            <Button onClick={() => createLeadWithBoard(selectedBoardId)} disabled={!selectedBoardId || creatingLead}>
              {creatingLead ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Criando...</> : 'Criar Lead'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* AI Preview Confirmation Dialog */}
      <Dialog open={showAiPreview} onOpenChange={(open) => { if (!open) { setShowAiPreview(false); setAiPreview(null); } }}>
        <DialogContent className="sm:max-w-[500px] max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-amber-500" />
              Dados extraídos da conversa
            </DialogTitle>
          </DialogHeader>
          {aiPreview && (
            <div className="space-y-4">
              {Object.keys(aiPreview.leadFields).length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-semibold text-primary">Lead</p>
                  <div className="rounded-lg border divide-y">
                    {Object.entries(aiPreview.leadFields).map(([key, value]) => (
                      <div key={key} className="flex items-start gap-3 px-3 py-2 text-sm">
                        <span className="text-muted-foreground min-w-[140px] shrink-0">{fieldLabel(key)}</span>
                        <span className="font-medium break-words">{value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {Object.keys(aiPreview.contactFields).length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-semibold text-primary">Contato</p>
                  <div className="rounded-lg border divide-y">
                    {Object.entries(aiPreview.contactFields).map(([key, value]) => (
                      <div key={key} className="flex items-start gap-3 px-3 py-2 text-sm">
                        <span className="text-muted-foreground min-w-[140px] shrink-0">{fieldLabel(key)}</span>
                        <span className="font-medium break-words">{value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowAiPreview(false); setAiPreview(null); }}>Cancelar</Button>
            <Button onClick={handleConfirmAiUpdate} className="gap-1.5">
              <Check className="h-4 w-4" /> Confirmar Atualização
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


      <BulkLeadCreationDialog
        open={showBulkDialog}
        onOpenChange={setShowBulkDialog}
        selectedConversations={conversations.filter(c => bulkSelectedPhones.has(c.phone))}
        boards={boards}
        onCreated={handleBulkCreated}
      />

      {reconnectInstance && (
        <WhatsAppReconnectDialog
          open={!!reconnectInstance}
          onOpenChange={(open) => !open && setReconnectInstance(null)}
          instanceId={reconnectInstance.id}
          instanceName={reconnectInstance.name}
          onReconnected={() => {
            refetchStatus();
            setReconnectInstance(null);
          }}
        />
      )}

      {showDashboard && (
        <Dialog open={showDashboard} onOpenChange={setShowDashboard}>
          <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto p-0">
            <WhatsAppLeadsDashboard onOpenChat={(phone) => { setShowDashboard(false); setSelectedPhone(phone); }} />
          </DialogContent>
        </Dialog>
      )}
      <ZapSignLeadCreationListener />
    </div>
  );
}
