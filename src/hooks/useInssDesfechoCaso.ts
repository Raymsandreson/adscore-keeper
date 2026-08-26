import { externalSupabase } from '@/integrations/supabase/external-client';
import { useSharedFetch } from '@/lib/sharedFetch';
import type { InssDesfechoCaso } from '@/components/activities/buildActivityMessage';

const NENHUM: InssDesfechoCaso | null = null;

/**
 * Desfecho do(s) requerimento(s) INSS de um caso/lead.
 *
 * Existe para uma coisa só: impedir que a mensagem da atividade anuncie
 * "Progresso do caso: X%" para quem já teve o pedido decidido no INSS. O
 * progresso vem dos checklists do POP, que medem execução interna e não param
 * quando o INSS decide — ver o comentário de `InssDesfechoCaso`.
 *
 * `encerrado` exige que NENHUM requerimento esteja em andamento: caso com
 * pedido negado e outro ainda em análise continua tendo progresso real para
 * contar. Compartilhado via `useSharedFetch` porque a tela de atividades monta
 * várias instâncias do mesmo formulário.
 */
export function useInssDesfechoCaso(
  caseId?: string | null,
  leadId?: string | null,
): InssDesfechoCaso | null {
  const chave = caseId ? `case:${caseId}` : leadId ? `lead:${leadId}` : '';
  const { data } = useSharedFetch<InssDesfechoCaso | null>(
    chave ? `inss_desfecho:${chave}` : 'inss_desfecho:vazio',
    async () => {
      if (!chave) return NENHUM;
      // `inss_admin_processes` não está no types.ts gerado (tabela do Externo,
      // ver docs/sistema): sem o cast o TS não conhece a relação.
      let q = (externalSupabase as any)
        .from('inss_admin_processes')
        .select('requerimento_number, resultado, created_at')
        .is('deleted_at', null);
      q = caseId ? q.eq('case_id', caseId) : q.eq('lead_id', leadId as string);
      const { data, error } = await q.order('created_at', { ascending: false }).limit(50);
      if (error) throw error; // sem resposta, o comportamento antigo continua
      const linhas = (data as any[]) || [];
      if (linhas.length === 0) return NENHUM;
      const comDesfecho = linhas.filter((l) => l.resultado);
      const emAndamento = linhas.length - comDesfecho.length;
      if (comDesfecho.length === 0) {
        return { encerrado: false, resultado: null, requerimento: null, emAndamento };
      }
      const ultimo = comDesfecho[0];
      return {
        encerrado: emAndamento === 0,
        resultado: ultimo.resultado,
        requerimento: ultimo.requerimento_number || null,
        emAndamento,
      };
    },
    NENHUM,
  );
  return data ?? NENHUM;
}
