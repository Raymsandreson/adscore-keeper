// Ranking das sugestões de vínculo de um protocolo do INSS a um lead/caso.
//
// POR QUE PRECISA DE RANKING: o e-mail do INSS identifica pelo BENEFICIÁRIO
// ("BERNARDO ...") e a base identifica pelo rótulo do funil e pelo responsável
// ("PREV 1630 - EVELYN/BERNARDO"). Medição de 26/08/2026 sobre os 304 protocolos
// órfãos: exigindo nome + sobrenome, 220 não têm candidato NENHUM em lugar
// nenhum (leads, contatos, grupos); aceitando só o primeiro nome, 264 têm
// candidato mas 230 batem em vários leads ao mesmo tempo ("Maria", "José").
//
// Nenhum dos dois extremos serve sozinho: o rigoroso devolve lista vazia e a
// pessoa desiste; o frouxo devolve 30 nomes iguais e a pessoa também desiste.
// A saída é aceitar a pista fraca E ordenar por desempate, deixando explícito
// que é palpite — quem decide é gente.

export type PistaVinculo =
  | 'requerimento'
  | 'cpf'
  | 'nome_forte'
  | 'nome_fraco';

/** Peso da pista. Requerimento e CPF são chave; nome é indício. */
const PESO_PISTA: Record<PistaVinculo, number> = {
  requerimento: 1000,
  cpf: 900,
  nome_forte: 500,
  nome_fraco: 100,
};

export type FamiliaBeneficio =
  | 'bpc'
  | 'aux_acidente'
  | 'aux_doenca'
  | 'aposentadoria'
  | 'pensao'
  | 'maternidade';

/**
 * Família do benefício a partir de texto solto — serve tanto para o
 * `benefit_type` do protocolo (recorte sujo do e-mail) quanto para o nome do
 * lead, onde a equipe escreve "(BPC/LOAS)", "AUX. ACIDENTE", "SM".
 */
export function familiaBeneficio(texto?: string | null): FamiliaBeneficio | null {
  const t = (texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  if (!t.trim()) return null;
  if (/\bBPC\b|\bLOAS\b|ASSISTENCIAL/.test(t)) return 'bpc';
  if (/AUX.{0,6}ACIDENTE|\bACD\b/.test(t)) return 'aux_acidente';
  if (/AUX.{0,6}DOENC|INCAPACIDADE/.test(t)) return 'aux_doenca';
  if (/APOSENTADORIA/.test(t)) return 'aposentadoria';
  if (/PENSAO POR MORTE|\bPENSAO\b/.test(t)) return 'pensao';
  if (/MATERNIDADE|\bSM\b/.test(t)) return 'maternidade';
  return null;
}

export interface EntradaScore {
  pista: PistaVinculo;
  /** `benefit_type` do protocolo. */
  beneficioProtocolo?: string | null;
  /** Nome do lead / título do caso — onde a equipe escreve o benefício. */
  beneficioCandidato?: string | null;
  /** `protocol_date` do requerimento (ISO). */
  dataProtocolo?: string | null;
  /** `created_at` do lead (ISO). */
  dataLead?: string | null;
  /** Lead já tem caso aberto: um pouco mais provável de ser o certo. */
  temCaso?: boolean;
}

export interface ResultadoScore {
  score: number;
  /** Motivos do desempate, para a pessoa ver por que a linha subiu. */
  motivos: string[];
}

const DIA = 24 * 60 * 60 * 1000;

/**
 * Nota da sugestão. A pista manda; os desempates só reordenam dentro dela —
 * um nome fraco nunca passa na frente de um CPF por causa de bônus.
 */
export function pontuarSugestao(e: EntradaScore): ResultadoScore {
  let score = PESO_PISTA[e.pista] ?? 0;
  const motivos: string[] = [];

  const fam = familiaBeneficio(e.beneficioProtocolo);
  const famCand = familiaBeneficio(e.beneficioCandidato);
  if (fam && famCand) {
    if (fam === famCand) { score += 40; motivos.push('mesmo benefício'); }
    else { score -= 60; motivos.push('benefício diferente'); }
  }

  if (e.dataProtocolo && e.dataLead) {
    const dias = Math.abs(Date.parse(e.dataProtocolo) - Date.parse(e.dataLead)) / DIA;
    if (Number.isFinite(dias)) {
      if (dias <= 60) { score += 30; motivos.push('lead entrou perto do protocolo'); }
      else if (dias <= 180) { score += 12; }
      else if (dias > 730) { score -= 25; motivos.push('lead é de outra época'); }
    }
  }

  if (e.temCaso) score += 10;

  return { score, motivos };
}
