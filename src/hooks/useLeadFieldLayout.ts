import { useCallback, useEffect, useMemo, useState } from 'react';
import { db } from '@/integrations/supabase';
import { LEAD_FIELD_REGISTRY, type LeadFieldTab } from '@/components/leads/leadFormFields';
import { toast } from 'sonner';

export interface LeadFieldLayoutRow {
  id?: string;
  board_id: string;
  field_key: string;
  tab: LeadFieldTab;
  display_order: number;
  hidden: boolean;
}

export interface ResolvedField {
  field_key: string;
  tab: LeadFieldTab;
  display_order: number;
  hidden: boolean;
}

/**
 * Resolves the layout for a given board: merges saved layout with defaults
 * from the registry. Fixed fields without a row use registry defaults.
 */
export function useLeadFieldLayout(boardId?: string | null) {
  const [rows, setRows] = useState<LeadFieldLayoutRow[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchLayout = useCallback(async () => {
    if (!boardId) { setRows([]); return; }
    setLoading(true);
    try {
      const { data, error } = await (db as any)
        .from('lead_field_layouts')
        .select('*')
        .eq('board_id', boardId);
      if (error) throw error;
      setRows((data || []) as LeadFieldLayoutRow[]);
    } catch (e) {
      console.error('useLeadFieldLayout fetch error', e);
    } finally {
      setLoading(false);
    }
  }, [boardId]);

  useEffect(() => { fetchLayout(); }, [fetchLayout]);

  const resolved = useMemo<ResolvedField[]>(() => {
    const byKey = new Map<string, LeadFieldLayoutRow>();
    rows.forEach(r => byKey.set(r.field_key, r));
    return LEAD_FIELD_REGISTRY.map(def => {
      const r = byKey.get(def.key);
      return r
        ? { field_key: def.key, tab: r.tab, display_order: r.display_order, hidden: r.hidden }
        : { field_key: def.key, tab: def.defaultTab, display_order: def.defaultOrder, hidden: false };
    });
  }, [rows]);

  const fieldsByTab = useCallback((tab: LeadFieldTab) => {
    return resolved
      .filter(f => f.tab === tab && !f.hidden)
      .sort((a, b) => a.display_order - b.display_order);
  }, [resolved]);

  const saveLayout = useCallback(async (next: ResolvedField[]) => {
    if (!boardId) return;
    try {
      // Upsert all (overwrite full layout for this board)
      const payload = next.map(f => ({
        board_id: boardId,
        field_key: f.field_key,
        tab: f.tab,
        display_order: f.display_order,
        hidden: f.hidden,
      }));
      const { error } = await (db as any)
        .from('lead_field_layouts')
        .upsert(payload, { onConflict: 'board_id,field_key' });
      if (error) throw error;
      toast.success('Layout salvo!');
      await fetchLayout();
    } catch (e: any) {
      console.error('saveLayout error', e);
      toast.error('Erro ao salvar layout: ' + (e?.message || 'desconhecido'));
    }
  }, [boardId, fetchLayout]);

  return { resolved, fieldsByTab, saveLayout, loading, refetch: fetchLayout };
}
