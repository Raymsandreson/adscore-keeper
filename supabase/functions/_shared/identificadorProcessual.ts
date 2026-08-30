// =============================================================================
// Identificador TIPADO de processo — o fim do "casar por comprimento".
//
// POR QUE EXISTE (30/08/2026):
//   O sync-email-push montava o índice assim: >= 15 dígitos vira CNJ, 6 a 11
//   vira protocolo INSS. Só que número SEI (13621.207251/2023-52) tem 17
//   dígitos e entraria como CNJ; os 3 protocolos administrativos de 12 dígitos
//   (ex.: 297696035235) não entravam em índice nenhum; e o IC do MPT
//   (002217.2025.03.000/2, 16 dígitos) idem. Medido na base em 30/08/2026:
//   1.295 processos com 20 dígitos, 14 com máscara SEI, 306 protocolos de
//   6-11 dígitos, 3 de 12 — e cada um desses formatos é um TIPO, não um
//   comprimento.
//
// REGRAS INEGOCIÁVEIS (decisão do Raym, tarefa de 30/08/2026):
//   - CNJ exige exatamente 20 dígitos E dígito verificador válido (módulo 97,
//     ISO 7064) quando vier sem máscara. Nunca casar por faixa de comprimento.
//   - Todo identificador não-CNJ extraído de texto livre exige palavra-âncora
//     a até 40 caracteres antes (ou na mesma frase); número solto é descartado.
//   - O tipo do identificador do e-mail tem que bater com o tipo do
//     process_number cadastrado: protocolo nunca casa com CNJ e vice-versa.
//     Colar movimentação no caso errado é pior do que não capturar.
//
// Módulo puro (sem I/O, sem API do Deno) — os testes em
// src/lib/__tests__/identificadorProcessual.test.ts importam direto.
// =============================================================================

export type TipoIdentificador =
  | 'cnj'
  | 'sei'
  | 'demanda_sit'
  | 'ordem_servico'
  | 'protocolo_inss'
  | 'documento_sei'
  | 'outro';

export interface IdentificadorExtraido {
  tipo: TipoIdentificador;
  /** Como apareceu no texto (com máscara). */
  valor: string;
  /** Só dígitos — é a metade da chave do índice (a outra é o tipo). */
  valorNormalizado: string;
  /** A palavra que autorizou a captura. Null só no CNJ com máscara completa. */
  ancora: string | null;
}

/** Chave do índice tipado: mesmo dígito em tipos diferentes nunca colide. */
export function chaveIdentificador(tipo: TipoIdentificador, digitos: string): string {
  return `${tipo}:${digitos}`;
}

export function soDigitos(s: string): string {
  return (s || '').replace(/\D/g, '');
}

// ---------------------------------------------------------------------------
// CNJ — Resolução CNJ 65/2008: NNNNNNN-DD.AAAA.J.TR.OOOO
// ---------------------------------------------------------------------------

/**
 * Dígito verificador do CNJ (módulo 97, ISO 7064): o número completo
 * reordenado como NNNNNNN + AAAA + J + TR + OOOO + DD tem resto 1 na divisão
 * por 97. BigInt porque são 20 dígitos — acima do inteiro seguro de JS.
 */
export function cnjDvValido(digitos20: string): boolean {
  if (!/^\d{20}$/.test(digitos20)) return false;
  const seq = digitos20.slice(0, 7);
  const dv = digitos20.slice(7, 9);
  const resto = digitos20.slice(9); // AAAA J TR OOOO
  try {
    return BigInt(seq + resto + dv) % 97n === 1n;
  } catch {
    return false;
  }
}

/** CNJ com máscara completa — a máscara já é a âncora. */
export const CNJ_MASCARA_RE = /\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/;

/** Máscara SEI: NNNNN.NNNNNN/AAAA-DD (reais: 10169.200184/2023-41). */
export const SEI_MASCARA_RE = /\d{5}\.\d{6}\/(19|20)\d{2}-\d{2}/;

/** Demanda do SIT: NNNNNNN-N (real: 3747657-2). */
const DEMANDA_MASCARA_RE = /^\d{7}-\d$/;

/** Ordem de serviço: NNNNNNNN-N (real: 11471427-4). */
const OS_MASCARA_RE = /^\d{8}-\d$/;

// ---------------------------------------------------------------------------
// Lado do CADASTRO: que tipo é o process_number gravado em lead_processes?
// ---------------------------------------------------------------------------

/**
 * Classifica um process_number cadastrado. Null quando o número não serve de
 * chave (curto demais, vazio). Aqui a máscara decide primeiro; comprimento é
 * só o critério RESIDUAL para número sem máscara nenhuma — e mesmo assim
 * nunca promove nada a CNJ sem 20 dígitos exatos.
 */
export function classificarNumeroCadastrado(
  processNumber: string | null | undefined,
): { tipo: TipoIdentificador; digitos: string } | null {
  const bruto = (processNumber || '').trim();
  if (!bruto) return null;
  const d = soDigitos(bruto);

  if (d.length === 20) return { tipo: 'cnj', digitos: d };
  if (SEI_MASCARA_RE.test(bruto)) return { tipo: 'sei', digitos: d };
  if (DEMANDA_MASCARA_RE.test(bruto)) return { tipo: 'demanda_sit', digitos: d };
  if (OS_MASCARA_RE.test(bruto)) return { tipo: 'ordem_servico', digitos: d };
  // Número liso de 6 a 12 dígitos: protocolo administrativo (INSS/NB). Os de
  // 12 existem no cadastro (297696035235) e ficavam fora do índice antigo.
  if (/^\d{6,12}$/.test(bruto)) return { tipo: 'protocolo_inss', digitos: d };
  // Qualquer outra máscara com dígito suficiente (IC do MPT, número estadual
  // fora de padrão): entra como 'outro' e só casa com 'outro' de dígito igual.
  if (d.length >= 6) return { tipo: 'outro', digitos: d };
  return null;
}

// ---------------------------------------------------------------------------
// Lado do E-MAIL: varredura de identificadores administrativos em texto livre
// ---------------------------------------------------------------------------

/**
 * Âncora a até `janela` caracteres ANTES do início do match ("na mesma frase
 * ou até 40 caracteres antes", regra da tarefa). É a defesa anti-falso-
 * positivo: "3747657-2" solto no rodapé não vira demanda; precisa de
 * "demanda"/"denúncia" por perto. Basta a palavra estar NA JANELA — exigir
 * adjacência quebraria os conectivos reais ("requerimento SEI nº", em que o
 * "nº" tem a letra n).
 */
function ancoraAntes(texto: string, inicio: number, re: RegExp, janela = 40): string | null {
  const trecho = texto.slice(Math.max(0, inicio - janela), inicio);
  const m = trecho.match(re);
  return m ? m[0] : null;
}

const ANCORA_SEI_RE = /\b(?:processo|sei|requeriment\w*|relat[óo]rio|protocolo|procediment\w*)\b/i;
const ANCORA_DEMANDA_RE = /\b(?:demanda|den[úu]ncia)\b/i;
const ANCORA_OS_RE = /ordem\s+de\s+servi[çc]o/i;
const ANCORA_CNJ_SEM_MASCARA_RE = /\b(?:processo|autos)\b/i;

/**
 * Documento avulso do SEI (Despacho_2688783, Solicitação 2678620): NÃO é
 * processo — é peça. Fica registrado como filho do `sei` do mesmo e-mail e
 * nunca casa processo sozinho.
 */
const DOCUMENTO_SEI_RE =
  /\b(despacho|solicita[çc][ãa]o|of[íi]cio|parecer|nota\s+t[ée]cnica|notifica[çc][ãa]o)[_\s]*(?:n[ºo°.]?\s*)?(\d{6,8})\b/gi;

const SEI_G = new RegExp(SEI_MASCARA_RE.source, 'g');
const DEMANDA_G = /\b\d{7}-\d\b/g;
const OS_G = /\b\d{8}-\d\b/g;
const CNJ_SEM_MASCARA_G = /\b\d{20}\b/g;
const MPT_PROCEDIMENTO_G = /\b\d{6}\.\d{4}\.\d{2}\.\d{3}\/\d\b/g;

function coletar(
  texto: string,
  re: RegExp,
  tipo: TipoIdentificador,
  ancoraRe: RegExp | null,
  out: IdentificadorExtraido[],
  filtro?: (valor: string, inicio: number) => boolean,
): void {
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(texto)) !== null) {
    const valor = m[0];
    if (filtro && !filtro(valor, m.index)) continue;
    let ancora: string | null = null;
    if (ancoraRe) {
      ancora = ancoraAntes(texto, m.index, ancoraRe);
      if (!ancora) continue; // sem âncora, número solto: descarta
    }
    out.push({ tipo, valor, valorNormalizado: soDigitos(valor), ancora });
  }
}

/**
 * Varre assunto+corpo atrás de identificadores administrativos tipados.
 * CNJ NÃO sai daqui — o judicial continua no emailPushParser; aqui é a trilha
 * administrativa (SEI/MTE, SIT, MPT, ordem de serviço) e o CNJ sem máscara.
 *
 * O protocolo do INSS também não sai daqui: o inssAdministrativoParser já o
 * extrai com o contexto do e-mail do INSS (status, serviço), e duplicar a
 * captura geraria duas linhas do mesmo fato.
 */
export function extrairIdentificadoresAdministrativos(input: {
  assunto?: string | null;
  corpo?: string | null;
}): IdentificadorExtraido[] {
  // Assunto participa da varredura com âncora: "INFORMAÇÕES RELATÓRIO Nº
  // 13041.200223/2026-88" é como o MTE escreve o número no título.
  const texto = `${input.assunto || ''}\n${(input.corpo || '').replace(/\r\n/g, '\n')}`;
  const out: IdentificadorExtraido[] = [];

  coletar(texto, SEI_G, 'sei', ANCORA_SEI_RE, out);
  coletar(texto, MPT_PROCEDIMENTO_G, 'outro', ANCORA_SEI_RE, out);
  coletar(texto, DEMANDA_G, 'demanda_sit', ANCORA_DEMANDA_RE, out);
  coletar(texto, OS_G, 'ordem_servico', ANCORA_OS_RE, out);
  // CNJ sem máscara: 20 dígitos lisos, DV válido, âncora "processo"/"autos".
  coletar(texto, CNJ_SEM_MASCARA_G, 'cnj', ANCORA_CNJ_SEM_MASCARA_RE, out,
    (valor) => cnjDvValido(valor));

  // Documento filho: só entra se o e-mail tiver um SEI pai — número de
  // despacho sem processo por perto não identifica nada.
  const temSeiPai = out.some((i) => i.tipo === 'sei');
  if (temSeiPai) {
    coletar(texto, DOCUMENTO_SEI_RE, 'documento_sei', null, out);
  }

  // Dedupe por (tipo, dígitos): o mesmo número repetido no reply/forward do
  // e-mail é UMA ocorrência.
  const vistos = new Set<string>();
  return out.filter((i) => {
    const chave = chaveIdentificador(i.tipo, i.valorNormalizado);
    if (vistos.has(chave)) return false;
    vistos.add(chave);
    return true;
  });
}
