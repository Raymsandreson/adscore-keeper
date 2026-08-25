/**
 * Conciliação de UM lançamento com o extrato do Open Finance.
 *
 * O problema que isto resolve: `lead_financials` (o que alguém digitou na ficha
 * do lead) e `bank_transactions`/`credit_card_transactions` (o que a Celcoin
 * trouxe do banco) moram no MESMO banco e viviam de costas um para o outro.
 * A ficha mostrava "Flores para visita lead290 — R$ 48,00" sem conseguir dizer
 * se aqueles R$ 48,00 saíram mesmo da conta.
 *
 * POR QUE A BUSCA PASSA POR EDGE E A GRAVAÇÃO NÃO:
 *  - ler extrato: a policy de `bank_transactions` é `user_id = auth.uid()` e a
 *    sessão que o front mantém no Externo é `signInAnonymously()`. Ler de cá
 *    volta VAZIO, sem erro — a forma mais cara de errar. A edge resolve a
 *    identidade pelo JWT do Cloud e reproduz a policy com service role.
 *  - gravar o vínculo e checar quem já usou a transação: `lead_financials` é
 *    aberta a `authenticated` e o painel já insere e atualiza direto. Passar
 *    isto por edge não compraria nada.
 *
 * A edge usada é a ação `list_transactions` que JÁ existe (a mesma da tela de
 * conciliação), com a janela estreitada em torno da data do lançamento. Uma
 * ação nova só para isto significaria redeploy da `celcoin-open-finance` — e o
 * ranqueamento não precisa de service role para nada: é aritmética sobre linhas
 * que a edge já autorizou.
 */
import { useState, useCallback } from 'react';
import { db, authClient, ensureExternalSession } from '@/integrations/supabase';
import { remapToExternal } from '@/integrations/supabase/uuid-remap';
import { cloudFunctions } from '@/lib/functionRouter';

/** Uma linha do extrato, já normalizada entre conta e cartão. Valor com sinal do banco. */
export interface TransacaoExtrato {
  id: string;
  tipo: 'bank' | 'card';
  descricao: string | null;
  merchant_name: string | null;
  /** yyyy-mm-dd */
  data: string;
  /** HH:mm, quando o banco informa. */
  hora: string | null;
  /** Negativo = débito na conta. No cartão a convenção varia por emissor. */
  valor: number;
  categoria: string | null;
  card_last_digits: string | null;
  pluggy_account_id: string | null;
}

/** Lançamento que JÁ apontou para uma transação — o alerta de dinheiro dobrado. */
export interface UsoDaTransacao {
  lancamento_id: string;
  descricao: string | null;
  amount: number;
}

/** O recorte de `lead_financials` que responde "esta transação já foi usada?". */
interface LancamentoQueUsou {
  id: string;
  of_transacao_id: string | null;
  description: string | null;
  amount: number | string;
}

export interface CandidatosConciliacao {
  candidatos: TransacaoExtrato[];
  /** id da transação -> lançamento que já a usou. */
  usadas: Record<string, UsoDaTransacao>;
  janela: { de: string; ate: string; dias: number };
  /** Quantos candidatos ficaram de fora do teto. >0 = estreite a busca. */
  cortados: number;
  /** 0 com `mapeado=false` explica a lista vazia sem erro. */
  contas_permitidas: number;
  mapeado: boolean;
}

/** As colunas `of_*` de `lead_financials`. Retrato + ponteiro. */
export interface ConciliacaoDoLancamento {
  of_transacao_id: string | null;
  of_transacao_tipo: 'bank' | 'card' | null;
  of_descricao: string | null;
  of_data: string | null;
  of_valor: number | null;
  of_conciliado_em: string | null;
  of_conciliado_por: string | null;
}

/** Um centavo de diferença ainda é a mesma transação; um real já não é. */
export const TOLERANCIA_CENTAVOS = 0.005;

/** true quando o extrato diz um valor e o lançamento diz outro. */
export function conciliacaoDivergente(
  amount: number,
  conc: Pick<ConciliacaoDoLancamento, 'of_transacao_id' | 'of_valor'>,
): boolean {
  if (!conc.of_transacao_id || conc.of_valor == null) return false;
  return Math.abs(Math.abs(Number(conc.of_valor)) - Math.abs(Number(amount))) > TOLERANCIA_CENTAVOS;
}

const MS_DIA = 86_400_000;
const emDia = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Teto de candidatos mostrados. Acima disso a lista deixa de ser escolha e vira extrato. */
const TETO_CANDIDATOS = 40;

/**
 * Linha crua de `bank_transactions` ou `credit_card_transactions`, como a edge
 * devolve. As duas tabelas divergem no fim (conta tem `pluggy_account_id`,
 * cartão tem `card_last_digits`), então tudo que não é comum é opcional.
 */
interface TransacaoCrua {
  id: string;
  description?: string | null;
  merchant_name?: string | null;
  amount: number | string;
  transaction_date: string;
  transaction_time?: string | null;
  category?: string | null;
  card_last_digits?: string | null;
  pluggy_account_id?: string | null;
}

/** Conta e cartão têm colunas diferentes; a lista precisa de uma forma só. */
function normalizar(t: TransacaoCrua, tipo: 'bank' | 'card'): TransacaoExtrato {
  return {
    id: String(t.id),
    tipo,
    descricao: t.description || t.merchant_name || null,
    merchant_name: t.merchant_name || null,
    data: String(t.transaction_date || '').slice(0, 10),
    hora: t.transaction_time ? String(t.transaction_time).slice(0, 5) : null,
    valor: Number(t.amount),
    categoria: t.category || null,
    card_last_digits: tipo === 'card' ? (t.card_last_digits ?? null) : null,
    pluggy_account_id: tipo === 'bank' ? (t.pluggy_account_id ?? null) : null,
  };
}

/**
 * Ordena os candidatos: valor idêntico primeiro e, entre iguais, o mais próximo
 * da data. Ordenar só por diferença de valor colocaria um débito de R$ 48,00 de
 * três semanas antes na frente do de ontem.
 */
export function ordenarCandidatos(
  linhas: TransacaoExtrato[],
  valor: number | null,
  dataRef: string,
): TransacaoExtrato[] {
  const temValor = valor != null && Number.isFinite(valor) && valor !== 0;
  const refMs = Date.parse(dataRef + 'T00:00:00Z');
  const difValor = (c: TransacaoExtrato) =>
    temValor ? Math.abs(Math.abs(c.valor) - Math.abs(valor as number)) : 0;
  const difDias = (c: TransacaoExtrato) =>
    Math.abs(Date.parse(c.data + 'T00:00:00Z') - refMs) / MS_DIA;

  return linhas.slice().sort((a, b) => {
    const ea = difValor(a) <= TOLERANCIA_CENTAVOS ? 0 : 1;
    const eb = difValor(b) <= TOLERANCIA_CENTAVOS ? 0 : 1;
    if (ea !== eb) return ea - eb;
    if (ea === 0) return difDias(a) - difDias(b);
    return (difValor(a) - difValor(b)) || (difDias(a) - difDias(b));
  });
}

export function useConciliacaoOpenFinance() {
  const [buscando, setBuscando] = useState(false);
  const [gravando, setGravando] = useState(false);

  const buscarCandidatos = useCallback(async (params: {
    valor: number | null;
    /** Data de referência: o dia em que o dinheiro deveria ter se movido. */
    data: string;
    dias?: number;
    busca?: string;
    direcao?: 'entrada' | 'saida' | null;
  }): Promise<CandidatosConciliacao> => {
    setBuscando(true);
    try {
      const dias = Math.min(Math.max(params.dias ?? 15, 0), 90);
      const refMs = Date.parse(params.data + 'T00:00:00Z');
      if (!Number.isFinite(refMs)) throw new Error('Lançamento sem data para procurar no extrato');
      const de = emDia(refMs - dias * MS_DIA);
      const ate = emDia(refMs + dias * MS_DIA);

      const ler = async (kind: 'bank' | 'card') => {
        const { data, error } = await cloudFunctions.invoke('celcoin-open-finance', {
          body: { action: 'list_transactions', kind, from: de, to: ate },
        });
        if (error) throw new Error(error.message || 'Falha ao ler o extrato');
        if (data?.success === false) throw new Error(data?.error || 'Falha ao ler o extrato');
        return data;
      };
      const [banco, cartao] = await Promise.all([ler('bank'), ler('card')]);

      let linhas = [
        ...((banco?.transactions || []) as TransacaoCrua[]).map(t => normalizar(t, 'bank')),
        ...((cartao?.transactions || []) as TransacaoCrua[]).map(t => normalizar(t, 'card')),
      ];

      // Sinal só filtra EXTRATO DE CONTA, onde débito é negativo e crédito é
      // positivo. No cartão a convenção varia por emissor na base atual, e
      // filtrar por sinal lá esconderia justamente a despesa que se procura.
      if (params.direcao) {
        linhas = linhas.filter(c =>
          c.tipo === 'card' || (params.direcao === 'entrada' ? c.valor > 0 : c.valor < 0));
      }
      const termo = (params.busca || '').trim().toLowerCase();
      if (termo) {
        linhas = linhas.filter(c =>
          `${c.descricao || ''} ${c.merchant_name || ''} ${c.categoria || ''}`.toLowerCase().includes(termo));
      }

      const ordenadas = ordenarCandidatos(linhas, params.valor, params.data);
      const candidatos = ordenadas.slice(0, TETO_CANDIDATOS);

      // Quais destas já baixaram OUTRO lançamento. Sem isto, apontar o mesmo PIX
      // em duas despesas passa despercebido e o dinheiro sai duas vezes do
      // relatório. `lead_financials` é legível pela sessão anônima, ao contrário
      // das tabelas de transação — por isso esta parte não precisa da edge.
      const usadas: Record<string, UsoDaTransacao> = {};
      if (candidatos.length) {
        await ensureExternalSession().catch(() => {});
        const { data: jaUsadas } = await db
          .from('lead_financials' as any)
          .select('id, of_transacao_id, description, amount')
          .in('of_transacao_id', candidatos.map(c => c.id));
        // `lead_financials` não está nos tipos gerados (mora no Externo), então
        // o PostgREST tipa o retorno como erro de relação — daí o unknown.
        for (const l of ((jaUsadas as unknown as LancamentoQueUsou[] | null) || [])) {
          usadas[String(l.of_transacao_id)] = {
            lancamento_id: String(l.id),
            descricao: l.description ?? null,
            amount: Number(l.amount),
          };
        }
      }

      return {
        candidatos,
        usadas,
        janela: { de, ate, dias },
        cortados: Math.max(0, ordenadas.length - candidatos.length),
        contas_permitidas: Number(banco?.contas_permitidas || 0) + Number(cartao?.contas_permitidas || 0),
        // `mapeado=false` é o sintoma mais caro daqui: a leitura volta vazia sem
        // erro nenhum, e "não achei nada" fica indistinguível de "não te vejo".
        mapeado: banco?.identidade?.mapeado !== false,
      };
    } finally {
      setBuscando(false);
    }
  }, []);

  /**
   * Aponta a transação e, se o lançamento ainda não era caixa, BAIXA com a data
   * do extrato. São o mesmo ato: dizer "este PIX é este lançamento" é dizer que
   * o dinheiro se moveu, e no dia em que o banco registra — não hoje. Obrigar
   * a baixar antes deixaria a data da baixa errada por quantos dias levasse
   * até alguém conferir.
   */
  const conciliar = useCallback(async (
    lancamentoId: string,
    transacao: TransacaoExtrato,
    opcoes?: { jaBaixado?: boolean; cloudUserId?: string | null },
  ): Promise<void> => {
    setGravando(true);
    try {
      await ensureExternalSession().catch(() => {});
      // Autoria: o uuid do CLOUD (o login de verdade) remapeado para o Externo.
      // `auth.uid()` do Externo aqui seria a sessão anônima, que não é ninguém.
      const cloudId = opcoes?.cloudUserId
        ?? (await authClient.auth.getUser()).data.user?.id
        ?? null;
      const por = await remapToExternal(cloudId).catch(() => null);
      const patch: Record<string, unknown> = {
        of_transacao_id: transacao.id,
        of_transacao_tipo: transacao.tipo,
        of_descricao: transacao.descricao,
        of_data: transacao.data,
        of_valor: Math.abs(Number(transacao.valor)),
        of_conciliado_em: new Date().toISOString(),
        of_conciliado_por: por,
      };
      if (!opcoes?.jaBaixado) patch.settled_at = transacao.data;

      const { error } = await db.from('lead_financials' as any).update(patch).eq('id', lancamentoId);
      if (error) throw new Error(error.message);
    } finally {
      setGravando(false);
    }
  }, []);

  /**
   * Desfaz o vínculo — e SÓ o vínculo. Não desfaz a baixa: o dinheiro pode ter
   * saído de uma conta que ninguém conectou ao Open Finance, e apagar a baixa
   * junto transformaria "conciliei na transação errada" em "o pagamento sumiu".
   */
  const desconciliar = useCallback(async (lancamentoId: string): Promise<void> => {
    setGravando(true);
    try {
      await ensureExternalSession().catch(() => {});
      const { error } = await db.from('lead_financials' as any).update({
        of_transacao_id: null,
        of_transacao_tipo: null,
        of_descricao: null,
        of_data: null,
        of_valor: null,
        of_conciliado_em: null,
        of_conciliado_por: null,
      }).eq('id', lancamentoId);
      if (error) throw new Error(error.message);
    } finally {
      setGravando(false);
    }
  }, []);

  return { buscarCandidatos, conciliar, desconciliar, buscando, gravando };
}
