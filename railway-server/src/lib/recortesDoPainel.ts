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
  /**
   * Grupos de tokens. A linha casa quando CADA grupo tem ao menos um token
   * presente — ou seja: "ou" dentro do grupo, "e" entre grupos.
   *
   * Nao e sofisticacao gratuita. Com uma lista simples de tokens, `ACIDENTE`
   * casava "Acidente de Trabalho" — que e TRABALHISTA, outro negocio, com outra
   * equipe. Medido em 14/09/2026: filtrar a aba por "Auxilio Acidente" devolvia
   * 3.224 leads do board de Acidente de Trabalho contra 544 do funil de verdade.
   * 86% do recorte era o funil errado.
   *
   * Exigir AUXILIO (ou AUX) junto de ACIDENTE separa os dois sem lista negra:
   * "Acidente de Trabalho", "[SEGURO ACIDENTE DE TRANSITO]" e
   * "[ANALYNE][ACD. DE TRABALHO]" deixam de casar, e as campanhas reais
   * ("[AUXILIO-ACIDENTE]", "AUXILIO - ACIDENTE [EDILAN]") continuam casando.
   */
  grupos: string[][];
}

/**
 * Os funis do PREVIDENCIARIO. Sao os unicos que a aba de Metricas cobre hoje.
 *
 * Trabalhista tem estrutura de lead diferente, acolhedores diferentes e nao vem
 * de formulario de anuncio (0 leads pagos no board de Acidente de Trabalho) —
 * misturar os dois num painel so produz numero que nao significa nada para
 * nenhuma das duas equipes.
 */
export const FUNIS: Funil[] = [
  { chave: 'bpc', rotulo: 'BPC - LOAS', grupos: [['BPC', 'LOAS', 'AUTISMO']] },
  { chave: 'auxilio_acidente', rotulo: 'Auxílio Acidente', grupos: [['ACIDENTE'], ['AUXILIO', 'AUX']] },
];

/**
 * Qual funil do PREV este nome descreve. Serve para os dois lados: campanha da
 * Meta ("BPC-LOAS", "[AUXILIO-ACIDENTE]") e board do CRM ("BPC - Autismo",
 * "Auxilio Acidente"). E o que permite cruzar gasto com lead no mesmo recorte.
 *
 * `null` para tudo que nao e PREV — Trabalhista, venda de curso, seguro.
 */
export function funilDoNome(nome: string | null | undefined): string | null {
  const palavras = new Set(normaliza(String(nome || '')).split(' '));
  for (const f of FUNIS) {
    if (f.grupos.every((grupo) => grupo.some((t) => palavras.has(t)))) return f.chave;
  }
  return null;
}

/** `true` quando o nome (board ou campanha) pertence ao PREV. */
export function ehPrev(nome: string | null | undefined): boolean {
  return funilDoNome(nome) !== null;
}
/**
 * Board que CAPTA lead — é o universo que esta aba mede.
 *
 * Casar o nome de um funil não basta. Dois tipos de board passavam pelo
 * `funilDoNome` e não deviam contar:
 *
 *  - **desativado / descontinuado / antigo**: não recebe lead novo, e só polui o
 *    rótulo do escopo na tela ("BPC JUDICIAL (desativado — unificado no POP
 *    BPC)").
 *
 *  - **POP**: é o fluxo do processo DEPOIS que o caso existe, não a porta de
 *    entrada. "POP - BPC (Administrativo e Judicial)" casa `BPC` e entrava no
 *    escopo. Medido em 15/09/2026: 174 leads no board e **zero** com id da Meta
 *    ou origem de planilha — os 10 da janela vieram todos de `whatsapp`. Contá-los
 *    inflava o total orgânico e fazia o cabeçalho anunciar um POP como se fosse
 *    funil de captação.
 *
 * Como o corte é pelo PREFIXO, board novo de POP sai sozinho e nenhum funil de
 * captação é atingido: nenhum dos 27 boards do Externo começa com "POP" sem ser
 * um POP.
 */
export function ehBoardDeCaptacao(nome: string | null | undefined): boolean {
  const n = String(nome || '');
  if (/desativad|descontinuad|\bantig/i.test(n)) return false;
  if (/^\s*POP\b/i.test(n)) return false;
  return true;
}
