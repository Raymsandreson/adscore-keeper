// =============================================================================
// Push do INSS por e-mail → movimentação do processo ADMINISTRATIVO.
//
// POR QUE EXISTE (20/08/2026):
//   A inbox#3 já trazia 1.118 e-mails do noreply@inss.gov.br para
//   processual_emails, e nenhum deles virava linha no sino: o sync-email-push
//   casa e-mail com processo pelo CNJ, e requerimento administrativo não tem
//   CNJ — dos 1.273 processos administrativos cadastrados, 938 não têm número
//   nenhum e só 56 têm CNJ. O feed tinha 12 linhas administrativas, todas do
//   Escavador. O escritório recebia o aviso de exigência e ele morria na caixa.
//
//   O que o INSS manda é estruturado e curto, então não precisa de adivinhação:
//     - "[INSS] O status do requerimento 812040787 foi alterado para Concluída"
//       (289 e-mails; Exigência 256, Em Análise 81, Cancelada 45, Pendente 35)
//     - "[INSS] Requerimento realizado com sucesso" (382), com o número no
//       corpo: "Protocolo : 1358796571 / Serviço : BENEFÍCIO ASSISTENCIAL..."
//
//   Medido em 20/08/2026: 1.088 dos 1.118 e-mails têm número, e 460 casam com
//   process_number de processo cadastrado.
//
// A CATEGORIA VEM DO STATUS, não de palavra-chave. O classificador por palavra
// é para texto de tribunal, que é prosa; aqui o status vem no assunto, em campo
// próprio. Adivinhar o que já está escrito é como se anunciou "Decisão de
// mérito" em cima de uma conclusão para julgamento.
// =============================================================================

import type { UpdateCategoria } from './processUpdateClassifier.ts';

export interface MovimentacaoAdministrativa {
  /** Protocolo/requerimento, só dígitos — é a chave que casa com o processo. */
  protocolo: string;
  /** ISO (YYYY-MM-DD). Null quando o corpo não traz data; o chamador usa a do e-mail. */
  data: string | null;
  categoria: UpdateCategoria;
  titulo: string;
  texto: string;
}

const STATUS_RE = /status\s+do\s+requerimento\s+(\d{6,11})\s+foi\s+alterado\s+para\s+([^.\n\r<|]{3,40})/i;
const PROTOCOLO_RE = /Protocolo\s*:?\s*(\d{6,11})/i;
const SERVICO_RE = /Servi[çc]o\s*:?\s*([^\n\r]{3,120}?)\s*(?:Data do Protocolo|Unidade|$)/i;
const DATA_PROTOCOLO_RE = /Data do Protocolo\s*:?\s*(\d{2})\/(\d{2})\/(\d{4})/i;

/**
 * Status → categoria do feed.
 *
 * "Exigência" é prazo porque é o único que cobra ato do escritório — é o que
 * não pode passar batido. "Concluída" é a decisão do requerimento (deferido ou
 * indeferido), que é o mérito na esfera administrativa. O resto é andamento:
 * "Em Análise" e "Pendente" não pedem nada de ninguém, e anunciá-los como
 * decisão treinaria a equipe a ignorar o badge.
 */
function categoriaDoStatus(status: string): UpdateCategoria {
  // Sem normalizar acento de propósito: são dois prefixos, e "Exigênc"/"Conclu"
  // já separam os cinco status que o INSS manda.
  const s = status.trim().toLowerCase();
  if (s.startsWith('exig')) return 'prazo';
  if (s.startsWith('conclu')) return 'decisao_merito';
  return 'movimentacao';
}

function limpaStatus(s: string): string {
  return s.replace(/\s+/g, ' ').trim().replace(/[.,;:]+$/, '');
}

/**
 * Extrai a movimentação administrativa do e-mail do INSS. Devolve lista vazia
 * quando não é um dos formatos conhecidos — e-mail de agendamento, convocação
 * de perícia por servidor, etc. cai fora e segue só em processual_emails.
 */
export function parseEmailAdministrativo(input: {
  assunto?: string | null;
  corpo?: string | null;
  dataEmail?: string | null;
}): MovimentacaoAdministrativa[] {
  const assunto = (input.assunto || '').replace(/\s+/g, ' ');
  const corpo = (input.corpo || '').replace(/\r\n/g, '\n');
  const teto = (input.dataEmail || '').slice(0, 10) || null;

  const mudanca = assunto.match(STATUS_RE) || corpo.match(STATUS_RE);
  if (mudanca) {
    const status = limpaStatus(mudanca[2]);
    return [{
      protocolo: mudanca[1],
      data: teto,
      categoria: categoriaDoStatus(status),
      titulo: `Requerimento ${mudanca[1]} — ${status}`,
      texto: `Status do requerimento ${mudanca[1]} alterado para ${status} (INSS)`,
    }];
  }

  // "Requerimento realizado com sucesso": o número está no corpo, não no assunto.
  const prot = corpo.match(PROTOCOLO_RE);
  if (prot && /requerimento\s+realizado/i.test(`${assunto} ${corpo}`)) {
    const servico = corpo.match(SERVICO_RE)?.[1]?.replace(/\s+/g, ' ').trim() || null;
    const dp = corpo.match(DATA_PROTOCOLO_RE);
    // A data do protocolo é a do fato; a do e-mail é quando soubemos. Elas
    // batem nesses avisos, mas quando não baterem vale o fato — e nunca uma
    // data acima do e-mail, que seria notícia antes de acontecer.
    const doProtocolo = dp ? `${dp[3]}-${dp[2]}-${dp[1]}` : null;
    const data = doProtocolo && (!teto || doProtocolo <= teto) ? doProtocolo : teto;
    return [{
      protocolo: prot[1],
      data,
      categoria: 'movimentacao',
      titulo: `Requerimento ${prot[1]} protocolado${servico ? ` — ${servico}` : ''}`,
      texto: `Requerimento protocolado no INSS sob o número ${prot[1]}${servico ? `. Serviço: ${servico}` : ''}`,
    }];
  }

  return [];
}
