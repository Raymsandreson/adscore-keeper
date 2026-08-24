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
 * Uma resposta por usuário, compartilhada entre todas as instâncias do hook.
 *
 * MEDIDO em 24/08/2026 pelo log da edge: uma abertura da tela financeira
 * disparava `my_finance_access` 2×, `list_pluggy_connections` 2× e
 * `list_finance_permissions` 3× — onze chamadas onde bastavam cinco. O hook é
 * montado em mais de um lugar (a página, o hook de cartão, os gerenciadores) e
 * cada instância buscava por conta própria. Guardar a *promessa* e não só o
 * resultado é o que resolve: as instâncias montam no mesmo tick, então um cache
 * de resultado ainda deixaria todas saírem juntas antes da primeira responder.
 */
let emVoo: { chave: string; promessa: Promise<AcessoFinanceiro> } | null = null;

export function invalidarAcessoFinanceiro(): void {
  emVoo = null;
}

async function buscarAcesso(): Promise<AcessoFinanceiro> {
  const { data, error } = await cloudFunctions.invoke('celcoin-open-finance', {
    body: { action: 'my_finance_access' },
  });
  if (error || data?.success === false) throw new Error(data?.error || error?.message);
  return {
    bank: Boolean(data?.bank),
    card: Boolean(data?.card),
    isAdmin: Boolean(data?.is_admin),
    allowedCards: (data?.allowed_cards as string[]) || [],
    allowedAccounts: (data?.allowed_accounts as string[]) || [],
  };
}

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

  const carregar = useCallback(async (forcar = false) => {
    if (!user) {
      // Sessão ainda não resolvida: fecha o acesso mas NÃO declara `loading`
      // encerrado. Declarar aqui faria a tela concluir "não tem acesso" no
      // primeiro render e agir sobre isso — foi o que envenenou a aba padrão
      // em 24/08/2026. Ausência de resposta não é resposta negativa.
      setAcesso(FECHADO);
      return;
    }
    if (forcar) emVoo = null;
    setLoading(true);
    try {
      if (!emVoo || emVoo.chave !== user.id) {
        emVoo = { chave: user.id, promessa: buscarAcesso() };
      }
      setAcesso(await emVoo.promessa);
    } catch (err) {
      // Falha fecha o acesso em vez de abrir. Erro de rede não é autorização.
      // A promessa falhada não fica no cache: a próxima montagem tenta de novo.
      emVoo = null;
      console.warn('[useFinanceAccess] falhou, fechando acesso:', err);
      setAcesso(FECHADO);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  return { ...acesso, loading, refetch: () => carregar(true) };
}
