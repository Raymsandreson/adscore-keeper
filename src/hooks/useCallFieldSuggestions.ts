import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuthContext } from '@/contexts/AuthContext';

export interface CallFieldSuggestion {
  id: string;
  call_record_id: string;
  entity_type: string;
  entity_id: string;
  field_name: string;
  field_label: string;
  current_value: string | null;
  suggested_value: string;
  status: string;
  created_at: string;
  contact_name?: string | null;
  lead_name?: string | null;
  caller_name?: string | null;
  lead_id?: string | null;
  next_step?: string | null;
}

export function useCallFieldSuggestions() {
  const { user } = useAuthContext();
  const [suggestions, setSuggestions] = useState<CallFieldSuggestion[]>([]);

  const fetchPending = useCallback(async () => {
    const { data } = await supabase
      .from('call_field_suggestions')
      .select('*, call_records:call_record_id(contact_name, lead_name, lead_id, next_step, user_id)')
      .eq('status', 'pending')
      .order('created_at', { ascending: false }) as any;

    // Fetch caller profile names
    const userIds = [...new Set((data || []).map((s: any) => s.call_records?.user_id).filter(Boolean))] as string[];
    let profileMap: Record<string, string> = {};
    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, full_name')
        .in('user_id', userIds);
      profileMap = (profiles || []).reduce((acc: any, p: any) => {
        acc[p.user_id] = p.full_name;
        return acc;
      }, {});
    }

    const mapped = (data || []).map((s: any) => ({
      ...s,
      contact_name: s.call_records?.contact_name || null,
      lead_name: s.call_records?.lead_name || null,
      lead_id: s.call_records?.lead_id || null,
      next_step: s.call_records?.next_step || null,
      caller_name: profileMap[s.call_records?.user_id] || null,
      call_records: undefined,
    }));
    setSuggestions(mapped);
  }, []);

  useEffect(() => {
    if (user) fetchPending();
  }, [user, fetchPending]);

  // Realtime
  useEffect(() => {
    const channel = supabase
      .channel('call_field_suggestions_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'call_field_suggestions' }, () => {
        fetchPending();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchPending]);

  const acceptSuggestion = async (suggestion: CallFieldSuggestion) => {
    console.log('[CallFieldSuggestions] Accepting:', {
      id: suggestion.id,
      entity_type: suggestion.entity_type,
      entity_id: suggestion.entity_id,
      field_name: suggestion.field_name,
      suggested_value: suggestion.suggested_value,
    });

    // Apply the field update
    const table = suggestion.entity_type === 'lead' ? 'leads' : 'contacts';
    const { error: updateError } = await supabase
      .from(table)
      .update({ [suggestion.field_name]: suggestion.suggested_value } as any)
      .eq('id', suggestion.entity_id);

    if (updateError) {
      console.error('[CallFieldSuggestions] Update error on', table, ':', updateError);
      throw updateError;
    }

    // Mark as accepted
    const { error: markError } = await supabase
      .from('call_field_suggestions')
      .update({ status: 'accepted', reviewed_by: user?.id } as any)
      .eq('id', suggestion.id);

    if (markError) {
      console.error('[CallFieldSuggestions] Mark accepted error:', markError);
    }
  };

  const rejectSuggestion = async (id: string) => {
    await supabase
      .from('call_field_suggestions')
      .update({ status: 'rejected', reviewed_by: user?.id } as any)
      .eq('id', id);
  };

  const acceptAll = async (ids: string[]) => {
    for (const id of ids) {
      const s = suggestions.find(x => x.id === id);
      if (s) await acceptSuggestion(s);
    }
  };

  const rejectAll = async (ids: string[]) => {
    await supabase
      .from('call_field_suggestions')
      .update({ status: 'rejected', reviewed_by: user?.id } as any)
      .in('id', ids);
  };

  return { suggestions, acceptSuggestion, rejectSuggestion, acceptAll, rejectAll, fetchPending };
}
