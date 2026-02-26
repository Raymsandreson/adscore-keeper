import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuthContext } from '@/contexts/AuthContext';
import { toast } from 'sonner';

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

export function useWhatsAppMessages(selectedInstanceId?: string | null) {
  const { user } = useAuthContext();
  const [messages, setMessages] = useState<WhatsAppMessage[]>([]);
  const [conversations, setConversations] = useState<WhatsAppConversation[]>([]);
  const [loading, setLoading] = useState(false);
  const [instances, setInstances] = useState<WhatsAppInstance[]>([]);
  const [instanceStats, setInstanceStats] = useState<InstanceStats[]>([]);
  const [statsLoading, setStatsLoading] = useState(true);
  const conversationsRef = useRef<WhatsAppConversation[]>([]);
  const [hasLoaded, setHasLoaded] = useState(false);
  const profileCacheRef = useRef<{ full_name: string | null; treatment_title: string | null } | null>(null);

  const fetchInstances = async () => {
    if (!user) return;
    
    const { data: permissions } = await supabase
      .from('whatsapp_instance_users')
      .select('instance_id')
      .eq('user_id', user.id);
    
    if (!permissions || permissions.length === 0) {
      setInstances([]);
      setStatsLoading(false);
      return;
    }

    const allowedIds = permissions.map(p => p.instance_id);
    const { data, error } = await supabase
      .from('whatsapp_instances')
      .select('*')
      .eq('is_active', true)
      .in('id', allowedIds)
      .order('instance_name');
    
    if (!error && data) {
      setInstances(data as WhatsAppInstance[]);
    }
  };

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

  const fetchMessages = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('whatsapp_messages')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500);

      if (selectedInstanceId && selectedInstanceId !== 'all') {
        const inst = instances.find(i => i.id === selectedInstanceId);
        if (inst) {
          query = query.eq('instance_name', inst.instance_name);
        }
      }

      const { data, error } = await query;
      if (error) throw error;

      const msgs = (data || []) as WhatsAppMessage[];
      setMessages(msgs);

      const convMap = new Map<string, WhatsAppConversation>();
      
      for (const msg of msgs) {
        const existing = convMap.get(msg.phone);
        if (!existing) {
          convMap.set(msg.phone, {
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
        }
      }

      const convList = Array.from(convMap.values())
        .sort((a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime());
      
      conversationsRef.current = convList;
      setConversations(convList);
      setHasLoaded(true);
      toast.success(`${convList.length} conversas carregadas`);
    } catch (error) {
      console.error('Error fetching WhatsApp messages:', error);
      toast.error('Erro ao carregar conversas');
    } finally {
      setLoading(false);
    }
  };

  const sendMessage = async (
    phone: string,
    message: string,
    contactId?: string,
    leadId?: string,
    conversationInstanceName?: string | null,
    identifySender = true,
    chatId?: string
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
      if (!targetInstanceId && instances.length > 0) {
        targetInstanceId = instances[0].id;
      }

      if (profileResult?.data) {
        profileCacheRef.current = profileResult.data;
      }

      if (user && identifySender && profileCacheRef.current?.full_name) {
        const { full_name, treatment_title } = profileCacheRef.current;
        const senderName = treatment_title ? `${treatment_title} ${full_name}` : full_name;
        finalMessage = `*${senderName}:*\n${message}`;
      }

      const { data, error } = await supabase.functions.invoke('send-whatsapp', {
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
      if (!data.success) throw new Error(data.error);
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
      setConversations(prev => prev.map(c =>
        c.phone === phone
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

  const markAsRead = async (phone: string) => {
    try {
      const { error } = await supabase
        .from('whatsapp_messages')
        .update({ read_at: new Date().toISOString() } as any)
        .eq('phone', phone).eq('direction', 'inbound').is('read_at', null);
      if (error) throw error;
      // Update local state without refetching
      setConversations(prev => prev.map(c => 
        c.phone === phone ? { ...c, unread_count: 0 } : c
      ));
    } catch (error) { console.error('Error marking as read:', error); }
  };

  const linkToLead = async (phone: string, leadId: string) => {
    try {
      const { error } = await supabase.from('whatsapp_messages')
        .update({ lead_id: leadId } as any).eq('phone', phone);
      if (error) throw error;
      toast.success('Conversa vinculada ao lead!');
      setConversations(prev => prev.map(c => c.phone === phone ? { ...c, lead_id: leadId } : c));
    } catch (error) { console.error(error); toast.error('Erro ao vincular ao lead'); }
  };

  const linkToContact = async (phone: string, contactId: string) => {
    try {
      const { error } = await supabase.from('whatsapp_messages')
        .update({ contact_id: contactId } as any).eq('phone', phone);
      if (error) throw error;
      toast.success('Conversa vinculada ao contato!');
      setConversations(prev => prev.map(c => c.phone === phone ? { ...c, contact_id: contactId } : c));
    } catch (error) { console.error(error); toast.error('Erro ao vincular ao contato'); }
  };

  // Fetch instances on mount
  useEffect(() => {
    if (user) fetchInstances();
  }, [user]);

  // Fetch lightweight stats when instances load (NOT full messages)
  useEffect(() => {
    if (instances.length > 0) {
      fetchInstanceStats();
    }
  }, [instances, fetchInstanceStats]);

  // If conversations were already loaded, re-fetch when instance filter changes
  useEffect(() => {
    if (!hasLoaded) return;
    fetchMessages();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedInstanceId]);

  return {
    messages,
    conversations,
    loading,
    instances,
    instanceStats,
    statsLoading,
    hasLoaded,
    sendMessage,
    markAsRead,
    linkToLead,
    linkToContact,
    refetch: fetchMessages,
    refetchStats: fetchInstanceStats,
  };
}
