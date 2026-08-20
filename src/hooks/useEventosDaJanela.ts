import { useQuery } from '@tanstack/react-query';
import { db } from '@/integrations/supabase';
import { useActivityTypes } from '@/hooks/useActivityTypes';
import { buscarTudo } from '@/lib/postgrestPaginacao';
import {
  ehAtividadeDePrazo,
  montarEventosDaJanela,
  type AtividadeLite,
  type AudienciaLite,
  type EventoAgenda,
  type ProcessoResolvido,
} from '@/lib/eventAgenda';

const COLS_ATIVIDADE =
  'id, title, activity_type, deadline, priority, status, lead_id, lead_name, ' +
  'process_id, process_title, case_id, case_title, ' +
  'assigned_to, assigned_to_name, assigned_to_ids, assigned_to_names, created_at';

const COLS_AUDIENCIA =
  'id, hearing_date, hearing_time, hearing_type, status, process_number, lead_id, ' +
  'location, case_ref, category, assigned_user_id';

/** Divide uma lista de ids em blocos, para o `.in()` não virar URL gigante. */
function emBlocos<T>(itens: T[], tamanho = 100): T[][] {
  const blocos: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) blocos.push(itens.slice(i, i + tamanho));
  return blocos;
}

/**
 * Busca os eventos de uma JANELA de dias (audiências, perícias e prazos).
 *
 * A janela vem de `janelaDaVespera` (D+1 até o próximo dia útil) ou de
 * `diasDoIntervalo`, quando a pessoa escolhe um período no seletor.
 *
 * As fontes são três tabelas diferentes e nenhuma delas se conhece:
 *  - `hearings` traz audiência e perícia (separadas por `hearing_type`), com
 *    hora, mas quase sempre SEM `lead_id`: em 19/08/2026 só 7 das 74 futuras
 *    tinham. O que quase todas têm é `process_number` (73 de 74), e é por aí que
 *    o cliente é resolvido. `case_ref` ("CASO 348", "PREV 203") está em 54 e
 *    `category` em todas as 74 — são eles que alimentam os filtros da tela.
 *  - `lead_activities` traz os prazos (tipo "Prazo") e as atividades que servem
 *    de "o que fazer" e de dono para cada audiência.
 *  - `activity_types` dá o rótulo das chaves `custom_*`.
 *
 * O FILTRO DE PRAZO ACONTECE NO SERVIDOR. Antes a busca trazia toda atividade
 * com deadline no dia e descartava no cliente: 337 linhas para exibir 8 em
 * 20/08/2026. Num período de 30 dias isso seriam ~10 mil linhas, muito além do
 * teto de 1000 do PostgREST — a lista chegaria cortada sem erro nenhum. Como as
 * chaves de prazo são conhecidas (a seed `prazo` mais as `custom_*` cujo rótulo
 * é "Prazo"), o `in` resolve na origem.
 */
export function useEventosDaJanela(dias: string[]) {
  const { types } = useActivityTypes();

  // As duas famílias de chave que significam "Prazo" (ver activityTypeAliases):
  // a seed hardcoded e as linhas `custom_*` com o mesmo rótulo.
  const chavesDePrazo = [
    'prazo',
    ...types.filter(t => ehAtividadeDePrazo(t.key, t.label)).map(t => t.key),
  ].filter((v, i, arr) => arr.indexOf(v) === i);

  const primeiro = dias[0];
  const ultimo = dias[dias.length - 1];

  const query = useQuery({
    queryKey: ['eventos-da-janela', primeiro, ultimo, chavesDePrazo.join(',')],
    staleTime: 60_000,
    enabled: dias.length > 0 && dias.every(d => /^\d{4}-\d{2}-\d{2}$/.test(d)),
    queryFn: async (): Promise<{
      audiencias: AudienciaLite[];
      atividades: AtividadeLite[];
      processoPorNumero: Map<string, ProcessoResolvido>;
      atividadesPorProcesso: Map<string, AtividadeLite[]>;
      nomePorLead: Map<string, string | null>;
    }> => {
      const [audiencias, atividades] = await Promise.all([
        buscarTudo<AudienciaLite>((de, ate) =>
          (db as any)
            .from('hearings')
            .select(COLS_AUDIENCIA)
            .is('deleted_at', null)
            .gte('hearing_date', primeiro)
            .lte('hearing_date', ultimo)
            .range(de, ate)),
        buscarTudo<AtividadeLite>((de, ate) =>
          (db as any)
            .from('lead_activities')
            .select(COLS_ATIVIDADE)
            .is('deleted_at', null)
            .neq('status', 'concluida')
            .in('activity_type', chavesDePrazo)
            .gte('deadline', primeiro)
            .lte('deadline', ultimo)
            .range(de, ate)),
      ]);

      // Número do processo → processo/cliente. Sem isso a coluna Cliente fica
      // vazia em ~85% das audiências.
      const numeros = [...new Set(audiencias.map(a => a.process_number?.trim()).filter(Boolean))] as string[];
      const processoPorNumero = new Map<string, ProcessoResolvido>();
      const atividadesPorProcesso = new Map<string, AtividadeLite[]>();
      const nomePorLead = new Map<string, string | null>();

      if (numeros.length > 0) {
        const linhas: { id: string; process_number: string | null; lead_id: string | null }[] = [];
        for (const bloco of emBlocos(numeros)) {
          const { data, error } = await (db as any)
            .from('lead_processes')
            .select('id, process_number, lead_id')
            .is('deleted_at', null)
            .in('process_number', bloco);
          if (error) throw error;
          linhas.push(...((data || []) as typeof linhas));
        }

        const leadIds = [...new Set(linhas.map(p => p.lead_id).filter(Boolean))] as string[];
        for (const bloco of emBlocos(leadIds)) {
          const { data, error } = await (db as any)
            .from('leads')
            .select('id, lead_name')
            .in('id', bloco);
          if (error) throw error;
          ((data || []) as { id: string; lead_name: string | null }[])
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

        // Atividades vivas desses processos — delas saem a coluna "Atividade" da
        // audiência E os responsáveis pelo evento (não há FK entre as tabelas, e
        // `hearings.assigned_user_id` estava preenchido em 6 de 74 em 19/08).
        const procIds = linhas.map(p => p.id);
        for (const bloco of emBlocos(procIds)) {
          const doProc = await buscarTudo<AtividadeLite>((de, ate) =>
            (db as any)
              .from('lead_activities')
              .select(COLS_ATIVIDADE)
              .is('deleted_at', null)
              .neq('status', 'concluida')
              .in('process_id', bloco)
              .range(de, ate));
          doProc.forEach(a => {
            if (!a.process_id) return;
            const lista = atividadesPorProcesso.get(a.process_id) || [];
            lista.push(a);
            atividadesPorProcesso.set(a.process_id, lista);
          });
        }
      }

      // O CLIENTE TAMBÉM VEM DE `hearings.lead_id`.
      // A resolução acima é por número do processo, que cobre a planilha (548 de
      // 566 linhas têm número em 20/08/2026). Mas a perícia marcada no chip da
      // atividade pode nascer sem processo nenhum: das 93 atividades vivas de
      // perícia, 30 têm só o caso ou só o cliente. Sem este segundo passo, o
      // evento entraria na agenda como "sem cliente" tendo o lead na mão.
      const leadsSoltos = [...new Set(
        audiencias.map(a => a.lead_id).filter((id): id is string => !!id && !nomePorLead.has(id)),
      )];
      for (const bloco of emBlocos(leadsSoltos)) {
        const { data, error } = await (db as any)
          .from('leads')
          .select('id, lead_name')
          .in('id', bloco);
        if (error) throw error;
        ((data || []) as { id: string; lead_name: string | null }[])
          .forEach(l => nomePorLead.set(l.id, l.lead_name));
      }

      return { audiencias, atividades, processoPorNumero, atividadesPorProcesso, nomePorLead };
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
        nomePorLead: query.data.nomePorLead,
      })
    : [];

  return { eventos, isLoading: query.isLoading, error: query.error, refetch: query.refetch };
}
