import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuthContext } from '@/contexts/AuthContext';
import { toast } from 'sonner';

export interface InternalNote {
  id: string;
  phone: string;
  instance_name: string | null;
  content: string;
  note_type: string;
  sender_id: string | null;
  sender_name: string | null;
  created_at: string;
}

export function useWhatsAppInternalNotes(phone: string | undefined) {
  const { user } = useAuthContext();
  const [notes, setNotes] = useState<InternalNote[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!phone) return;
    setLoading(true);
    const { data } = await supabase
      .from('whatsapp_internal_notes')
      .select('*')
      .eq('phone', phone)
      .order('created_at', { ascending: true });
    if (data) setNotes(data as InternalNote[]);
    setLoading(false);
  }, [phone]);

  useEffect(() => {
    load();

    if (!phone) return;
    const channel = supabase
      .channel(`internal-notes-${phone}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'whatsapp_internal_notes',
        filter: `phone=eq.${phone}`,
      }, () => { load(); })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [phone, load]);

  const addNote = useCallback(async (content: string, noteType: string = 'note') => {
    if (!user || !phone) return;

    const profileRes = await supabase
      .from('profiles')
      .select('full_name')
      .eq('user_id', user.id)
      .single();

    const senderName = profileRes.data?.full_name || user.email || 'Usuário';

    const { error } = await supabase
      .from('whatsapp_internal_notes')
      .insert({
        phone,
        content,
        note_type: noteType,
        sender_id: user.id,
        sender_name: senderName,
      });

    if (error) {
      toast.error('Erro ao salvar nota');
    }
  }, [user, phone]);

  const deleteNote = useCallback(async (noteId: string) => {
    const { error } = await supabase
      .from('whatsapp_internal_notes')
      .delete()
      .eq('id', noteId);
    if (error) toast.error('Erro ao excluir nota');
  }, []);

  return { notes, loading, addNote, deleteNote };
}
