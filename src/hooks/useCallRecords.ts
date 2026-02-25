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
  const [authorizedInstances, setAuthorizedInstances] = useState<{ id: string; instance_name: string; owner_phone: string | null }[]>([]);

  // Fetch user's authorized instances
  const fetchAuthorizedInstances = useCallback(async () => {
    if (!user) return [];
    try {
      // Get instance IDs the user has access to
      const { data: permissions } = await supabase
        .from('whatsapp_instance_users')
        .select('instance_id')
        .eq('user_id', user.id);

      const instanceIds = (permissions || []).map(p => (p as any).instance_id);
      if (instanceIds.length === 0) return [];

      const { data: instances } = await supabase
        .from('whatsapp_instances')
        .select('id, instance_name, owner_phone')
        .in('id', instanceIds);

      const result = (instances || []) as { id: string; instance_name: string; owner_phone: string | null }[];
      setAuthorizedInstances(result);
      return result;
    } catch (e) {
      console.error('Error fetching authorized instances:', e);
      return [];
    }
  }, [user]);

  const fetchRecords = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const instances = await fetchAuthorizedInstances();

      // Build list of phone_used values to match: instance names + owner phones
      const matchValues: string[] = [];
      for (const inst of instances) {
        if (inst.instance_name) matchValues.push(inst.instance_name);
        if (inst.owner_phone) {
          matchValues.push(inst.owner_phone);
          // Also add cleaned version
          const cleaned = inst.owner_phone.replace(/\D/g, '');
          if (cleaned) matchValues.push(cleaned);
        }
      }

      // Fetch own records + records from authorized instances
      let allRecords: CallRecord[] = [];

      // Always fetch user's own records
      const { data: ownData, error: ownError } = await supabase
        .from('call_records')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (ownError) throw ownError;
      allRecords = (ownData || []) as CallRecord[];

      // Fetch records from other users on authorized instances
      if (matchValues.length > 0) {
        // Build OR filter for phone_used matching any instance name or phone
        const orFilters = matchValues.map(v => `phone_used.ilike.%${v}%`).join(',');
        
        const { data: instanceData, error: instanceError } = await supabase
          .from('call_records')
          .select('*')
          .neq('user_id', user.id)
          .or(orFilters)
          .order('created_at', { ascending: false });

        if (!instanceError && instanceData) {
          // Deduplicate by id
          const existingIds = new Set(allRecords.map(r => r.id));
          for (const r of instanceData as CallRecord[]) {
            if (!existingIds.has(r.id)) {
              allRecords.push(r);
            }
          }
        }
      }

      // Sort all by created_at desc
      allRecords.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setRecords(allRecords);
    } catch (e) {
      console.error('Error fetching call records:', e);
    } finally {
      setLoading(false);
    }
  }, [user, fetchAuthorizedInstances]);

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

  return { records, loading, fetchRecords, updateRecord, deleteRecord, createRecord, authorizedInstances };
}
