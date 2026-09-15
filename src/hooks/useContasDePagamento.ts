/**
 * As contas e os cartões que podem ter pago uma despesa.
 *
 * Duas tabelas minúsculas do EXTERNO (5 contas e 8 cartões em 11/09/2026), as
 * MESMAS que a sessão Financeiro já usa: `cost_accounts` é o vocabulário de
 * conta da casa (PESSOAL, ABRACI, WHATSJUD, PRUDÊNCIO CAPITAL, PRUDÊNCIO
 * ADVOGADOS) e `card_assignments` é o cadastro de cartão, com nome e os quatro
 * dígitos que casam com o extrato.
 *
 * `useExpenseCategories` também traz `card_assignments`, mas junto de
 * categorias e de TODOS os overrides de transação — carga que a ficha do lead
 * não tem por que pagar só para desenhar dois selects. Por isso este hook
 * separado, e por isso ele só busca quando `ativo` (o diálogo aberto).
 */
import { useCallback, useEffect, useState } from 'react';
import { db } from '@/integrations/supabase';

export interface ContaDePagamento {
  id: string;
  name: string;
  color: string | null;
  icon: string | null;
}

export interface CartaoDePagamento {
  id: string;
  /** Os quatro dígitos — é o que casa com `credit_card_transactions`. */
  card_last_digits: string;
  card_name: string | null;
  cost_account_id: string | null;
}

/** Formas que a casa aceita. Mesma lista da sessão Financeiro, sem inventar. */
export const FORMAS_DE_PAGAMENTO = [
  { valor: 'pix', rotulo: 'PIX' },
  { valor: 'boleto', rotulo: 'Boleto' },
  { valor: 'cartao_credito', rotulo: 'Cartão de Crédito' },
  { valor: 'cartao_debito', rotulo: 'Cartão de Débito' },
  { valor: 'transferencia', rotulo: 'Transferência' },
  { valor: 'dinheiro', rotulo: 'Dinheiro' },
] as const;

/** true quando a forma escolhida exige dizer QUAL cartão. */
export function formaUsaCartao(forma: string | null | undefined): boolean {
  return forma === 'cartao_credito' || forma === 'cartao_debito';
}

export function rotuloDaForma(forma: string | null | undefined): string | null {
  if (!forma) return null;
  return FORMAS_DE_PAGAMENTO.find(f => f.valor === forma)?.rotulo ?? forma;
}

export function useContasDePagamento(ativo = true) {
  const [contas, setContas] = useState<ContaDePagamento[]>([]);
  const [cartoes, setCartoes] = useState<CartaoDePagamento[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const [respContas, respCartoes] = await Promise.all([
        db
          .from('cost_accounts')
          .select('id, name, color, icon')
          .eq('is_active', true)
          .order('display_order', { ascending: true }),
        db
          .from('card_assignments')
          .select('id, card_last_digits, card_name, cost_account_id')
          .order('card_name', { ascending: true }),
      ]);
      if (respContas.error) throw respContas.error;
      if (respCartoes.error) throw respCartoes.error;
      setContas((respContas.data as ContaDePagamento[]) || []);
      setCartoes((respCartoes.data as CartaoDePagamento[]) || []);
    } catch (err) {
      // Lista vazia com erro dito na tela é melhor que select mudo: quem lança
      // precisa saber que a conta não carregou, não achar que não existe conta.
      console.error('[useContasDePagamento] erro ao carregar contas/cartões:', err);
      setErro(err instanceof Error ? err.message : String(err));
      setContas([]);
      setCartoes([]);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    if (ativo) void carregar();
  }, [ativo, carregar]);

  return { contas, cartoes, carregando, erro, recarregar: carregar };
}
