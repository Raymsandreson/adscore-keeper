/**
 * "Quem é essa pessoa para nós" — em linhas que a IA da sugestão lê antes de
 * escrever qualquer resposta.
 *
 * Por que existe: a sugestão só via a transcrição. Numa conversa em que o
 * ESCRITÓRIO cobra o cliente (empréstimo adiantado, parcelas atrasadas), a IA
 * lia "tô mandando a documentação do pagamento" e respondia "daremos andamento
 * ao pagamento" — invertendo quem deve a quem. O sistema já sabia a resposta em
 * três lugares (Relacionamento Conosco do contato, o caso ligado à conversa e o
 * livro-caixa do lead); nada disso chegava ao prompt.
 *
 * Aqui é só a montagem do texto — sem banco e sem React, para poder testar.
 * Quem busca os dados é `useRelacionamentoDoContato`.
 */

/** De onde saiu o "Relacionamento Conosco" que estamos usando agora. */
export type OrigemDoRelacionamento = 'salvo' | 'nome' | 'ia' | 'desconhecido';

/** Uma linha do livro-caixa do lead (`lead_financials`). */
export interface LancamentoDoLead {
  /** 'income' = entrou no escritório; 'expense' = saiu. */
  entry_type: string | null;
  category: string | null;
  description: string | null;
  amount: number | null;
  /** 'YYYY-MM-DD'. */
  entry_date: string | null;
}

/** O caso/lead ligado à conversa. */
export interface CasoDaConversa {
  nome?: string | null;
  status?: string | null;
  tipoDoCaso?: string | null;
  numeroDoProcesso?: string | null;
}

export interface DadosDoRelacionamento {
  /** Rótulos do "Relacionamento Conosco" (Cliente, Parceiro, Fornecedor…). */
  relacionamento: string[];
  origem: OrigemDoRelacionamento;
  caso?: CasoDaConversa | null;
  lancamentos?: LancamentoDoLead[];
}

/**
 * Categoria de lançamento que significa dinheiro que SAIU do escritório para a
 * mão da pessoa e volta depois. É o caso que mais confunde a IA, porque o
 * cliente fala em "pagamento" e "documentação" como se nós fôssemos pagar.
 */
const ADIANTAMENTO = /adiantad|emprestim|antecipa/;

const normalizar = (v: string | null | undefined) =>
  (v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

const brl = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

/** 'YYYY-MM-DD' → 'DD/MM/YYYY'. Virar Date aqui só traria erro de fuso. */
const dataBr = (v: string | null | undefined): string =>
  v ? String(v).slice(0, 10).split('-').reverse().join('/') : '';

/** É adiantamento/empréstimo ao cliente? Categoria manda; descrição confirma. */
export function ehAdiantamento(l: LancamentoDoLead): boolean {
  return ADIANTAMENTO.test(normalizar(l.category)) || ADIANTAMENTO.test(normalizar(l.description));
}

/**
 * O dinheiro entre o escritório e a pessoa, em uma frase. `null` quando não há
 * lançamento nenhum — silêncio é melhor que uma linha vazia no prompt.
 *
 * Não inventa saldo nem status de parcela: `lead_financials` é livro-caixa, não
 * tem "pago/em aberto". Diz só o que está registrado — quanto saiu para ela e
 * quanto voltou — e de que lado está a obrigação.
 */
export function resumirDinheiro(lancamentos: LancamentoDoLead[] | null | undefined): string | null {
  const linhas = (lancamentos || []).filter((l) => l && Number.isFinite(Number(l.amount)));
  if (!linhas.length) return null;

  const adiantados = linhas.filter(ehAdiantamento);
  const recebidos = linhas.filter((l) => !ehAdiantamento(l) && normalizar(l.entry_type) === 'income');

  const soma = (arr: LancamentoDoLead[]) => arr.reduce((t, l) => t + Math.abs(Number(l.amount) || 0), 0);
  const ultimaData = (arr: LancamentoDoLead[]) =>
    arr.map((l) => l.entry_date || '').filter(Boolean).sort().pop() || '';

  const partes: string[] = [];
  if (adiantados.length) {
    const quando = dataBr(ultimaData(adiantados));
    partes.push(
      `o escritório ADIANTOU ${brl(soma(adiantados))} a esta pessoa ` +
      `(${adiantados.length} lançamento(s)${quando ? `, o último em ${quando}` : ''}) — é dinheiro que ELA deve devolver ao escritório`
    );
  }
  if (recebidos.length) {
    partes.push(`o escritório já recebeu ${brl(soma(recebidos))} dela`);
  }
  if (!partes.length) return null;

  return (
    `DINHEIRO REGISTRADO ENTRE O ESCRITÓRIO E ESTA PESSOA: ${partes.join('; ')}. ` +
    (adiantados.length
      ? `Se a conversa fala de pagamento ligado a isso, quem paga é ELA — nunca escreva como se o escritório fosse pagar, liberar ou "dar andamento" a um pagamento nosso.`
      : `Use isso só para entender de que lado está a obrigação; não cite valores que a pessoa não mencionou.`)
  );
}

/** Rótulo de origem para a IA saber o quanto pode confiar no relacionamento. */
const RESSALVA: Record<OrigemDoRelacionamento, string> = {
  salvo: '',
  nome: ' (lido do nome do contato, ainda não confirmado por ninguém — trate como indício)',
  ia: ' (lido pela IA a partir da conversa, ainda não confirmado por ninguém — trate como indício)',
  desconhecido: '',
};

/**
 * As linhas de contexto que vão para o prompt da sugestão. Devolve `[]` quando
 * não há nada de concreto — prompt sem informação é melhor que prompt com
 * informação inventada.
 */
export function montarLinhasDoRelacionamento(dados: DadosDoRelacionamento): string[] {
  const linhas: string[] = [];

  const papeis = (dados.relacionamento || []).map((r) => String(r || '').trim()).filter(Boolean);
  if (papeis.length) {
    linhas.push(
      `RELACIONAMENTO DESTA PESSOA COM O ESCRITÓRIO: ${papeis.join(', ')}${RESSALVA[dados.origem] || ''}. ` +
      `Isso define o papel de cada lado — não presuma que ela é cliente de um processo se o relacionamento disser outra coisa.`
    );
  }

  const c = dados.caso;
  if (c) {
    const pedacos = [
      c.tipoDoCaso && `tipo: ${c.tipoDoCaso}`,
      c.status && `situação: ${c.status}`,
      c.numeroDoProcesso && `processo ${c.numeroDoProcesso}`,
    ].filter(Boolean);
    if (pedacos.length) {
      linhas.push(`CASO LIGADO A ESTA CONVERSA — ${pedacos.join(' · ')}. Use como contexto; não invente andamento que não está na conversa.`);
    }
  }

  const dinheiro = resumirDinheiro(dados.lancamentos);
  if (dinheiro) linhas.push(dinheiro);

  return linhas;
}
