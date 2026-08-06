/**
 * Decodificador de número CNJ (Resolução CNJ 65/2008).
 *
 * Formato: NNNNNNN-DD.AAAA.J.TR.OOOO  (20 dígitos)
 *   NNNNNNN sequencial | DD dígito verificador | AAAA ano
 *   J  segmento do Judiciário
 *   TR tribunal dentro do segmento
 *   OOOO unidade de origem (0000 = competência originária do tribunal → 2º grau)
 *
 * Serve para ligar contato de vara ↔ processo sem tabela de vínculo manual:
 * o número que já está em `lead_processes.process_number` diz o ramo, o tribunal
 * e o código da unidade. Cobertura real medida em 06/08/2026: 623 de 1.758
 * processos ativos têm CNJ de 20 dígitos (35%), contra 85 (5%) com os campos
 * `tribunal_sigla`/`grau` vindos do Escavador.
 */

export type CourtBranch =
  | 'trabalhista'
  | 'federal'
  | 'estadual'
  | 'eleitoral'
  | 'militar'
  | 'superior'
  | 'extrajudicial';

export interface CnjInfo {
  /** 20 dígitos, sem máscara. */
  digits: string;
  /** Número formatado NNNNNNN-DD.AAAA.J.TR.OOOO. */
  formatted: string;
  year: number;
  /** Dígito J. */
  segment: number;
  branch: CourtBranch;
  /** Chave curta do tribunal: TRT22, TRF1, TJPI, TRE-PI, STJ... */
  courtCode: string;
  /** UF quando o tribunal cobre uma só; null quando cobre várias (TRF1, TRT8). */
  uf: string | null;
  /** Todas as UFs sob o tribunal. */
  ufs: string[];
  /** Dígitos OOOO — código da unidade de origem dentro do tribunal. */
  originCode: string;
  /** OOOO = 0000: processo originário do tribunal (2º grau). */
  isTribunalOrigin: boolean;
}

/** Código de UF usado no campo TR da Justiça Estadual, Eleitoral e Militar Estadual. */
const UF_BY_TR: Record<string, string> = {
  '01': 'AC', '02': 'AL', '03': 'AP', '04': 'AM', '05': 'BA', '06': 'CE',
  '07': 'DF', '08': 'ES', '09': 'GO', '10': 'MA', '11': 'MT', '12': 'MS',
  '13': 'MG', '14': 'PA', '15': 'PB', '16': 'PR', '17': 'PE', '18': 'PI',
  '19': 'RJ', '20': 'RN', '21': 'RS', '22': 'RO', '23': 'RR', '24': 'SC',
  '25': 'SE', '26': 'SP', '27': 'TO',
};

/** Região do TRT → UFs de jurisdição. TRT2 = capital/Grande SP, TRT15 = interior. */
export const TRT_UFS: Record<number, string[]> = {
  1: ['RJ'], 2: ['SP'], 3: ['MG'], 4: ['RS'], 5: ['BA'], 6: ['PE'],
  7: ['CE'], 8: ['PA', 'AP'], 9: ['PR'], 10: ['DF', 'TO'], 11: ['AM', 'RR'],
  12: ['SC'], 13: ['PB'], 14: ['RO', 'AC'], 15: ['SP'], 16: ['MA'],
  17: ['ES'], 18: ['GO'], 19: ['AL'], 20: ['SE'], 21: ['RN'], 22: ['PI'],
  23: ['MT'], 24: ['MS'],
};

/**
 * Região do TRF → UFs. O TRF6 (MG) foi instalado em 19/08/2022 e desmembrou
 * Minas do TRF1: processo mineiro antigo continua com TR=01.
 */
export const TRF_UFS: Record<number, string[]> = {
  1: ['AC', 'AM', 'AP', 'BA', 'DF', 'GO', 'MA', 'MT', 'PA', 'PI', 'RO', 'RR', 'TO'],
  2: ['RJ', 'ES'],
  3: ['SP', 'MS'],
  4: ['RS', 'SC', 'PR'],
  5: ['AL', 'CE', 'PB', 'PE', 'RN', 'SE'],
  6: ['MG'],
};

/** Justiça Militar Estadual só tem tribunal próprio em MG, RS e SP. */
const TJM_UFS: Record<string, string> = { '13': 'MG', '21': 'RS', '26': 'SP' };

export const onlyDigits = (raw: string | null | undefined) =>
  String(raw ?? '').replace(/\D/g, '');

export const formatCnj = (digits: string): string =>
  digits.length === 20
    ? `${digits.slice(0, 7)}-${digits.slice(7, 9)}.${digits.slice(9, 13)}.${digits.slice(13, 14)}.${digits.slice(14, 16)}.${digits.slice(16, 20)}`
    : digits;

/**
 * Lê o número e devolve ramo/tribunal/UF/unidade. Devolve null se não for CNJ
 * de 20 dígitos — número antigo, protocolo administrativo ou NB do INSS caem aqui.
 */
export function parseCnj(raw: string | null | undefined): CnjInfo | null {
  const digits = onlyDigits(raw);
  if (digits.length !== 20) return null;

  const year = Number(digits.slice(9, 13));
  const segment = Number(digits.slice(13, 14));
  const tr = digits.slice(14, 16);
  const originCode = digits.slice(16, 20);
  const trNum = Number(tr);

  let branch: CourtBranch;
  let courtCode: string;
  let ufs: string[] = [];

  switch (segment) {
    case 1:
      branch = 'superior'; courtCode = 'STF'; break;
    case 2:
      branch = 'superior'; courtCode = 'CNJ'; break;
    case 3:
      branch = 'superior'; courtCode = 'STJ'; break;
    case 4:
      branch = 'federal';
      courtCode = trNum >= 1 && trNum <= 6 ? `TRF${trNum}` : 'JF';
      ufs = TRF_UFS[trNum] || [];
      break;
    case 5:
      branch = 'trabalhista';
      if (trNum === 0) { courtCode = 'TST'; branch = 'superior'; }
      else { courtCode = `TRT${trNum}`; ufs = TRT_UFS[trNum] || []; }
      break;
    case 6: {
      branch = 'eleitoral';
      const uf = UF_BY_TR[tr];
      courtCode = uf ? `TRE-${uf}` : 'TSE';
      ufs = uf ? [uf] : [];
      break;
    }
    case 7:
      branch = 'militar'; courtCode = 'STM'; break;
    case 8: {
      branch = 'estadual';
      const uf = UF_BY_TR[tr];
      // O tribunal do DF acumula os Territórios: a sigla corrente é TJDFT.
      courtCode = uf ? (uf === 'DF' ? 'TJDFT' : `TJ${uf}`) : 'TJ';
      ufs = uf ? [uf] : [];
      break;
    }
    case 9: {
      branch = 'militar';
      const uf = TJM_UFS[tr];
      courtCode = uf ? `TJM-${uf}` : 'TJM';
      ufs = uf ? [uf] : [];
      break;
    }
    default:
      return null;
  }

  return {
    digits,
    formatted: formatCnj(digits),
    year,
    segment,
    branch,
    courtCode,
    uf: ufs.length === 1 ? ufs[0] : null,
    ufs,
    originCode,
    isTribunalOrigin: originCode === '0000',
  };
}

/** Chave de casamento fino contato ↔ processo: tribunal + unidade de origem. */
export const cnjUnitKey = (courtCode: string, originCode: string) =>
  `${courtCode}:${originCode}`;

/**
 * O que o campo OOOO identifica muda conforme o ramo — verificado nos dados em
 * 06/08/2026:
 *   Trabalhista: é a vara. TRT22 0001 = 1ª VT de Teresina, 0002 = 2ª VT.
 *   Estadual:    é a comarca. TJPI 0140 serve a 4ª Vara Cível E a Vara de
 *                Registros Públicos, ambas de Teresina.
 *   Federal:     é a subseção. TRF1 4000 cobre a 6ª, 7ª e 8ª Varas de JEF do PI.
 * Por isso a contagem casada por origem não pode ser rotulada como "nesta vara"
 * fora da Justiça do Trabalho.
 */
export function originScopeLabel(branch: CourtBranch | null | undefined): string {
  switch (branch) {
    case 'trabalhista': return 'nesta vara';
    case 'federal': return 'nesta subseção';
    case 'estadual': return 'nesta comarca';
    default: return 'nesta unidade';
  }
}
