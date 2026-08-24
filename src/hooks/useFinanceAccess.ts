import { useState, useEffect, useCallback } from 'react';
import { cloudFunctions } from '@/lib/functionRouter';
import { useAuth } from './useAuth';

interface AcessoFinanceiro {
  bank: boolean;
  card: boolean;
  isAdmin: boolean;
  allowedCards: string[];
  allowedAccounts: string[];
}

const FECHADO: AcessoFinanceiro = {
  bank: false,
  card: false,
  isAdmin: false,
  allowedCards: [],
  allowedAccounts: [],
};

/**
 * Quem vê o quê no financeiro, e quem administra.
 *
 * Fonte única, respondida pela edge (`my_finance_access`). Não dá para perguntar
 * daqui: `bank_transactions` e `credit_card_transactions` são das poucas tabelas
 * do Externo com RLS de verdade (`user_id = auth.uid()`), e a sessão que o front
 * mantém lá é `signInAnonymously()` — a resposta seria "não pode" para todo
 * mundo, vazia e sem erro.
 *
 * `isAdmin` vem daqui e NÃO de `useUserRole`, que lê o `user_roles` do **Cloud**.
 * As ações administrativas são gateadas pelo `is_admin` do **Externo**, e os dois
 * conjuntos não coincidem: quem era admin só no Cloud via o painel e tomava 403;
 * quem era admin só no Externo nunca via o painel. Medido em 24/08/2026.
 *
 * A regra de acesso é derivada do dado — é dono de lançamento ou tem permissão
 * concedida. Deliberadamente não existe lista de nomes no código: quem sai da
 * firma perde o acesso ao perder a permissão, sem depender de alguém lembrar de
 * um `if`.
 */
export function useFinanceAccess() {
  const { user } = useAuth();
  const [acesso, setAcesso] = useState<AcessoFinanceiro>(FECHADO);
  const [loading, setLoading] = useState(true);

  const carregar = useCallback(async () => {
    if (!user) {
      setAcesso(FECHADO);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await cloudFunctions.invoke('celcoin-open-finance', {
        body: { action: 'my_finance_access' },
      });
      if (error || data?.success === false) throw new Error(data?.error || error?.message);
      setAcesso({
        bank: Boolean(data?.bank),
        card: Boolean(data?.card),
        isAdmin: Boolean(data?.is_admin),
        allowedCards: (data?.allowed_cards as string[]) || [],
        allowedAccounts: (data?.allowed_accounts as string[]) || [],
      });
    } catch (err) {
      // Falha fecha o acesso em vez de abrir. Erro de rede não é autorização.
      console.warn('[useFinanceAccess] falhou, fechando acesso:', err);
      setAcesso(FECHADO);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    let vivo = true;
    carregar().finally(() => {
      if (!vivo) return;
    });
    return () => {
      vivo = false;
    };
  }, [carregar]);

  return { ...acesso, loading, refetch: carregar };
}
