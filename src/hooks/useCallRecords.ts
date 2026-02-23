import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuthContext } from '@/contexts/AuthContext';

export interface CallRecord {
  id: string;
  activity_id: string | null;
  lead_id: string | null;
  contact_id: string | null;
  chat_message_id: string | null;
  user_id: string;
  call_type: string;
  call_result: string;
  phone_used: string | null;
  duration_seconds: number;
  audio_url: string | null;
  audio_file_name: string | null;
  ai_summary: string | null;
  ai_transcript: string | null;
  next_step: string | null;
  callback_date: string | null;
  callback_notes: string | null;
  tags: string[];
  rating: number | null;
  notes: string | null;
  lead_name: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  created_at: string;
  updated_at: string;
}

export function useCallRecords() {
  const { user } = useAuthContext();
  const [records, setRecords] = useState<CallRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchRecords = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('call_records')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setRecords((data || []) as CallRecord[]);
    } catch (e) {
      console.error('Error fetching call records:', e);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (user) fetchRecords();
  }, [user, fetchRecords]);

  // Realtime
  useEffect(() => {
    const channel = supabase
      .channel('call_records_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'call_records' }, () => {
        fetchRecords();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchRecords]);

  const updateRecord = async (id: string, updates: Partial<CallRecord>) => {
    const { error } = await supabase.from('call_records').update(updates as any).eq('id', id);
    if (error) throw error;
    await fetchRecords();
  };

  const deleteRecord = async (id: string) => {
    const { error } = await supabase.from('call_records').delete().eq('id', id);
    if (error) throw error;
    await fetchRecords();
  };

  const createRecord = async (data: Partial<CallRecord> & { user_id: string }) => {
    const { error } = await supabase.from('call_records').insert(data as any);
    if (error) throw error;
    await fetchRecords();
  };

  return { records, loading, fetchRecords, updateRecord, deleteRecord, createRecord };
}
