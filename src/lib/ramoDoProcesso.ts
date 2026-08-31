// =============================================================================
// O ramo de um processo, para a tela poder dizer o que está fora do lugar.
//
// Camada fina em cima de `parseCnj` (lib/cnj.ts), que já decodifica segmento,
// tribunal e UF. O que falta lá, e nasce aqui, são os dois casos que NÃO são
// jurisdição nenhuma mas ocupam linha na tela:
//   SEM_NUMERO       ficha cadastrada sem número de processo
//   NUMERO_INVALIDO  tem número, mas não são os 20 dígitos do CNJ
// `parseCnj` devolve null para os dois, e null não dá para agrupar nem contar.
//
// POR QUE NÃO USAR `lead_processes.area`: medido em 24/08/2026 no POP
// "Trabalhistas judicial — marcos", 1214 das 1289 fichas estavam com o campo
// vazio, e as preenchidas vinham em quatro grafias ("Trabalhista",
// "TRABALHISTA", "CIVEL", "Cível"). O número não depende de ninguém digitar.
//
// ESPELHO DO BANCO: `cnj_ramo` e `cnj_uf` da migração 20260824120000 fazem a
// mesma leitura em SQL, para a contagem do servidor e a da tela não divergirem.
// =============================================================================
import { parseCnj, onlyDigits, type CourtBranch } from './cnj';

/** Ramo, mais os dois buracos de cadastro que a tela precisa mostrar à parte. */
export type RamoDoProcesso = CourtBranch | 'SEM_NUMERO' | 'NUMERO_INVALIDO';

export const ramoDoProcesso = (numero: string | null | undefined): RamoDoProcesso => {
  if (!onlyDigits(numero)) return 'SEM_NUMERO';
  return parseCnj(numero)?.branch ?? 'NUMERO_INVALIDO';
};

/** Ramos que não identificam um processo: cada ficha conta por si, nunca
 *  deduplicada — sem número, fundir fichas seria fundir gente diferente. */
export const RAMO_SEM_IDENTIDADE = new Set<RamoDoProcesso>(['SEM_NUMERO', 'NUMERO_INVALIDO']);

export const RAMO_ROTULO: Record<RamoDoProcesso, string> = {
  trabalhista: 'Justiça do Trabalho',
  federal: 'Justiça Federal',
  estadual: 'Justiça Estadual',
  eleitoral: 'Justiça Eleitoral',
  militar: 'Justiça Militar',
  superior: 'Tribunal superior',
  extrajudicial: 'Extrajudicial',
  SEM_NUMERO: 'Sem número de processo',
  NUMERO_INVALIDO: 'Número incompleto',
};

/** Rótulo curto, para caber em badge. */
export const RAMO_BADGE: Record<RamoDoProcesso, string> = {
  trabalhista: 'Trabalhista',
  federal: 'Federal',
  estadual: 'Estadual',
  eleitoral: 'Eleitoral',
  militar: 'Militar',
  superior: 'Superior',
  extrajudicial: 'Extrajudicial',
  SEM_NUMERO: 'Sem número',
  NUMERO_INVALIDO: 'Número incompleto',
};

/** Ordem de leitura: jurisdição primeiro, buraco de cadastro por último. */
export const RAMO_ORDEM: RamoDoProcesso[] = [
  'trabalhista', 'estadual', 'federal', 'eleitoral', 'militar', 'superior',
  'extrajudicial', 'NUMERO_INVALIDO', 'SEM_NUMERO',
];

/** true quando o tribunal cobre mais de um estado — TRT 8/10/11/14 e os TRF.
 *  Nesses casos o número sabe o tribunal, mas não sabe a UF. */
export const ufAmbigua = (numero: string | null | undefined): boolean =>
  (parseCnj(numero)?.ufs.length ?? 0) > 1;

/**
 * A UF de um processo, na ordem em que se confia nas fontes.
 *
 * O cadastro ganha do número porque ele sabe a vara; o número entra quando o
 * cadastro está vazio — que é a esmagadora maioria (medido em 24/08/2026: 394
 * de 1289 fichas do POP trabalhista tinham `estado_origem_sigla`).
 */
export const ufDoProcesso = (p: {
  process_number?: string | null;
  estado_origem_sigla?: string | null;
  /** UF da Tabela Auxiliar (`jm_processos.uf_proc`), quando o processo está lá. */
  uf_proc?: string | null;
}): string | null =>
  p.uf_proc?.trim().toUpperCase() ||
  p.estado_origem_sigla?.trim().toUpperCase() ||
  parseCnj(p.process_number)?.uf ||
  null;

/**
 * O ramo que o NOME do quadro promete, para a tela saber o que está fora do
 * lugar. Só reconhece o que dá para afirmar; na dúvida devolve null e a tela
 * mostra a distribuição sem acusar ninguém de estar no quadro errado.
 */
export const ramoPrometidoPeloNome = (nome: string | null | undefined): RamoDoProcesso | null => {
  const n = (nome ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (/trabalhista/.test(n)) return 'trabalhista';
  if (/\bfederal\b|previdenciari|\bbpc\b|\binss\b|auxilio|salario maternidade|pensao por morte/.test(n)) return 'federal';
  if (/justica comum|civel|estadual/.test(n)) return 'estadual';
  return null;
};
