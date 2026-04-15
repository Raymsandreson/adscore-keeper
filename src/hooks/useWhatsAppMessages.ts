import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuthContext } from '@/contexts/AuthContext';
import { useUserRole } from '@/hooks/useUserRole';
import { toast } from 'sonner';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';

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

const getConversationKey = (phone: string, instanceName?: string | null) => `${phone}__${instanceName || ''}`;

export function useWhatsAppMessages(selectedInstanceId?: string | null) {
  const { user } = useAuthContext();
  const { isAdmin } = useUserRole();
  const [messages, setMessages] = useState<WhatsAppMessage[]>([]);
  const [conversations, setConversations] = useState<WhatsAppConversation[]>([]);
  const [loading, setLoading] = useState(false);
  const [instanceSwitching, setInstanceSwitching] = useState(false);
  const [switchProgress, setSwitchProgress] = useState(0);
  const [instances, setInstances] = useState<WhatsAppInstance[]>([]);
  const [instanceStats, setInstanceStats] = useState<InstanceStats[]>([]);
  const [statsLoading, setStatsLoading] = useState(true);
  const conversationsRef = useRef<WhatsAppConversation[]>([]);
  const [hasLoaded, setHasLoaded] = useState(false);
  const profileCacheRef = useRef<{ full_name: string | null; treatment_title: string | null } | null>(null);
  const isFetchingRef = useRef(false);
  const [realtimeHealthy, setRealtimeHealthy] = useState(true);
  const [realtimeRetryNonce, setRealtimeRetryNonce] = useState(0);
  const realtimeRetryTimerRef = useRef<number | null>(null);
  const syncInFlightRef = useRef(false);
  const lastSyncAtRef = useRef<Record<string, number>>({});
  const activeConversationKeyRef = useRef<string | null>(null);
  const fullConvCacheRef = useRef<Record<string, WhatsAppMessage[]>>({});

  

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
      const instanceNames = instances.map(i => i.instance_name);
      
      // Use a single lightweight query with counts per instance
      const stats: InstanceStats[] = [];
      
      for (const inst of instances) {
        const [totalRes, inboundRes, outboundRes, unreadRes, phonesRes] = await Promise.all([
          supabase.from('whatsapp_messages').select('id', { count: 'exact', head: true })
            .eq('instance_name', inst.instance_name),
          supabase.from('whatsapp_messages').select('id', { count: 'exact', head: true })
            .eq('instance_name', inst.instance_name).eq('direction', 'inbound'),
          supabase.from('whatsapp_messages').select('id', { count: 'exact', head: true })
            .eq('instance_name', inst.instance_name).eq('direction', 'outbound'),
          supabase.from('whatsapp_messages').select('id', { count: 'exact', head: true })
            .eq('instance_name', inst.instance_name).eq('direction', 'inbound').is('read_at', null),
          supabase.from('whatsapp_messages').select('phone', { count: 'exact', head: true })
            .eq('instance_name', inst.instance_name),
        ]);

        // Get distinct phone count via a different approach
        const { data: distinctPhones } = await supabase
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
    setMessages(msgs);

    const convMap = new Map<string, WhatsAppConversation>();

    for (const msg of msgs) {
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
  }, []);

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

      // Paginate RPC in parallel to bypass the 1000-row default limit
      const PAGE_SIZE = 1000;
      let sumError: any = null;

      // First page sequentially to know if there's more
      const { data: firstBatch, error: firstError } = await supabase
        .rpc('get_conversation_summaries', { p_instance_names: instanceNames })
        .range(0, PAGE_SIZE - 1);

      if (firstError) {
        sumError = firstError;
      }

      let allSummaries: any[] = firstBatch || [];

      // If first page is full, fetch remaining pages in parallel
      if (!sumError && allSummaries.length === PAGE_SIZE) {
        const parallelPages = [1, 2, 3, 4]; // up to 5000 total
        const results = await Promise.all(
          parallelPages.map(p =>
            supabase
              .rpc('get_conversation_summaries', { p_instance_names: instanceNames })
              .range(p * PAGE_SIZE, (p + 1) * PAGE_SIZE - 1)
          )
        );
        for (const { data, error } of results) {
          if (error) { sumError = error; break; }
          if (data && data.length > 0) allSummaries = allSummaries.concat(data);
          if (!data || data.length < PAGE_SIZE) break;
        }
      }

      const summaries = allSummaries;

      if (sumError && summaries.length === 0) {
        console.error('Error fetching conversation summaries:', sumError);
        const fallbackQuery = supabase
          .from('whatsapp_messages')
          .select('*')
          .in('instance_name', instanceNames)
          .order('created_at', { ascending: false })
          .limit(2000);
        const { data, error } = await fallbackQuery;
        if (error) throw error;
        processMessages((data || []) as WhatsAppMessage[], silent);
        return;
      }

      const convList: WhatsAppConversation[] = (summaries || []).map((s: any) => ({
        phone: s.phone,
        contact_name: s.contact_name,
        contact_id: s.contact_id,
        lead_id: s.lead_id,
        last_message: s.last_message_text,
        last_message_at: s.last_message_at,
        unread_count: Number(s.unread_count) || 0,
        messages: [{
          id: `summary-${s.phone}-${s.instance_name}`,
          phone: s.phone,
          contact_name: s.contact_name,
          message_text: s.last_message_text,
          message_type: 'text',
          media_url: null,
          media_type: null,
          direction: s.last_direction || 'inbound',
          status: 'received',
          contact_id: s.contact_id,
          lead_id: s.lead_id,
          external_message_id: null,
          metadata: null,
          created_at: s.last_message_at,
          read_at: null,
          instance_name: s.instance_name,
          instance_token: null,
        }] as WhatsAppMessage[],
        instance_name: s.instance_name,
      }));

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
    } catch (error) {
      console.error('Error fetching WhatsApp messages:', error);
      if (!silent) {
        toast.error('Erro ao carregar conversas');
      }
    } finally {
      isFetchingRef.current = false;
      if (!silent && !hasLoaded) setLoading(false);
    }
  }, [instances, selectedInstanceId, processMessages, syncRecentMessages, hasLoaded]);

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
        metadata: null,
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
        external_message_id: null, metadata: null,
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
        external_message_id: null, metadata: { latitude, longitude, name, address },
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
    try {
      let query = supabase
        .from('whatsapp_messages')
        .update({ read_at: new Date().toISOString() } as any)
        .eq('phone', phone)
        .eq('direction', 'inbound')
        .is('read_at', null);

      if (instanceName) {
        query = query.eq('instance_name', instanceName);
      }

      const { error } = await query;
      if (error) throw error;

      const targetConversationKey = getConversationKey(phone, instanceName);
      setConversations(prev => prev.map(c => 
        instanceName
          ? getConversationKey(c.phone, c.instance_name) === targetConversationKey ? { ...c, unread_count: 0 } : c
          : c.phone === phone ? { ...c, unread_count: 0 } : c
      ));
    } catch (error) { console.error('Error marking as read:', error); }
  };

  const linkToLead = async (phone: string, leadId: string, instanceName?: string | null) => {
    try {
      let query = supabase
        .from('whatsapp_messages')
        .update({ lead_id: leadId } as any)
        .eq('phone', phone);

      if (instanceName) {
        query = query.eq('instance_name', instanceName);
      }

      const { error } = await query;
      if (error) throw error;
      toast.success('Conversa vinculada ao lead!');
      const targetConversationKey = getConversationKey(phone, instanceName);
      setConversations(prev => prev.map(c =>
        instanceName
          ? getConversationKey(c.phone, c.instance_name) === targetConversationKey ? { ...c, lead_id: leadId } : c
          : c.phone === phone ? { ...c, lead_id: leadId } : c
      ));
    } catch (error) { console.error(error); toast.error('Erro ao vincular ao lead'); }
  };

  const linkToContact = async (phone: string, contactId: string, instanceName?: string | null) => {
    try {
      // Fetch contact name
      const { data: contactData } = await supabase.from('contacts').select('full_name').eq('id', contactId).single();
      let query = supabase
        .from('whatsapp_messages')
        .update({ contact_id: contactId } as any)
        .eq('phone', phone);

      if (instanceName) {
        query = query.eq('instance_name', instanceName);
      }

      const { error } = await query;
      if (error) throw error;
      toast.success('Conversa vinculada ao contato!');
      const targetConversationKey = getConversationKey(phone, instanceName);
      setConversations(prev => prev.map(c =>
        instanceName
          ? getConversationKey(c.phone, c.instance_name) === targetConversationKey
            ? { ...c, contact_id: contactId, contact_name: contactData?.full_name || c.contact_name }
            : c
          : c.phone === phone
            ? { ...c, contact_id: contactId, contact_name: contactData?.full_name || c.contact_name }
            : c
      ));
    } catch (error) { console.error(error); toast.error('Erro ao vincular ao contato'); }
  };

  // Fetch instances on mount
  useEffect(() => {
    if (user) fetchInstances();
  }, [user, fetchInstances]);

  // Fetch lightweight stats when instances load (NOT full messages)
  useEffect(() => {
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

    const channelName = `whatsapp-realtime-${Date.now()}`;
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'whatsapp_messages' },
        (payload) => {
          const newMsg = payload.new as WhatsAppMessage;

          // Skip messages from instances the user doesn't have access to
          const allowedNames = new Set(instances.map(i => i.instance_name?.trim().toLowerCase()));
          const incomingName = (newMsg.instance_name || '').trim().toLowerCase();
          if (allowedNames.size > 0 && !allowedNames.has(incomingName)) return;

          // If filtering by specific instance, skip irrelevant messages
          if (selectedInstanceId && selectedInstanceId !== 'all') {
            const inst = instances.find(i => i.id === selectedInstanceId);
            const selectedName = inst?.instance_name?.trim().toLowerCase();
            if (selectedName && incomingName !== selectedName) return;
          }

          setMessages(prev => {
            // Avoid duplicates from optimistic updates
            if (prev.some(m => m.id === newMsg.id)) return prev;
            return [newMsg, ...prev];
          });
          setConversations(prev => {
            const targetConversationKey = getConversationKey(newMsg.phone, newMsg.instance_name);
            const existing = prev.find(c => getConversationKey(c.phone, c.instance_name) === targetConversationKey);
            if (existing) {
              // Deduplicate
              const msgId = newMsg.external_message_id?.split(':').pop();
              const isDuplicate = msgId && existing.messages.some(m => {
                const existingMsgId = m.external_message_id?.split(':').pop();
                return existingMsgId === msgId && m.created_at === newMsg.created_at;
              });
              if (isDuplicate) return prev;
              // Also check by id
              if (existing.messages.some(m => m.id === newMsg.id)) return prev;

              // Update cache if this is the active conversation
              if (activeConversationKeyRef.current === targetConversationKey && fullConvCacheRef.current[targetConversationKey]) {
                fullConvCacheRef.current[targetConversationKey] = [...fullConvCacheRef.current[targetConversationKey], newMsg];
              }

              return prev.map(c => {
                if (getConversationKey(c.phone, c.instance_name) !== targetConversationKey) return c;
                return {
                  ...c,
                  last_message: newMsg.message_text || c.last_message,
                  last_message_at: newMsg.created_at,
                  unread_count: !newMsg.read_at && newMsg.direction === 'inbound' ? c.unread_count + 1 : c.unread_count,
                  messages: [...c.messages, newMsg],
                  contact_name: newMsg.contact_name || c.contact_name,
                };
              }).sort((a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime());
            } else {
              // New conversation
              const newConv: WhatsAppConversation = {
                phone: newMsg.phone,
                contact_name: newMsg.contact_name,
                contact_id: newMsg.contact_id,
                lead_id: newMsg.lead_id,
                last_message: newMsg.message_text,
                last_message_at: newMsg.created_at,
                unread_count: !newMsg.read_at && newMsg.direction === 'inbound' ? 1 : 0,
                messages: [newMsg],
                instance_name: newMsg.instance_name,
              };
              return [newConv, ...prev];
            }
          });
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setRealtimeHealthy(true);
          return;
        }

        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          setRealtimeHealthy(false);
          // Throttle: only refetch if last error-driven fetch was > 30s ago
          const now = Date.now();
          const lastErrorFetch = (window as any).__lastRealtimeErrorFetch || 0;
          if (now - lastErrorFetch > 30000) {
            (window as any).__lastRealtimeErrorFetch = now;
            console.warn(`Realtime channel status: ${status}, refetching`);
            fetchMessages(true);
          }
          scheduleRetry();
        }
      });

    return () => {
      disposed = true;
      if (realtimeRetryTimerRef.current !== null) {
        window.clearTimeout(realtimeRetryTimerRef.current);
        realtimeRetryTimerRef.current = null;
      }
      supabase.removeChannel(channel);
    };
  }, [hasLoaded, selectedInstanceId, instances, fetchMessages, realtimeRetryNonce]);

  // Refresh conversation list when tab becomes visible + periodic polling fallback
  useEffect(() => {
    if (!hasLoaded) return;

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        fetchMessages(true);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    // Periodic polling every 30s as fallback for dropped WebSocket connections
    const pollInterval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetchMessages(true);
      }
    }, 30000);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      clearInterval(pollInterval);
    };
  }, [hasLoaded, fetchMessages]);

  // Load all messages for a specific conversation (when selected)
  const fetchFullConversation = useCallback(async (phone: string, instanceName?: string | null) => {
    activeConversationKeyRef.current = getConversationKey(phone, instanceName);
    // NOTE: removed background fetchMessages(true) call here to avoid double-loading
    try {
      // Paginate to get ALL messages for this phone/instance (up to 3000)
      const allMsgs: WhatsAppMessage[] = [];
      let from = 0;
      const pageSize = 1000;
      const maxPages = 3;

      for (let page = 0; page < maxPages; page++) {
        let query = supabase
          .from('whatsapp_messages')
          .select('*')
          .eq('phone', phone);

        if (instanceName) {
          query = query.eq('instance_name', instanceName);
        }

        const { data, error } = await query
          .order('created_at', { ascending: false })
          .range(from, from + pageSize - 1);

        if (error) throw error;
        if (!data || data.length === 0) break;
        allMsgs.push(...(data as WhatsAppMessage[]));
        if (data.length < pageSize) break;
        from += pageSize;
      }

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
      const targetInstanceName = instanceName || lastMessage?.instance_name || null;
      const targetConversationKey = getConversationKey(phone, targetInstanceName);

      activeConversationKeyRef.current = targetConversationKey;
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
  }, []);

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
