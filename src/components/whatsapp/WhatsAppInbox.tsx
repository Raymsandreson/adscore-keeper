import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useWhatsAppMessages, WhatsAppConversation } from '@/hooks/useWhatsAppMessages';
import { usePageState } from '@/hooks/usePageState';
import { useWhatsAppInstanceStatus } from '@/hooks/useWhatsAppInstanceStatus';
import { WhatsAppConversationList } from './WhatsAppConversationList';
import { WhatsAppAssigneeSummary } from './WhatsAppAssigneeSummary';
import { WhatsAppChat } from './WhatsAppChat';
import { ZapSignDialogHost } from './ZapSignDialogHost';
import { OnboardingCheckpointHost } from './OnboardingCheckpointHost';
import { hasOnboardingPending, getPendingLeadId } from '@/lib/onboardingGuard';
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { MessageSquare, Settings, RefreshCw, Smartphone, BarChart3, Chrome, ListChecks, AlertTriangle, WifiOff, X, Sparkles, Check, Loader2, Download, Users, List, Contact2, Share2, QrCode, ArrowLeft } from 'lucide-react';
import { SharedConversationsPanel } from './SharedConversationsPanel';
import { useSharedWithMe } from '@/hooks/useSharedWithMe';
import { FocusDashboard } from './FocusDashboard/FocusDashboard';

import { LeadEditDialog } from '@/components/kanban/LeadEditDialog';
import { ContactDetailSheet } from '@/components/contacts/ContactDetailSheet';
import { supabase } from '@/integrations/supabase/client';
import { externalSupabase } from '@/integrations/supabase/external-client';
import { toast } from 'sonner';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { Lead } from '@/hooks/useLeads';
import type { Contact } from '@/hooks/useContacts';
import { useKanbanBoards } from '@/hooks/useKanbanBoards';
import { useModulePermissions } from '@/hooks/useModulePermissions';
import { useAuthContext } from '@/contexts/AuthContext';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';
import { normalizeWhatsAppConversationPhone, isWhatsAppGroupId } from '@/lib/whatsappPhone';
import { LEAD_FIELD_REGISTRY } from '@/components/leads/leadFormFields';
import { remapToExternal } from '@/integrations/supabase/uuid-remap';
import { sanitizeLeadDateFields } from '@/utils/sanitizeLeadDateFields';

const FIELD_LABELS: Record<string, string> = {
  lead_name: 'Nome do Lead', victim_name: 'Nome da Vítima', lead_email: 'E-mail', lead_phone: 'Telefone',
  city: 'Cidade', state: 'Estado', neighborhood: 'Bairro', main_company: 'Empresa Principal',
  contractor_company: 'Empresa Contratante', accident_address: 'Local do Acidente', accident_date: 'Data do Acidente',
  damage_description: 'Descrição do Dano', case_number: 'Nº do Processo', case_type: 'Tipo do Caso',
  notes: 'Observações', sector: 'Setor', visit_city: 'Cidade (Visita)', visit_state: 'Estado (Visita)',
  visit_address: 'Endereço (Visita)', liability_type: 'Tipo de Responsabilidade', news_link: 'Link da Notícia',
  expected_birth_date: 'Previsão do Parto', client_classification: 'Classificação',
  full_name: 'Nome Completo', phone: 'Telefone', email: 'E-mail', instagram_url: 'Instagram', profession: 'Profissão',
};
const fieldLabel = (key: string) => FIELD_LABELS[key] || key.replace(/_/g, ' ');

const PT_MONTHS: Record<string, number> = {
  janeiro: 0, fevereiro: 1, marco: 2, março: 2, abril: 3, maio: 4, junho: 5,
  julho: 6, agosto: 7, setembro: 8, outubro: 9, novembro: 10, dezembro: 11,
};

const toIsoDate = (date: Date) => date.toISOString().slice(0, 10);

const normalizeFieldLabel = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const isBirthDateLabel = (label: string) => {
  const normalized = normalizeFieldLabel(label);
  return normalized.includes('data do parto') || normalized.includes('previsao do parto') || normalized.includes('previsao de parto');
};

const extractNearestExpectedBirthDate = (messages: WhatsAppConversation['messages'] = []) => {
  const text = messages.map((m) => m.message_text || '').join('\n');
  if (!/(parto|gesta[cç][aã]o|beb[eê]|nasciment|maternidade)/i.test(text)) return null;
  const now = new Date();
  const candidates: Date[] = [];
  const push = (day: number, month: number, year?: number) => {
    if (!day || month < 0 || day > 31) return;
    let y = year || now.getFullYear();
    let d = new Date(Date.UTC(y, month, day));
    if (!year && d.getTime() < now.getTime() - 30 * 86400000) d = new Date(Date.UTC(y + 1, month, day));
    if (d.getUTCDate() === day && d.getUTCMonth() === month) candidates.push(d);
  };
  for (const m of text.matchAll(/\b(\d{1,2})\s*(?:de\s*)?(janeiro|fevereiro|mar[cç]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)(?:\s*(?:de)?\s*(20\d{2}))?/gi)) {
    const monthName = m[2].toLowerCase().replace('ç', 'c');
    push(Number(m[1]), PT_MONTHS[monthName] ?? PT_MONTHS[m[2].toLowerCase()], m[3] ? Number(m[3]) : undefined);
  }
  for (const m of text.matchAll(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](20\d{2}))?\b/g)) {
    push(Number(m[1]), Number(m[2]) - 1, m[3] ? Number(m[3]) : undefined);
  }
  if (candidates.length === 0) return null;
  const future = candidates.filter((d) => d.getTime() >= now.getTime() - 86400000);
  const pool = future.length > 0 ? future : candidates;
  pool.sort((a, b) => a.getTime() - b.getTime());
  return toIsoDate(pool[0]);
};

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
  `${normalizeWhatsAppConversationPhone(phone)}__${(instanceName || '').trim().toLowerCase()}`;

const normalizeInstanceName = (instanceName?: string | null) =>
  (instanceName || '').trim().toLowerCase();

// Instâncias da WhatsApp Business Cloud API (WhatsJUD API) — vivem em aba separada
// da inbox UazAPI para não misturar conversas de canais diferentes.
const CLOUD_API_INSTANCE_NAMES = new Set<string>(['cloud_gerencia']);
const isCloudApiInstance = (instanceName?: string | null) =>
  CLOUD_API_INSTANCE_NAMES.has(normalizeInstanceName(instanceName));

// Force clean rebuild
interface WhatsAppInboxProps {
  // Trava o filtro de instância pelo nome (ex: 'cloud_gerencia'). Esconde o dropdown de seleção.
  lockInstanceName?: string;
  // 'minimal' esconde ferramentas que não se aplicam ao caso de uso Cloud-only.
  chrome?: 'full' | 'minimal';
  // Rota destino do botão Voltar quando chrome='minimal'. Ignorado em 'full'.
  backTo?: string;
}

export function WhatsAppInbox({ lockInstanceName, chrome = 'full', backTo }: WhatsAppInboxProps = {}) {
  const isMinimal = chrome === 'minimal';
  // Aba: separa conversas das instâncias UazAPI da instância WhatsJUD API (Cloud).
  const [inboxTab, setInboxTab] = useState<'whatsapp' | 'cloud_api'>(() => {
    if (lockInstanceName && CLOUD_API_INSTANCE_NAMES.has(lockInstanceName.trim().toLowerCase())) return 'cloud_api';
    const saved = typeof window !== 'undefined' ? localStorage.getItem('whatsapp_inbox_tab') : null;
    return (saved === 'cloud_api' ? 'cloud_api' : 'whatsapp');
  });
  useEffect(() => {
    if (lockInstanceName) return;
    try { localStorage.setItem('whatsapp_inbox_tab', inboxTab); } catch {}
  }, [inboxTab, lockInstanceName]);
  // WhatsApp API: usuário pode escolher ver TODAS as conversas (pool inteiro) ou só as suas atribuídas.
  // Default = false (só as minhas + sem dono). Persiste por usuário no localStorage.
  const [cloudShowAll, setCloudShowAll] = usePageState<boolean>('wa_cloud_show_all', false);
  // Contexto WhatsApp Cloud API (Meta oficial). 'cloud_gerencia' NÃO é uma sessão UazAPI:
  // não tem status /instance/status nem exige instância padrão para atender. Status real vem da Meta.
  const isCloudInstanceName = useCallback(
    (name?: string | null) => (name || '').trim().toLowerCase() === 'cloud_gerencia',
    [],
  );
  const isCloudContext = isCloudInstanceName(lockInstanceName);
  // null = ainda não resolvi qual instância usar (não buscar nada).
  // 'all' ou um id = pronto para buscar.
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);
  const {
    conversations: _allConversations,
    loading, instanceSwitching, switchProgress,
    instances: _allInstances,
    instanceStats: _allInstanceStats,
    statsLoading, hasLoaded, sendMessage, sendMedia, sendLocation, deleteMessage, clearConversation, markAsRead, linkToLead, linkToContact, refetch, refetchStats, refetchInstances, fetchFullConversation, searchConversations,
    loadMoreConversations, hasMoreConversations, loadOlderConversationMessages,
  } = useWhatsAppMessages(selectedInstanceId, lockInstanceName);

  // Filtra instâncias/conversas/stats por aba (UazAPI x WhatsJUD API).
  const instances = useMemo(() => {
    if (lockInstanceName) return _allInstances;
    return _allInstances.filter(i =>
      inboxTab === 'cloud_api' ? isCloudApiInstance(i.instance_name) : !isCloudApiInstance(i.instance_name)
    );
  }, [_allInstances, inboxTab, lockInstanceName]);
  const conversations = useMemo(() => {
    if (lockInstanceName) return _allConversations;
    return _allConversations.filter(c =>
      inboxTab === 'cloud_api' ? isCloudApiInstance(c.instance_name) : !isCloudApiInstance(c.instance_name)
    );
  }, [_allConversations, inboxTab, lockInstanceName]);
  const instanceStats = useMemo(() => {
    if (lockInstanceName) return _allInstanceStats;
    return _allInstanceStats.filter(s =>
      inboxTab === 'cloud_api' ? isCloudApiInstance(s.instance_name) : !isCloudApiInstance(s.instance_name)
    );
  }, [_allInstanceStats, inboxTab, lockInstanceName]);
  const hasCloudApiInstance = useMemo(
    () => _allInstances.some(i => isCloudApiInstance(i.instance_name)),
    [_allInstances]
  );
  const { statuses, disconnectedInstances, loading: statusLoading, refetchStatus } = useWhatsAppInstanceStatus(instances.length > 0);
  const [dismissedAlert, setDismissedAlert] = useState(false);
  const [reconnectInstance, setReconnectInstance] = useState<{ id: string; name: string } | null>(null);

  // Listener global: qualquer toast/erro de "instância desconectada" pode pedir abrir este dialog.
  useEffect(() => {
    const handler = async (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      let id: string | undefined = detail.instanceId;
      let name: string | undefined = detail.instanceName;
      if (!id && name) {
        const { data } = await supabase
          .from('whatsapp_instances')
          .select('id, instance_name')
          .ilike('instance_name', name)
          .eq('is_active', true)
          .maybeSingle();
        if (data) { id = data.id; name = data.instance_name; }
      } else if (id && !name) {
        const { data } = await supabase
          .from('whatsapp_instances')
          .select('instance_name')
          .eq('id', id)
          .maybeSingle();
        if (data) name = data.instance_name;
      }
      if (id && name) setReconnectInstance({ id, name });
    };
    window.addEventListener('whatsapp:open-reconnect', handler as EventListener);
    return () => window.removeEventListener('whatsapp:open-reconnect', handler as EventListener);
  }, []);
  const { boards } = useKanbanBoards();
  const { canView } = useModulePermissions();
  const { user } = useAuthContext();
  const { isConnected: googleConnected, importContacts: googleImportContacts } = useGoogleIntegration();
  const [importingGoogle, setImportingGoogle] = useState(false);
  const [importingWhatsApp, setImportingWhatsApp] = useState(false);
  const [creatingLead, setCreatingLead] = useState(false);
  const [focusPanelPinned, setFocusPanelPinned] = useState(false);
  const [instanceSelectOpen, setInstanceSelectOpen] = useState(false);

  // Default instance do perfil do usuário (fonte da verdade para alertas e fallback).
  const [userDefaultInstanceId, setUserDefaultInstanceId] = useState<string | null>(null);
  // Lista de acolhedores possíveis (pra filtro do FocusDashboard).
  const [acolhedorUsers, setAcolhedorUsers] = useState<{ id: string; full_name: string }[]>([]);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await externalSupabase
          .from('profiles')
          .select('user_id, full_name')
          .not('full_name', 'is', null)
          .order('full_name', { ascending: true })
          .limit(500);
        if (!alive) return;
        const list = (data || [])
          .map((p: any) => ({ id: p.user_id, full_name: p.full_name }))
          .filter((u) => u.id && u.full_name);
        setAcolhedorUsers(list);
      } catch { /* silencioso */ }
    })();
    return () => { alive = false; };
  }, []);

  // Filtra alertas de desconexão: só mostra se a instância caída é a default do user.
  // Admins continuam vendo todas (não têm default específico ou enxergam o pool inteiro).
  const relevantDisconnectedInstances = useMemo(() => {
    if (!userDefaultInstanceId) return [];
    const defaultInstance = instances.find((inst) => inst.id === userDefaultInstanceId);
    const defaultName = normalizeInstanceName(defaultInstance?.instance_name);

    return disconnectedInstances.filter((inst) => (
      // Número Cloud (Meta) não é sessão UazAPI — nunca alerta como "desconectado" por aqui.
      !isCloudInstanceName(inst.instance_name) && (
        inst.id === userDefaultInstanceId ||
        (defaultName && normalizeInstanceName(inst.instance_name) === defaultName)
      )
    ));
  }, [disconnectedInstances, instances, userDefaultInstanceId, isCloudInstanceName]);

  const disconnectedSignature = useMemo(
    () => relevantDisconnectedInstances.map((inst) => inst.id).sort().join('|'),
    [relevantDisconnectedInstances]
  );

  useEffect(() => {
    setDismissedAlert(false);
  }, [disconnectedSignature]);

  // Ao trocar de aba (UazAPI <-> WhatsJUD API), garante que a instância selecionada
  // pertence ao conjunto atual; senão, cai para a primeira disponível ou 'all'.
  useEffect(() => {
    if (lockInstanceName) return;
    if (!selectedInstanceId || selectedInstanceId === 'all') return;
    const stillValid = instances.some(i => i.id === selectedInstanceId);
    if (!stillValid) {
      setSelectedInstanceId(instances[0]?.id ?? 'all');
      setSelectedPhone(null);
      setSelectedInstance(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inboxTab]);

  // Auto-select default instance on mount.
  // Ordem de prioridade (corrigida): perfil.default_instance_id > localStorage > primeira disponível.
  // O default do perfil é soberano: se existir e estiver na lista de instâncias do user, ganha sempre.
  const [defaultInstanceApplied, setDefaultInstanceApplied] = useState(false);
  useEffect(() => {
    if (defaultInstanceApplied || !user || instances.length === 0) return;
    const applyDefault = async () => {
      // 0. lockInstanceName (prop) tem prioridade absoluta — modo embed (ex: WhatsApp API)
      if (lockInstanceName) {
        const target = lockInstanceName.trim().toLowerCase();
        const locked = instances.find(i =>
          (i.instance_name || '').trim().toLowerCase() === target,
        );
        if (locked) {
          setSelectedInstanceId(locked.id);
        }
        setDefaultInstanceApplied(true);
        return;
      }
      // 1. Perfil default lido SEMPRE do Externo (fonte de verdade)
      const extUserId = await remapToExternal(user.id);
      const { data } = await externalSupabase
        .from('profiles')
        .select('default_instance_id')
        .eq('user_id', extUserId || user.id)
        .maybeSingle();
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
  }, [user, instances, defaultInstanceApplied, lockInstanceName]);

  // Popup: usuário sem instância padrão cadastrada não pode enviar.
  const [missingInstanceOpen, setMissingInstanceOpen] = useState(false);
  const [pickingInstanceId, setPickingInstanceId] = useState<string>('');
  const [savingDefault, setSavingDefault] = useState(false);

  // Envio é independente de instância padrão cadastrada — a conversa carrega o
  // instance_name correto (UazAPI ou cloud_gerencia) e o servidor resolve a rota.
  // Mantemos os wrappers como passthrough pra preservar a assinatura usada na árvore.
  const guardSendMessage = useCallback((fn: typeof sendMessage) => {
    return ((...args: Parameters<typeof sendMessage>) => fn(...args)) as typeof sendMessage;
  }, [sendMessage]);

  const guardSendMedia = useCallback((...args: Parameters<typeof sendMedia>) => {
    return (sendMedia as any)(...args);
  }, [sendMedia]);

  const guardSendLocation = useCallback((...args: Parameters<typeof sendLocation>) => {
    return (sendLocation as any)(...args);
  }, [sendLocation]);

  // Status REAL do número Cloud (Meta), independente da UazAPI. FONTE ÚNICA DE VERDADE:
  // consulta o MESMO WHATSAPP_CLOUD_TOKEN usado no envio (Railway), via proxy check-whatsapp-cloud-token.
  // Evita o "offline" falso de quando o token de status (Supabase) dessincroniza do token de envio.
  // Roda 1x ao abrir + refresh manual — sem polling (cada checagem consome chamada Graph).
  const [cloudStatus, setCloudStatus] = useState<'idle' | 'checking' | 'online' | 'offline'>('idle');
  const [cloudStatusInfo, setCloudStatusInfo] = useState<string | null>(null);
  const checkCloudStatus = useCallback(async () => {
    if (!isCloudContext) return;
    setCloudStatus('checking');
    try {
      const { data } = await cloudFunctions.invoke('check-whatsapp-cloud-token', { body: {} });
      // Online só quando o token é válido E consegue acessar o número configurado.
      if (data?.success && data?.status === 'valid' && data?.phone_check?.ok !== false) {
        setCloudStatus('online');
        setCloudStatusInfo(data?.phone_check?.display_phone || data?.display_phone || null);
      } else {
        setCloudStatus('offline');
        setCloudStatusInfo(data?.message || data?.phone_check?.error || null);
      }
    } catch (e) {
      setCloudStatus('offline');
      setCloudStatusInfo(e instanceof Error ? e.message : null);
    }
  }, [isCloudContext]);
  useEffect(() => { checkCloudStatus(); }, [checkCloudStatus]);

  const handleConfirmDefaultInstance = useCallback(async () => {
    if (!user || !pickingInstanceId) return;
    setSavingDefault(true);
    try {
      const extUserId = await remapToExternal(user.id);
      // Escreve no Externo (fonte de verdade)
      const { error: extErr } = await externalSupabase
        .from('profiles')
        .update({ default_instance_id: pickingInstanceId } as any)
        .eq('user_id', extUserId || user.id);
      if (extErr) throw extErr;
      // Espelha no Cloud (compat com leituras legadas)
      await supabase
        .from('profiles')
        .update({ default_instance_id: pickingInstanceId } as any)
        .eq('user_id', user.id);

      setUserDefaultInstanceId(pickingInstanceId);
      setSelectedInstanceId(pickingInstanceId);
      setMissingInstanceOpen(false);
      toast.success('Instância padrão cadastrada. Você já pode enviar mensagens.');
    } catch (e: any) {
      toast.error('Erro ao salvar instância: ' + (e?.message || ''));
    } finally {
      setSavingDefault(false);
    }
  }, [user, pickingInstanceId]);


  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedPhone, setSelectedPhone] = usePageState<string | null>('wa_selected_phone', null);

  const handleOpenChatByPhone = useCallback(async (phone: string) => {
    if (!phone) return;
    const conversationPhone = normalizeWhatsAppConversationPhone(phone);

    try {
      const { data: latestMessage } = await externalSupabase
        .from('whatsapp_messages')
        .select('instance_name')
        .in('phone', [conversationPhone, `${conversationPhone}@g.us`])
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

      setSelectedPhone(conversationPhone);
      fetchFullConversation(conversationPhone, targetInstanceName);
    } catch (error) {
      console.error('Error opening chat by phone:', error);
      setSelectedInstance(null);
      setSelectedPhone(conversationPhone);
      fetchFullConversation(conversationPhone, null);
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
      externalSupabase.from('contacts').select('phone').eq('id', contactId).single().then(({ data }) => {
        if (data?.phone) {
          const normalized = data.phone.replace(/\D/g, '');
          const match = conversations.find(c => c.phone.replace(/\D/g, '').endsWith(normalized.slice(-8)));
          handleOpenChatByPhone(match?.phone || normalized);
        }
      });
      searchParams.delete('contactId');
      setSearchParams(searchParams, { replace: true });
    } else if (leadId) {
      externalSupabase.from('contact_leads').select('contact_id, contacts(phone)').eq('lead_id', leadId).limit(1).single().then(({ data }) => {
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

  // Largura redimensionável da lista de conversas (desktop)
  const LIST_MIN_WIDTH = 260;
  const LIST_MAX_WIDTH = 600;
  const LIST_DEFAULT_WIDTH = 320;
  const [listWidth, setListWidth] = useState<number>(() => {
    try {
      const stored = localStorage.getItem('whatsapp_list_width');
      if (stored) {
        const n = parseInt(stored, 10);
        if (!isNaN(n) && n >= LIST_MIN_WIDTH && n <= LIST_MAX_WIDTH) return n;
      }
    } catch {}
    return LIST_DEFAULT_WIDTH;
  });
  const isResizingRef = useRef(false);
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizingRef.current = true;
    const startX = e.clientX;
    const startWidth = listWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const onMove = (ev: MouseEvent) => {
      if (!isResizingRef.current) return;
      const next = Math.min(LIST_MAX_WIDTH, Math.max(LIST_MIN_WIDTH, startWidth + (ev.clientX - startX)));
      setListWidth(next);
    };
    const onUp = () => {
      isResizingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      try { localStorage.setItem('whatsapp_list_width', String(Math.round(listWidthRef.current))); } catch {}
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [listWidth]);
  const listWidthRef = useRef(listWidth);
  useEffect(() => { listWidthRef.current = listWidth; }, [listWidth]);

  // Activity sheet state
  const [showActivitySheet, setShowActivitySheet] = useState(false);
  const [activityDefaults, setActivityDefaults] = useState<{ leadId?: string; leadName?: string; contactId?: string; contactName?: string; dictationText?: string }>({});
  const [showBoardPicker, setShowBoardPicker] = useState(false);
  const [selectedBoardId, setSelectedBoardId] = useState<string>('');
  const [aiPreview, setAiPreview] = useState<{
    leadFields: Record<string, string>;
    contactFields: Record<string, string>;
    customFields?: Array<{ id: string; label: string; type: string; value: any }>;
    identifiedContacts?: Array<Record<string, any>>;
  } | null>(null);
  const [creatingIdentified, setCreatingIdentified] = useState<number | null>(null);
  const [showAiPreview, setShowAiPreview] = useState(false);
  // Bulk selection state
  const [bulkMode, setBulkMode] = useState(false);
  const [sharedPanelOpen, setSharedPanelOpen] = useState(false);
  const { items: sharedWithMe } = useSharedWithMe();
  const sharedUnread = sharedWithMe.filter(s => !s.acknowledged_at).length;
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

  // Dono ("atendente atribuído") das conversas da WhatsApp API (cloud_gerencia).
  // Só essa instância usa visibilidade por atendente; instâncias UazAPI não.
  // Map<phone, assigned_user_id (ID Cloud)>. Recarrega no polling junto com as mensagens.
  const [cloudAssignees, setCloudAssignees] = useState<Map<string, string>>(new Map());
  const refreshCloudAssignees = useCallback(async () => {
    // Tabela ainda não está em types.ts (criada via migration externa); cast segue o idioma do arquivo.
    const { data } = await (externalSupabase as any)
      .from('whatsapp_cloud_assignees')
      .select('phone, assigned_user_id')
      .eq('instance_name', 'cloud_gerencia');
    const rows = (data || []) as Array<{ phone: string; assigned_user_id: string }>;
    setCloudAssignees(new Map(rows.map(r => [r.phone, r.assigned_user_id])));
  }, []);
  useEffect(() => { refreshCloudAssignees(); }, [refreshCloudAssignees]);

  // Recarrega os donos quando aparece/sai uma conversa do cloud_gerencia (atribuição só muda
  // no primeiro contato — sticky). Assinatura estável pelos telefones cloud evita refetch a cada msg.
  const cloudPhonesSig = useMemo(
    () => conversations
      .filter(c => (c.instance_name || '').toLowerCase() === 'cloud_gerencia')
      .map(c => c.phone)
      .sort()
      .join(','),
    [conversations]
  );
  useEffect(() => {
    if (cloudPhonesSig) refreshCloudAssignees();
  }, [cloudPhonesSig, refreshCloudAssignees]);

  // Realtime no dono da conversa. O webhook responde 200 ANTES de gravar o assignee
  // (processamento async), então o refresh disparado pela conversa nova corre na frente
  // da escrita e o Map fica sem a entrada → badge preso em "Sem dono". Assinar a tabela
  // garante que, quando o webhook grava o dono ~1-2s depois, o Map atualiza na hora —
  // sem depender de novo poll/mudança de telefone. (Fase 3: realtime > setInterval.)
  useEffect(() => {
    const channelName = `cloud-assignees-realtime-${Date.now()}`;
    const ch = (externalSupabase as any)
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'whatsapp_cloud_assignees', filter: `instance_name=eq.cloud_gerencia` },
        (payload: any) => {
          const row = payload.new || payload.old || {};
          const phone = row.phone as string | undefined;
          if (!phone) return;
          setCloudAssignees((prev) => {
            const next = new Map(prev);
            if (payload.eventType === 'DELETE' || !payload.new?.assigned_user_id) {
              next.delete(phone);
            } else {
              next.set(phone, payload.new.assigned_user_id as string);
            }
            return next;
          });
        }
      )
      .subscribe();
    return () => {
      (externalSupabase as any).removeChannel(ch);
    };
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
      // Egress: evitar select('*') (metadata jsonb pesado). Buscar só o que a
      // construção da lista usa abaixo.
      const { data: msgs } = await supabase
        .from('whatsapp_messages')
        .select('id, phone, contact_name, contact_id, lead_id, message_text, message_type, media_url, direction, read_at, created_at, instance_name')
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
            messages: [msg as any],
            instance_name: msg.instance_name,
          });
        } else {
          existing.messages.push(msg as any);
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
      // WhatsApp API (cloud_gerencia): visibilidade por atendente.
      // Supervisor (canViewPrivate, que já inclui admin) vê tudo; sem dono = pool comum
      // visível a todos; com dono = só o dono. Não vale para instâncias UazAPI.
      if ((conv.instance_name || '').toLowerCase() === 'cloud_gerencia') {
        if (canViewPrivate) return true;
        if (cloudShowAll) return true;
        const owner = cloudAssignees.get(conv.phone);
        if (!owner) return true;
        return owner === user.id;
      }

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
  }, [conversations, privateConvs, sharedMessages, user, canViewPrivate, cloudAssignees, cloudShowAll]);

  const [selectedInstance, setSelectedInstance] = usePageState<string | null>('wa_selected_instance', null);
  const selectedConversation = visibleConversations.find(
    c => getConversationKey(c.phone, c.instance_name) === getConversationKey(selectedPhone || '', selectedInstance)
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

  // Guard: se a conversa atual tem onboarding pendente, perguntar antes de sair.
  const [pendingNav, setPendingNav] = useState<null | (() => void)>(null);

  const guardLeaveCurrent = useCallback((after: () => void) => {
    if (selectedPhone && hasOnboardingPending(selectedPhone)) {
      setPendingNav(() => after);
    } else {
      after();
    }
  }, [selectedPhone]);

  const handleSelectConversation = (conv: WhatsAppConversation) => {
    const apply = () => {
      setSelectedPhone(normalizeWhatsAppConversationPhone(conv.phone));
      setSelectedInstance(conv.instance_name);
      fetchFullConversation(conv.phone, conv.instance_name);
      if (conv.unread_count > 0) {
        markAsRead(conv.phone, conv.instance_name);
      }
    };
    // Se for a mesma conversa, não pergunta
    if (conv.phone === selectedPhone) { apply(); return; }
    guardLeaveCurrent(apply);
  };

  // Finaliza (cancela) os checkpoints pendentes do lead da conversa atual.
  const finalizeOnboardingForCurrent = useCallback(async () => {
    const lid = getPendingLeadId(selectedPhone);
    if (!lid) return;
    const dbAny = externalSupabase as any;
    await dbAny
      .from('onboarding_checkpoints')
      .update({ status: 'done', result: { cancelled_by_user: true, at: new Date().toISOString() } })
      .eq('lead_id', lid)
      .in('status', ['pending', 'running', 'failed']);
  }, [selectedPhone]);

  const [extracting, setExtracting] = useState(false);
  const [extractionStep, setExtractionStep] = useState('');
  const [contactDefaults, setContactDefaults] = useState<Record<string, string>>({});

  const fetchCallContext = async (leadId?: string | null, contactId?: string | null): Promise<string> => {
    try {
      const ids: string[] = [];
      if (leadId) ids.push(`lead_id.eq.${leadId}`);
      if (contactId) ids.push(`contact_id.eq.${contactId}`);
      if (ids.length === 0) return '';
      const { data } = await externalSupabase
        .from('call_records')
        .select('created_at, call_type, call_result, duration_seconds, ai_summary, ai_transcript, notes, next_step')
        .or(ids.join(','))
        .order('created_at', { ascending: false })
        .limit(15);
      if (!data || data.length === 0) return '';
      return data
        .map((c: any) => {
          const when = c.created_at ? new Date(c.created_at).toLocaleString('pt-BR') : '';
          const dur = c.duration_seconds ? ` (${Math.round(c.duration_seconds / 60)}min)` : '';
          const parts = [
            `--- Ligação ${when}${dur} [${c.call_type || ''} / ${c.call_result || ''}] ---`,
            c.ai_summary ? `Resumo: ${c.ai_summary}` : '',
            c.ai_transcript ? `Transcrição: ${c.ai_transcript}` : '',
            c.notes ? `Notas: ${c.notes}` : '',
            c.next_step ? `Próximo passo registrado: ${c.next_step}` : '',
          ].filter(Boolean);
          return parts.join('\n');
        })
        .join('\n\n');
    } catch (e) {
      console.warn('[fetchCallContext] erro:', e);
      return '';
    }
  };

  const extractConversationData = async (
    targetType: 'lead' | 'contact',
    customFields?: Array<{ id: string; label: string; type?: string; options?: string[] }>
  ) => {
    if (!selectedConversation?.phone || !selectedInstance) return {};
    try {
      setExtracting(true);
      setExtractionStep(targetType === 'lead' ? 'Extraindo dados do lead...' : 'Extraindo dados do contato...');
      const callContext = await fetchCallContext(selectedConversation.lead_id, selectedConversation.contact_id);
      const visibleMessages = (selectedConversation.messages || [])
        .slice()
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
        .slice(-300)
        .map((m) => ({
          direction: m.direction,
          sender_name: (m as any).sender_name,
          contact_name: m.contact_name,
          message_text: m.message_text,
          message_type: m.message_type,
          media_type: m.media_type,
          created_at: m.created_at,
        }));
      const { data, error } = await cloudFunctions.invoke('extract-conversation-data', {
        body: {
          phone: selectedConversation.phone,
          instance_name: selectedInstance,
          targetType,
          extra_context: callContext || undefined,
          call_summaries: callContext || undefined,
          custom_fields: customFields && customFields.length > 0 ? customFields : undefined,
          visible_messages: visibleMessages,
          // Só no contato: manda também as imagens/PDFs da conversa pro OCR, que é
          // de onde saem profissão, cidade/UF, CPF/RG e endereço quando o cliente
          // mandou o documento sem digitar nada. Fica fora do lead porque
          // multimodal custa caro e o lead não depende de documento pessoal.
          include_documents: targetType === 'contact',
        },
      });
      if (error) throw error;
      setExtractionStep('Dados extraídos!');
      const result = data?.data || data?.result || {};
      // Garantir que o resumo das ligações apareça nas notas mesmo se a IA externa ignorar extra_context.
      if (callContext) {
        const existingNotes = (result.notes || '').toString();
        const callMarker = '[Resumo das ligações CallFace]';
        if (!existingNotes.includes(callMarker)) {
          result.notes = `${existingNotes ? existingNotes + '\n\n' : ''}${callMarker}\n${callContext}`.slice(0, 8000);
        }
      }
      return result;
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
      const extCreatedBy = await remapToExternal(currentUser?.id);

      // Extract both lead and contact data in parallel
      const [extracted, contactExtracted] = await Promise.all([
        extractConversationData('lead'),
        extractConversationData('contact'),
      ]);

      const isGroupChat = isWhatsAppGroupId(selectedConversation.phone);
      const insertData: Record<string, any> = {
        lead_name: extracted.lead_name || contactExtracted.full_name || selectedConversation.contact_name || 'Novo Lead - WhatsApp',
        // JID de grupo NÃO entra em lead_phone (não é telefone).
        lead_phone: isGroupChat ? null : (selectedConversation.phone || null),
        whatsapp_group_id: isGroupChat ? selectedConversation.phone : null,
        lead_email: extracted.lead_email || contactExtracted.email || null,
        source: 'whatsapp',
        created_by: extCreatedBy,
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

      // A IA de extração devolve datas em texto livre e pode entregar só o ano
      // ("2024"): sanitiza antes de tocar no banco (coluna date rejeita parcial).
      const { data, error } = await externalSupabase
        .from('leads')
        .insert(sanitizeLeadDateFields(insertData))
        .select('*')
        .single();

      if (error) throw error;

      // Conversa de grupo: o phone é o JID do grupo, não o número de uma pessoa.
      // Cria o lead (já com whatsapp_group_id acima) e NÃO cria contato — senão
      // nasce um "contato" com o nome do grupo e o JID no telefone. O contato do
      // cliente entra depois pelos participantes / ClosedCaseContactDialog.
      if (!isGroupChat) {
        // Use already-extracted contact data
        const contactName = contactExtracted.full_name || selectedConversation.contact_name || 'Contato WhatsApp';

        // Check if contact with same phone already exists
        const normalizedPhone = selectedConversation.phone.replace(/\D/g, '');
        const { data: existingContact } = await externalSupabase
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
            created_by: extCreatedBy,
          };
          if (contactExtracted.email) contactInsert.email = contactExtracted.email;
          if (contactExtracted.city) contactInsert.city = contactExtracted.city;
          if (contactExtracted.state) contactInsert.state = contactExtracted.state;
          if (contactExtracted.instagram_url) contactInsert.instagram_url = contactExtracted.instagram_url;

          const { data: newContact, error: contactError } = await externalSupabase
            .from('contacts')
            .insert([contactInsert] as any)
            .select('id')
            .single();
          if (contactError) throw contactError;
          contactId = newContact.id;
        }

        // Link contact to lead
        await externalSupabase.from('contact_leads').insert({
          contact_id: contactId,
          lead_id: data.id,
          relationship_to_victim: 'Vítima',
        });

        // Link contact to conversation
        await linkToContact(selectedConversation.phone, contactId, selectedConversation.instance_name);
      }

      await linkToLead(selectedConversation.phone, data.id, selectedConversation.instance_name);

      setEditingLead(data as Lead);
      setShowLeadPanel(true);
      setShowBoardPicker(false);

      toast.success(isGroupChat ? 'Lead criado com o grupo vinculado!' : 'Lead e contato criados com dados da conversa!');
    } catch (e) {
      console.error(e);
      toast.error('Erro ao criar lead');
    } finally {
      setCreatingLead(false);
    }
  };

  const handleCreateContact = async () => {
    if (!selectedConversation) return;
    // Grupo não é contato: o phone é o JID do grupo. Cadastrar aqui geraria um
    // "contato" com o nome e o ID do grupo. Para clientes de um grupo, use o
    // fluxo de participantes / caso fechado.
    if (isWhatsAppGroupId(selectedConversation.phone)) {
      toast.error('Esta conversa é um grupo, não um contato individual.', {
        description: 'Para cadastrar o cliente, use "Sincronizar contatos do grupo" ou o cadastro de caso fechado.',
      });
      return;
    }
    const extracted = await extractConversationData('contact');
    const normalizedPhone = selectedConversation.phone.replace(/\D/g, '');
    try {
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      const extCreatedBy = await remapToExternal(currentUser?.id);
      const { data: existingContact } = await externalSupabase
        .from('contacts')
        .select('id, full_name, phone')
        .or(`phone.eq.${selectedConversation.phone},phone.eq.${normalizedPhone},phone.ilike.%${normalizedPhone.slice(-8)}%`)
        .limit(1)
        .maybeSingle();

      let contactId = existingContact?.id;
      if (!contactId) {
        const { data: created, error } = await externalSupabase
          .from('contacts')
          .insert({
            full_name: extracted.full_name || selectedConversation.contact_name || 'Contato WhatsApp',
            phone: selectedConversation.phone,
            email: extracted.email || null,
            city: extracted.city || null,
            state: extracted.state || null,
            instagram_url: extracted.instagram_url || null,
            notes: extracted.notes || null,
            created_by: extCreatedBy,
          } as any)
          .select('id')
          .single();
        if (error) throw error;
        contactId = created.id;
      }

      await linkToContact(selectedConversation.phone, contactId, selectedConversation.instance_name);
      await refetch();
      toast.success(existingContact ? 'Contato existente vinculado' : 'Contato criado automaticamente');
    } catch (e: any) {
      console.error('Create contact error:', e);
      toast.error('Erro ao criar contato: ' + (e?.message || ''));
    }
  };

  const handleUpdateWithAI = async () => {
    if (!selectedConversation) return;
    try {
      const leadFields: Record<string, string> = {};
      const contactFields: Record<string, string> = {};
      const customFieldsResolved: Array<{ id: string; label: string; type: string; value: any }> = [];
      let identifiedContacts: Array<Record<string, any>> = [];


      if (selectedConversation.lead_id) {
        setExtractionStep('Carregando campos personalizados...');
        // Fetch lead's board_id + custom fields for that board
        let customSpecs: Array<{ id: string; label: string; type?: string; options?: string[] }> = [];
        let customMeta: Record<string, { label: string; type: string }> = {};
        let visibleLeadFieldKeys: Set<string> | null = null;
        let birthDateCustomFieldId: string | null = null;
        try {
          const { data: leadRow } = await externalSupabase
            .from('leads')
            .select('board_id')
            .eq('id', selectedConversation.lead_id)
            .maybeSingle();
          const boardId = (leadRow as any)?.board_id;
          if (boardId) {
            const [{ data: cfs }, { data: fieldLayouts }, { data: tabLayouts }] = await Promise.all([
              (externalSupabase as any)
                .from('lead_custom_fields')
                .select('id, field_name, field_type, field_options, tab')
                .or(`board_id.eq.${boardId},board_id.is.null`),
              (externalSupabase as any)
                .from('lead_field_layouts')
                .select('field_key, hidden')
                .eq('board_id', boardId),
              (externalSupabase as any)
                .from('lead_tab_layouts')
                .select('tab_key, hidden')
                .eq('board_id', boardId),
            ]);
            const hiddenTabs = new Set((tabLayouts || []).filter((t: any) => t.hidden).map((t: any) => t.tab_key));
            const hiddenFixed = new Set((fieldLayouts || []).filter((f: any) => f.hidden).map((f: any) => f.field_key));
            visibleLeadFieldKeys = new Set(LEAD_FIELD_REGISTRY.map((def) => def.key).filter((key) => !hiddenFixed.has(key)));
            const visibleCustomFields = (cfs || []).filter((f: any) => !hiddenTabs.has(((f as any).tab as string) || 'basic'));
            const birthField = visibleCustomFields.find((f: any) => isBirthDateLabel(f.field_name));
            birthDateCustomFieldId = birthField?.id || null;
            customSpecs = visibleCustomFields.map((f: any) => ({
              id: f.id,
              label: f.field_name,
              type: f.field_type,
              options: Array.isArray(f.field_options) ? f.field_options : undefined,
            }));
            customMeta = Object.fromEntries(customSpecs.map(s => [s.id, { label: s.label, type: s.type || 'text' }]));
          }
        } catch (e) {
          console.warn('[handleUpdateWithAI] fetch custom fields error:', e);
        }

        setExtractionStep('Analisando conversa para o lead...');
        const extracted = await extractConversationData('lead', customSpecs);
        if (Array.isArray(extracted?.identified_contacts)) {
          identifiedContacts = extracted.identified_contacts;
        }
        const allowedLeadFields = [
          'lead_name', 'victim_name', 'lead_email', 'city', 'state', 'neighborhood',
          'main_company', 'contractor_company', 'accident_address', 'accident_date',
          'damage_description', 'case_number', 'case_type', 'notes', 'sector',
          'visit_city', 'visit_state', 'visit_address', 'liability_type', 'news_link',
          'expected_birth_date', 'client_classification',
        ];
        for (const field of allowedLeadFields) {
          if (visibleLeadFieldKeys && !visibleLeadFieldKeys.has(field)) continue;
          if (field === 'expected_birth_date' && birthDateCustomFieldId) continue;
          if (extracted[field]) leadFields[field] = extracted[field];
        }
        if (!leadFields.expected_birth_date && !birthDateCustomFieldId && (!visibleLeadFieldKeys || visibleLeadFieldKeys.has('expected_birth_date'))) {
          const deterministicDate = extractNearestExpectedBirthDate(selectedConversation.messages || []);
          if (deterministicDate) leadFields.expected_birth_date = deterministicDate;
        }
        if (leadFields.expected_birth_date && !leadFields.client_classification) {
          leadFields.client_classification = 'parto';
        }
        const extractedCustom = (extracted && extracted.custom_fields) || {};
        const deterministicBirthDate = extractNearestExpectedBirthDate(selectedConversation.messages || []);
        if (birthDateCustomFieldId && deterministicBirthDate && !extractedCustom[birthDateCustomFieldId]) {
          extractedCustom[birthDateCustomFieldId] = deterministicBirthDate;
        }
        for (const [fieldId, value] of Object.entries(extractedCustom)) {
          const meta = customMeta[fieldId];
          if (!meta) continue;
          customFieldsResolved.push({ id: fieldId, label: meta.label, type: meta.type, value });
        }
      }

      if (selectedConversation.contact_id) {
        setExtractionStep('Analisando conversa para o contato...');
        const extracted = await extractConversationData('contact');
        const allowedContactFields = [
          'full_name', 'phone', 'email', 'city', 'state', 'neighborhood',
          'notes', 'instagram_url', 'instagram_username', 'profession',
          'cpf', 'rg', 'cep', 'street', 'street_number', 'complement', 'birth_date',
        ];
        for (const field of allowedContactFields) {
          if (extracted[field]) contactFields[field] = extracted[field];
        }
      }


      setExtractionStep('');

      if (
        Object.keys(leadFields).length === 0 &&
        Object.keys(contactFields).length === 0 &&
        customFieldsResolved.length === 0 &&
        identifiedContacts.length === 0
      ) {
        toast.info('Nenhuma informação nova encontrada na conversa.');
        return;
      }

      setAiPreview({ leadFields, contactFields, customFields: customFieldsResolved, identifiedContacts });
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
        const { error } = await externalSupabase.from('leads').update(aiPreview.leadFields).eq('id', selectedConversation.lead_id);
        if (!error) updates.push('Lead');
      }
      if (Object.keys(aiPreview.contactFields).length > 0 && selectedConversation.contact_id) {
        const { error } = await externalSupabase.from('contacts').update(aiPreview.contactFields).eq('id', selectedConversation.contact_id);
        if (!error) updates.push('Contato');
      }
      if (aiPreview.customFields && aiPreview.customFields.length > 0 && selectedConversation.lead_id) {
        const leadId = selectedConversation.lead_id;
        let saved = 0;
        for (const cf of aiPreview.customFields) {
          try {
            const payload: any = {
              lead_id: leadId,
              field_id: cf.id,
              value_text: null,
              value_number: null,
              value_date: null,
              value_boolean: null,
            };
            switch (cf.type) {
              case 'number':
                payload.value_number = typeof cf.value === 'number' ? cf.value : Number(String(cf.value).replace(/[^\d.-]/g, '')) || null;
                break;
              case 'date':
                payload.value_date = String(cf.value).slice(0, 10);
                break;
              case 'checkbox':
                payload.value_boolean = Boolean(cf.value);
                break;
              default:
                payload.value_text = String(cf.value);
            }
            const { data: existing } = await (externalSupabase as any)
              .from('lead_custom_field_values')
              .select('id')
              .eq('lead_id', leadId)
              .eq('field_id', cf.id)
              .maybeSingle();
            if (existing?.id) {
              await (externalSupabase as any).from('lead_custom_field_values').update({
                value_text: payload.value_text,
                value_number: payload.value_number,
                value_date: payload.value_date,
                value_boolean: payload.value_boolean,
              }).eq('id', existing.id);
            } else {
              await (externalSupabase as any).from('lead_custom_field_values').insert(payload);
            }
            saved++;
          } catch (e) {
            console.warn('[handleConfirmAiUpdate] custom field save error:', cf.id, e);
          }
        }
        if (saved > 0) updates.push(`${saved} campo(s) personalizado(s)`);
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

  const handleCreateIdentifiedContact = async (idx: number) => {
    if (!aiPreview?.identifiedContacts || !selectedConversation?.lead_id) return;
    const person = aiPreview.identifiedContacts[idx];
    if (!person) return;
    setCreatingIdentified(idx);
    try {
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      const extCreatedBy = await remapToExternal(currentUser?.id);
      const phoneDigits = person.phone ? String(person.phone).replace(/\D/g, '') : null;
      const insertPayload: Record<string, any> = {
        full_name: person.full_name || person.relationship || 'Contato identificado',
        phone: phoneDigits || null,
        cpf: person.cpf || null,
        rg: person.rg || null,
        birth_date: person.birth_date || null,
        cep: person.cep || null,
        street: person.street || null,
        street_number: person.street_number || null,
        complement: person.complement || null,
        neighborhood: person.neighborhood || null,
        city: person.city || null,
        state: person.state || null,
        email: person.email || null,
        profession: person.profession || null,
        notes: [person.relationship ? `Relação: ${person.relationship}` : '', person.notes || ''].filter(Boolean).join('\n') || null,
        created_by: extCreatedBy,
      };
      const { data: created, error: insertError } = await (externalSupabase as any)
        .from('contacts')
        .insert(insertPayload as any)
        .select('id')
        .single();
      if (insertError) throw insertError;
      // Vincular ao lead atual
      const { error: linkError } = await externalSupabase
        .from('contact_leads' as any)
        .insert({ contact_id: created.id, lead_id: selectedConversation.lead_id });
      if (linkError && linkError.code !== '23505') throw linkError;
      toast.success(`Contato "${insertPayload.full_name}" criado e vinculado`);
      // Remove da lista do preview
      setAiPreview(prev => prev ? {
        ...prev,
        identifiedContacts: prev.identifiedContacts?.filter((_, i) => i !== idx),
      } : prev);
    } catch (e: any) {
      console.error('Create identified contact error:', e);
      toast.error('Erro ao criar contato: ' + (e?.message || ''));
    } finally {
      setCreatingIdentified(null);
    }
  };


  const handleContactCreated = async (contact: { id: string; full_name: string; phone: string | null; lead_id?: string | null }) => {
    if (selectedConversation) {
      await linkToContact(selectedConversation.phone, contact.id, selectedConversation.instance_name);
      if (contact.lead_id) {
        await linkToLead(selectedConversation.phone, contact.lead_id, selectedConversation.instance_name);
      }
    }
    await refetch();
  };

  const handleSaveLead = async (leadId: string, updates: Partial<Lead>) => {
    // Track who updated
    const { data: { user } } = await supabase.auth.getUser();
    const payload = { ...updates } as any;
    if (user?.id) {
      payload.updated_by = await remapToExternal(user.id);
    }
    
    const { error } = await externalSupabase
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

  const handleCreateActivity = (leadId: string, leadName: string, contactId?: string, contactName?: string, prefillText?: string) => {
    setActivityDefaults({ leadId, leadName, contactId, contactName, dictationText: prefillText });
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
    const { data } = await externalSupabase.from('leads').select('*').eq('id', leadId).single();
    if (data) {
      setEditingLead(data as Lead);
      setShowLeadPanel(true);
    }
  };

  const handleViewContact = async (contactId: string) => {
    const { data } = await externalSupabase.from('contacts').select('*').eq('id', contactId).single();
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
        onBack={() => {
          setShowSetup(false);
          refetchInstances();
        }} 
        initialTab={settingsTab}
      />
    );
  }

  return (
    <div
      className="flex flex-col relative overflow-hidden h-screen md:h-screen"
      style={{
        height: 'calc(100dvh - var(--app-header-offset, 0px))',
      }}
    >
      {/* Header da inbox (instância + ações) — SEMPRE FIXO NO TOPO */}
      <div className={`flex items-center gap-2 md:gap-3 p-3 md:p-4 border-b bg-card flex-wrap md:flex-nowrap shrink-0 ${selectedPhone ? 'hidden md:flex' : 'flex'}`}>
        {isMinimal && backTo && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate(backTo)}
            title="Voltar"
            className="h-8 w-8"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
        )}
        <MessageSquare className="h-6 w-6 text-green-600" />
        {!isMinimal && <h1 className="text-lg font-semibold">WhatsApp</h1>}
        {totalUnread > 0 && (
          <Badge variant="destructive" className="text-xs">{totalUnread}</Badge>
        )}

        {!isMinimal && !lockInstanceName && hasCloudApiInstance && (
          <Tabs
            value={inboxTab}
            onValueChange={(v) => setInboxTab(v as 'whatsapp' | 'cloud_api')}
            className="ml-0 md:ml-2"
          >
            <TabsList className="h-8">
              <TabsTrigger value="whatsapp" className="text-xs h-7 px-2.5">WhatsApp</TabsTrigger>
              <TabsTrigger value="cloud_api" className="text-xs h-7 px-2.5">WhatsJUD API</TabsTrigger>
            </TabsList>
          </Tabs>
        )}
        {isCloudContext && (
          <button
            type="button"
            onClick={checkCloudStatus}
            disabled={cloudStatus === 'checking'}
            title={cloudStatusInfo
              ? `WhatsApp Cloud API (Meta) — ${cloudStatusInfo}`
              : 'Status do número Cloud (Meta). Clique para atualizar.'}
            className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium hover:bg-accent transition-colors"
          >
            {cloudStatus === 'checking' ? (
              <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
            ) : (
              <span
                className={`h-2 w-2 rounded-full ${
                  cloudStatus === 'online' ? 'bg-green-500'
                  : cloudStatus === 'offline' ? 'bg-destructive'
                  : 'bg-muted-foreground'
                }`}
              />
            )}
            <span className={cloudStatus === 'offline' ? 'text-destructive' : ''}>
              {cloudStatus === 'online' ? 'Conectado'
                : cloudStatus === 'offline' ? 'Offline'
                : cloudStatus === 'checking' ? 'Verificando…'
                : 'Status'}
            </span>
          </button>
        )}

        {!isMinimal && inboxTab !== 'cloud_api' && instances.length > 0 && (
          <Select open={instanceSelectOpen} onOpenChange={setInstanceSelectOpen} value={selectedInstanceId} onValueChange={(val) => { guardLeaveCurrent(() => { setSelectedInstanceId(val); setSelectedPhone(null); setSelectedInstance(null); if (val !== 'all') localStorage.setItem('whatsapp_last_instance_id', val); }); }}>
            <SelectTrigger data-tour="instance-selector" className="w-52 h-8 text-xs ml-0 md:ml-2">
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
                const instanceNameKey = normalizeInstanceName(inst.instance_name);
                const status = statuses.find(s => (
                  s.id === inst.id || normalizeInstanceName(s.instance_name) === instanceNameKey
                ));
                const state: 'connected' | 'disconnected' | 'unknown' =
                  status ? (status.connected ? 'connected' : 'disconnected') : 'unknown';
                const dotClass =
                  state === 'connected' ? 'bg-green-500' :
                  state === 'disconnected' ? 'bg-destructive' :
                  'bg-muted-foreground/40';
                return (
                  <SelectItem key={inst.id} value={inst.id}>
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full flex-shrink-0 ${dotClass}`} />
                      <span className={state === 'disconnected' ? 'text-muted-foreground' : ''}>{inst.instance_name}</span>
                      {state === 'disconnected' && <span className="text-[10px] text-destructive">offline</span>}
                      {state === 'unknown' && <span className="text-[10px] text-muted-foreground">verificando…</span>}
                    </div>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        )}

        {/* WhatsApp API: alterna entre "minhas + pool" e "todas as conversas" (qualquer usuário). */}
        {inboxTab === 'cloud_api' && !canViewPrivate && (
          <Button
            variant={cloudShowAll ? 'default' : 'outline'}
            size="sm"
            className="h-8 gap-1.5 ml-0 md:ml-2"
            onClick={() => setCloudShowAll(!cloudShowAll)}
            title={cloudShowAll ? 'Mostrando todas as conversas — clique para ver só as suas' : 'Mostrando suas conversas + pool — clique para ver todas'}
          >
            <Users className="h-3.5 w-3.5" />
            <span className="hidden md:inline text-xs">{cloudShowAll ? 'Todas as conversas' : 'Minhas + pool'}</span>
          </Button>
        )}



        {/* Atalho: reconectar (QR / código) a instância selecionada */}
        {!isMinimal && inboxTab !== 'cloud_api' && selectedInstanceId && selectedInstanceId !== 'all' && (() => {
          const inst = instances.find(i => i.id === selectedInstanceId);
          if (!inst) return null;
          const status = statuses.find(s => (
            s.id === inst.id || normalizeInstanceName(s.instance_name) === normalizeInstanceName(inst.instance_name)
          ));
          const isOffline = status ? !status.connected : false;
          return (
            <Button
              variant={isOffline ? 'destructive' : 'outline'}
              size="sm"
              className="h-8 gap-1.5"
              onClick={() => setReconnectInstance({ id: inst.id, name: inst.instance_name })}
              title={isOffline ? `Reconectar ${inst.instance_name} (QR ou código)` : `Gerar QR / código de pareamento para ${inst.instance_name}`}
            >
              <QrCode className="h-3.5 w-3.5" />
              <span className="hidden md:inline">{isOffline ? 'Reconectar' : 'QR / Código'}</span>
            </Button>
          );
        })()}


        <div className="w-full md:w-auto md:ml-auto flex flex-wrap md:flex-nowrap gap-0.5 md:gap-1 items-center justify-end">
          {!isMinimal && inboxTab !== 'cloud_api' && relevantDisconnectedInstances.length > 0 && (
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
          {!isMinimal && (
            <Button
              variant={bulkMode ? "default" : "ghost"}
              size={bulkMode ? "sm" : "icon"}
              onClick={handleToggleBulkMode}
              title="Seleção em lote"
            >
              <ListChecks className="h-4 w-4" />
              {bulkMode && <span className="ml-1 text-xs">Lote</span>}
            </Button>
          )}
          {!isMinimal && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSharedPanelOpen(true)}
              title="Conversas compartilhadas comigo"
              className="relative"
            >
              <Share2 className="h-4 w-4" />
              {sharedUnread > 0 && (
                <span className="absolute -top-0.5 -right-0.5 h-4 min-w-4 px-1 rounded-full bg-destructive text-destructive-foreground text-[9px] flex items-center justify-center font-semibold">
                  {sharedUnread}
                </span>
              )}
            </Button>
          )}
          {!isMinimal && (
            <Button variant="ghost" size="icon" onClick={() => setShowGooglePanel(true)} title="Google Workspace">
              <Chrome className="h-4 w-4" />
            </Button>
          )}
          {!isMinimal && googleConnected && (
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
          {!isMinimal && (
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
          )}
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

          {!isMinimal && (
            <Button variant="ghost" size="icon" onClick={() => { setSettingsTab('integration'); setShowSetup(true); }} title="Configuração">
              <Settings className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Foco Agora — barra única sempre visível (condensada) para ver indicadores e conversas ao mesmo tempo */}
      {/* Foco Agora — barra única sempre visível (condensada) para ver indicadores e conversas ao mesmo tempo */}
      <div className="shrink-0 border-b">
        <FocusDashboard
          compact
          users={acolhedorUsers}
          onOpenMissingDocs={() => toast.info('Filtro "faltam documentos" em breve')}
          onOpenZapsignPending={() => toast.info('Lista de pendentes ZapSign em breve')}
          onOpenUnanswered={() => {
            window.dispatchEvent(new CustomEvent('wa:set-quick-filter', { detail: { filter: 'unanswered' } }));
          }}
          onOpenChat={handleOpenChatByPhone}
        />
      </div>

      {/* Reconnect Bar - apenas para instância padrão do usuário */}
      {relevantDisconnectedInstances.length > 0 && !lockInstanceName && (
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
      {relevantDisconnectedInstances.length > 0 && !dismissedAlert && !lockInstanceName && (
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
                cloudAssignees={cloudAssignees}
                currentUserId={user?.id || null}
                canSeeAllAssignments={canViewPrivate}
                onServerSearch={searchConversations}
                onLoadMore={loadMoreConversations}
                hasMore={hasMoreConversations}
              />
            </div>
          ) : (
            <div className="flex flex-1 flex-col overflow-hidden">
              {selectedConversation && (
                <WhatsAppChat
                  conversation={selectedConversation}
                  onBack={() => { guardLeaveCurrent(() => { setSelectedPhone(null); setSelectedInstance(null); }); }}
                  onSendMessage={(() => {
                    const share = sharedConvs.find(s => s.phone === selectedConversation.phone && s.instance_name === selectedConversation.instance_name);
                    if (share) {
                      return guardSendMessage(((phone: string, message: string, contactId?: string, leadId?: string, instanceName?: string | null, _identifySender?: boolean, chatId?: string, treatmentOverride?: string | null, nameFormatOverride?: string, nicknameOverride?: string | null, mentions?: string[]) =>
                        sendMessage(phone, message, contactId, leadId, instanceName, share.identify_sender, chatId, treatmentOverride, nameFormatOverride, nicknameOverride, mentions)) as any);
                    }
                    return guardSendMessage(sendMessage);
                  })()}
                  shareInfo={sharedConvs.find(s => s.phone === selectedConversation.phone && s.instance_name === selectedConversation.instance_name) || null}
                  onSendMedia={guardSendMedia as any}
                  onSendLocation={guardSendLocation as any}

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
                  onLoadOlderMessages={loadOlderConversationMessages}
                />
              )}
            </div>
          )}
        </div>

        {/* DESKTOP: layout com largura fixa redimensionável por arrasto */}
        <div className="hidden md:flex flex-1 min-w-0">
          <div
            className="border-r overflow-y-auto bg-card flex flex-col flex-shrink-0"
            style={{ width: `${listWidth}px` }}
          >
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
              cloudAssignees={cloudAssignees}
              currentUserId={user?.id || null}
              canSeeAllAssignments={canViewPrivate}
              onServerSearch={searchConversations}
              onLoadMore={loadMoreConversations}
              hasMore={hasMoreConversations}
            />
          </div>

          {/* Alça de redimensionamento */}
          <div
            onMouseDown={handleResizeStart}
            onDoubleClick={() => { setListWidth(LIST_DEFAULT_WIDTH); try { localStorage.setItem('whatsapp_list_width', String(LIST_DEFAULT_WIDTH)); } catch {} }}
            title="Arraste para redimensionar (duplo clique para resetar)"
            className="w-1 hover:w-1.5 bg-border hover:bg-primary/40 cursor-col-resize flex-shrink-0 transition-all"
          />

          <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
            {selectedConversation ? (
                <WhatsAppChat
                  conversation={selectedConversation}
                  onBack={() => { guardLeaveCurrent(() => { setSelectedPhone(null); setSelectedInstance(null); }); }}
                  onSendMessage={(() => {
                    const share = sharedConvs.find(s => s.phone === selectedConversation.phone && s.instance_name === selectedConversation.instance_name);
                    if (share) {
                      return guardSendMessage(((phone: string, message: string, contactId?: string, leadId?: string, instanceName?: string | null, _identifySender?: boolean, chatId?: string, treatmentOverride?: string | null, nameFormatOverride?: string, nicknameOverride?: string | null, mentions?: string[]) =>
                        sendMessage(phone, message, contactId, leadId, instanceName, share.identify_sender, chatId, treatmentOverride, nameFormatOverride, nicknameOverride, mentions)) as any);
                    }
                    return guardSendMessage(sendMessage);
                  })()}
                  shareInfo={sharedConvs.find(s => s.phone === selectedConversation.phone && s.instance_name === selectedConversation.instance_name) || null}
                  onSendMedia={guardSendMedia as any}
                  onSendLocation={guardSendLocation as any}

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
                  onLoadOlderMessages={loadOlderConversationMessages}
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
        </div>
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
        defaultDictationText={activityDefaults.dictationText}
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
              {aiPreview.customFields && aiPreview.customFields.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-semibold text-primary">Campos personalizados do lead</p>
                  <div className="rounded-lg border divide-y">
                    {aiPreview.customFields.map((cf) => (
                      <div key={cf.id} className="flex items-start gap-3 px-3 py-2 text-sm">
                        <span className="text-muted-foreground min-w-[140px] shrink-0">{cf.label}</span>
                        <span className="font-medium break-words">{String(cf.value)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {aiPreview.identifiedContacts && aiPreview.identifiedContacts.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-semibold text-primary">Pessoas identificadas na conversa</p>
                  <div className="space-y-2">
                    {aiPreview.identifiedContacts.map((person, idx) => (
                      <div key={idx} className="rounded-lg border p-3 space-y-1 text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-medium">
                            {person.full_name || '(sem nome)'}
                            {person.relationship && <span className="text-muted-foreground font-normal"> — {person.relationship}</span>}
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={creatingIdentified === idx}
                            onClick={() => handleCreateIdentifiedContact(idx)}
                          >
                            {creatingIdentified === idx ? 'Criando...' : 'Criar e vincular'}
                          </Button>
                        </div>
                        <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5">
                          {person.phone && <span>📞 {person.phone}</span>}
                          {person.cpf && <span>CPF: {person.cpf}</span>}
                          {person.birth_date && <span>Nasc: {person.birth_date}</span>}
                          {person.city && <span>{person.city}{person.state ? `/${person.state}` : ''}</span>}
                          {person.profession && <span>{person.profession}</span>}
                        </div>
                        {(person.street || person.cep) && (
                          <div className="text-xs text-muted-foreground">
                            {[person.street, person.street_number, person.complement, person.neighborhood, person.cep].filter(Boolean).join(', ')}
                          </div>
                        )}
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
      <ZapSignDialogHost />
      <OnboardingCheckpointHost selectedPhone={selectedPhone} />

      <AlertDialog
        open={!!pendingNav}
        onOpenChange={(o) => { if (!o) setPendingNav(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Onboarding pendente nesta conversa</AlertDialogTitle>
            <AlertDialogDescription>
              Há etapas de onboarding pós-assinatura abertas para este cliente.
              Se você sair, o formulário será fechado. O que deseja fazer?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-2">
            <AlertDialogCancel onClick={() => setPendingNav(null)}>
              Continuar onboarding
            </AlertDialogCancel>
            <Button
              variant="outline"
              onClick={() => {
                const nav = pendingNav;
                setPendingNav(null);
                nav?.();
              }}
            >
              Sair sem finalizar
            </Button>
            <AlertDialogAction
              onClick={async () => {
                await finalizeOnboardingForCurrent();
                const nav = pendingNav;
                setPendingNav(null);
                nav?.();
              }}
            >
              Finalizar onboarding
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <SharedConversationsPanel open={sharedPanelOpen} onOpenChange={setSharedPanelOpen} />

      {/* Popup bloqueante: sem instância padrão = sem envio */}
      <Dialog
        open={missingInstanceOpen && !lockInstanceName}
        onOpenChange={(open) => {
          // Só fecha se já tiver instância cadastrada (não pode escapar sem escolher)
          if (!open && !userDefaultInstanceId) return;
          setMissingInstanceOpen(open);
        }}
      >
        <DialogContent className="sm:max-w-md" onPointerDownOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>Escolha sua instância de WhatsApp</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              Você ainda não tem uma instância cadastrada. Selecione qual número deve enviar suas mensagens. Sem isso, o envio fica bloqueado.
            </p>
            {instances.length === 0 ? (
              <p className="text-sm text-destructive">
                Nenhuma instância disponível para você. Peça ao administrador para liberar uma instância.
              </p>
            ) : (
              <div className="space-y-2">
                <Label>Instância</Label>
                <Select value={pickingInstanceId} onValueChange={setPickingInstanceId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione uma instância..." />
                  </SelectTrigger>
                  <SelectContent>
                    {instances.map((inst) => (
                      <SelectItem key={inst.id} value={inst.id}>
                        {inst.instance_name}{(inst as any).owner_name ? ` — ${(inst as any).owner_name}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              onClick={handleConfirmDefaultInstance}
              disabled={!pickingInstanceId || savingDefault || instances.length === 0}
            >
              {savingDefault ? (<><Loader2 className="h-4 w-4 mr-2 animate-spin" />Salvando...</>) : 'Cadastrar instância'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

