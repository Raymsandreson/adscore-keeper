// Número sequencial de caso ("PREV 1448", "CASO-0474", "SM-0009") — parse,
// comparação e faixa.
//
// POR QUE EXISTE: `case_number` é campo de texto digitado à mão em dois lugares
// (legal_cases e leads) e chegou bagunçado. Medição de 17/08/2026 sobre os 918
// protocolos INSS vivos: 291 "PREV nnn", 133 só com o número, 43 "CASO nnn",
// 4 "SM", 1 "DG" — com variações "✅PREV 2027", "✅️ Prev 133", "Caso 322",
// "CASO-0474". Comparar isso como string ordena "PREV 1000" antes de "PREV 99",
// então qualquer filtro por faixa precisa passar por aqui primeiro.
//
// O QUE NÃO É SEQUÊNCIA: o mesmo campo guarda número CNJ
// ("0011351-63.2022.5.15.0031"), NUP do INSS ("13621.214680/2024-67") e
// dígitos soltos de 10+ posições ("1332519476"). Nenhum desses tem número de
// ordem; devolver um pedaço deles como "caso 13621" colocaria linha errada
// dentro da faixa e o usuário contaria protocolo que não é dele. Por isso o
// parse REJEITA em vez de adivinhar.

export type FamiliaCaso = "PREV" | "CASO" | "LEAD" | "SM" | "DG" | "NUM";

/** "NUM" = case_number que é só o número, sem prefixo de funil. */
export const FAMILIAS: { valor: FamiliaCaso; rotulo: string }[] = [
  { valor: "PREV", rotulo: "PREV" },
  { valor: "CASO", rotulo: "CASO" },
  { valor: "NUM", rotulo: "Sem prefixo" },
  { valor: "LEAD", rotulo: "LEAD" },
  { valor: "SM", rotulo: "SM" },
  { valor: "DG", rotulo: "DG" },
];

const PREFIXOS: Exclude<FamiliaCaso, "NUM">[] = ["PREV", "CASO", "LEAD", "SM", "DG"];
/** Ordem de exibição quando a lista é ordenada por sequência. */
const ORDEM_FAMILIA: FamiliaCaso[] = ["PREV", "CASO", "NUM", "LEAD", "SM", "DG"];

export interface CasoSequencia {
  familia: FamiliaCaso;
  numero: number;
  /** Texto como está no banco, pra exibir sem reescrever o dado de ninguém. */
  original: string;
}

/** Tira acento/emoji e uniformiza caixa, preservando a pontuação (o parse usa). */
function limpar(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

/** CNJ ("0011351-63.2022.5.15.0031"), CNJ colado (20 dígitos) e NUP do INSS. */
const FORMATOS_DE_PROCESSO = [
  /\d{7}-?\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/,
  /\d{20}/,
  /\d{5}\.\d{6}\/\d{4}-\d{2}/,
];

/**
 * Cheira a número de processo (CNJ, NUP, protocolo) em vez de sequência.
 *
 * Duas regras:
 *  - formato de processo em qualquer lugar do texto derruba, mesmo com prefixo
 *    ("CASO 0001723-93.2025.5.17.0191" não é o caso 93);
 *  - sem prefixo, dois ou mais blocos de dígitos também derrubam. Com prefixo
 *    isso é permitido porque "CASO 17 e 17.1" existe no banco e vale 17.
 */
function pareceNumeroDeProcesso(texto: string, temPrefixo: boolean): boolean {
  if (FORMATOS_DE_PROCESSO.some((re) => re.test(texto))) return true;
  if (temPrefixo) return false;
  // Desdobramento sem prefixo ("222.1", "26.1") continua sendo o caso 222 e o
  // 26 — são 8 linhas no Externo e todas seguem esse formato curto.
  if (/^\d{1,5}(\.\d{1,2})+$/.test(texto.trim())) return false;
  const blocos = texto.match(/\d+/g) || [];
  return blocos.length >= 2;
}

/**
 * Lê o número sequencial de um `case_number`. Devolve null quando o texto não
 * carrega sequência nenhuma (CNJ, NUP, vazio, dígitos demais).
 *
 * O limite de 5 dígitos é proposital: a maior sequência viva é PREV 2050, e
 * blocos de 6+ dígitos no campo são sempre protocolo/CNJ mal colado.
 */
export function parseCasoSequencia(raw?: string | null): CasoSequencia | null {
  const original = String(raw ?? "").trim();
  if (!original) return null;

  const texto = limpar(original);
  const mPrefixo = texto.match(/\b(PREV|CASO|LEAD|SM|DG)\b/);
  const familia = (mPrefixo?.[1] as Exclude<FamiliaCaso, "NUM"> | undefined) ?? null;

  if (pareceNumeroDeProcesso(texto, Boolean(familia))) return null;

  // `\b` nas duas pontas ancora em bloco inteiro: "1332519476" (10 dígitos) não
  // casa nada, em vez de devolver os 5 últimos como se fossem o número.
  const depoisDoPrefixo = familia
    ? texto.slice((mPrefixo?.index ?? 0) + familia.length)
    : texto;
  const mNumero = depoisDoPrefixo.match(/\b(\d{1,5})\b/) || texto.match(/\b(\d{1,5})\b/);
  if (!mNumero) return null;

  const numero = Number(mNumero[1]);
  if (!Number.isFinite(numero) || numero <= 0) return null;

  return { familia: familia ?? "NUM", numero, original };
}

export interface EntradaFaixa {
  /** null = o usuário digitou só o número; quem manda é o seletor de família. */
  familia: FamiliaCaso | null;
  numero: number;
}

/**
 * Lê o que a pessoa digitou no campo de faixa: "PREV 1200", "prev1200", "1200".
 * Aceita o prefixo junto pra ninguém ter que reparar em dois controles.
 */
export function parseEntradaFaixa(raw?: string | null): EntradaFaixa | null {
  const texto = limpar(String(raw ?? "").trim());
  if (!texto) return null;

  const mPrefixo = texto.match(/(PREV|CASO|LEAD|SM|DG)/);
  const familia = (mPrefixo?.[1] as Exclude<FamiliaCaso, "NUM"> | undefined) ?? null;
  const mNumero = texto.match(/(\d{1,6})/);
  if (!mNumero) return null;

  const numero = Number(mNumero[1]);
  if (!Number.isFinite(numero) || numero <= 0) return null;
  return { familia, numero };
}

export interface FaixaCaso {
  familia: FamiliaCaso | null;
  /** Inclusivo. null = sem piso. */
  de: number | null;
  /** Inclusivo. null = sem teto. */
  ate: number | null;
}

export function faixaEstaAtiva(faixa: FaixaCaso): boolean {
  return faixa.de !== null || faixa.ate !== null;
}

/**
 * A linha cai na faixa? Sem sequência legível a resposta é não — protocolo com
 * `case_number` de CNJ não pode entrar numa contagem "de PREV 1200 a 1400".
 */
export function dentroDaFaixa(seq: CasoSequencia | null, faixa: FaixaCaso): boolean {
  if (!faixaEstaAtiva(faixa) && !faixa.familia) return true;
  if (!seq) return false;
  if (faixa.familia && seq.familia !== faixa.familia) return false;
  // Faixa invertida ("de 1400 até 1200") lê como intervalo mesmo assim: é erro
  // de digitação óbvio, e devolver zero resultado só faria a pessoa refazer.
  const piso = faixa.de !== null && faixa.ate !== null ? Math.min(faixa.de, faixa.ate) : faixa.de;
  const teto = faixa.de !== null && faixa.ate !== null ? Math.max(faixa.de, faixa.ate) : faixa.ate;
  if (piso !== null && seq.numero < piso) return false;
  if (teto !== null && seq.numero > teto) return false;
  return true;
}

/** Rótulo curto pra badge da linha: "PREV 1448", "CASO 474", "nº 248". */
export function formatCasoSequencia(seq: CasoSequencia | null): string {
  if (!seq) return "";
  return seq.familia === "NUM" ? `nº ${seq.numero}` : `${seq.familia} ${seq.numero}`;
}

/** Descrição da faixa pro rodapé de contagem. */
export function descreverFaixa(faixa: FaixaCaso): string {
  const nome = faixa.familia && faixa.familia !== "NUM" ? faixa.familia : "";
  const rotulo = (n: number) => (nome ? `${nome} ${n}` : `nº ${n}`);
  if (faixa.de !== null && faixa.ate !== null) {
    const piso = Math.min(faixa.de, faixa.ate);
    const teto = Math.max(faixa.de, faixa.ate);
    return `de ${rotulo(piso)} até ${rotulo(teto)}`;
  }
  if (faixa.de !== null) return `de ${rotulo(faixa.de)} em diante`;
  if (faixa.ate !== null) return `até ${rotulo(faixa.ate)}`;
  return faixa.familia ? `sequência ${faixa.familia === "NUM" ? "sem prefixo" : faixa.familia}` : "";
}

/** Ordena por família e número — usado quando a lista é vista por sequência. */
export function compararSequencia(a: CasoSequencia | null, b: CasoSequencia | null): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  if (a.familia !== b.familia) {
    return ORDEM_FAMILIA.indexOf(a.familia) - ORDEM_FAMILIA.indexOf(b.familia);
  }
  return a.numero - b.numero;
}
