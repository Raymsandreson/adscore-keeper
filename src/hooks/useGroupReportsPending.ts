/**
 * Quantos relatos de grupo estão esperando triagem.
 *
 * Serve para o botão dentro de Leads não ser mais um link mudo: número no
 * badge é o que faz alguém abrir a fila. Só a CONTAGEM vem do banco (`head:
 * true`), então a barra do funil não paga o preço de carregar os relatos.
 */
import { useCallback, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { db, ensureExternalSession } from '@/integrations/supabase';

// Tabela nova, ainda fora dos types gerados — acesso destipado.
const dbAny = db as unknown as SupabaseClient;

export function useGroupReportsPending() {
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    try {
      await ensureExternalSession();
      const { count: total, error } = await dbAny
        .from('whatsapp_group_case_reports')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'novo');
      if (error) throw error;
      setCount(total || 0);
    } catch {
      // Tela de leads não pode quebrar por causa de um badge: sem contagem,
      // o botão continua lá, só sem número.
      setCount(0);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Relato novo cai a cada 10 min pelo cron; quem está no funil vê o badge
  // subir sem recarregar a página.
  useEffect(() => {
    const channel = dbAny
      .channel('group-case-reports-badge')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'whatsapp_group_case_reports' },
        () => { refresh(); })
      .subscribe();
    return () => { dbAny.removeChannel(channel); };
  }, [refresh]);

  return { count, refresh };
}
