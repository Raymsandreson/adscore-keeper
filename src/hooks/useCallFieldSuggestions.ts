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
}

export function useCallFieldSuggestions() {
  const { user } = useAuthContext();
  const [suggestions, setSuggestions] = useState<CallFieldSuggestion[]>([]);

  const fetchPending = useCallback(async () => {
    const { data } = await supabase
      .from('call_field_suggestions')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: false }) as any;
    setSuggestions(data || []);
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
    // Apply the field update
    const table = suggestion.entity_type === 'lead' ? 'leads' : 'contacts';
    const { error: updateError } = await supabase
      .from(table)
      .update({ [suggestion.field_name]: suggestion.suggested_value } as any)
      .eq('id', suggestion.entity_id);

    if (updateError) throw updateError;

    // Mark as accepted
    await supabase
      .from('call_field_suggestions')
      .update({ status: 'accepted', reviewed_by: user?.id } as any)
      .eq('id', suggestion.id);
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
