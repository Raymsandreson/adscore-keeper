import { useCallback, useEffect, useMemo, useState } from 'react';
import { db } from '@/integrations/supabase';
import { CONTACT_FIELD_REGISTRY, type ContactFieldTab } from '@/components/contacts/contactFormFields';
import { toast } from 'sonner';

export interface ContactFieldLayoutRow {
  id?: string;
  field_key: string;
  tab: string;
  display_order: number;
  hidden: boolean;
}

export interface ResolvedContactField {
  field_key: string;
  tab: string;
  display_order: number;
  hidden: boolean;
}

export function useContactFieldLayout() {
  const [rows, setRows] = useState<ContactFieldLayoutRow[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchLayout = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await (db as any).from('contact_field_layouts').select('*');
      if (error) throw error;
      setRows((data || []) as ContactFieldLayoutRow[]);
    } catch (e) {
      console.error('useContactFieldLayout fetch', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchLayout(); }, [fetchLayout]);

  const resolved = useMemo<ResolvedContactField[]>(() => {
    const byKey = new Map<string, ContactFieldLayoutRow>();
    rows.forEach(r => byKey.set(r.field_key, r));
    return CONTACT_FIELD_REGISTRY.map(def => {
      const r = byKey.get(def.key);
      return r
        ? { field_key: def.key, tab: r.tab, display_order: r.display_order, hidden: r.hidden }
        : { field_key: def.key, tab: def.defaultTab, display_order: def.defaultOrder, hidden: false };
    });
  }, [rows]);

  const isHidden = useCallback((key: string): boolean => {
    return resolved.find(r => r.field_key === key)?.hidden ?? false;
  }, [resolved]);

  const tabOf = useCallback((key: string): string => {
    return resolved.find(r => r.field_key === key)?.tab ?? 'info';
  }, [resolved]);

  const saveLayout = useCallback(async (next: ResolvedContactField[]) => {
    try {
      const payload = next.map(f => ({
        field_key: f.field_key,
        tab: f.tab,
        display_order: f.display_order,
        hidden: f.hidden,
      }));
      const { error } = await (db as any)
        .from('contact_field_layouts')
        .upsert(payload, { onConflict: 'field_key' });
      if (error) throw error;
      await fetchLayout();
    } catch (e: any) {
      console.error('saveLayout (contact)', e);
      toast.error('Erro ao salvar layout: ' + (e?.message || 'desconhecido'));
      throw e;
    }
  }, [fetchLayout]);

  return { resolved, isHidden, tabOf, saveLayout, loading, refetch: fetchLayout };
}
