import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';

export interface BroadcastList {
  id: string;
  name: string;
  description: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  member_count?: number;
}

export interface BroadcastListMember {
  id: string;
  broadcast_list_id: string;
  contact_id: string;
  created_at: string;
  contact?: {
    id: string;
    full_name: string;
    phone: string | null;
  };
}

export interface BroadcastSend {
  id: string;
  broadcast_list_id: string | null;
  message_text: string | null;
  media_url: string | null;
  media_type: string | null;
  instance_name: string | null;
  total_recipients: number;
  sent_count: number;
  failed_count: number;
  status: string;
  sent_by: string | null;
  created_at: string;
}

export function useBroadcastLists() {
  const [lists, setLists] = useState<BroadcastList[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchLists = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('broadcast_lists')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;

      // Get member counts
      const listIds = (data || []).map(l => l.id);
      const countsMap: Record<string, number> = {};
      
      if (listIds.length > 0) {
        const { data: members } = await supabase
          .from('broadcast_list_members')
          .select('broadcast_list_id')
          .in('broadcast_list_id', listIds);
        
        for (const m of (members || [])) {
          countsMap[m.broadcast_list_id] = (countsMap[m.broadcast_list_id] || 0) + 1;
        }
      }

      setLists((data || []).map(l => ({ ...l, member_count: countsMap[l.id] || 0 })));
    } catch (error) {
      console.error('Error fetching broadcast lists:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  const createList = async (name: string, description?: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from('broadcast_lists')
        .insert({ name, description: description || null, created_by: user?.id || null })
        .select()
        .single();
      if (error) throw error;
      toast.success('Lista criada!');
      fetchLists();
      return data;
    } catch (error) {
      console.error('Error creating broadcast list:', error);
      toast.error('Erro ao criar lista');
      throw error;
    }
  };

  const updateList = async (id: string, updates: { name?: string; description?: string }) => {
    try {
      const { error } = await supabase
        .from('broadcast_lists')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
      toast.success('Lista atualizada');
      fetchLists();
    } catch (error) {
      toast.error('Erro ao atualizar lista');
    }
  };

  const deleteList = async (id: string) => {
    try {
      const { error } = await supabase.from('broadcast_lists').delete().eq('id', id);
      if (error) throw error;
      toast.success('Lista removida');
      fetchLists();
    } catch (error) {
      toast.error('Erro ao remover lista');
    }
  };

  const fetchMembers = async (listId: string): Promise<BroadcastListMember[]> => {
    try {
      const { data, error } = await supabase
        .from('broadcast_list_members')
        .select('*')
        .eq('broadcast_list_id', listId);
      if (error) throw error;

      // Fetch contact details
      const contactIds = (data || []).map(m => m.contact_id);
      if (contactIds.length === 0) return [];

      const { data: contacts } = await supabase
        .from('contacts')
        .select('id, full_name, phone')
        .in('id', contactIds);

      const contactMap = new Map((contacts || []).map(c => [c.id, c]));
      return (data || []).map(m => ({
        ...m,
        contact: contactMap.get(m.contact_id) || undefined,
      }));
    } catch (error) {
      console.error('Error fetching members:', error);
      return [];
    }
  };

  const addMembers = async (listId: string, contactIds: string[]) => {
    try {
      const records = contactIds.map(contact_id => ({
        broadcast_list_id: listId,
        contact_id,
      }));
      const { error } = await supabase.from('broadcast_list_members').insert(records);
      if (error) {
        if (error.code === '23505') {
          toast.info('Alguns contatos já estão na lista');
          return;
        }
        throw error;
      }
      toast.success(`${contactIds.length} contato(s) adicionado(s)`);
      fetchLists();
    } catch (error) {
      toast.error('Erro ao adicionar contatos');
    }
  };

  const removeMember = async (memberId: string) => {
    try {
      const { error } = await supabase.from('broadcast_list_members').delete().eq('id', memberId);
      if (error) throw error;
      toast.success('Contato removido da lista');
      fetchLists();
    } catch (error) {
      toast.error('Erro ao remover contato');
    }
  };

  const sendBroadcast = async (params: {
    listId?: string;
    contactIds: string[];
    message: string;
    instanceId: string;
    mediaUrl?: string;
    mediaType?: string;
  }) => {
    try {
      // Get instance details
      const { data: instance } = await supabase
        .from('whatsapp_instances')
        .select('instance_name, instance_token, base_url')
        .eq('id', params.instanceId)
        .single();

      if (!instance) throw new Error('Instância não encontrada');

      // Get contacts with phones
      const { data: contacts } = await supabase
        .from('contacts')
        .select('id, full_name, phone')
        .in('id', params.contactIds);

      const validContacts = (contacts || []).filter(c => c.phone);
      if (validContacts.length === 0) {
        toast.error('Nenhum contato com telefone válido');
        return;
      }

      // Create send record
      const { data: { user } } = await supabase.auth.getUser();
      const { data: sendRecord } = await supabase
        .from('broadcast_sends')
        .insert({
          broadcast_list_id: params.listId || null,
          message_text: params.message || null,
          media_url: params.mediaUrl || null,
          media_type: params.mediaType || null,
          instance_name: instance.instance_name,
          total_recipients: validContacts.length,
          status: 'sending',
          sent_by: user?.id || null,
        })
        .select()
        .single();

      let sentCount = 0;
      let failedCount = 0;

      for (const contact of validContacts) {
        try {
          if (params.mediaUrl) {
            // Send media message
            const { error } = await cloudFunctions.invoke('send-whatsapp', {
              body: {
                action: 'send_media',
                phone: contact.phone,
                media_url: params.mediaUrl,
                media_type: params.mediaType,
                caption: params.message || undefined,
                contact_id: contact.id,
                instance_id: params.instanceId,
              },
            });
            if (error) throw error;
          } else {
            // Send text message
            const { error } = await cloudFunctions.invoke('send-whatsapp', {
              body: {
                phone: contact.phone,
                message: params.message,
                contact_id: contact.id,
                instance_id: params.instanceId,
              },
            });
            if (error) throw error;
          }
          sentCount++;
        } catch {
          failedCount++;
        }
        await new Promise(r => setTimeout(r, 1500));
      }

      if (sendRecord) {
        await supabase.from('broadcast_sends').update({
          sent_count: sentCount,
          failed_count: failedCount,
          status: failedCount === 0 ? 'completed' : 'partial',
        }).eq('id', sendRecord.id);
      }

      toast.success(`Transmissão: ${sentCount} enviadas, ${failedCount} falhas`);
      return { sentCount, failedCount };
    } catch (error) {
      console.error('Broadcast error:', error);
      toast.error('Erro ao enviar transmissão');
      throw error;
    }
  };

  useEffect(() => { fetchLists(); }, [fetchLists]);

  return {
    lists,
    loading,
    fetchLists,
    createList,
    updateList,
    deleteList,
    fetchMembers,
    addMembers,
    removeMember,
    sendBroadcast,
  };
}
