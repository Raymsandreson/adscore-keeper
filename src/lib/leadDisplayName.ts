// Um rótulo de lead nem sempre é o nome de alguém.
//
// A receita de nome dos funis (board_group_settings.lead_fields) intercala
// literais de texto com campos do lead. Os literais entram sempre; os campos só
// quando têm valor. Quando o cadastro está vazio, sobra a pontuação sozinha e
// nasce coisa como "PREV 1512 - ( ) Acd- -" ou "LEAD314". Medido em 04/09/2026:
// 5.066 dos 19.419 leads vivos (26%) não têm nome de pessoa no lead_name.
//
// Este arquivo tem UM par de funções: reconhecer se um rótulo carrega nome de
// gente, e escolher o que a tela mostra. Ele não corrige nada e não escreve no
// banco — quem resolve o nome é a cascata determinística do resolve-client-names,
// que grava em client_name_resolved.
//
// Gêmeo no backend: railway-server/src/lib/lead-nome-pessoa.ts. As duas listas
// precisam andar juntas — o front usa pra barrar a digitação, o backend pra
// barrar a gravação. Se divergirem, a tela aceita o que o servidor recusa.

/**
 * Palavras que aparecem em rótulo de dossiê e não são nome de pessoa.
 * Só entram termos de processo/produto e siglas de UF: nome próprio de
 * acolhedor NÃO entra aqui (a lista viraria manutenção eterna, e o
 * desempate de acolhedor é problema da fila de conferência, não daqui).
 */
const PALAVRAS_DE_DOSSIE = new Set([
  'PREV', 'LEAD', 'CASO', 'BPC', 'LOAS', 'ANUNCIO', 'AUX', 'AUXILIO', 'ACD',
  'MATERNIDADE', 'ACIDENTE', 'TRABALHO', 'PROCESSUAL', 'MANUAL', 'ATENDIMENTO',
  'WHATSAPP', 'PENSAO', 'APOSENTADORIA', 'SALARIO', 'RURAL', 'URBANO',
  'INVALIDEZ', 'DOENCA', 'INCAPACIDADE', 'OBITO', 'REVISAO', 'MORTE', 'SEGURO',
  'DEFESA', 'RECURSO', 'PERICIA', 'ANALISE', 'ADMINISTRATIVO', 'JUDICIAL',
  'AUTISMO', 'POP', 'NAO', 'INFORMADO', 'SEM', 'NOME', 'BAIRRO', 'PARTO',
  'ACOLHEDOR', 'NOVO', 'NOVA', 'TESTE',
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG',
  'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
]);

const semAcento = (s: string) =>
  String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * Sobra do rótulo depois de tirar tudo que é código de dossiê: o ✅ da frente,
 * os pares "PREV 1512"/"LEAD314"/"Caso 98", pontuação e as palavras de produto.
 * O que restar são candidatos a nome de gente.
 */
export function tokensDeNome(rotulo: string): string[] {
  return semAcento(rotulo)
    .toUpperCase()
    // "PREV 1512", "LEAD314", "Caso 98", "PREV-1512", "LEAD | 301"
    .replace(/\b(PREV|LEAD|CASO)\s*[-_|:.]?\s*\d+/g, ' ')
    .replace(/[^A-Z\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !PALAVRAS_DE_DOSSIE.has(t));
}

/**
 * O rótulo carrega nome de pessoa? Basta um token de 3+ letras que não seja
 * palavra de dossiê. É de propósito frouxo: a função existe pra separar
 * "LEAD314" de "LEAD314 | Willian Rodrigues", não pra validar nome civil.
 */
export function temNomeDePessoa(rotulo: string | null | undefined): boolean {
  return tokensDeNome(String(rotulo || '')).length > 0;
}

/** Inverso de temNomeDePessoa, para leitura mais direta em validação. */
export function ehSoCodigoDeDossie(rotulo: string | null | undefined): boolean {
  return String(rotulo || '').trim() !== '' && !temNomeDePessoa(rotulo);
}

export type LeadComNome = {
  lead_name?: string | null;
  client_name_resolved?: string | null;
  client_name_source?: string | null;
};

export type RotuloDeLead = {
  /** O que a tela mostra como título. */
  titulo: string;
  /** O rótulo original, quando ele foi rebaixado a código. Nunca some da tela. */
  codigo: string | null;
  /** De onde veio o nome resolvido (procuracao, contato, titulo_grupo, inss). */
  fonte: string | null;
};

/**
 * Decide o que a tela mostra. Regra: o lead_name manda sempre que carrega nome
 * de gente. Só quando ele é código puro é que o nome resolvido assume o título
 * — e ainda assim o código continua exposto ao lado, nunca escondido.
 */
export function displayLeadName(lead: LeadComNome | null | undefined): RotuloDeLead {
  const rotulo = String(lead?.lead_name || '').trim();
  const resolvido = String(lead?.client_name_resolved || '').trim();
  if (!rotulo) return { titulo: resolvido || '', codigo: null, fonte: resolvido ? lead?.client_name_source || null : null };
  if (temNomeDePessoa(rotulo) || !resolvido) return { titulo: rotulo, codigo: null, fonte: null };
  return { titulo: resolvido, codigo: rotulo, fonte: lead?.client_name_source || null };
}
