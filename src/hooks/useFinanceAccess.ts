import { useState, useEffect } from 'react';
import { cloudFunctions } from '@/lib/functionRouter';
import { useAuth } from './useAuth';

/**
 * Quem pode ver extrato de conta e de cartão.
 *
 * A resposta vem da edge e não de uma consulta daqui porque `bank_transactions`
 * e `credit_card_transactions` são das poucas tabelas do Externo com RLS de
 * verdade (`user_id = auth.uid()`, mais `can_view_pluggy_account`/`can_view_card`),
 * e a sessão que o front mantém lá é `signInAnonymously()`. Perguntar daqui
 * devolveria "não pode" para todo mundo — vazio, sem erro.
 *
 * A regra é derivada do dado: é dono de lançamento OU tem permissão concedida.
 * Deliberadamente não existe lista de nomes no código — quem sai da firma perde
 * o acesso ao perder a permissão, sem depender de alguém lembrar de um `if`.
 */
export function useFinanceAccess() {
  const { user } = useAuth();
  const [bank, setBank] = useState(false);
  const [card, setCard] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let vivo = true;
    if (!user) {
      setBank(false);
      setCard(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    (async () => {
      try {
        const { data, error } = await cloudFunctions.invoke('celcoin-open-finance', {
          body: { action: 'my_finance_access' },
        });
        if (!vivo) return;
        if (error || data?.success === false) throw new Error(data?.error || error?.message);
        setBank(Boolean(data?.bank));
        setCard(Boolean(data?.card));
      } catch (err) {
        // Falha fecha as abas em vez de abrir. Erro de rede não é autorização.
        if (!vivo) return;
        console.warn('[useFinanceAccess] falhou, fechando abas:', err);
        setBank(false);
        setCard(false);
      } finally {
        if (vivo) setLoading(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [user]);

  return { bank, card, loading };
}
