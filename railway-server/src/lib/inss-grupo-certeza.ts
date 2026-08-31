// ============================================================================
// O grupo que eu encontrei é MESMO o desse cliente?
//
// Existe porque a mensagem do INSS morria com "lead sem grupo vinculado" mesmo
// quando o grupo estava lá: `resolverGrupoDoLead` só olhava
// `lead_whatsapp_groups`, e 102 dos 623 leads com requerimento INSS não têm
// linha nessa tabela — 23 deles guardam o JID no campo legado
// `leads.whatsapp_group_id` (medido em 31/08/2026). O caso que abriu a
// investigação: PREV 584, indeferimento de salário-maternidade em 31/08, grupo
// vivo com 8 instâncias-membro, e o cliente não soube de nada.
//
// Só que o campo legado não é palavra de honra: 1.190 leads têm as duas fontes,
// 1.185 concordam e 5 divergem (3 dessas por `null`/`PENDING` do lado novo). E
// a memória da casa é ruim aqui — o auto-vínculo por nome do front está
// DESLIGADO desde 31/07/2026 (`useAutoLinkGroupByName`) porque colou grupo de
// outro cliente em 101 leads. Mandar notícia de benefício para o grupo errado é
// vazar dado de cliente e assustar quem não tem nada a ver com aquilo.
//
// Daí a regra desta lib, pedida pelo usuário em 31/08/2026: na dúvida NÃO
// manda. Quem não passa aqui vira aviso na atividade pedindo que uma pessoa
// vincule o grupo ao lead — nunca um palpite entregue ao cliente.
// ============================================================================

import { RUIDO_DE_ROTULO, normalizarNome, tokensDeNome } from './inss-nome-confere';

export interface ConferenciaGrupo {
  ok: boolean;
  /** Frase curta, pronta para o `zap_erro` e para a atividade. */
  motivo: string;
}

/** CNJ, CNJ colado e NUP do INSS — nenhum deles carrega número de caso. */
const FORMATOS_DE_PROCESSO = [
  /\d{7}-?\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/,
  /\d{20}/,
  /\d{5}\.\d{6}\/\d{4}-\d{2}/,
];

/**
 * Código do caso escrito no nome ("✅Prev 584 Josileide/..." → "PREV 584").
 *
 * Mesma família de prefixos do `parseCasoSequencia` do front
 * (`src/lib/casoSequencia.ts`), mais FAMILIA, que aparece em nome de grupo
 * ("✅ FAMÍLIA 331 - JOÃO VICTOR"). Reescrito aqui porque o railway-server não
 * compartilha o bundle do app.
 *
 * Devolve null quando o texto não tem código — e null NUNCA vale como
 * casamento: dois nomes sem código não "batem", ficam sem base.
 */
export function codigoDoCaso(texto?: string | null): string | null {
  const t = normalizarNome(texto).replace(/\s+/g, ' ');
  if (!t) return null;
  if (FORMATOS_DE_PROCESSO.some((re) => re.test(String(texto)))) return null;
  const m = t.match(/\b(PREV|CASO|LEAD|FAMILIA|SM|DG)\b[\s\-|.:#]*(\d{1,5})\b/);
  if (!m) return null;
  const numero = Number(m[2]);
  if (!Number.isFinite(numero) || numero <= 0) return null;
  return `${m[1]} ${numero}`;
}

/**
 * Tokens de nome de gente, sem o ruído de rótulo de funil ("PREV", "BPC"...).
 * Exportado porque o backfill (`scripts/vincular-grupos-inss-certeza.mjs`)
 * procura candidato com a mesma tokenização com que a regra depois julga.
 */
export function nomesDeGente(texto?: string | null): string[] {
  return tokensDeNome(texto).filter((t) => !RUIDO_DE_ROTULO.has(t));
}

/**
 * O grupo é desse lead? Três provas, nesta ordem:
 *
 *  1. Código do caso nos dois nomes: igual aprova, diferente REPROVA na hora
 *     ("PREV 1092" com o grupo "PREV 1174" foi um dos 101 erros de julho).
 *  2. O primeiro nome do segurado do e-mail do INSS precisa aparecer em algum
 *     dos dois nomes — é a única prova que vem de fora do nosso cadastro.
 *  3. Sobrando isso, exige nome de gente em comum entre lead e grupo.
 *
 * Sem nenhuma prova o veredito é reprovar. Grupo sem nome no índice também
 * reprova: não dá para conferir o que não se lê.
 */
export function conferirGrupoDoLead(args: {
  leadName?: string | null;
  groupName?: string | null;
  nomeSegurado?: string | null;
}): ConferenciaGrupo {
  const groupName = (args.groupName || '').trim();
  if (!groupName) return { ok: false, motivo: 'grupo sem nome para conferir' };

  const codLead = codigoDoCaso(args.leadName);
  const codGrupo = codigoDoCaso(groupName);
  if (codLead && codGrupo && codLead !== codGrupo) {
    return {
      ok: false,
      motivo: `o lead é ${codLead} e o grupo é ${codGrupo}`,
    };
  }

  // Código igual encerra: é o identificador que o escritório mesmo dá ao caso, e
  // vale mais que grafia de nome. "CASO 146 SÓ CRISTIANE" tem o grupo de nome
  // idêntico e o INSS escreve "CRISTIANNE" — recusar isso seria calar por causa
  // de um N. Segurado que briga com o LEAD é outro problema (vínculo do
  // protocolo), e o `conferirNomeDoSegurado` já bloqueia antes de chegar aqui.
  if (codLead && codGrupo) return { ok: true, motivo: `código do caso confere (${codLead})` };

  const doLead = new Set(nomesDeGente(args.leadName));
  const doGrupo = new Set(nomesDeGente(groupName));
  const segurado = nomesDeGente(args.nomeSegurado);
  const seguradoNoGrupo = segurado.length >= 2 && doGrupo.has(segurado[0]);
  const seguradoNoLead = segurado.length >= 2 && doLead.has(segurado[0]);
  if (segurado.length >= 2 && !seguradoNoGrupo && !seguradoNoLead) {
    return {
      ok: false,
      motivo: `o INSS diz "${segurado[0]}" e esse nome não aparece nem no lead nem no grupo "${groupName}"`,
    };
  }

  // Segurado batendo com o LEAD não diz nada sobre o grupo — o nome tem que
  // estar no grupo, senão a prova é sobre o cadastro conferindo consigo mesmo.
  if (seguradoNoGrupo) {
    return { ok: true, motivo: `nome do segurado aparece no grupo "${groupName}"` };
  }
  // Prova mais fraca, e por isso a mais exigente: um único nome em comum pode
  // ser só o acolhedor que batiza os dois grupos ("... / Anúncio Edilan"). Vale
  // quando são dois nomes, ou quando o nome em comum é o primeiro de um dos
  // lados — que é o cliente, não quem atendeu.
  const emComum = [...doLead].filter((t) => doGrupo.has(t));
  const listaLead = [...doLead];
  const listaGrupo = [...doGrupo];
  const ehPrincipal = emComum.includes(listaLead[0]) || emComum.includes(listaGrupo[0]);
  if (emComum.length >= 2 || (emComum.length === 1 && ehPrincipal)) {
    return { ok: true, motivo: `nome em comum entre lead e grupo (${emComum.slice(0, 2).join(', ')})` };
  }
  if (emComum.length === 1) {
    return {
      ok: false,
      motivo: `só "${emComum[0]}" liga o lead ao grupo "${groupName}" — pode ser o acolhedor`,
    };
  }
  return { ok: false, motivo: `nada liga o lead ao grupo "${groupName}"` };
}
