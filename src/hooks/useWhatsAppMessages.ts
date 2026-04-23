import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { externalSupabase, ensureExternalSession } from '@/integrations/supabase/external-client';
import {
  getConversationSummaries,
  getConversationMessages,
  markMessagesAsRead,
  linkMessagesToLead,
  linkMessagesToContact,
} from '@/integrations/supabase/external-rpc';
import { useAuthContext } from '@/contexts/AuthContext';
import { useUserRole } from '@/hooks/useUserRole';
import { toast } from 'sonner';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';
import { traceHook } from '@/utils/hookTracer';

export interface WhatsAppMessage {
  id: string;
  phone: string;
  contact_name: string | null;
  message_text: string | null;
  message_type: string;
  media_url: string | null;
  media_type: string | null;
  direction: string;
  status: string;
  contact_id: string | null;
  lead_id: string | null;
  external_message_id: string | null;
  metadata: any;
  created_at: string;
  read_at: string | null;
  instance_name: string | null;
  instance_token: string | null;
}

export interface WhatsAppConversation {
  phone: string;
  contact_name: string | null;
  contact_id: string | null;
  lead_id: string | null;
  last_message: string | null;
  last_message_at: string;
  unread_count: number;
  messages: WhatsAppMessage[];
  instance_name: string | null;
}

export interface WhatsAppInstance {
  id: string;
  instance_name: string;
  instance_token: string;
  owner_phone: string | null;
  base_url: string | null;
  is_active: boolean;
  auto_identify_sender?: boolean | null;
}

export interface InstanceStats {
  instance_name: string;
  conversation_count: number;
  message_count: number;
  inbound_count: number;
  outbound_count: number;
  unread_count: number;
}

const normalizeInstanceName = (instanceName?: string | null) =>
  (instanceName || '').trim().toLowerCase();

// Conversation identity = phone + instance_name. Normalize instance_name case-insensitively
// to avoid creating phantom duplicates when the webhook saves "Cris" but the RPC returns "cris".
const getConversationKey = (phone: string, instanceName?: string | null) =>
  `${(phone || '').trim()}__${normalizeInstanceName(instanceName)}`;

// ---------------------------------------------------------------------------
// Module-level cache (sobrevive a unmount/remount do WhatsAppInbox).
// Mantém a última lista de conversas por filtro de instância, para que ao
// voltar para a página o usuário veja imediatamente o estado anterior em vez
// de tela branca + flash de outra instância.
// ---------------------------------------------------------------------------
type ConversationsCacheEntry = {
  conversations: WhatsAppConversation[];
  fetchedAt: number;
};
const conversationsCache: Map<string, ConversationsCacheEntry> = new Map();
const cacheKeyFor = (selectedInstanceId?: string | null) =>
  `inst:${selectedInstanceId ?? 'none'}`;

export function useWhatsAppMessages(selectedInstanceId?: string | null) {
  const { user } = useAuthContext();
  const { isAdmin } = useUserRole();
  const [messages, setMessages] = useState<WhatsAppMessage[]>([]);
  // Restaura cache imediato no mount para evitar tela branca / flash ao re-entrar na página
  const [conversations, setConversations] = useState<WhatsAppConversation[]>(() => {
    const cached = conversationsCache.get(cacheKeyFor(selectedInstanceId));
    return cached?.conversations ?? [];
  });
  const [loading, setLoading] = useState(false);
  const [instanceSwitching, setInstanceSwitching] = useState(false);
  const [switchProgress, setSwitchProgress] = useState(0);
  const [instances, setInstances] = useState<WhatsAppInstance[]>([]);
  const [instanceStats, setInstanceStats] = useState<InstanceStats[]>([]);
  const [statsLoading, setStatsLoading] = useState(true);
  const conversationsRef = useRef<WhatsAppConversation[]>([]);
  // Se restaurou do cache, considera "já carregado" — não mostra spinner
  const [hasLoaded, setHasLoaded] = useState(() => {
    return conversationsCache.has(cacheKeyFor(selectedInstanceId));
  });
  const profileCacheRef = useRef<{ full_name: string | null; treatment_title: string | null } | null>(null);
  const isFetchingRef = useRef(false);
  const [realtimeHealthy, setRealtimeHealthy] = useState(true);
  const [realtimeRetryNonce, setRealtimeRetryNonce] = useState(0);
  const realtimeRetryTimerRef = useRef<number | null>(null);
  const syncInFlightRef = useRef(false);
  const lastSyncAtRef = useRef<Record<string, number>>({});
  const activeConversationKeyRef = useRef<string | null>(null);
  const fullConvCacheRef = useRef<Record<string, WhatsAppMessage[]>>({});

  const getCanonicalInstanceName = useCallback((instanceName?: string | null) => {
    const normalized = normalizeInstanceName(instanceName);
    if (!normalized) return instanceName?.trim() || null;

    const matchedInstance = instances.find(
      (instance) => normalizeInstanceName(instance.instance_name) === normalized
    );

    return matchedInstance?.instance_name || instanceName?.trim() || null;
  }, [instances]);

  

  const fetchInstances = useCallback(async () => {
    if (!user) return;

    try {
      // Admins see all active instances
      if (isAdmin) {
        const { data, error } = await supabase
          .from('whatsapp_instances')
          .select('*')
          .eq('is_active', true)
          .order('instance_name');
        if (error) throw error;
        setInstances((data || []) as WhatsAppInstance[]);
        return;
      }

      // Members: only see explicitly assigned instances
      const [{ data: permissions, error: permissionsError }, { data: profile, error: profileError }] = await Promise.all([
        supabase
          .from('whatsapp_instance_users')
          .select('instance_id')
          .eq('user_id', user.id),
        supabase
          .from('profiles')
          .select('default_instance_id')
          .eq('user_id', user.id)
          .maybeSingle(),
      ]);

      if (permissionsError) throw permissionsError;
      if (profileError) throw profileError;

      const allowedIds = new Set((permissions || []).map((permission) => permission.instance_id));

      if (profile?.default_instance_id) {
        allowedIds.add(profile.default_instance_id);
      }

      if (allowedIds.size === 0) {
        setInstances([]);
        return;
      }

      const { data: instData, error: instError } = await supabase
        .from('whatsapp_instances')
        .select('*')
        .eq('is_active', true)
        .in('id', Array.from(allowedIds))
        .order('instance_name');

      if (instError) throw instError;

      setInstances((instData || []) as WhatsAppInstance[]);
    } catch (error) {
      console.error('Error fetching WhatsApp instances:', error);
      setInstances([]);
    } finally {
      setStatsLoading(false);
    }
  }, [user, isAdmin]);

  // Lightweight stats fetch — only counts, no full message data
  const fetchInstanceStats = useCallback(async () => {
    if (instances.length === 0) {
      setInstanceStats([]);
      setStatsLoading(false);
      return;
    }

    setStatsLoading(true);
    try {
      await ensureExternalSession().catch(() => {});
      const ext = externalSupabase as any;

      // Use a single lightweight query with counts per instance
      const stats: InstanceStats[] = [];

      for (const inst of instances) {
        const [totalRes, inboundRes, outboundRes, unreadRes] = await Promise.all([
          ext.from('whatsapp_messages').select('id', { count: 'exact', head: true })
            .eq('instance_name', inst.instance_name),
          ext.from('whatsapp_messages').select('id', { count: 'exact', head: true })
            .eq('instance_name', inst.instance_name).eq('direction', 'inbound'),
          ext.from('whatsapp_messages').select('id', { count: 'exact', head: true })
            .eq('instance_name', inst.instance_name).eq('direction', 'outbound'),
          ext.from('whatsapp_messages').select('id', { count: 'exact', head: true })
            .eq('instance_name', inst.instance_name).eq('direction', 'inbound').is('read_at', null),
        ]);

        // Get distinct phone count via a different approach
        const { data: distinctPhones } = await ext
          .from('whatsapp_messages')
          .select('phone')
          .eq('instance_name', inst.instance_name)
          .limit(1000);
        
        const uniquePhones = new Set(distinctPhones?.map(p => p.phone) || []);

        stats.push({
          instance_name: inst.instance_name,
          conversation_count: uniquePhones.size,
          message_count: totalRes.count || 0,
          inbound_count: inboundRes.count || 0,
          outbound_count: outboundRes.count || 0,
          unread_count: unreadRes.count || 0,
        });
      }
      
      setInstanceStats(stats);
    } catch (error) {
      console.error('Error fetching instance stats:', error);
    } finally {
      setStatsLoading(false);
    }
  }, [instances]);

  const processMessages = useCallback((msgs: WhatsAppMessage[], silent: boolean) => {
    const normalizedMessages = msgs.map((msg) => ({
      ...msg,
      instance_name: getCanonicalInstanceName(msg.instance_name),
    }));

    setMessages(normalizedMessages);

    const convMap = new Map<string, WhatsAppConversation>();

    for (const msg of normalizedMessages) {
      const conversationKey = getConversationKey(msg.phone, msg.instance_name);
      const existing = convMap.get(conversationKey);
      if (!existing) {
        convMap.set(conversationKey, {
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
        const msgId = msg.external_message_id?.split(':').pop();
        const isDuplicate = msgId && existing.messages.some(m => {
          const existingMsgId = m.external_message_id?.split(':').pop();
          return existingMsgId === msgId && m.created_at === msg.created_at;
        });
        if (!isDuplicate) {
          existing.messages.push(msg);
          if (!msg.read_at && msg.direction === 'inbound') existing.unread_count++;
        }
        if (!existing.contact_name && msg.contact_name) existing.contact_name = msg.contact_name;
        if (!existing.contact_id && msg.contact_id) existing.contact_id = msg.contact_id;
        if (!existing.lead_id && msg.lead_id) existing.lead_id = msg.lead_id;
      }
    }

    const convList = Array.from(convMap.values())
      .sort((a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime());

    conversationsRef.current = convList;
    setConversations(convList);
    setHasLoaded(true);

    if (!silent) {
      toast.success(`${convList.length} conversas carregadas`);
    }
  }, [getCanonicalInstanceName]);

  const syncRecentMessages = useCallback(async (instance?: WhatsAppInstance | null, force = false) => {
    if (!instance?.id) return;
    const now = Date.now();
    const lastSyncAt = lastSyncAtRef.current[instance.id] || 0;

    // Avoid excessive provider pulls unless realtime is degraded
    if (!force && now - lastSyncAt < 45000) return;
    if (syncInFlightRef.current) return;

    syncInFlightRef.current = true;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const { data, error } = await cloudFunctions.invoke('sync-whatsapp-recent', {
        body: {
          instance_id: instance.id,
          instance_name: instance.instance_name,
          max_chats: 80,
          user_id: user?.id || null,
        },
        authToken: session?.access_token,
      });

      if (error) throw error;
      if (data && data.success === false) {
        throw new Error(data.error || 'Sync failed');
      }

      lastSyncAtRef.current[instance.id] = now;
    } catch (err) {
      console.warn('Error syncing recent WhatsApp messages:', err);
    } finally {
      syncInFlightRef.current = false;
    }
  }, [user?.id]);

  const fetchMessages = useCallback(async (silent = false, triggerSync = false) => {
    traceHook('useWhatsAppMessages.fetchMessages', {
      silent,
      triggerSync,
      selectedInstanceId,
      instancesCount: instances.length,
      hasLoaded,
      isFetching: isFetchingRef.current,
    });
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;

    // Only show loading spinner on first load, never on silent/polling refreshes
    if (!silent && !hasLoaded) setLoading(true);

    try {
      const targetInstances = (!selectedInstanceId || selectedInstanceId === 'all')
        ? instances
        : instances.filter(i => i.id === selectedInstanceId);

      if (targetInstances.length === 0) {
        // Don't set hasLoaded when there are no instances yet — 
        // allows retry once instances actually load
        setConversations([]);
        setMessages([]);
        return;
      }

      // Only trigger sync on explicit manual refresh, NOT on polling/realtime
      if (triggerSync && selectedInstanceId && selectedInstanceId !== 'all') {
        const inst = instances.find(i => i.id === selectedInstanceId);
        if (inst) {
          // Fire and forget - don't block the UI
          syncRecentMessages(inst, true).catch(() => {});
        }
      }

      const instanceNames = targetInstances.map(i => i.instance_name);

      // Single call to the typed wrapper backed by the external DB — this is the
      // source of truth for whatsapp_messages. There is NO Cloud fallback: the Cloud
      // mirror is stale (sync is batched), so falling back to it was overwriting the
      // sidebar with old data and removing conversations that only existed in the
      // external DB. If the external call fails, we throw and let the catch block
      // keep the last-known-good state, and show a loading/error UI.
      try {
        await ensureExternalSession();
      } catch (sessionError) {
        console.error('External session failed:', sessionError);
      }
      console.log('Calling getConversationSummaries with:', instanceNames);
      const summaries = await getConversationSummaries(instanceNames);

      const canonicalInstanceNames = new Map(
        targetInstances.map((instance) => [normalizeInstanceName(instance.instance_name), instance.instance_name])
      );

      const conversationMap = new Map<string, WhatsAppConversation>();

      for (const summary of summaries || []) {
        const canonicalInstanceName =
          canonicalInstanceNames.get(normalizeInstanceName(summary.instance_name)) ||
          summary.instance_name ||
          null;

        const summaryMessage: WhatsAppMessage = {
          id: `summary-${summary.phone}-${canonicalInstanceName}`,
          phone: summary.phone,
          contact_name: summary.contact_name,
          message_text: summary.last_message_text,
          message_type: 'text',
          media_url: null,
          media_type: null,
          direction: summary.last_direction || 'inbound',
          status: 'received',
          contact_id: summary.contact_id,
          lead_id: summary.lead_id,
          external_message_id: null,
          metadata: null,
          created_at: summary.last_message_at,
          read_at: null,
          instance_name: canonicalInstanceName,
          instance_token: null,
        };

        const conversationKey = getConversationKey(summary.phone, canonicalInstanceName);
        const existingConversation = conversationMap.get(conversationKey);

        if (!existingConversation) {
          conversationMap.set(conversationKey, {
            phone: summary.phone,
            contact_name: summary.contact_name,
            contact_id: summary.contact_id,
            lead_id: summary.lead_id,
            last_message: summary.last_message_text,
            last_message_at: summary.last_message_at,
            unread_count: Number(summary.unread_count) || 0,
            messages: [summaryMessage],
            instance_name: canonicalInstanceName,
          });
          continue;
        }

        const existingTime = new Date(existingConversation.last_message_at).getTime();
        const incomingTime = new Date(summary.last_message_at).getTime();

        existingConversation.unread_count += Number(summary.unread_count) || 0;
        if (!existingConversation.contact_name && summary.contact_name) {
          existingConversation.contact_name = summary.contact_name;
        }
        if (!existingConversation.contact_id && summary.contact_id) {
          existingConversation.contact_id = summary.contact_id;
        }
        if (!existingConversation.lead_id && summary.lead_id) {
          existingConversation.lead_id = summary.lead_id;
        }

        if (incomingTime >= existingTime) {
          existingConversation.last_message = summary.last_message_text;
          existingConversation.last_message_at = summary.last_message_at;
          existingConversation.messages = [summaryMessage];
          existingConversation.instance_name = canonicalInstanceName;
        }
      }

      const convList = Array.from(conversationMap.values())
        .sort((a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime());

      // Preserve full message history for the active conversation
      const activeConversationKey = activeConversationKeyRef.current;
      if (activeConversationKey && fullConvCacheRef.current[activeConversationKey]) {
        const cachedMsgs = fullConvCacheRef.current[activeConversationKey];
        const activeConvIdx = convList.findIndex(c => getConversationKey(c.phone, c.instance_name) === activeConversationKey);
        if (activeConvIdx >= 0) {
          const cachedIds = new Set(cachedMsgs.map(m => m.id));
          const newMsgs = convList[activeConvIdx].messages.filter(m => !cachedIds.has(m.id) && !m.id.startsWith('summary-'));
          convList[activeConvIdx] = {
            ...convList[activeConvIdx],
            messages: [...cachedMsgs, ...newMsgs],
          };
          fullConvCacheRef.current[activeConversationKey] = convList[activeConvIdx].messages;
        }
      }

      conversationsRef.current = convList;
      setConversations(convList);
      setMessages(convList.map(c => c.messages[0]));
      setHasLoaded(true);

      if (!silent && convList.length > 0) {
        toast.success(`${convList.length} conversas carregadas`);
      }
    } catch (error: any) {
      const errCode = error?.code || error?.details?.code;
      const isTimeout = errCode === '57014' || /statement timeout|timeout/i.test(error?.message || '');
      console.error('Error fetching WhatsApp messages from external:', error);

      // CRITICAL: never wipe the conversation list on RPC failure.
      // If we already have conversations in memory, keep them as-is — the next
      // successful poll/realtime event will refresh them. Only show a toast
      // when the user explicitly triggered the fetch (not silent polling).
      const hasExistingData = conversationsRef.current.length > 0;

      if (!silent) {
        if (isTimeout && hasExistingData) {
          toast.warning('Servidor lento — mostrando últimas conversas em cache.');
        } else if (isTimeout) {
          toast.error('Servidor demorou para responder. Tentando novamente em instantes...');
        } else if (hasExistingData) {
          toast.warning('Falha temporária ao atualizar conversas. Mantendo lista atual.');
        } else {
          toast.error('Erro ao carregar conversas do servidor. Tentando novamente...');
        }
      }

      // Mark as loaded so the UI stops showing the initial spinner indefinitely
      // when the very first call fails — the realtime subscription will hydrate later.
      if (!hasLoaded) setHasLoaded(true);
    } finally {
      isFetchingRef.current = false;
      if (!silent && !hasLoaded) setLoading(false);
    }
  }, [instances, selectedInstanceId, syncRecentMessages, hasLoaded]);

  const sendMessage = async (
    phone: string,
    message: string,
    contactId?: string,
    leadId?: string,
    conversationInstanceName?: string | null,
    identifySender = true,
    chatId?: string,
    treatmentOverride?: string | null,
    nameFormatOverride?: string,
    nicknameOverride?: string | null
  ) => {
    try {
      let finalMessage = message;
      let targetInstanceId = selectedInstanceId && selectedInstanceId !== 'all' ? selectedInstanceId : undefined;

      // Run instance lookup and profile fetch in parallel
      const instancePromise = conversationInstanceName
        ? supabase.from('whatsapp_instances').select('id').eq('instance_name', conversationInstanceName).eq('is_active', true).maybeSingle()
        : Promise.resolve(null);

      const profilePromise = (user && identifySender && !profileCacheRef.current)
        ? supabase.from('profiles').select('full_name, treatment_title').eq('user_id', user.id).single()
        : Promise.resolve(null);

      const [instanceResult, profileResult] = await Promise.all([instancePromise, profilePromise]);

      if (instanceResult?.data?.id) {
        targetInstanceId = instanceResult.data.id;
      }
      if (!targetInstanceId) {
        toast.error('Erro: instância não identificada. Selecione uma instância antes de enviar.');
        return false;
      }

      if (profileResult?.data) {
        profileCacheRef.current = profileResult.data;
      }

      if (user && identifySender) {
        const fmt = nameFormatOverride || 'first_last';
        
        if (fmt === 'nickname' && nicknameOverride) {
          // Nickname mode: just the nickname, no treatment title
          finalMessage = `*${nicknameOverride}:*\n${message}`;
        } else if (profileCacheRef.current?.full_name) {
          const { full_name } = profileCacheRef.current;
          let displayName = full_name;
          if (fmt === 'first') {
            displayName = full_name.split(' ')[0];
          } else if (fmt === 'first_last') {
            const parts = full_name.split(' ');
            displayName = parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1]}` : parts[0];
          }
          const title = treatmentOverride !== undefined && treatmentOverride !== null
            ? treatmentOverride
            : (profileCacheRef.current.treatment_title || '');
          const senderName = title ? `${title} ${displayName}` : displayName;
          finalMessage = `*${senderName}:*\n${message}`;
        }
      }

      const { data, error } = await cloudFunctions.invoke('send-whatsapp', {
        body: {
          phone,
          chat_id: chatId,
          message: finalMessage,
          contact_id: contactId,
          lead_id: leadId,
          instance_id: targetInstanceId,
        },
      });
      if (error) throw error;
      if (!data.success) {
        if (data.error_code === 'INSTANCE_DISCONNECTED') {
          toast.error(`Instância ${data.instance_name || ''} desconectada. Reconecte o WhatsApp e tente novamente.`.trim());
          return false;
        }
        throw new Error(data.error);
      }
      toast.success('Mensagem enviada!');

      // Optimistic local update instead of full refetch
      const optimisticMsg: WhatsAppMessage = {
        id: data.message_id || crypto.randomUUID(),
        phone,
        contact_name: null,
        message_text: finalMessage,
        message_type: 'text',
        media_url: null,
        media_type: null,
        direction: 'outbound',
        status: 'sent',
        contact_id: contactId || null,
        lead_id: leadId || null,
        external_message_id: null,
        metadata: { __optimistic: true },
        created_at: new Date().toISOString(),
        read_at: null,
        instance_name: data.instance_name || conversationInstanceName || null,
        instance_token: null,
      };
      setMessages(prev => [optimisticMsg, ...prev]);
      const targetConversationKey = getConversationKey(phone, optimisticMsg.instance_name);
      setConversations(prev => prev.map(c =>
        getConversationKey(c.phone, c.instance_name) === targetConversationKey
          ? { ...c, last_message: finalMessage, last_message_at: optimisticMsg.created_at, messages: [...c.messages, optimisticMsg] }
          : c
      ));

      return true;
    } catch (error: any) {
      console.error('Error sending message:', error);
      toast.error('Erro ao enviar mensagem: ' + (error.message || 'Erro desconhecido'));
      return false;
    }
  };

  const sendMedia = async (
    phone: string,
    mediaUrl: string,
    mediaType: string,
    caption?: string,
    fileName?: string,
    contactId?: string,
    leadId?: string,
    conversationInstanceName?: string | null,
    chatId?: string
  ) => {
    try {
      let targetInstanceId = selectedInstanceId && selectedInstanceId !== 'all' ? selectedInstanceId : undefined;
      if (conversationInstanceName) {
        const { data } = await supabase.from('whatsapp_instances').select('id').eq('instance_name', conversationInstanceName).eq('is_active', true).maybeSingle();
        if (data?.id) targetInstanceId = data.id;
      }
      if (!targetInstanceId) {
        toast.error('Erro: instância não identificada para envio de mídia.');
        return false;
      }

      const { data, error } = await cloudFunctions.invoke('send-whatsapp', {
        body: {
          action: 'send_media',
          phone,
          chat_id: chatId,
          media_url: mediaUrl,
          media_type: mediaType,
          caption: caption || undefined,
          file_name: fileName || undefined,
          contact_id: contactId,
          lead_id: leadId,
          instance_id: targetInstanceId,
        },
      });
      if (error) throw error;
      if (!data.success) {
        if (data.error_code === 'INSTANCE_DISCONNECTED') {
          toast.error(`Instância ${data.instance_name || ''} desconectada. Reconecte o WhatsApp e tente novamente.`.trim());
          return false;
        }
        throw new Error(data.error);
      }
      toast.success('Mídia enviada!');

      const msgType = mediaType?.startsWith('audio') ? 'audio' : mediaType?.startsWith('image') ? 'image' : mediaType?.startsWith('video') ? 'video' : 'document';
      const optimisticMsg: WhatsAppMessage = {
        id: data.message_id || crypto.randomUUID(),
        phone, contact_name: null, message_text: caption || null,
        message_type: msgType, media_url: mediaUrl, media_type: mediaType,
        direction: 'outbound', status: 'sent',
        contact_id: contactId || null, lead_id: leadId || null,
        external_message_id: null, metadata: { __optimistic: true },
        created_at: new Date().toISOString(), read_at: null,
        instance_name: data.instance_name || conversationInstanceName || null, instance_token: null,
      };
      setMessages(prev => [optimisticMsg, ...prev]);
      const targetConversationKey = getConversationKey(phone, optimisticMsg.instance_name);
      setConversations(prev => prev.map(c =>
        getConversationKey(c.phone, c.instance_name) === targetConversationKey
          ? { ...c, last_message: caption || `📎 ${msgType}`, last_message_at: optimisticMsg.created_at, messages: [...c.messages, optimisticMsg] }
          : c
      ));
      return true;
    } catch (error: any) {
      console.error('Error sending media:', error);
      toast.error('Erro ao enviar mídia: ' + (error.message || 'Erro desconhecido'));
      return false;
    }
  };

  const sendLocation = async (
    phone: string,
    latitude: number,
    longitude: number,
    name?: string,
    address?: string,
    contactId?: string,
    leadId?: string,
    conversationInstanceName?: string | null,
    chatId?: string
  ) => {
    try {
      let targetInstanceId = selectedInstanceId && selectedInstanceId !== 'all' ? selectedInstanceId : undefined;
      if (conversationInstanceName) {
        const { data } = await supabase.from('whatsapp_instances').select('id').eq('instance_name', conversationInstanceName).eq('is_active', true).maybeSingle();
        if (data?.id) targetInstanceId = data.id;
      }
      if (!targetInstanceId) {
        toast.error('Erro: instância não identificada para envio de localização.');
        return false;
      }

      const { data, error } = await cloudFunctions.invoke('send-whatsapp', {
        body: {
          action: 'send_location',
          phone, chat_id: chatId, latitude, longitude, name, address,
          contact_id: contactId, lead_id: leadId, instance_id: targetInstanceId,
        },
      });
      if (error) throw error;
      if (!data.success) {
        if (data.error_code === 'INSTANCE_DISCONNECTED') {
          toast.error(`Instância ${data.instance_name || ''} desconectada. Reconecte o WhatsApp e tente novamente.`.trim());
          return false;
        }
        throw new Error(data.error);
      }
      toast.success('Localização enviada!');

      const locationText = `📍 ${name || 'Localização'}${address ? `\n${address}` : ''}`;
      const optimisticMsg: WhatsAppMessage = {
        id: data.message_id || crypto.randomUUID(),
        phone, contact_name: null, message_text: locationText,
        message_type: 'location', media_url: null, media_type: null,
        direction: 'outbound', status: 'sent',
        contact_id: contactId || null, lead_id: leadId || null,
        external_message_id: null, metadata: { latitude, longitude, name, address, __optimistic: true },
        created_at: new Date().toISOString(), read_at: null,
        instance_name: data.instance_name || conversationInstanceName || null, instance_token: null,
      };
      setMessages(prev => [optimisticMsg, ...prev]);
      const targetConversationKey = getConversationKey(phone, optimisticMsg.instance_name);
      setConversations(prev => prev.map(c =>
        getConversationKey(c.phone, c.instance_name) === targetConversationKey
          ? { ...c, last_message: locationText, last_message_at: optimisticMsg.created_at, messages: [...c.messages, optimisticMsg] }
          : c
      ));
      return true;
    } catch (error: any) {
      console.error('Error sending location:', error);
      toast.error('Erro ao enviar localização: ' + (error.message || 'Erro desconhecido'));
      return false;
    }
  };

  const deleteMessage = async (messageId: string, instanceName?: string | null, externalMessageId?: string | null) => {
    try {
      let instanceId: string | undefined;
      if (instanceName) {
        const { data } = await supabase.from('whatsapp_instances').select('id').eq('instance_name', instanceName).eq('is_active', true).maybeSingle();
        if (data?.id) instanceId = data.id;
      }

      const { data, error } = await cloudFunctions.invoke('send-whatsapp', {
        body: {
          action: 'delete_message',
          message_id: messageId,
          instance_id: instanceId,
          external_message_id: externalMessageId || undefined,
        },
      });
      if (error) throw error;
      if (!data.success) throw new Error(data.error);
      
      // Remove from local state
      setMessages(prev => prev.filter(m => m.id !== messageId));
      setConversations(prev => prev.map(c => ({
        ...c,
        messages: c.messages.filter(m => m.id !== messageId),
      })));
      toast.success('Mensagem apagada!');
      return true;
    } catch (error: any) {
      console.error('Error deleting message:', error);
      toast.error('Erro ao apagar mensagem: ' + (error.message || 'Erro desconhecido'));
      return false;
    }
  };

  const markAsRead = async (phone: string, instanceName?: string | null) => {
    if (!instanceName) {
      console.warn('markAsRead called without instance_name — skipping to avoid cross-instance mutation');
      return;
    }
    try {
      await ensureExternalSession().catch(() => {});
      await markMessagesAsRead(phone, instanceName);

      const targetConversationKey = getConversationKey(phone, instanceName);
      setConversations(prev => prev.map(c =>
        getConversationKey(c.phone, c.instance_name) === targetConversationKey
          ? { ...c, unread_count: 0 }
          : c
      ));
    } catch (error) { console.error('Error marking as read:', error); }
  };

  const linkToLead = async (phone: string, leadId: string, instanceName?: string | null) => {
    if (!instanceName) {
      toast.error('Erro: instância não identificada para vincular lead.');
      return;
    }
    try {
      await ensureExternalSession().catch(() => {});
      await linkMessagesToLead(phone, instanceName, leadId);
      toast.success('Conversa vinculada ao lead!');
      const targetConversationKey = getConversationKey(phone, instanceName);
      setConversations(prev => prev.map(c =>
        getConversationKey(c.phone, c.instance_name) === targetConversationKey
          ? { ...c, lead_id: leadId }
          : c
      ));
    } catch (error) { console.error(error); toast.error('Erro ao vincular ao lead'); }
  };

  const linkToContact = async (phone: string, contactId: string, instanceName?: string | null) => {
    if (!instanceName) {
      toast.error('Erro: instância não identificada para vincular contato.');
      return;
    }
    try {
      // Fetch contact name from Cloud (contacts table lives there)
      const { data: contactData } = await supabase.from('contacts').select('full_name').eq('id', contactId).single();
      await ensureExternalSession().catch(() => {});
      await linkMessagesToContact(phone, instanceName, contactId);
      toast.success('Conversa vinculada ao contato!');
      const targetConversationKey = getConversationKey(phone, instanceName);
      setConversations(prev => prev.map(c =>
        getConversationKey(c.phone, c.instance_name) === targetConversationKey
          ? { ...c, contact_id: contactId, contact_name: contactData?.full_name || c.contact_name }
          : c
      ));
    } catch (error) { console.error(error); toast.error('Erro ao vincular ao contato'); }
  };

  // Fetch instances on mount
  useEffect(() => {
    traceHook('useWhatsAppMessages.effect:fetchInstances', { hasUser: !!user });
    if (user) fetchInstances();
  }, [user, fetchInstances]);

  // Fetch lightweight stats when instances load (NOT full messages)
  useEffect(() => {
    traceHook('useWhatsAppMessages.effect:onInstancesLoaded', {
      instancesCount: instances.length,
      hasLoaded,
    });
    if (instances.length > 0) {
      fetchInstanceStats();
      // Auto-load conversations when instances are ready
      if (!hasLoaded) {
        fetchMessages(true);
      }
    }
  }, [instances, fetchInstanceStats, fetchMessages, hasLoaded]);

  // If conversations were already loaded, re-fetch when instance filter changes
  useEffect(() => {
    traceHook('useWhatsAppMessages.effect:onInstanceFilterChange', {
      selectedInstanceId,
      hasLoaded,
    });
    if (!hasLoaded) return;
    // Clear caches so stale data from previous instance doesn't leak
    fullConvCacheRef.current = {};
    activeConversationKeyRef.current = null;
    // Reset fetching guard so instance switch always triggers a fresh load
    isFetchingRef.current = false;

    // Show switching indicator with progress
    setInstanceSwitching(true);
    setSwitchProgress(10);

    const progressTimer1 = setTimeout(() => setSwitchProgress(30), 200);
    const progressTimer2 = setTimeout(() => setSwitchProgress(50), 600);
    const progressTimer3 = setTimeout(() => setSwitchProgress(70), 1200);

    const doFetch = async () => {
      await fetchMessages(true);
      setSwitchProgress(100);
      setTimeout(() => {
        setInstanceSwitching(false);
        setSwitchProgress(0);
      }, 300);
    };
    doFetch();

    return () => {
      clearTimeout(progressTimer1);
      clearTimeout(progressTimer2);
      clearTimeout(progressTimer3);
    };
  }, [selectedInstanceId, hasLoaded, fetchMessages]);

  // Realtime subscription with reconnection resilience
  useEffect(() => {
    if (!hasLoaded) return;

    let disposed = false;

    const scheduleRetry = () => {
      if (realtimeRetryTimerRef.current !== null) return;
      realtimeRetryTimerRef.current = window.setTimeout(() => {
        realtimeRetryTimerRef.current = null;
        if (!disposed) {
          setRealtimeRetryNonce((prev) => prev + 1);
        }
      }, 2500);
    };

      // Predicate: `existing` é um optimistic local que corresponde ao `incoming`
      // (INSERT realtime). Fingerprint: phone + instance + outbound dos dois lados,
      // conteúdo bate (text OU media_url OU location latitude+longitude), delta
      // created_at < 30s. Só retorna true se existing.metadata.__optimistic === true —
      // guarda contra replace falso de outbound real recente com mesmo conteúdo.
      const isOptimisticMatch = (existing: WhatsAppMessage, incoming: WhatsAppMessage): boolean => {
        if (incoming.direction !== 'outbound') return false;
        if (existing.direction !== 'outbound') return false;
        if (!existing.metadata || existing.metadata.__optimistic !== true) return false;
        if (existing.phone !== incoming.phone) return false;
        if (existing.instance_name !== incoming.instance_name) return false;
        const dt = Math.abs(new Date(existing.created_at).getTime() - new Date(incoming.created_at).getTime());
        if (dt > 30_000) return false;
        if (existing.message_text != null && incoming.message_text != null &&
            existing.message_text === incoming.message_text) return true;
        if (existing.media_url != null && incoming.media_url != null &&
            existing.media_url === incoming.media_url) return true;
        const em = existing.metadata;
        const im = incoming.metadata;
        if (em && im && em.latitude != null && em.longitude != null &&
            em.latitude === im.latitude && em.longitude === im.longitude) return true;
        return false;
      };

      // Tail do external_message_id (formato "instance:msgid"). Usado pra detectar
      // 2º INSERT do mesmo evento realtime (ex: mirror disparando duplicado).
      const extMsgIdTail = (m: WhatsAppMessage) => m.external_message_id?.split(':').pop() || null;

      const handleIncomingMessage = (newMsg: WhatsAppMessage) => {
        const canonicalMsg = {
          ...newMsg,
          instance_name: getCanonicalInstanceName(newMsg.instance_name),
        };
        const allowedNames = new Set(instances.map(i => i.instance_name?.trim().toLowerCase()));
        const incomingName = (canonicalMsg.instance_name || '').trim().toLowerCase();
        if (allowedNames.size > 0 && !allowedNames.has(incomingName)) return;

        if (selectedInstanceId && selectedInstanceId !== 'all') {
          const inst = instances.find(i => i.id === selectedInstanceId);
          const selectedName = inst?.instance_name?.trim().toLowerCase();
          if (selectedName && incomingName !== selectedName) return;
        }

        const incomingExtTail = extMsgIdTail(canonicalMsg);

        setMessages(prev => {
          // Match 1: external_message_id igual → duplicado, ignora.
          if (incomingExtTail && prev.some(m => extMsgIdTail(m) === incomingExtTail && m.created_at === canonicalMsg.created_at)) {
            return prev;
          }
          // Match 2: optimistic fingerprint → replace in-place.
          const optIdx = prev.findIndex(m => isOptimisticMatch(m, canonicalMsg));
          if (optIdx >= 0) {
            const next = prev.slice();
            next[optIdx] = canonicalMsg;
            return next;
          }
          return [canonicalMsg, ...prev];
        });

        setConversations(prev => {
          const targetConversationKey = getConversationKey(canonicalMsg.phone, canonicalMsg.instance_name);
          const existing = prev.find(c => getConversationKey(c.phone, c.instance_name) === targetConversationKey);
          if (existing) {
            // Match 1: external_message_id igual → duplicado (mirror disparando 2×).
            if (incomingExtTail && existing.messages.some(m => extMsgIdTail(m) === incomingExtTail && m.created_at === canonicalMsg.created_at)) {
              return prev;
            }

            // Match 2: optimistic fingerprint → replace in-place (preserva posição).
            const optIdx = existing.messages.findIndex(m => isOptimisticMatch(m, canonicalMsg));

            // Mesma lógica no cache da conversa ativa.
            if (activeConversationKeyRef.current === targetConversationKey && fullConvCacheRef.current[targetConversationKey]) {
              const cached = fullConvCacheRef.current[targetConversationKey];
              const cachedHasExt = incomingExtTail && cached.some(m => extMsgIdTail(m) === incomingExtTail && m.created_at === canonicalMsg.created_at);
              if (!cachedHasExt) {
                const cachedOptIdx = cached.findIndex(m => isOptimisticMatch(m, canonicalMsg));
                if (cachedOptIdx >= 0) {
                  const nextCached = cached.slice();
                  nextCached[cachedOptIdx] = canonicalMsg;
                  fullConvCacheRef.current[targetConversationKey] = nextCached;
                } else {
                  fullConvCacheRef.current[targetConversationKey] = [...cached, canonicalMsg];
                }
              }
            }

            return prev.map(c => {
              if (getConversationKey(c.phone, c.instance_name) !== targetConversationKey) return c;
              if (optIdx >= 0) {
                // Replace optimistic com o canonical. Não mexe em last_message*/unread_count:
                // o optimistic já setou corretamente, e qualquer update aqui causaria
                // reorder/jitter visual na sidebar quando a mensagem já estava renderizada.
                return {
                  ...c,
                  messages: c.messages.map((m, i) => i === optIdx ? canonicalMsg : m),
                };
              }
              // Append normal (inbound, ou outbound sem optimistic pré-existente).
              return {
                ...c,
                last_message: canonicalMsg.message_text || c.last_message,
                last_message_at: canonicalMsg.created_at,
                messages: [...c.messages, canonicalMsg],
                contact_name: canonicalMsg.contact_name || c.contact_name,
              };
            }).sort((a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime());
          } else {
            const newConv: WhatsAppConversation = {
              phone: canonicalMsg.phone,
              contact_name: canonicalMsg.contact_name,
              contact_id: canonicalMsg.contact_id,
              lead_id: canonicalMsg.lead_id,
              last_message: canonicalMsg.message_text,
              last_message_at: canonicalMsg.created_at,
              unread_count: !canonicalMsg.read_at && canonicalMsg.direction === 'inbound' ? 1 : 0,
              messages: [canonicalMsg],
              instance_name: canonicalMsg.instance_name,
            };
            return [newConv, ...prev];
          }
        });
      };

      // Canal 1 — conversations. Autoridade server-side de last_message_*,
      // contact_*, lead_id, unread_count, ordenação da sidebar. NÃO toca
      // messages[] (autoridade do Canal 2). Monotonic rule em last_message_at:
      // só avança, nunca retrocede, pra evitar jitter quando optimistic
      // client-clock está à frente do server.
      type ConversationRow = {
        instance_name: string;
        phone: string;
        last_message_text: string | null;
        last_message_at: string;
        contact_name: string | null;
        contact_id: string | null;
        lead_id: string | null;
        unread_count: number;
      };
      type ConvChangePayload = {
        eventType: 'INSERT' | 'UPDATE' | 'DELETE';
        new: ConversationRow | Record<string, never>;
        old: ConversationRow | Record<string, never>;
      };

      const handleConversationChange = (payload: ConvChangePayload) => {
        if (payload.eventType === 'DELETE') return;
        const row = payload.new as ConversationRow;
        if (!row || !row.instance_name || !row.phone) return;

        const canonicalInstance = getCanonicalInstanceName(row.instance_name);
        const allowedNames = new Set(instances.map(i => i.instance_name?.trim().toLowerCase()));
        const incomingName = (canonicalInstance || '').trim().toLowerCase();
        if (allowedNames.size > 0 && !allowedNames.has(incomingName)) return;

        if (selectedInstanceId && selectedInstanceId !== 'all') {
          const inst = instances.find(i => i.id === selectedInstanceId);
          const selectedName = inst?.instance_name?.trim().toLowerCase();
          if (selectedName && incomingName !== selectedName) return;
        }

        const targetKey = getConversationKey(row.phone, canonicalInstance);

        setConversations(prev => {
          const idx = prev.findIndex(c => getConversationKey(c.phone, c.instance_name) === targetKey);

          if (idx < 0) {
            // Conversa nova pro frontend (primeira inbound numa conversa,
            // ou instância adicionada após o initial fetch). Insere sem
            // messages[] — Canal 2 vai popular conforme INSERTs chegarem.
            const newConv: WhatsAppConversation = {
              phone: row.phone,
              contact_name: row.contact_name ?? null,
              contact_id: row.contact_id ?? null,
              lead_id: row.lead_id ?? null,
              last_message: row.last_message_text ?? null,
              last_message_at: row.last_message_at,
              unread_count: row.unread_count ?? 0,
              messages: [],
              instance_name: canonicalInstance,
            };
            return [newConv, ...prev].sort((a, b) =>
              new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime()
            );
          }

          return prev.map((c, i) => {
            if (i !== idx) return c;
            const incomingAt = new Date(row.last_message_at).getTime();
            const localAt = new Date(c.last_message_at).getTime();
            const advanceTimestamp = incomingAt > localAt;
            return {
              ...c,
              contact_name: row.contact_name ?? c.contact_name,
              contact_id: row.contact_id ?? c.contact_id,
              lead_id: row.lead_id ?? c.lead_id,
              unread_count: row.unread_count ?? c.unread_count,
              last_message: advanceTimestamp ? (row.last_message_text ?? c.last_message) : c.last_message,
              last_message_at: advanceTimestamp ? row.last_message_at : c.last_message_at,
              // messages[] NUNCA é tocado por Canal 1 — autoridade é Canal 2.
            };
          }).sort((a, b) =>
            new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime()
          );
        });
      };

    // One external channel per allowed instance, with server-side
    // filter `instance_name=eq.<name>`. This guarantees the Realtime backend
    // only broadcasts events for instances the user actually owns — a message
    // arriving on instance B for a phone the user also has on instance A
    // never reaches this client and can't accidentally disturb the list.
    const externalChannels: Array<ReturnType<typeof externalSupabase.channel>> = [];

    const targetInstanceNames = (() => {
      if (selectedInstanceId && selectedInstanceId !== 'all') {
        const inst = instances.find(i => i.id === selectedInstanceId);
        return inst?.instance_name ? [inst.instance_name] : [];
      }
      return instances.map(i => i.instance_name).filter(Boolean) as string[];
    })();

    const setupExternalChannels = async () => {
      try {
        await ensureExternalSession();
      } catch {
        // continues without external realtime; Cloud subscription still works
      }
      if (disposed) return;
      for (const instanceName of targetInstanceNames) {
        const safeName = instanceName.replace(/[^a-zA-Z0-9_-]/g, '_');
        const timestamp = Date.now();

        // Canal 2 — whatsapp_messages (autoridade de messages[] na conversa ativa).
        const msgChannelName = `whatsapp-realtime-external-${safeName}-${timestamp}`;
        const msgCh = externalSupabase
          .channel(msgChannelName)
          .on(
            'postgres_changes',
            {
              event: 'INSERT',
              schema: 'public',
              table: 'whatsapp_messages',
              filter: `instance_name=eq.${instanceName}`,
            },
            (payload) => handleIncomingMessage(payload.new as WhatsAppMessage)
          )
          .subscribe((status) => {
            if (status === 'SUBSCRIBED') {
              setRealtimeHealthy(true);
            }
          });
        externalChannels.push(msgCh);

        // Canal 1 — conversations (autoridade de last_message_*, contact_*, lead_id, ordem).
        const convChannelName = `conversations-realtime-${safeName}-${timestamp}`;
        const convCh = externalSupabase
          .channel(convChannelName)
          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'conversations',
              filter: `instance_name=eq.${instanceName}`,
            },
            (payload) => handleConversationChange(payload as unknown as ConvChangePayload)
          )
          .subscribe();
        externalChannels.push(convCh);
      }
    };
    setupExternalChannels();

    return () => {
      disposed = true;
      if (realtimeRetryTimerRef.current !== null) {
        window.clearTimeout(realtimeRetryTimerRef.current);
        realtimeRetryTimerRef.current = null;
      }
      for (const ch of externalChannels) {
        externalSupabase.removeChannel(ch);
      }
    };
  }, [hasLoaded, selectedInstanceId, instances, fetchMessages, realtimeRetryNonce, getCanonicalInstanceName]);

  // Load all messages for a specific conversation (when selected)
  const fetchFullConversation = useCallback(async (phone: string, instanceName?: string | null) => {
    // Requires instance_name — without it we'd pull messages from other instances with the same phone.
    if (!instanceName) {
      console.warn('fetchFullConversation called without instance_name — aborting to avoid cross-instance mix');
      return;
    }

    // Canonicaliza a key ANTES de qualquer await. O handler realtime compara
    // activeConversationKeyRef contra targetConversationKey canônica; se um INSERT
    // chegar durante o await, a key raw setada antes não bate e o cache não atualiza.
    const targetInstanceName = getCanonicalInstanceName(instanceName);
    const targetConversationKey = getConversationKey(phone, targetInstanceName);
    activeConversationKeyRef.current = targetConversationKey;

    try {
      // Fetch directly from the external DB (source of truth for whatsapp_messages).
      await ensureExternalSession().catch(() => {});
      const raw = await getConversationMessages(phone, instanceName, 3000);
      const allMsgs: WhatsAppMessage[] = raw as unknown as WhatsAppMessage[];

      // Deduplicate group messages (same messageid from different instances)
      const deduped: WhatsAppMessage[] = [];
      const seenMsgIds = new Set<string>();
      for (const m of allMsgs) {
        const msgId = m.external_message_id?.split(':').pop();
        const dedupKey = msgId ? `${msgId}_${m.created_at}` : m.id;
        if (!seenMsgIds.has(dedupKey)) {
          seenMsgIds.add(dedupKey);
          deduped.push(m);
        }
      }

      const firstNamedMessage = deduped.find(m => m.contact_name || m.contact_id || m.lead_id) || deduped[0] || null;
      const lastMessage = deduped[0] || null;
      const unreadCount = deduped.filter(m => !m.read_at && m.direction === 'inbound').length;

      fullConvCacheRef.current[targetConversationKey] = deduped;

      setConversations(prev => {
        const existingIndex = prev.findIndex(c => getConversationKey(c.phone, c.instance_name) === targetConversationKey);

        if (existingIndex >= 0) {
          return prev.map(c => {
            const isTargetConversation = getConversationKey(c.phone, c.instance_name) === targetConversationKey;
            if (!isTargetConversation) return c;
            return {
              ...c,
              messages: deduped,
              contact_name: firstNamedMessage?.contact_name || c.contact_name,
              contact_id: firstNamedMessage?.contact_id || c.contact_id,
              lead_id: firstNamedMessage?.lead_id || c.lead_id,
              last_message: lastMessage?.message_text || c.last_message,
              last_message_at: lastMessage?.created_at || c.last_message_at,
              unread_count: unreadCount,
              instance_name: c.instance_name || targetInstanceName,
            };
          });
        }

        if (!lastMessage && !targetInstanceName) return prev;

        const next = [{
          phone,
          contact_name: firstNamedMessage?.contact_name || null,
          contact_id: firstNamedMessage?.contact_id || null,
          lead_id: firstNamedMessage?.lead_id || null,
          last_message: lastMessage?.message_text || null,
          last_message_at: lastMessage?.created_at || new Date().toISOString(),
          unread_count: unreadCount,
          messages: deduped,
          instance_name: targetInstanceName,
        }, ...prev];

        return next.sort((a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime());
      });
    } catch (error) {
      console.error('Error fetching full conversation:', error);
    }
  }, [getCanonicalInstanceName]);

  const clearActivePhone = useCallback(() => {
    activeConversationKeyRef.current = null;
  }, []);

  const clearConversation = async (phone: string, instanceName?: string) => {
    try {
      const { data, error } = await cloudFunctions.invoke('send-whatsapp', {
        body: {
          action: 'clear_conversation',
          phone,
          instance_name: instanceName || undefined,
        },
      });
      if (error) throw error;
      if (!data.success) throw new Error(data.error);

      // Remove from local state
      const targetConversationKey = getConversationKey(phone, instanceName);
      setMessages(prev => prev.filter(m => instanceName ? getConversationKey(m.phone, m.instance_name) !== targetConversationKey : m.phone !== phone));
      setConversations(prev => prev.filter(c => instanceName ? getConversationKey(c.phone, c.instance_name) !== targetConversationKey : c.phone !== phone));
      toast.success('Conversa limpa com sucesso!');
      return true;
    } catch (error: any) {
      console.error('Error clearing conversation:', error);
      toast.error('Erro ao limpar conversa: ' + (error.message || 'Erro desconhecido'));
      return false;
    }
  };

  return {
    messages,
    conversations,
    loading,
    instanceSwitching,
    switchProgress,
    instances,
    instanceStats,
    statsLoading,
    hasLoaded,
    sendMessage,
    sendMedia,
    sendLocation,
    deleteMessage,
    clearConversation,
    markAsRead,
    linkToLead,
    linkToContact,
    refetch: (silent?: boolean) => fetchMessages(silent, true),
    refetchStats: fetchInstanceStats,
    fetchFullConversation,
    clearActivePhone,
  };
}
