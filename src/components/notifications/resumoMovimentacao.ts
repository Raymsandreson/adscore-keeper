// =============================================================================
// O que escrever na linha de baixo do card do sino.
//
// `process_updates.descricao` vem de duas naturezas misturadas, e o card tratava
// as duas igual — cinza claro, embaixo do CNJ, cortado em duas linhas:
//
//   1. teor de verdade, do tribunal: "Distribuído por sorteio", "Proferido
//      despacho de mero expediente", "Intimação | Intimação (RESTRITO)".
//   2. ruído do aviso por e-mail: "[TRT15] [PUSH] Atualizações de Informações
//      Processuais do Processo 0011351-63.2022.5.15.0031" — que repete o número
//      já impresso duas linhas acima e não diz nada do que aconteceu.
//
// Medido em 12/08/2026 sobre os 30 dias anteriores: 327 linhas com teor (67%)
// contra 161 de ruído (33%). Ou seja, o assunto existe na maioria — só estava
// com o mesmo peso visual do lixo.
//
// Então: teor vira assunto em destaque; ruído vira uma linha curta de origem,
// discreta. O que NÃO se faz aqui é inventar assunto quando não há: o teor real
// dessas linhas não está no banco (o DataJud, que teria o texto TPU, estava 9
// dias atrasado e não cobria nenhuma das 73 atualizações da semana).
// =============================================================================

const CNJ = /\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/g;

/** Prefixo de caixa de entrada: "[TRT15] [PUSH] ...", "[TST] [PUSH] ..." */
const PREFIXO_TRIBUNAL = /^\s*\[([^\]]+)\]/;

/** "TRT02" e "TRT2" são o mesmo tribunal — sem isso a origem apareceria dobrada. */
function normalizarTribunal(sigla: string): string {
  const s = sigla.trim().toUpperCase();
  const m = s.match(/^([A-Z]+)0*(\d+)$/);
  return m ? `${m[1]}${m[2]}` : s;
}

function ehRuido(d: string): boolean {
  const semCnj = d.replace(CNJ, '').trim();
  // Sobrou só pontuação depois de tirar o número: a descrição ERA o número.
  if (!semCnj || /^[\s\-–—.:|]*$/.test(semCnj)) return true;
  return /movimenta(ç|c)(ã|a)o processual do processo/i.test(d)
    || /atualiza(ç|c)(õ|o)es de informa(ç|c)(õ|o)es processuais do processo/i.test(d)
    || /^movimenta(ç|c)(õ|o)es processuais\s*-\s*/i.test(d);
}

/**
 * De onde veio o aviso, quando não há teor. Curto de propósito: é rodapé do
 * card, não informação principal.
 */
function origemDoRuido(d: string): string {
  const tribunal = d.match(PREFIXO_TRIBUNAL)?.[1];
  // "[Push]" também é colchete no começo, mas é rótulo de origem, não tribunal —
  // sem esta guarda a linha saía "aviso por e-mail · PUSH".
  if (tribunal && !/^push$/i.test(tribunal.trim())) {
    return `aviso por e-mail · ${normalizarTribunal(tribunal)}`;
  }
  // "Movimentações Processuais - EPROC Seção Judiciária do Paraná"
  const sistema = d.match(/^movimenta(?:ç|c)(?:õ|o)es processuais\s*-\s*(.+)$/i)?.[1];
  if (sistema) return `aviso por e-mail · ${sistema.trim()}`;
  if (/^\s*\[push\]/i.test(d)) return 'aviso por e-mail';
  return 'sem detalhe do tribunal';
}

/**
 * Limpa o teor: tira o CNJ repetido, colapsa as repetições do separador `|`
 * ("Intimação | Intimação (RESTRITO)" → "Intimação (RESTRITO)") e junta o que
 * sobrou com `·`.
 */
function limparAssunto(d: string): string {
  const partes = d
    .replace(CNJ, '')
    .split('|')
    .map((p) => p.trim().replace(/\s+/g, ' ').replace(/[\s.·-]+$/, ''))
    .filter(Boolean);

  const mantidas: string[] = [];
  for (const parte of partes) {
    const i = mantidas.findIndex((m) => {
      const a = m.toLowerCase();
      const b = parte.toLowerCase();
      return a === b || a.startsWith(b) || b.startsWith(a);
    });
    // Entre duas que se contêm, fica a mais específica: "Intimação (RESTRITO)"
    // diz mais que "Intimação".
    if (i >= 0) { if (parte.length > mantidas[i].length) mantidas[i] = parte; } else mantidas.push(parte);
  }
  return mantidas.join(' · ');
}

export interface ResumoMovimentacao {
  /** O que aconteceu, quando o tribunal disse. Vai em destaque no card. */
  assunto: string | null;
  /** De onde veio o aviso. Só quando não há assunto — é o consolo, não o dado. */
  origem: string | null;
}

export function resumoMovimentacao(descricao: string | null | undefined): ResumoMovimentacao {
  const d = (descricao || '').trim();
  if (!d) return { assunto: null, origem: null };
  if (ehRuido(d)) return { assunto: null, origem: origemDoRuido(d) };
  const assunto = limparAssunto(d);
  return assunto ? { assunto, origem: null } : { assunto: null, origem: 'sem detalhe do tribunal' };
}
