import { useEffect, useState } from 'react';
import { externalSupabase, ensureExternalSession } from '@/integrations/supabase/external-client';

export type LinkedCaseRow = { id: string; case_number: string | null; title: string | null };
export type LinkedProcessRow = {
  id: string;
  process_number: string | null;
  title: string | null;
  /** usado pelo chip "sem andamento efetivo" do cabeçalho da atividade */
  data_ultima_movimentacao?: string | null;
};

/**
 * Caso/processo vivos do vínculo da atividade, quando o snapshot não basta.
 *
 * As atividades guardam `case_title`/`process_title` no momento em que foram
 * criadas; as auto-criadas nascem com o id preenchido e o título nulo (40
 * atividades com processo e 2.189 com caso, em 12/08/2026). Como as telas
 * mostravam o vínculo condicionado ao *título*, o processo sumia do cabeçalho
 * enquanto o menu "Vincular" continuava oferecendo "Remover Processo" — que lê
 * o *id*. Aqui buscamos o dado vivo só quando ele não está nas listas já
 * carregadas (`leadCases` / `caseProcesses`), então na maioria dos casos não há
 * consulta extra.
 */
export function useLinkedCaseProcess(params: {
  caseId?: string | null;
  processId?: string | null;
  caseProcesses?: { id: string; process_number?: string | null; title?: string | null; data_ultima_movimentacao?: string | null }[];
  leadCases?: { id: string; case_number?: string | null; title?: string | null }[];
}) {
  const { caseId, processId, caseProcesses, leadCases } = params;

  const knownCase = caseId ? (leadCases || []).find(c => c.id === caseId) : null;
  const knownProcess = processId ? (caseProcesses || []).find(p => p.id === processId) : null;

  const [fetchedCase, setFetchedCase] = useState<LinkedCaseRow | null>(null);
  const [fetchedProcess, setFetchedProcess] = useState<LinkedProcessRow | null>(null);

  useEffect(() => {
    if (!caseId || knownCase) { setFetchedCase(null); return; }
    let cancelled = false;
    (async () => {
      await ensureExternalSession();
      const { data } = await externalSupabase
        .from('legal_cases')
        .select('id, case_number, title')
        .eq('id', caseId)
        .maybeSingle();
      if (!cancelled) setFetchedCase((data as LinkedCaseRow) || null);
    })();
    return () => { cancelled = true; };
  }, [caseId, knownCase?.id]);

  useEffect(() => {
    if (!processId || knownProcess) { setFetchedProcess(null); return; }
    let cancelled = false;
    (async () => {
      await ensureExternalSession();
      const { data } = await externalSupabase
        .from('lead_processes')
        .select('id, process_number, title, data_ultima_movimentacao')
        .eq('id', processId)
        .maybeSingle();
      if (!cancelled) setFetchedProcess((data as LinkedProcessRow) || null);
    })();
    return () => { cancelled = true; };
  }, [processId, knownProcess?.id]);

  return {
    linkedCase: (knownCase as LinkedCaseRow | undefined) || fetchedCase || null,
    linkedProcess: (knownProcess as LinkedProcessRow | undefined) || fetchedProcess || null,
  };
}
