// =============================================================================
// As perícias marcadas de dentro da atividade — leitura e escrita em `hearings`.
//
// A perícia é do BENEFÍCIO, não da atividade: quem marcar em qualquer atividade
// faz a data aparecer em todas as outras do mesmo processo/caso, inclusive nas
// criadas depois. Por isso a linha é procurada por uma ÂNCORA que degrada:
//
//   processo → caso → lead
//
// Degrada porque 115 das 326 atividades vivas de perícia (19/08/2026) não têm
// processo vinculado, e amarrar no processo deixaria 35% do serviço sem onde
// salvar. A mesma expressão é o índice único parcial criado na migration
// 20260819110000 (`coalesce(process_id, legal_case_id, lead_id), hearing_type`
// where origem='atividade'), então banco e tela concordam sobre o que é "a
// mesma perícia".
//
// `activity_id` é gravado como rastro de quem marcou primeiro — nunca como
// chave de busca: a atividade some (concluída, clonada) e a perícia fica.
// =============================================================================
import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { db, ensureExternalSession } from '@/integrations/supabase';
import {
  PERICIA_HEARING_TYPE,
  PERICIA_TIPOS,
  type PericiaTipo,
} from '@/lib/periciaInss';

export interface PericiaMarcada {
  id: string;
  data: string;          // hearing_date  'YYYY-MM-DD'
  hora: string | null;   // hearing_time  'HH:MM:SS'
  status: string | null;
}

export interface AncoraPericia {
  processId?: string | null;
  caseId?: string | null;
  leadId?: string | null;
  /** Só para gravar junto (a planilha casa por número); não entra na busca. */
  processNumber?: string | null;
  activityId?: string | null;
  assignedTo?: string | null;
}

type Mapa = Partial<Record<PericiaTipo, PericiaMarcada>>;

/** Qual campo ancora esta perícia. null = atividade solta, sem onde pendurar. */
export function campoDaAncora(a: AncoraPericia): 'process_id' | 'legal_case_id' | 'lead_id' | null {
  if (a.processId) return 'process_id';
  if (a.caseId) return 'legal_case_id';
  if (a.leadId) return 'lead_id';
  return null;
}

function valorDaAncora(a: AncoraPericia): string | null {
  return a.processId || a.caseId || a.leadId || null;
}

/**
 * Filtro que casa EXATAMENTE o `coalesce` do índice único: ancorada no caso, só
 * conta a linha que não tem processo — senão a perícia de um processo do mesmo
 * caso seria devolvida como se fosse a da atividade sem processo.
 */
function aplicarAncora(q: any, a: AncoraPericia) {
  const campo = campoDaAncora(a);
  if (campo === 'process_id') return q.eq('process_id', a.processId);
  if (campo === 'legal_case_id') return q.is('process_id', null).eq('legal_case_id', a.caseId);
  return q.is('process_id', null).is('legal_case_id', null).eq('lead_id', a.leadId);
}

export function usePericiaDaAtividade(ancora: AncoraPericia) {
  const qc = useQueryClient();
  const [pericias, setPericias] = useState<Mapa>({});
  const [carregou, setCarregou] = useState(false);
  const chave = valorDaAncora(ancora);

  useEffect(() => {
    if (!chave) { setCarregou(false); setPericias({}); return; }
    let cancelled = false;
    (async () => {
      await ensureExternalSession();
      const { data, error } = await aplicarAncora(
        (db as any)
          .from('hearings')
          .select('id, hearing_type, hearing_date, hearing_time, status')
          .is('deleted_at', null)
          .eq('origem', 'atividade')
          .in('hearing_type', PERICIA_TIPOS.map(t => PERICIA_HEARING_TYPE[t])),
        ancora,
      );
      if (cancelled) return;
      if (error) { setCarregou(false); return; }
      const mapa: Mapa = {};
      for (const t of PERICIA_TIPOS) {
        const row = (data || []).find((h: any) => h.hearing_type === PERICIA_HEARING_TYPE[t]);
        if (row) mapa[t] = { id: row.id, data: row.hearing_date, hora: row.hearing_time, status: row.status };
      }
      setPericias(mapa);
      setCarregou(true);
    })();
    return () => { cancelled = true; };
    // `chave` resume a âncora: mudou a âncora, recarrega.
  }, [chave]); // eslint-disable-line react-hooks/exhaustive-deps

  const invalidar = useCallback(() => {
    // O calendário e a aba Eventos leem a mesma tabela por outras chaves.
    qc.invalidateQueries({ queryKey: ['hearings'] });
    qc.invalidateQueries({ queryKey: ['eventos-da-janela'] });
  }, [qc]);

  /** Marca ou remarca. Devolve mensagem de erro, ou null se deu certo. */
  const salvar = useCallback(async (tipo: PericiaTipo, data: string, hora: string): Promise<string | null> => {
    if (!chave) return 'Esta atividade não tem processo, caso nem cliente para pendurar a perícia.';
    await ensureExternalSession();
    const existente = pericias[tipo];

    if (existente) {
      // Remarcação: a data nova entra e o evento volta a valer. Sem forçar
      // 'ativa', uma perícia marcada como adiada ficaria fora do calendário
      // mesmo depois de remarcada — que é exatamente o caso do "REMARCAR
      // PERÍCIA" que aparece aos montes nos títulos das atividades.
      const { error } = await (db as any)
        .from('hearings')
        .update({ hearing_date: data, hearing_time: hora, status: 'ativa' })
        .eq('id', existente.id);
      if (error) return error.message;
      setPericias(p => ({ ...p, [tipo]: { ...existente, data, hora, status: 'ativa' } }));
      invalidar();
      return null;
    }

    const { data: inserida, error } = await (db as any)
      .from('hearings')
      .insert({
        process_id: ancora.processId || null,
        legal_case_id: ancora.caseId || null,
        lead_id: ancora.leadId || null,
        activity_id: ancora.activityId || null,
        process_number: ancora.processNumber || null,
        assigned_user_id: ancora.assignedTo || null,
        hearing_type: PERICIA_HEARING_TYPE[tipo],
        category: 'previdenciario',
        hearing_date: data,
        hearing_time: hora,
        timezone_label: 'Padrão Brasília',
        status: 'ativa',
        origem: 'atividade',
      })
      .select('id, hearing_date, hearing_time, status')
      .single();
    if (error) return error.message;
    setPericias(p => ({ ...p, [tipo]: { id: inserida.id, data, hora, status: 'ativa' } }));
    invalidar();
    return null;
  }, [chave, pericias, ancora, invalidar]);

  /** Desmarca (soft delete — o histórico do evento não se perde). */
  const remover = useCallback(async (tipo: PericiaTipo): Promise<string | null> => {
    const existente = pericias[tipo];
    if (!existente) return null;
    await ensureExternalSession();
    const { error } = await (db as any)
      .from('hearings')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', existente.id);
    if (error) return error.message;
    setPericias(p => ({ ...p, [tipo]: undefined }));
    invalidar();
    return null;
  }, [pericias, invalidar]);

  return { pericias, carregou, temAncora: !!chave, salvar, remover };
}
