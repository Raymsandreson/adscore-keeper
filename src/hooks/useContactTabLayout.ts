import { useCallback, useEffect, useMemo, useState } from 'react';
import { db } from '@/integrations/supabase';
import { toast } from 'sonner';

export interface ContactTabRow {
  id?: string;
  tab_key: string;
  label: string;
  display_order: number;
  hidden: boolean;
  is_custom: boolean;
}

export interface ResolvedContactTab {
  key: string;
  label: string;
  display_order: number;
  hidden: boolean;
  is_custom: boolean;
}

// Built-in tabs from ContactDetailSheet
const BUILTIN_TABS: ResolvedContactTab[] = [
  { key: 'info', label: 'Info', display_order: 1, hidden: false, is_custom: false },
  { key: 'calls', label: 'Chamadas', display_order: 2, hidden: false, is_custom: false },
  { key: 'history', label: 'Histórico', display_order: 3, hidden: false, is_custom: false },
  { key: 'location', label: 'Local', display_order: 4, hidden: false, is_custom: false },
  { key: 'groups', label: 'Grupos', display_order: 5, hidden: false, is_custom: false },
  { key: 'relationships', label: 'Vínculos', display_order: 6, hidden: false, is_custom: false },
  { key: 'leads', label: 'Leads', display_order: 7, hidden: false, is_custom: false },
  { key: 'ai_chat', label: 'IA', display_order: 8, hidden: false, is_custom: false },
];

export function useContactTabLayout() {
  const [rows, setRows] = useState<ContactTabRow[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchTabs = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await (db as any).from('contact_tab_layouts').select('*');
      if (error) throw error;
      setRows((data || []) as ContactTabRow[]);
    } catch (e) {
      console.error('useContactTabLayout fetch', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchTabs(); }, [fetchTabs]);

  const resolved = useMemo<ResolvedContactTab[]>(() => {
    const byKey = new Map<string, ContactTabRow>();
    rows.forEach(r => byKey.set(r.tab_key, r));
    const builtIn: ResolvedContactTab[] = BUILTIN_TABS.map(d => {
      const r = byKey.get(d.key);
      return r
        ? { key: d.key, label: r.label || d.label, display_order: r.display_order, hidden: r.hidden, is_custom: false }
        : d;
    });
    const custom: ResolvedContactTab[] = rows
      .filter(r => r.is_custom)
      .map(r => ({ key: r.tab_key, label: r.label, display_order: r.display_order, hidden: r.hidden, is_custom: true }));
    return [...builtIn, ...custom].sort((a, b) => a.display_order - b.display_order);
  }, [rows]);

  const visibleTabs = useMemo(() => resolved.filter(t => !t.hidden), [resolved]);

  const saveTabs = useCallback(async (next: ResolvedContactTab[]) => {
    try {
      const payload = next.map(t => ({
        tab_key: t.key,
        label: t.label,
        display_order: t.display_order,
        hidden: t.hidden,
        is_custom: t.is_custom,
      }));
      const { error } = await (db as any)
        .from('contact_tab_layouts')
        .upsert(payload, { onConflict: 'tab_key' });
      if (error) throw error;
      const keptKeys = new Set(next.map(t => t.key));
      const toDelete = rows.filter(r => !keptKeys.has(r.tab_key)).map(r => r.id!).filter(Boolean);
      if (toDelete.length) {
        await (db as any).from('contact_tab_layouts').delete().in('id', toDelete);
      }
      await fetchTabs();
    } catch (e: any) {
      console.error('saveTabs', e);
      toast.error('Erro ao salvar abas: ' + (e?.message || 'desconhecido'));
      throw e;
    }
  }, [rows, fetchTabs]);

  return { resolved, visibleTabs, saveTabs, loading, refetch: fetchTabs };
}
