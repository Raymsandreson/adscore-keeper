import { useQuery } from '@tanstack/react-query';
import { db } from '@/integrations/supabase';
import { useActivityTypes } from '@/hooks/useActivityTypes';
import {
  montarEventosDaJanela,
  type AtividadeLite,
  type AudienciaLite,
  type EventoAgenda,
  type ProcessoResolvido,
} from '@/lib/eventAgenda';

/**
 * Busca os eventos de uma JANELA de dias (audiências, perícias e prazos).
 *
 * A janela vem de `janelaDaVespera`: normalmente um dia, mas na sexta são três
 * (sábado, domingo e segunda) para a segunda também ter véspera.
 *
 * As fontes são três tabelas diferentes e nenhuma delas se conhece:
 *  - `hearings` traz audiência e perícia (separadas por `hearing_type`), com
 *    hora, mas quase sempre SEM `lead_id`: em 17/08/2026 só 10 das 70 futuras
 *    tinham. O que quase todas têm é `process_number` (69 de 70), e 53 dos 59
 *    números casam em `lead_processes` — é por aí que o cliente é resolvido.
 *  - `lead_activities` traz os prazos (tipo "Prazo") e as atividades que servem
 *    de "o que fazer" para cada audiência.
 *  - `activity_types` dá o rótulo das chaves `custom_*`.
 *
 * Volume por dia é pequeno (2 a 9 linhas por aba), então a busca é direta, sem
 * paginação: o maior lote é o de atividades com prazo no dia (274 no pico
 * medido) e a janela chega a três dias, ainda abaixo do teto de 1000 por
 * request do PostgREST.
 */
export function useEventosDaJanela(dias: string[]) {
  const { types } = useActivityTypes();

  const query = useQuery({
    queryKey: ['eventos-da-janela', dias.join(',')],
    staleTime: 60_000,
    enabled: dias.length > 0 && dias.every(d => /^\d{4}-\d{2}-\d{2}$/.test(d)),
    queryFn: async (): Promise<{ audiencias: AudienciaLite[]; atividades: AtividadeLite[]; processoPorNumero: Map<string, ProcessoResolvido>; atividadesPorProcesso: Map<string, AtividadeLite[]> }> => {
      const COLS_ATIVIDADE =
        'id, title, activity_type, deadline, priority, status, lead_id, lead_name, process_id, process_title, assigned_to_name';

      const [audRes, ativRes] = await Promise.all([
        (db as any)
          .from('hearings')
          .select('id, hearing_date, hearing_time, hearing_type, status, process_number, lead_id, location')
          .is('deleted_at', null)
          .in('hearing_date', dias),
        (db as any)
          .from('lead_activities')
          .select(COLS_ATIVIDADE)
          .is('deleted_at', null)
          .neq('status', 'concluida')
          .in('deadline', dias),
      ]);
      if (audRes.error) throw audRes.error;
      if (ativRes.error) throw ativRes.error;

      const audiencias = (audRes.data || []) as AudienciaLite[];
      const atividades = (ativRes.data || []) as AtividadeLite[];

      // Número do processo → processo/cliente. Sem isso a coluna Cliente fica
      // vazia em ~85% das audiências.
      const numeros = [...new Set(audiencias.map(a => a.process_number?.trim()).filter(Boolean))] as string[];
      const processoPorNumero = new Map<string, ProcessoResolvido>();
      const atividadesPorProcesso = new Map<string, AtividadeLite[]>();

      if (numeros.length > 0) {
        const { data: procs, error: procErr } = await (db as any)
          .from('lead_processes')
          .select('id, process_number, lead_id')
          .is('deleted_at', null)
          .in('process_number', numeros);
        if (procErr) throw procErr;

        const linhas = (procs || []) as { id: string; process_number: string | null; lead_id: string | null }[];
        const leadIds = [...new Set(linhas.map(p => p.lead_id).filter(Boolean))] as string[];

        const nomePorLead = new Map<string, string | null>();
        if (leadIds.length > 0) {
          const { data: leads, error: leadErr } = await (db as any)
            .from('leads')
            .select('id, lead_name')
            .in('id', leadIds);
          if (leadErr) throw leadErr;
          ((leads || []) as { id: string; lead_name: string | null }[])
            .forEach(l => nomePorLead.set(l.id, l.lead_name));
        }

        linhas.forEach(p => {
          if (!p.process_number) return;
          processoPorNumero.set(p.process_number.trim(), {
            process_id: p.id,
            process_number: p.process_number,
            lead_id: p.lead_id,
            lead_name: p.lead_id ? nomePorLead.get(p.lead_id) ?? null : null,
          });
        });

        // Atividades vivas desses processos — é delas que sai a coluna
        // "Atividade" da audiência (não há FK entre hearings e atividades).
        const procIds = linhas.map(p => p.id);
        if (procIds.length > 0) {
          const { data: doProc, error: procAtivErr } = await (db as any)
            .from('lead_activities')
            .select(COLS_ATIVIDADE)
            .is('deleted_at', null)
            .neq('status', 'concluida')
            .in('process_id', procIds);
          if (procAtivErr) throw procAtivErr;
          ((doProc || []) as AtividadeLite[]).forEach(a => {
            if (!a.process_id) return;
            const lista = atividadesPorProcesso.get(a.process_id) || [];
            lista.push(a);
            atividadesPorProcesso.set(a.process_id, lista);
          });
        }
      }

      return { audiencias, atividades, processoPorNumero, atividadesPorProcesso };
    },
  });

  const rotuloDoTipo = new Map(types.map(t => [t.key, t.label]));

  const eventos: EventoAgenda[] = query.data
    ? montarEventosDaJanela({
        dias,
        audiencias: query.data.audiencias,
        atividades: query.data.atividades,
        rotuloDoTipo,
        processoPorNumero: query.data.processoPorNumero,
        atividadesPorProcesso: query.data.atividadesPorProcesso,
      })
    : [];

  return { eventos, isLoading: query.isLoading, error: query.error, refetch: query.refetch };
}
