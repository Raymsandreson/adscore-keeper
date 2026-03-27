import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface ProcessTracking {
  id: string;
  case_id: string | null;
  lead_id: string | null;
  cliente: string | null;
  caso: string | null;
  cpf: string | null;
  senha_gov: string | null;
  data_criacao: string | null;
  tipo: string | null;
  acolhedor: string | null;
  numero_processo: string | null;
  pendencia: string | null;
  data_gerar_guia: string | null;
  data_nascimento_bebe: string | null;
  protocolado: string | null;
  data_protocolo_cancelamento: string | null;
  tempo_dias: number | null;
  status_processo: string | null;
  data_decisao_final: string | null;
  motivo_indeferimento: string | null;
  observacao: string | null;
  cliente_no_grupo: string | null;
  atividade_criada: string | null;
  pago_acolhedor: string | null;
  data_pagamento: string | null;
  import_source: string | null;
  imported_at: string | null;
  created_at: string;
  updated_at: string;
}

export function useProcessTracking() {
  const [records, setRecords] = useState<ProcessTracking[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('case_process_tracking')
        .select('*')
        .order('caso', { ascending: true, nullsFirst: false });
      if (error) throw error;
      setRecords((data || []) as ProcessTracking[]);
    } catch (e) {
      console.error('Error fetching tracking:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  const upsertRecord = useCallback(async (record: Partial<ProcessTracking> & { id?: string }) => {
    try {
      if (record.id) {
        const { data, error } = await supabase
          .from('case_process_tracking')
          .update(record as any)
          .eq('id', record.id)
          .select()
          .single();
        if (error) throw error;
        setRecords(prev => prev.map(r => r.id === record.id ? data as ProcessTracking : r));
        return data;
      } else {
        const { data, error } = await supabase
          .from('case_process_tracking')
          .insert(record as any)
          .select()
          .single();
        if (error) throw error;
        setRecords(prev => [data as ProcessTracking, ...prev]);
        return data;
      }
    } catch (e) {
      console.error('Error upserting tracking:', e);
      throw e;
    }
  }, []);

  const bulkInsert = useCallback(async (rows: Partial<ProcessTracking>[]) => {
    try {
      const { data, error } = await supabase
        .from('case_process_tracking')
        .insert(rows.map(r => ({ ...r, imported_at: new Date().toISOString() })) as any)
        .select();
      if (error) throw error;
      setRecords(prev => [...(data as ProcessTracking[]), ...prev]);
      return data;
    } catch (e) {
      console.error('Error bulk inserting:', e);
      throw e;
    }
  }, []);

  const deleteRecord = useCallback(async (id: string) => {
    try {
      const { error } = await supabase.from('case_process_tracking').delete().eq('id', id);
      if (error) throw error;
      setRecords(prev => prev.filter(r => r.id !== id));
    } catch (e) {
      console.error('Error deleting:', e);
      throw e;
    }
  }, []);

  return { records, loading, fetchRecords, upsertRecord, bulkInsert, deleteRecord };
}
