// ============================================================================
// Quem fica com a atividade de atualização do INSS.
//
// Regras do usuário (25/08/2026), nesta ordem:
//   1. Lead de matéria TRABALHISTA ("Família 400", "CASO 146") → Felipe.
//      O requerimento do INSS é legítimo — é o mesmo cliente que move ação
//      trabalhista e pediu benefício —, mas quem toca o caso é o responsável
//      trabalhista, não o previdenciário.
//   2. Requerimento recém-protocolado → Luana. É a etapa dela.
//   3. Todo o resto (exigência, análise, conclusão, cancelamento) → José.
//
// POR QUE PELO NOME DO LEAD E NÃO PELO BOARD: o board mente. Das 33 atividades
// em leads do board "Acidente de Trabalho", 19 têm nome dizendo BPC/LOAS/PREV
// — são previdenciárias puras cadastradas no board errado. O rótulo que a
// equipe escreve no nome ("PREV 1800", "Família 400", "CASO 146") é o dado
// confiável. Medido em 25/08/2026.
//
// POR QUE NÃO PELA CAIXA DE E-MAIL: todo evento do INSS chega no adm@
// (inbox#3), inclusive o dos casos de família — 1.046 eventos casados por
// gmail_message_id, nenhum de outra caixa. A caixa não separa matéria.
// ============================================================================

export interface DonoAtividade {
  id: string;
  name: string;
}

/** Previdenciário, exceto protocolo. UUID = profiles.user_id do Externo. */
export const ASSESSOR_INSS: DonoAtividade = {
  id: 'e1849012-7d6b-49b9-a5e5-36a2332e6eb8',
  name: 'Jose Francisco Campos de Oliveira',
};

/** Protocolo do requerimento. */
export const ASSESSOR_PROTOCOLO: DonoAtividade = {
  id: '1589c873-0550-418b-b828-f290e852d5d5',
  name: 'Luana Barros',
};

/** Casos trabalhistas — o mesmo responsável que já recebe prazo e perícia da Justiça do Trabalho. */
export const ASSESSOR_TRABALHISTA: DonoAtividade = {
  id: 'f8862a68-887b-4cd1-bb42-6c3e533bdf1f',
  name: 'Felipe Estefânio Cardoso Lopes de Sousa',
};

/**
 * Rótulo de caso trabalhista no nome do lead.
 *
 * "caso" exige fronteira de palavra dos dois lados para não casar dentro de
 * outra palavra; o acento de "família" é opcional porque a equipe escreve das
 * duas formas ("FAMILIA 301" e "Família 372" convivem no banco).
 */
export function ehLeadTrabalhista(leadName?: string | null): boolean {
  return /fam[íi]lia|(^|[^a-zà-ú])caso([^a-zà-ú]|$)/i.test(leadName || '');
}

/** Requerimento recém-entrado: "[INSS] Requerimento realizado com sucesso". */
export function ehProtocolo(status?: string | null): boolean {
  return /protocolad/i.test(status || '');
}

export function donoDaAtualizacaoInss(args: {
  status?: string | null;
  leadName?: string | null;
}): DonoAtividade {
  if (ehLeadTrabalhista(args.leadName)) return ASSESSOR_TRABALHISTA;
  if (ehProtocolo(args.status)) return ASSESSOR_PROTOCOLO;
  return ASSESSOR_INSS;
}
