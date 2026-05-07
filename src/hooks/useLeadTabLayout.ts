import { useCallback, useEffect, useMemo, useState } from 'react';
import { db } from '@/integrations/supabase';
import { TAB_DEFS, type LeadFieldTab } from '@/components/leads/leadFormFields';
import { toast } from 'sonner';

export interface LeadTabLayoutRow {
  id?: string;
  board_id: string;
  tab_key: string;
  label: string;
  display_order: number;
  hidden: boolean;
  is_custom: boolean;
}

export interface ResolvedTab {
  key: string;        // built-in LeadFieldTab or custom slug
  label: string;
  display_order: number;
  hidden: boolean;
  is_custom: boolean;
}

const DEFAULT_TABS: ResolvedTab[] = TAB_DEFS.map((t, i) => ({
  key: t.key,
  label: t.label,
  display_order: i + 1,
  hidden: false,
  is_custom: false,
}));

export function useLeadTabLayout(boardId?: string | null) {
  const [rows, setRows] = useState<LeadTabLayoutRow[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchTabs = useCallback(async () => {
    if (!boardId) { setRows([]); return; }
    setLoading(true);
    try {
      const { data, error } = await (db as any)
        .from('lead_tab_layouts')
        .select('*')
        .eq('board_id', boardId);
      if (error) throw error;
      setRows((data || []) as LeadTabLayoutRow[]);
    } catch (e) {
      console.error('useLeadTabLayout fetch error', e);
    } finally {
      setLoading(false);
    }
  }, [boardId]);

  useEffect(() => { fetchTabs(); }, [fetchTabs]);

  const resolved = useMemo<ResolvedTab[]>(() => {
    const byKey = new Map<string, LeadTabLayoutRow>();
    rows.forEach(r => byKey.set(r.tab_key, r));
    const builtIn: ResolvedTab[] = DEFAULT_TABS.map(d => {
      const r = byKey.get(d.key);
      return r
        ? { key: d.key, label: r.label || d.label, display_order: r.display_order, hidden: r.hidden, is_custom: false }
        : d;
    });
    const custom: ResolvedTab[] = rows
      .filter(r => r.is_custom)
      .map(r => ({ key: r.tab_key, label: r.label, display_order: r.display_order, hidden: r.hidden, is_custom: true }));
    return [...builtIn, ...custom].sort((a, b) => a.display_order - b.display_order);
  }, [rows]);

  const visibleTabs = useMemo(() => resolved.filter(t => !t.hidden), [resolved]);

  const saveTabs = useCallback(async (next: ResolvedTab[]) => {
    if (!boardId) return;
    try {
      const payload = next.map(t => ({
        board_id: boardId,
        tab_key: t.key,
        label: t.label,
        display_order: t.display_order,
        hidden: t.hidden,
        is_custom: t.is_custom,
      }));
      const { error } = await (db as any)
        .from('lead_tab_layouts')
        .upsert(payload, { onConflict: 'board_id,tab_key' });
      if (error) throw error;
      // remove rows that no longer exist (custom tabs removed)
      const keptKeys = new Set(next.map(t => t.key));
      const toDelete = rows.filter(r => !keptKeys.has(r.tab_key)).map(r => r.id!).filter(Boolean);
      if (toDelete.length) {
        await (db as any).from('lead_tab_layouts').delete().in('id', toDelete);
      }
      await fetchTabs();
    } catch (e: any) {
      console.error('saveTabs error', e);
      toast.error('Erro ao salvar abas: ' + (e?.message || 'desconhecido'));
      throw e;
    }
  }, [boardId, rows, fetchTabs]);

  return { resolved, visibleTabs, saveTabs, loading, refetch: fetchTabs };
}
