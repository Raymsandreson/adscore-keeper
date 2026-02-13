import { useState, useEffect } from 'react';
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
}

export function useWhatsAppMessages() {
  const { user } = useAuthContext();
  const [messages, setMessages] = useState<WhatsAppMessage[]>([]);
  const [conversations, setConversations] = useState<WhatsAppConversation[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchMessages = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('whatsapp_messages')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500);

      if (error) throw error;

      const msgs = (data || []) as WhatsAppMessage[];
      setMessages(msgs);

      // Group by phone to create conversations
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
          });
        } else {
          existing.messages.push(msg);
          if (!msg.read_at && msg.direction === 'inbound') {
            existing.unread_count++;
          }
          // Update contact info if missing
          if (!existing.contact_name && msg.contact_name) {
            existing.contact_name = msg.contact_name;
          }
          if (!existing.contact_id && msg.contact_id) {
            existing.contact_id = msg.contact_id;
          }
          if (!existing.lead_id && msg.lead_id) {
            existing.lead_id = msg.lead_id;
          }
        }
      }

      const convList = Array.from(convMap.values())
        .sort((a, b) => new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime());
      
      setConversations(convList);
    } catch (error) {
      console.error('Error fetching WhatsApp messages:', error);
    } finally {
      setLoading(false);
    }
  };

  const sendMessage = async (phone: string, message: string, contactId?: string, leadId?: string) => {
    try {
      const { data, error } = await supabase.functions.invoke('send-whatsapp', {
        body: { phone, message, contact_id: contactId, lead_id: leadId },
      });

      if (error) throw error;
      if (!data.success) throw new Error(data.error);

      toast.success('Mensagem enviada!');
      fetchMessages();
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
        .eq('phone', phone)
        .eq('direction', 'inbound')
        .is('read_at', null);

      if (error) throw error;
      fetchMessages();
    } catch (error) {
      console.error('Error marking as read:', error);
    }
  };

  const linkToLead = async (phone: string, leadId: string) => {
    try {
      const { error } = await supabase
        .from('whatsapp_messages')
        .update({ lead_id: leadId } as any)
        .eq('phone', phone);

      if (error) throw error;
      toast.success('Conversa vinculada ao lead!');
      fetchMessages();
    } catch (error) {
      console.error('Error linking to lead:', error);
      toast.error('Erro ao vincular ao lead');
    }
  };

  const linkToContact = async (phone: string, contactId: string) => {
    try {
      const { error } = await supabase
        .from('whatsapp_messages')
        .update({ contact_id: contactId } as any)
        .eq('phone', phone);

      if (error) throw error;
      toast.success('Conversa vinculada ao contato!');
      fetchMessages();
    } catch (error) {
      console.error('Error linking to contact:', error);
      toast.error('Erro ao vincular ao contato');
    }
  };

  // Subscribe to realtime
  useEffect(() => {
    fetchMessages();

    const channel = supabase
      .channel('whatsapp-messages')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'whatsapp_messages' },
        () => {
          fetchMessages();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return {
    messages,
    conversations,
    loading,
    sendMessage,
    markAsRead,
    linkToLead,
    linkToContact,
    refetch: fetchMessages,
  };
}
