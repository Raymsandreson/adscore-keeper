// Como a aba de Métricas recorta o que mostra: por acolhedor e por funil.
//
// Os dois recortes saem de TEXTO da Meta, não de coluna do banco:
//  - acolhedor: do nome do conjunto (`leads.adset_name`). `leads.assigned_to` é
//    nulo nos leads do Externo, então o conjunto é o único vínculo que existe
//    entre um lead pago e a pessoa que o atende — e, medido em 10/09/2026,
//    cobre 3.290 dos 3.291 leads pagos dos últimos 30 dias.
//  - funil: do nome da campanha, que separa BPC-LOAS de [AUXÍLIO-ACIDENTE].
//
// Por isso vivem aqui, puros e com teste: nome de conjunto é escrito à mão por
// quem monta o anúncio, muda de formato sem aviso, e um `includes` solto no meio
// do handler falharia calado — o filtro devolveria zero e pareceria "não teve
// lead" em vez de "não soube ler o nome".

/** Sem acento, caixa alta, separadores viram espaço. "CONJUNTO 4 KAROL — Cópia" → "CONJUNTO 4 KAROL COPIA". */
function normaliza(v: string): string {
  return (v || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

export interface Acolhedor {
  chave: string;
  rotulo: string;
  /** Tokens aceitos no nome do conjunto. KAROL é abreviação de KAROLYNE — há uma só no quadro. */
  tokens: string[];
}

export const ACOLHEDORES: Acolhedor[] = [
  { chave: 'ISRAEL', rotulo: 'Israel', tokens: ['ISRAEL'] },
  { chave: 'MATEUS', rotulo: 'Mateus', tokens: ['MATEUS'] },
  { chave: 'KAROLYNE', rotulo: 'Karolyne', tokens: ['KAROLYNE', 'KAROL'] },
  { chave: 'EDILAN', rotulo: 'Edilan', tokens: ['EDILAN'] },
];

/**
 * De quem é este conjunto. `null` quando o nome não nomeia ninguém — caso de
 * "CONJUNTO 1", "C1" e do erro da Graph API gravado no lugar do nome.
 *
 * Compara TOKEN INTEIRO, não pedaço: `includes('KAROL')` casaria dentro de outra
 * palavra, e o dia em que existir uma "KAROLINA" o número dela entraria calado
 * no recorte da Karolyne.
 */
export function acolhedorDoConjunto(nomeDoConjunto: string | null | undefined): string | null {
  const palavras = new Set(normaliza(String(nomeDoConjunto || '')).split(' '));
  for (const a of ACOLHEDORES) {
    if (a.tokens.some((t) => palavras.has(t))) return a.chave;
  }
  return null;
}

export interface Funil {
  chave: string;
  rotulo: string;
  /** Casa tanto o nome da campanha na Meta quanto o nome do board no CRM. */
  tokens: string[];
}

export const FUNIS: Funil[] = [
  { chave: 'bpc', rotulo: 'BPC - LOAS', tokens: ['BPC', 'LOAS', 'AUTISMO'] },
  { chave: 'auxilio_acidente', rotulo: 'Auxílio Acidente', tokens: ['ACIDENTE'] },
];

/**
 * Qual funil este nome descreve. Serve para os dois lados: campanha da Meta
 * ("BPC-LOAS", "[AUXÍLIO-ACIDENTE]") e board do CRM ("BPC - Autismo",
 * "Auxílio Acidente"). É o que permite cruzar gasto com lead no mesmo recorte.
 */
export function funilDoNome(nome: string | null | undefined): string | null {
  const palavras = new Set(normaliza(String(nome || '')).split(' '));
  for (const f of FUNIS) {
    if (f.tokens.some((t) => palavras.has(t))) return f.chave;
  }
  return null;
}
