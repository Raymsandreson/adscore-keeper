/**
 * O cronograma da peça vira PARCELAS — uma linha por vencimento.
 *
 * A leitura (`jm_documento_leitura.cronograma`) devolve o plano de pagamento que
 * a peça FIXA: "11 parcelas de R$ 56.818,18, todo dia 10". Isso é promessa, não
 * pagamento. Para virar carteira precisa descer ao grão que o Raym descreveu em
 * 20/08/2026: **um lançamento para cada mês que for receber, por parte** — 10
 * parcelas × 3 partes = 30 linhas, cada uma com sua data de vencimento.
 *
 * Até aqui a coluna era escrita e ninguém a lia. Conferido no Externo em
 * 24/08/2026: das 21 leituras com os campos novos, ZERO trouxe cronograma, e
 * nenhum ponto do sistema consulta a coluna.
 *
 * ── A armadilha: explodir duas vezes
 *
 *    A peça pode nomear o beneficiário de cada parcela ("R$ 10.000 a João em
 *    10/09") ou falar global ("11 parcelas de R$ 56.818,18"). Se o cronograma
 *    JÁ vem por parte e ainda assim multiplicarmos pelas partes, o processo
 *    triplica. É exatamente o erro que aconteceu com o honorário em 21/08, e a
 *    razão de a decisão ser tomada item a item aqui, e não em bloco.
 *
 * ── A ambiguidade que NÃO se resolve por conta própria
 *
 *    Cronograma global + várias partes tem duas leituras honestas: R$ 10.000
 *    para CADA uma (o total é 30 mil) ou R$ 10.000 DIVIDIDO entre elas (o total
 *    é 10 mil). A peça não diz, e chutar erra por 3x para um lado ou para o
 *    outro. O prompt do `jm-ler-peca` já se recusa a dividir sozinho (regra 9:
 *    "Não divida por igual entre as partes por conta própria") — aqui a recusa
 *    continua: sem `rateio` explícito sai UMA linha por parcela, sem parte,
 *    marcada `precisaRateio`. É o que a peça literalmente diz.
 */

export interface ParcelaLida {
  nParcela?: number | null;
  dataPrevista?: string | null;
  valor?: number | null;
  /** Nome da parte, ou null quando a peça fala do total sem abrir por quem. */
  beneficiario?: string | null;
}

/**
 * Como distribuir uma parcela global entre as partes. Só o humano decide:
 * `POR_PARTE` cada parte recebe o valor CHEIO; `DIVIDIR` o valor é rateado.
 */
export type Rateio = 'POR_PARTE' | 'DIVIDIR';

export interface ParcelaExpandida {
  nParcela: number;
  /** AAAA-MM-DD. null = a peça fixou o valor mas não a data. */
  dataPrevista: string | null;
  valor: number;
  parteNome: string | null;
  /** true = há partes candidatas e ninguém disse de quem é. Não entra em total. */
  precisaRateio: boolean;
  /** Índice no cronograma de origem, para desfazer sem adivinhação. */
  origemIndice: number;
}

export interface ExpansaoCronograma {
  parcelas: ParcelaExpandida[];
  /** Soma de tudo que saiu, inclusive o que precisa de rateio. */
  total: number;
  /** Soma só do que já tem dono — o que pode virar total sem mentir. */
  totalAtribuido: number;
  rateio: Rateio | null;
  /** O que ficou torto na peça. Tela mostra; não se esconde defeito de origem. */
  avisos: string[];
}

const semAcento = (v: string) =>
  v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

/** Centavos. O `+ 0` mata o zero NEGATIVO, que a tela mostraria como "-R$ 0,00". */
const arred = (n: number) => Math.round(n * 100) / 100 + 0;

const ehDataISO = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

/**
 * Casa o beneficiário lido com a lista de partes. Exato normalizado primeiro;
 * só depois "um contém o outro", e SÓ quando o palpite é único — decisão em
 * 24/08/2026 depois de ver "MARIA" bater em duas partes na mesma ação. Ambíguo
 * devolve o nome cru: errar de quem é o dinheiro é pior que não saber.
 */
export function casarParte(beneficiario: string, partes: string[]): string {
  const alvo = semAcento(beneficiario);
  const exato = partes.find((p) => semAcento(p) === alvo);
  if (exato) return exato;
  const contem = partes.filter((p) => {
    const n = semAcento(p);
    return n.includes(alvo) || alvo.includes(n);
  });
  return contem.length === 1 ? contem[0] : beneficiario;
}

/**
 * Divide `valor` em `n` fatias que SOMAM de volta ao original. Sobra de centavo
 * vai para as primeiras: 10.000 / 3 = 3.333,34 + 3.333,33 + 3.333,33. Dividir
 * e arredondar cada fatia perderia centavo e o total não fecharia.
 */
export function ratear(valor: number, n: number): number[] {
  if (n <= 0) return [];
  const centavos = Math.round(valor * 100);
  const base = Math.trunc(centavos / n);
  const sobra = centavos - base * n;
  return Array.from({ length: n }, (_, i) => (base + (i < sobra ? 1 : 0)) / 100);
}

export function expandirCronograma(
  cronograma: ParcelaLida[],
  partes: string[],
  opts: { rateio?: Rateio } = {},
): ExpansaoCronograma {
  const avisos: string[] = [];
  const rateio = opts.rateio ?? null;
  const parcelas: ParcelaExpandida[] = [];
  const vistos = new Set<number>();

  (cronograma ?? []).forEach((item, i) => {
    const valor = Number(item?.valor);
    if (!Number.isFinite(valor) || valor <= 0) {
      avisos.push(`Parcela ${i + 1}: sem valor — não vira lançamento.`);
      return;
    }

    const n = Number.isFinite(Number(item?.nParcela)) ? Number(item.nParcela) : i + 1;
    if (vistos.has(n)) avisos.push(`Parcela ${n} aparece mais de uma vez no cronograma.`);
    vistos.add(n);

    const bruta = typeof item?.dataPrevista === 'string' ? item.dataPrevista.trim() : '';
    let data: string | null = null;
    if (bruta && ehDataISO(bruta)) data = bruta;
    else if (bruta) avisos.push(`Parcela ${n}: data "${bruta}" não é AAAA-MM-DD — ignorada.`);
    else avisos.push(`Parcela ${n}: a peça fixou valor mas não a data de vencimento.`);

    const põe = (parteNome: string | null, v: number, precisaRateio = false) =>
      parcelas.push({
        nParcela: n, dataPrevista: data, valor: arred(v), parteNome, precisaRateio,
        origemIndice: i,
      });

    // 1. A peça diz de quem é: uma linha, sem multiplicar por parte nenhuma.
    const benef = typeof item?.beneficiario === 'string' ? item.beneficiario.trim() : '';
    if (benef) {
      const casado = casarParte(benef, partes);
      if (partes.length > 0 && !partes.includes(casado)) {
        avisos.push(`Parcela ${n}: beneficiário "${benef}" não bate com nenhuma parte.`);
      }
      põe(casado, valor);
      return;
    }

    // 2. Global com uma parte só: não há a quem mais atribuir.
    if (partes.length === 1) return põe(partes[0], valor);

    // 3. Global sem parte nenhuma: fica sem dono, e não há rateio possível.
    if (partes.length === 0) {
      avisos.push(`Parcela ${n}: cronograma global e a peça não abriu partes.`);
      return põe(null, valor);
    }

    // 4. Global com várias partes: só explode com ordem explícita (ver cabeçalho).
    if (!rateio) {
      avisos.push(
        `Parcela ${n}: R$ ${valor.toFixed(2)} para ${partes.length} partes sem dizer de quem é. ` +
        `Escolha POR_PARTE (cada uma recebe o cheio) ou DIVIDIR (rateia).`,
      );
      return põe(null, valor, true);
    }
    const fatias = rateio === 'DIVIDIR' ? ratear(valor, partes.length) : partes.map(() => valor);
    partes.forEach((p, j) => põe(p, fatias[j]));
  });

  const total = arred(parcelas.reduce((s, p) => s + p.valor, 0));
  const totalAtribuido = arred(
    parcelas.filter((p) => p.parteNome && !p.precisaRateio).reduce((s, p) => s + p.valor, 0),
  );
  return { parcelas, total, totalAtribuido, rateio, avisos };
}
