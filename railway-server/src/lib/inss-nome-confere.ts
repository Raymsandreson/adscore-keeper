// Confere se o segurado do e-mail do INSS é mesmo a pessoa daquele lead.
//
// Por que existe: o vínculo protocolo→lead é feito por robô, e o matcher casa
// por nome. Em 27/08/2026, varrendo os 687 protocolos já vinculados, 6 estavam
// no lead de OUTRA pessoa — o processo da ESTER pendurado no lead da ANA FLÁVIA,
// o da VALENTINA ARAUJO FRANCA numa notícia sobre "Valentina Francavilla".
// Enquanto o e-mail só virava atividade interna isso era sujeira; desde que a
// atualização virou mensagem no grupo do cliente, virou risco de mandar o
// processo de um cliente para o grupo de outro.
//
// Módulo puro de propósito: o vitest da raiz só importa o que não toca banco.

export type VereditoNome = 'ok' | 'sem_base' | 'conflito';

export interface ConferenciaNome {
  veredito: VereditoNome;
  /** Frase curta, pronta para ir na atividade e no `zap_erro`. */
  motivo: string;
  /** Qual campo decidiu — ajuda a depurar sem reabrir o banco. */
  fonte: 'victim_name' | 'rotulos' | 'nenhuma';
}

const STOPWORDS = new Set([
  'DA', 'DE', 'DO', 'DAS', 'DOS', 'E', 'DI', 'DU',
  'JR', 'JUNIOR', 'NETO', 'NETA', 'FILHO', 'FILHA', 'SOBRINHO',
]);

/**
 * Palavras que aparecem no rótulo do funil e no nome do grupo mas não são
 * nome de gente. Sem essa lista, "✅PREV 1144 - ( ) Acd- -" pareceria um nome
 * que contradiz o segurado — quando na verdade ali não há nome nenhum.
 */
export const RUIDO_DE_ROTULO = new Set([
  'PREV', 'LEAD', 'CASO', 'FAMILIA', 'GRUPO', 'CLIENTE', 'INSS', 'ADV', 'DRA',
  'BPC', 'LOAS', 'ANUNCIO', 'AUX', 'AUXILIO', 'MATERNIDADE', 'ACIDENTE', 'ACD',
  'PROCESSUAL', 'MANUAL', 'ATENDIMENTO', 'WHATSAPP', 'PENSAO', 'APOSENTADORIA',
  'SALARIO', 'RURAL', 'INVALIDEZ', 'DOENCA', 'INCAPACIDADE', 'OBITO', 'REVISAO',
  'MORTE', 'SEGURO', 'DEFESA', 'RECURSO', 'PERICIA', 'ANALISE', 'NOVO', 'NOVA',
]);

export function normalizarNome(s: string | null | undefined): string {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Tokens que valem como nome: 3+ letras, sem preposição e sem dígito. */
export function tokensDeNome(s: string | null | undefined): string[] {
  return normalizarNome(s)
    .split(' ')
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t) && !/\d/.test(t));
}

const contido = (a: string[], b: Set<string>) => a.length > 0 && a.every((t) => b.has(t));

/**
 * `victim_name` com dois ou mais tokens é nome estruturado e vale como
 * confronto: ou um nome contém o outro, ou são pessoas diferentes. Rótulo de
 * funil e nome de grupo carregam só o primeiro nome ("PREV 1404 Naira - Ellena"),
 * então ali a exigência é o primeiro nome do segurado aparecer inteiro.
 */
export function conferirNomeDoSegurado(
  nomeSegurado: string | null | undefined,
  alvo: { victimName?: string | null; leadName?: string | null; groupName?: string | null },
): ConferenciaNome {
  const segurado = tokensDeNome(nomeSegurado);
  if (segurado.length < 2) {
    return { veredito: 'sem_base', motivo: 'e-mail do INSS sem nome utilizável', fonte: 'nenhuma' };
  }

  const victim = tokensDeNome(alvo.victimName);
  if (victim.length >= 2) {
    const setVictim = new Set(victim);
    const setSegurado = new Set(segurado);
    if (contido(segurado, setVictim) || contido(victim, setSegurado)) {
      return { veredito: 'ok', motivo: 'nome do segurado bate com o beneficiário do lead', fonte: 'victim_name' };
    }
    return {
      veredito: 'conflito',
      motivo: `o INSS diz "${normalizarNome(nomeSegurado)}" e o lead está em nome de "${normalizarNome(alvo.victimName)}"`,
      fonte: 'victim_name',
    };
  }

  // Sem nome estruturado: sobra o que estiver escrito nos rótulos.
  const rotulos = new Set(
    [alvo.victimName, alvo.leadName, alvo.groupName]
      .flatMap((s) => tokensDeNome(s))
      .filter((t) => !RUIDO_DE_ROTULO.has(t)),
  );
  if (rotulos.size === 0) {
    return { veredito: 'sem_base', motivo: 'lead sem nome para conferir', fonte: 'nenhuma' };
  }
  if (rotulos.has(segurado[0])) {
    return { veredito: 'ok', motivo: 'primeiro nome do segurado aparece no lead', fonte: 'rotulos' };
  }
  return {
    veredito: 'conflito',
    motivo: `"${segurado[0]}" não aparece em nenhum nome do lead (${[...rotulos].slice(0, 4).join(', ')})`,
    fonte: 'rotulos',
  };
}
