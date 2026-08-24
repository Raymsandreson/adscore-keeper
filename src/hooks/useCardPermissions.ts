import { useState, useEffect, useCallback } from 'react';
import { cloudFunctions } from '@/lib/functionRouter';
import { useAuth } from './useAuth';
import { useFinanceAccess } from './useFinanceAccess';

interface CardPermission {
  id: string;
  user_id: string;
  card_last_digits: string;
  pluggy_account_id: string | null;
  granted_by: string | null;
  created_at: string;
}

interface TeamMember {
  id: string;
  user_id: string;
  role: 'admin' | 'member';
  email: string | null;
  full_name: string | null;
}

/**
 * Permissões de cartão.
 *
 * Tudo passa pela edge, e não pelo cliente `supabase` (que é o Cloud), por dois
 * motivos que se somam:
 *
 * 1. `user_card_permissions` existe nos DOIS projetos. A que a leitura de
 *    extrato consulta é a do Externo; a do Cloud não gateia nada.
 * 2. Os `user_id` são uuids do **Externo**, e a sessão do front é do **Cloud**.
 *    Dos 52 usuários mapeados, 26 têm uuid diferente nos dois bancos. A versão
 *    anterior comparava `p.user_id === user.id` (uuid do Cloud) para montar
 *    `allowedCards` — nunca casava, e como `filterByPermissions` devolve `[]`
 *    quando `allowedCards` está vazio, a tela de cartão zerava mesmo com dado
 *    legível. Erro que não aparece como erro: aparece como lista vazia.
 *
 * A tradução de uuid acontece na edge, pelo `auth_uuid_mapping`.
 */
export function useCardPermissions() {
  const { user } = useAuth();
  // Identidade, cartões permitidos e `isAdmin` vêm todos daqui: uma chamada só,
  // e `isAdmin` do MESMO banco que gateia as ações administrativas na edge.
  const { isAdmin, allowedCards, loading: acessoLoading } = useFinanceAccess();
  const [permissions, setPermissions] = useState<CardPermission[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [allKnownCards, setAllKnownCards] = useState<string[]>([]);

  const chamar = useCallback(async (action: string, params: Record<string, unknown> = {}) => {
    const { data, error } = await cloudFunctions.invoke('celcoin-open-finance', {
      body: { action, ...params },
    });
    if (error) throw error;
    if (data?.success === false) throw new Error(data?.error || `Falha em ${action}`);
    return data;
  }, []);

  const fetchPermissions = useCallback(async () => {
    if (!user) return;
    try {
      // O painel inteiro é de administrador. Quem não é não precisa da lista
      // dos outros — e a edge recusaria com 403 de qualquer forma.
      if (isAdmin) {
        const painel = await chamar('list_finance_permissions');
        setPermissions((painel?.card_permissions as CardPermission[]) || []);
        setAllKnownCards((painel?.cards as string[]) || []);
        setTeamMembers((painel?.team as TeamMember[]) || []);
      } else {
        setPermissions([]);
        setAllKnownCards([]);
        setTeamMembers([]);
      }
    } catch (error) {
      console.error('Error fetching card permissions:', error);
      setPermissions([]);
    } finally {
      setLoading(false);
    }
  }, [user, isAdmin, chamar]);

  useEffect(() => {
    if (!acessoLoading && user) fetchPermissions();
  }, [fetchPermissions, acessoLoading, user]);

  const getPermissionsForUser = useCallback((userId: string) => {
    return permissions.filter((p) => p.user_id === userId);
  }, [permissions]);

  /**
   * A edge recebe o CONJUNTO final, não um grant ou revoke isolado. Assim não
   * existe a janela em que o revoke passa, o grant falha, e a pessoa fica sem
   * nada — estado que ninguém percebe até alguém reclamar que sumiu.
   */
  const definirCartoes = useCallback(async (userId: string, cards: string[]) => {
    await chamar('set_card_permissions', { target_user_id: userId, cards });
    await fetchPermissions();
  }, [chamar, fetchPermissions]);

  const grantPermission = useCallback(async (userId: string, cardLastDigits: string) => {
    if (!isAdmin) throw new Error('Only admins can grant card permissions');
    const atuais = permissions.filter((p) => p.user_id === userId).map((p) => p.card_last_digits);
    await definirCartoes(userId, [...new Set([...atuais, cardLastDigits])]);
  }, [isAdmin, permissions, definirCartoes]);

  const revokePermission = useCallback(async (userId: string, cardLastDigits: string) => {
    if (!isAdmin) throw new Error('Only admins can revoke card permissions');
    const atuais = permissions.filter((p) => p.user_id === userId).map((p) => p.card_last_digits);
    await definirCartoes(userId, atuais.filter((c) => c !== cardLastDigits));
  }, [isAdmin, permissions, definirCartoes]);

  const grantMultiplePermissions = useCallback(
    async (userId: string, cards: { cardLastDigits: string }[]) => {
      if (!isAdmin) throw new Error('Only admins can grant card permissions');
      const atuais = permissions.filter((p) => p.user_id === userId).map((p) => p.card_last_digits);
      await definirCartoes(userId, [...new Set([...atuais, ...cards.map((c) => c.cardLastDigits)])]);
    },
    [isAdmin, permissions, definirCartoes],
  );

  const revokeAllPermissions = useCallback(async (userId: string) => {
    if (!isAdmin) throw new Error('Only admins can revoke card permissions');
    await definirCartoes(userId, []);
  }, [isAdmin, definirCartoes]);

  const canViewCard = useCallback((cardLastDigits: string) => {
    return allowedCards.includes(cardLastDigits);
  }, [allowedCards]);

  const filterByPermissions = useCallback(<T extends { card_last_digits: string | null }>(items: T[]): T[] => {
    if (allowedCards.length === 0) return [];
    return items.filter((item) => item.card_last_digits && allowedCards.includes(item.card_last_digits));
  }, [allowedCards]);

  const isLoading = loading || acessoLoading;

  return {
    permissions,
    teamMembers,
    loading: isLoading,
    allowedCards,
    allKnownCards,
    grantPermission,
    revokePermission,
    grantMultiplePermissions,
    revokeAllPermissions,
    getPermissionsForUser,
    canViewCard,
    filterByPermissions,
    refetch: fetchPermissions,
  };
}
