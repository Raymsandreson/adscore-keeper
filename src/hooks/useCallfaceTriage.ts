import { useState, useEffect, useCallback } from 'react';
import { externalSupabase, ensureExternalSession } from '@/integrations/supabase/external-client';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

/**
 * Fila de triagem das ligações da Callface.
 *
 * O webhook marca com a tag 'triagem' toda chamada que não encostou em nenhum
 * lead nem contato — em agosto/2026 isso foi 37 de 46. Nada vira lead ou contato
 * automaticamente: quem classifica é a atendente, aqui.
 *
 * Lê e escreve no EXTERNO (fonte de verdade das ligações). As telas antigas
 * (/calls lista, histórico do contato) leem a cópia do Cloud, que o webhook
 * espelha — por isso as tags são atualizadas nos dois lados. O `lead_id` fica
 * só no Externo de propósito: no Cloud o id ou viola a FK call_records_lead_id_fkey
 * ou aponta para outro lead.
 */

export interface TriageCall {
  id: string;
  contact_phone: string | null;
  contact_name: string | null;
  created_at: string;
  duration_seconds: number | null;
  ai_summary: string | null;
  audio_url: string | null;
  notes: string | null;
  phone_used: string | null;
  user_id: string;
  tags: string[] | null;
  call_result: string | null;
  /** Nome de quem fez a ligação, resolvido pelo profiles do Externo. */
  autor: string | null;
}

const SENTINELA = '00000000-0000-0000-0000-000000000000';

export function useCallfaceTriage() {
  const [calls, setCalls] = useState<TriageCall[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchQueue = useCallback(async () => {
    setLoading(true);
    try {
      await ensureExternalSession();
      const { data, error } = await externalSupabase
        .from('call_records')
        .select('id, contact_phone, contact_name, created_at, duration_seconds, ai_summary, audio_url, notes, phone_used, user_id, tags, call_result')
        .contains('tags', ['callface', 'triagem'])
        .order('created_at', { ascending: false })
        .limit(300);

      if (error) throw error;

      // 'descartado' é decisão da atendente: sai da fila, mas a linha continua lá.
      const abertas = ((data || []) as any[]).filter((r) => !(r.tags || []).includes('descartado'));

      // Nome do autor em uma query só — nada de N+1 por linha da fila.
      const ids = [...new Set(abertas.map((r) => r.user_id).filter((id) => id && id !== SENTINELA))];
      const nomes: Record<string, string> = {};
      if (ids.length > 0) {
        const { data: profs } = await externalSupabase
          .from('profiles')
          .select('user_id, full_name, email')
          .in('user_id', ids);
        for (const p of (profs || []) as any[]) {
          const nome = p.full_name || p.email?.split('@')[0];
          if (nome) nomes[p.user_id] = nome;
        }
      }

      setCalls(
        abertas.map((r) => ({
          ...r,
          // Sem atribuição o webhook grava a sentinela em vez de chutar um dono.
          // phone_used guarda o nome que a Callface mandou, que ainda ajuda a
          // atendente a saber quem ligou mesmo sem casar com um perfil.
          autor: r.user_id === SENTINELA ? null : nomes[r.user_id] || null,
        })) as TriageCall[],
      );
    } catch (e) {
      console.error('[triagem callface] falha ao carregar fila:', e);
      toast.error('Não foi possível carregar a fila de triagem');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchQueue();
  }, [fetchQueue]);

  /** Espelha as tags no Cloud para a lista antiga de /calls não divergir. */
  const sincronizarTagsNoCloud = async (id: string, tags: string[]) => {
    const { error } = await supabase.from('call_records').update({ tags } as any).eq('id', id);
    if (error) console.warn('[triagem callface] tags não sincronizaram no Cloud:', error.message);
  };

  const novasTags = (atuais: string[] | null, adicionar: string[], remover: string[]) => {
    const t = new Set(atuais || []);
    for (const r of remover) t.delete(r);
    for (const a of adicionar) t.add(a);
    return [...t];
  };

  /** Liga a chamada a um lead que já existe. Sai da fila. */
  const vincularLead = async (call: TriageCall, leadId: string, leadName: string | null) => {
    const tags = novasTags(call.tags, [], ['triagem']);
    const { error } = await externalSupabase
      .from('call_records')
      .update({ lead_id: leadId, lead_name: leadName, tags } as any)
      .eq('id', call.id);

    if (error) {
      console.error('[triagem callface] falha ao vincular:', error);
      toast.error('Não foi possível vincular ao lead');
      return false;
    }
    await sincronizarTagsNoCloud(call.id, tags);
    setCalls((prev) => prev.filter((c) => c.id !== call.id));
    toast.success(`Ligação vinculada a ${leadName || 'lead'}`);
    return true;
  };

  /** Tira da fila sem virar lead (engano, caixa postal, número errado). */
  const descartar = async (call: TriageCall, motivo?: string) => {
    const tags = novasTags(call.tags, ['descartado'], ['triagem']);
    const notes = motivo ? [call.notes, `Descartado na triagem: ${motivo}`].filter(Boolean).join(' | ') : call.notes;
    const { error } = await externalSupabase
      .from('call_records')
      .update({ tags, notes } as any)
      .eq('id', call.id);

    if (error) {
      console.error('[triagem callface] falha ao descartar:', error);
      toast.error('Não foi possível descartar');
      return false;
    }
    await sincronizarTagsNoCloud(call.id, tags);
    setCalls((prev) => prev.filter((c) => c.id !== call.id));
    toast.success('Ligação descartada');
    return true;
  };

  return { calls, loading, refetch: fetchQueue, vincularLead, descartar };
}
