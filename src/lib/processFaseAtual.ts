// =============================================================================
// Fase do processo pela LINHA DO TREM — fallback de quando o caso não tem POP.
//
// O sino de atualizações manda mensagem no padrão da atividade (etapa /
// objetivo / passo atual / progresso), e esses três vêm do checklist do lead.
// Processo sem POP cadastrado ficaria sem nenhum contexto de fase. Em vez de
// omitir tudo — ou pior, inventar percentual — cai aqui: a estação atual da
// régua de marcos (process_movements) e a posição dela nas estações previstas
// para aquele processo (mesma régua da aba Marcos, processStations.ts).
//
// Rótulo NÃO é traduzido para linguagem de cliente (decisão do Raym,
// 11/08/2026): o cliente lê "Sentença 1º grau", igual à ficha do processo.
// Por isso o texto na mensagem é "Andamento processual", nunca "Progresso do
// caso" — % de POP e % de régua processual são medidas diferentes.
// =============================================================================
import { db } from '@/integrations/supabase';
import { estacoesDoProcesso, type EstacaoTipo } from '@/lib/processStations';

const LABEL: Record<EstacaoTipo, string> = {
  peticao_inicial: 'Petição inicial',
  audiencia_conciliacao: 'Audiência de conciliação',
  pericia: 'Perícia',
  audiencia_instrucao: 'Audiência de instrução',
  sentenca_1grau: 'Sentença 1º grau',
  acordo: 'Acordo',
  acordao_2grau: 'Acórdão 2º grau',
  acordao_superior: 'Acórdão superior',
  transito_julgado: 'Trânsito em julgado',
  cumprimento_sentenca: 'Cumprimento de sentença',
  precatorio_rpv: 'Precatório / RPV',
  pagamento: 'Pagamento',
};

export interface FaseProcessual {
  /** Ex.: "Sentença 1º grau". Null quando nenhum marco foi detectado ainda. */
  faseLabel: string | null;
  /** Posição da estação atual (1-based) nas estações previstas do processo. */
  posicao: number;
  total: number;
}

/**
 * Lê os marcos do processo e devolve a estação atual + posição na régua.
 * Devolve `null` quando não há marco nenhum — o chamador deve então omitir o
 * bloco de fase por completo (nunca imprimir "Etapa: —").
 */
export async function fetchFaseProcessual(
  processId: string | null | undefined,
  opts: { processNumber?: string | null; caseType?: string | null; periciaPrevista?: boolean | null } = {},
): Promise<FaseProcessual | null> {
  if (!processId) return null;
  try {
    // process_movements ainda não está no types.ts gerado — cast local
    // (mesmo padrão do useProcessMovements).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = db as any;
    const { data, error } = await client
      .from('process_movements')
      .select('tipo_movimentacao, data_movimentacao')
      .eq('process_id', processId);
    if (error) throw error;

    const movimentos = (data || []) as Array<{ tipo_movimentacao: string }>;
    if (movimentos.length === 0) return null;

    const tiposComMarco = new Set(movimentos.map((m) => m.tipo_movimentacao));
    const estacoes = estacoesDoProcesso({
      tiposComMarco,
      processNumber: opts.processNumber,
      caseType: opts.caseType,
      periciaPrevista: opts.periciaPrevista ?? null,
    });

    // Estação atual = a mais avançada já alcançada (ordem canônica vence data,
    // mesma regra da migration 20260731010000).
    let idx = -1;
    estacoes.forEach((t, i) => { if (tiposComMarco.has(t)) idx = i; });
    if (idx < 0) return null;

    return { faseLabel: LABEL[estacoes[idx]], posicao: idx + 1, total: estacoes.length };
  } catch (err) {
    console.warn('[fetchFaseProcessual]', err);
    return null;
  }
}
