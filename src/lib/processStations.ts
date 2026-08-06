// =============================================================================
// Monta a lista de estações da linha do processo (aba Marcos).
// Estações intermediárias (conciliação, perícia, instrução) entram por:
//   1. EVIDÊNCIA — o marco existe em process_movements (detector já viu);
//   2. PREVISÃO — regra por ramo da Justiça + tipo do caso, validada com o
//      usuário em 13/07/2026:
//      - Trabalhista: conciliação + instrução previstas; perícia só se caso
//        NÃO-fatal (fatal não tem perícia).
//      - Previdenciário: perícia prevista (médica/social), EXCETO pensão por
//        morte, maternidade e rural; audiência (instrução/justificação) SÓ em
//        pensão por morte ou rural.
//      - Demais ramos: só evidência (nada previsto).
//   Override manual: lead_processes.pericia_prevista (null = automático).
// Módulo puro — sem I/O, testável isolado.
// =============================================================================

export type EstacaoTipo =
  | 'peticao_inicial'
  | 'audiencia_conciliacao'
  | 'pericia'
  | 'audiencia_instrucao'
  | 'sentenca_1grau'
  | 'acordo'
  | 'acordao_2grau'
  | 'acordao_superior'
  | 'transito_julgado'
  | 'cumprimento_sentenca'
  | 'precatorio_rpv'
  | 'pagamento';

const ORDEM_CANONICA: EstacaoTipo[] = [
  'peticao_inicial', 'audiencia_conciliacao', 'pericia', 'audiencia_instrucao',
  'sentenca_1grau', 'acordo', 'acordao_2grau', 'acordao_superior',
  'transito_julgado', 'cumprimento_sentenca', 'precatorio_rpv', 'pagamento',
];

const INTERMEDIARIAS: EstacaoTipo[] = ['audiencia_conciliacao', 'pericia', 'audiencia_instrucao'];

// Execução (06/08/2026): entram na régua mas NÃO são previstas por regra — só
// aparecem na linha do trem quando o marco existe de fato. Prever execução em
// todo processo poluiria a linha de quem nunca vai executar (acordo, improcedência),
// e a fase é eventual por natureza: depende de a parte não cumprir espontaneamente.
const SO_POR_EVIDENCIA: EstacaoTipo[] = ['cumprimento_sentenca', 'precatorio_rpv'];

function normalize(s: string | null | undefined): string {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Dígito J (ramo da Justiça) do número CNJ. */
function ramoFromCnj(processNumber: string | null | undefined): string | null {
  const m = (processNumber || '').match(/\d{7}-?\d{2}\.\d{4}\.(\d)\./);
  return m ? m[1] : null;
}

export interface EstacoesOpts {
  /** Tipos de marco já registrados no processo (evidência). */
  tiposComMarco: Set<string>;
  processNumber?: string | null;
  /** case_type do lead vinculado. */
  caseType?: string | null;
  /** Override manual: null/undefined = automático. */
  periciaPrevista?: boolean | null;
}

/** Lista de estações a exibir na linha do trem, na ordem canônica. */
export function estacoesDoProcesso(opts: EstacoesOpts): EstacaoTipo[] {
  const ct = normalize(opts.caseType);
  const fatal = ct.includes('fatal');
  const pensaoMorte = ct.includes('pensao') && ct.includes('morte');
  const rural = ct.includes('rural');
  const maternidade = ct.includes('maternidade');
  const previdenciarioPorTipo = /bpc|loas|previdenc|auxilio|aposentad|pensao|incapacidade/.test(ct);

  const ramo = ramoFromCnj(opts.processNumber);
  const trabalhista = ramo === '5';
  const previdenciario = !trabalhista && (ramo === '4' || previdenciarioPorTipo);

  let conciliacao = false;
  let pericia = false;
  let instrucao = false;

  if (trabalhista) {
    conciliacao = true;
    instrucao = true;
    pericia = !fatal;
  } else if (previdenciario) {
    conciliacao = false;
    instrucao = pensaoMorte || rural;
    pericia = !(pensaoMorte || maternidade || rural);
  } else {
    // Cível e demais ramos: a audiência de conciliação/mediação do art. 334 do
    // CPC é a REGRA, não a exceção — o juiz designa salvo desinteresse de ambas
    // as partes ou impossibilidade de autocomposição. Até 06/08/2026 estes 19
    // processos não previam nenhuma estação intermediária e a linha do trem
    // pulava direto do ajuizamento para a sentença.
    conciliacao = true;
  }

  // Override manual da perícia (quando definido, vence a regra automática).
  if (opts.periciaPrevista === true) pericia = true;
  if (opts.periciaPrevista === false) pericia = false;

  const previstas: Record<string, boolean> = {
    audiencia_conciliacao: conciliacao,
    pericia,
    audiencia_instrucao: instrucao,
  };

  return ORDEM_CANONICA.filter((tipo) => {
    // Execução nunca é prevista — só aparece se já aconteceu.
    if (SO_POR_EVIDENCIA.includes(tipo)) return opts.tiposComMarco.has(tipo);
    if (!INTERMEDIARIAS.includes(tipo)) return true;
    // Evidência sempre vence: se o marco existe, a estação aparece.
    return opts.tiposComMarco.has(tipo) || previstas[tipo];
  });
}
