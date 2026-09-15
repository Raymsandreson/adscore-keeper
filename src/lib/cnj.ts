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

/**
 * As formas em que o MESMO processo pode estar gravado, para usar em `.in()`.
 *
 * Por que existe: as tabelas de jurimetria (`jm_decisoes`, `jm_valores`,
 * `jm_pagamentos`) guardam o CNJ com máscara; `lead_processes.process_number`
 * guarda o que a equipe digitou, com ou sem. As RPCs resolvem isso aplicando
 * `regexp_replace(..., '[^0-9]', '', 'g')` dos dois lados — no front não dá pra
 * usar regexp dentro do filtro, então a consulta tem que oferecer as variantes.
 */
export function cnjVariantes(valor: string | null | undefined): string[] {
  const cru = String(valor ?? '').trim();
  const digits = onlyDigits(cru);
  return [...new Set([cru, formatCnj(digits), digits].filter(Boolean))];
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

// =============================================================================
// Reparo do número lido em material solto (conversa, PDF, print)
//
// O advogado da outra parte digita "0000846-69-2025-5-08-00009" no WhatsApp:
// traço no lugar do ponto e um zero a mais na unidade de origem. São 21 dígitos,
// e o casamento por número simplesmente desiste — a pista mais forte que existe
// é jogada fora justamente quando ela é mais útil. A atividade então cai no
// vínculo por nome de parte, que é fraco, e nasce no lead certo sem processo
// nenhum (caso real de 09/09/2026: o processo existia, no mesmo lead).
//
// Reparar sem chutar é possível porque o CNJ carrega dígito verificador: entre
// os candidatos de 20 dígitos que dá pra formar tirando (ou pondo) um dígito,
// só passa quem fecha o módulo 97. Um candidato aleatório tem 1 chance em 97 de
// passar — e mesmo assim o reparo NUNCA vincula sozinho: quem chama pergunta.
// =============================================================================

/**
 * DD do CNJ (Resolução 65/2008, art. 1º §1º — módulo 97 base 10, ISO 7064):
 * `DD = 98 - (NNNNNNN AAAA J TR OOOO || "00" mod 97)`.
 * Recebe os 18 dígitos SEM o verificador. Devolve null se não forem 18 dígitos.
 */
export function digitoVerificadorCnj(dezoitoDigitos: string): string | null {
  if (!/^\d{18}$/.test(dezoitoDigitos)) return null;
  const resto = Number(BigInt(dezoitoDigitos + '00') % 97n);
  return String(98 - resto).padStart(2, '0');
}

/** O DD gravado confere com o que o resto do número exige? */
export function cnjDvValido(digits: string): boolean {
  if (!/^\d{20}$/.test(digits)) return false;
  return digitoVerificadorCnj(digits.slice(0, 7) + digits.slice(9)) === digits.slice(7, 9);
}

export interface CandidatoCnj {
  /** 20 dígitos, sem máscara. */
  digits: string;
  /** NNNNNNN-DD.AAAA.J.TR.OOOO. */
  formatted: string;
  /** Faltou/sobrou dígito no que foi lido e este candidato é uma reconstrução. */
  reparado: boolean;
}

/**
 * Os números de 20 dígitos que o texto lido pode estar querendo dizer.
 *
 *   20 dígitos → ele mesmo, e só. Errar UM dígito no meio de um número completo
 *                é outra classe de problema: aqui viraria adivinhação.
 *   21 dígitos → tira um dígito, em cada posição. Sobra quem fecha o DV.
 *   19 dígitos → põe um zero de preenchimento, em cada posição. Idem.
 *   qualquer outro tamanho → nada. Protocolo administrativo e NB do INSS caem
 *                aqui e não podem virar palpite de processo.
 */
export function candidatosCnj(bruto: string | null | undefined): CandidatoCnj[] {
  const digits = onlyDigits(bruto);
  if (digits.length === 20) {
    return [{ digits, formatted: formatCnj(digits), reparado: false }];
  }

  const brutos: string[] = [];
  if (digits.length === 21) {
    for (let i = 0; i < digits.length; i++) brutos.push(digits.slice(0, i) + digits.slice(i + 1));
  } else if (digits.length === 19) {
    for (let i = 0; i <= digits.length; i++) brutos.push(`${digits.slice(0, i)}0${digits.slice(i)}`);
  } else {
    return [];
  }

  const vistos = new Set<string>();
  const candidatos: CandidatoCnj[] = [];
  for (const c of brutos) {
    if (vistos.has(c) || !cnjDvValido(c)) continue;
    // Segmento inválido (parseCnj devolve null) é ruído que passou no DV por acaso.
    if (!parseCnj(c)) continue;
    vistos.add(c);
    candidatos.push({ digits: c, formatted: formatCnj(c), reparado: true });
  }
  return candidatos;
}

/**
 * O texto digitado numa caixa de busca é um número de processo? Devolve como
 * ele deve ser escrito.
 *
 * A busca já resolve o CNJ colado sem máscara pela RPC `busca_unificada`, que
 * compara `cnj_digitos`. O que ela não resolve é dígito a menos ou a mais na
 * cópia: em 09/09/2026 a busca por "0008466920255080009" (19 dígitos, um zero
 * à esquerda perdido no caminho) devolveu nada, e o processo
 * 0000846-69.2025.5.08.0009 estava lá. Comparação por dígito exige que os
 * dígitos estejam certos.
 *
 * O reparo não chuta: 19 ou 21 dígitos só viram um número quando existe UM
 * único candidato que fecha o dígito verificador (módulo 97) e tem segmento de
 * Judiciário válido. Dois candidatos = ambíguo = devolve null, e a busca segue
 * com o texto cru em vez de mascarar por cima do que a pessoa quis dizer.
 *
 * Só entra em cena de 19 a 21 dígitos, faixa onde CPF (11), telefone (11 a 13)
 * e NB do INSS (10) não chegam.
 */
export function cnjDigitado(texto: string | null | undefined): CandidatoCnj | null {
  const cru = String(texto ?? '').trim();
  // Letra em qualquer lugar: é nome, e-mail ou "CASO-369", não número de processo.
  if (!cru || /[^\d\s.\-/]/.test(cru)) return null;
  const digits = onlyDigits(cru);
  if (digits.length < 19 || digits.length > 21) return null;
  const candidatos = candidatosCnj(digits);
  return candidatos.length === 1 ? candidatos[0] : null;
}
