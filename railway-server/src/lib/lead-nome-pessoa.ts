// Gêmeo de src/lib/leadDisplayName.ts. Ver o cabeçalho de lá para o porquê.
//
// O front usa a regra pra barrar a digitação; aqui ela barra a gravação. Duas
// cópias porque o tsconfig do railway tem rootDir ./src e não alcança o front —
// mesma situação da LEGENDA_PROCURACAO. Se as listas divergirem, a tela aceita
// o que o servidor recusa, então mexer numa é mexer na outra.

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

export function tokensDeNome(rotulo: string): string[] {
  return semAcento(rotulo)
    .toUpperCase()
    .replace(/\b(PREV|LEAD|CASO)\s*[-_|:.]?\s*\d+/g, ' ')
    .replace(/[^A-Z\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !PALAVRAS_DE_DOSSIE.has(t));
}

export function temNomeDePessoa(rotulo: string | null | undefined): boolean {
  return tokensDeNome(String(rotulo || '')).length > 0;
}

export function ehSoCodigoDeDossie(rotulo: string | null | undefined): boolean {
  return String(rotulo || '').trim() !== '' && !temNomeDePessoa(rotulo);
}

/**
 * Campos da receita (board_group_settings.lead_fields) que nomeiam o CLIENTE.
 * `acolhedor` está fora de propósito: ele nomeia a funcionária, e foi
 * exatamente por ele entrar no lugar do cliente que nasceram os 141 leads
 * "PREV 1409 ... Acd- Mateus Santos Saraiva" — o rótulo tem nome de gente, só
 * que da pessoa errada.
 */
export const CAMPOS_DE_PESSOA = new Set([
  'lead_name',
  'lead_name_upper',
  'victim_name',
  'victim_name_upper',
  'client_name',
]);
