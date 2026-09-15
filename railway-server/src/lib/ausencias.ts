// Prazo não cai em ausência registrada — a regra, num lugar só.
//
// Ela já existia em `src/lib/timeOff.ts` (front do web) e roda em dois pontos:
// na criação de atividade e em toda mudança de prazo/responsável. O app mobile
// NÃO a tem — `member_time_off` aparece lá só no painel "Time agora" —, e o
// adiar do celular oferece quatro opções fixas, qualquer uma podendo cair nas
// férias de alguém que está fora do escritório e sem a aba de Férias na frente.
//
// Por que aqui e não copiada para o app: duas implementações da mesma pergunta
// divergem em silêncio. É o §5.5 do escopo do mobile, e é o motivo de o
// `create-activity` e o `check-time-off` chamarem ESTA função, e não cada um a
// sua.
//
// `member_time_off.user_id` guarda uuid do CLOUD (é o mesmo dos seletores de
// assessor). A consulta roda ANTES do remap para o Externo, como no web.
import { supabase as ext } from './supabase';

export const ROTULO_DA_AUSENCIA: Record<string, string> = {
  ferias: 'Férias',
  compensacao: 'Compensação de horas',
  folga: 'Folga',
};

export interface ConflitoDeAusencia {
  user_id: string;
  user_name: string | null;
  type: string;
  start_date: string;
  end_date: string;
  /** Frase pronta, idêntica à do web. Quem consome pode montar a sua. */
  descricao: string;
}

export interface ConsultaDeAusencia {
  conflitos: ConflitoDeAusencia[];
  /**
   * `false` só quando a CONSULTA falhou — rede, policy, banco fora.
   *
   * A distinção é o ponto: `getTimeOffConflicts` do web devolve `[]` tanto para
   * "conferi e não há" quanto para "não consegui conferir", e aí o toast some e
   * a pessoa fica com a impressão de que o prazo foi conferido. Quem chama daqui
   * precisa saber a diferença para avisar (`ausencia_nao_verificada`).
   */
  verificado: boolean;
}

const EH_DIA = /^\d{4}-\d{2}-\d{2}$/;

export function dataBr(iso: string): string {
  const [y, m, d] = String(iso || '').split('-');
  return y && m && d ? `${d}/${m}/${y}` : String(iso || '');
}

/** Mesma frase do `describeTimeOff` do web — uma regra, duas telas, um texto. */
export function descreverAusencia(a: { type: string; start_date: string; end_date: string }): string {
  const periodo = a.start_date === a.end_date
    ? `em ${dataBr(a.start_date)}`
    : `de ${dataBr(a.start_date)} a ${dataBr(a.end_date)}`;
  return `${ROTULO_DA_AUSENCIA[a.type] || a.type} ${periodo}`;
}

interface LinhaDeAusencia {
  user_id: string;
  user_name: string | null;
  type: string;
  start_date: string;
  end_date: string;
}

export function conflitoDaLinha(l: LinhaDeAusencia): ConflitoDeAusencia {
  return {
    user_id: l.user_id,
    user_name: l.user_name ?? null,
    type: l.type,
    start_date: l.start_date,
    end_date: l.end_date,
    descricao: descreverAusencia(l),
  };
}

/**
 * Ausências que cobrem `data` para qualquer um dos `cloudUserIds`.
 *
 * Sem id ou sem data válida devolve `{ [], verificado: true }` — e isso É uma
 * resposta, não uma falha: atividade sem prazo não tem como cair em ausência
 * nenhuma. Só erro de consulta derruba o `verificado`.
 */
export async function consultarAusencias(
  cloudUserIds: (string | null | undefined)[],
  data: string | null | undefined,
): Promise<ConsultaDeAusencia> {
  const ids = [...new Set((cloudUserIds || []).filter(Boolean))] as string[];
  const dia = String(data || '').slice(0, 10);
  if (ids.length === 0 || !EH_DIA.test(dia)) return { conflitos: [], verificado: true };

  try {
    const { data: linhas, error } = await ext
      .from('member_time_off')
      .select('user_id, user_name, type, start_date, end_date')
      .in('user_id', ids)
      .lte('start_date', dia)
      .gte('end_date', dia);
    if (error) throw error;
    return { conflitos: (linhas || []).map((l) => conflitoDaLinha(l as LinhaDeAusencia)), verificado: true };
  } catch (e) {
    // Falha ABERTO, e quem chama avisa: travar a criação porque a consulta de
    // férias caiu transforma problema de rede em trabalho perdido, e quem está
    // em audiência é justamente quem mais depende de gravar. A decisão está em
    // `docs/endpoint-criar-atividade.md` §3.4 (14/09/2026), com o porquê de ela
    // ser aceitável aqui e não numa regra de permissão: isto protege contra
    // engano de agenda, não contra má-fé.
    console.warn('[ausencias] consulta falhou (seguindo, e avisando quem chamou):', e instanceof Error ? e.message : e);
    return { conflitos: [], verificado: false };
  }
}
