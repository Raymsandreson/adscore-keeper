import { useState, useEffect, useCallback } from 'react';
import { cloudFunctions } from '@/lib/functionRouter';
import { useAuth } from './useAuth';
import { useUserRole } from './useUserRole';

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
  const { isAdmin, loading: roleLoading } = useUserRole();
  const [permissions, setPermissions] = useState<CardPermission[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [allowedCards, setAllowedCards] = useState<string[]>([]);
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
      // Os cartões que EU vejo saem daqui e não da lista completa: quem não é
      // administrador não pode ler as permissões dos outros, e não precisa.
      const meu = await chamar('my_finance_access');
      setAllowedCards((meu?.allowed_cards as string[]) || []);

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
      // Falha fecha o acesso em vez de abrir. Erro de rede não é autorização.
      console.error('Error fetching card permissions:', error);
      setAllowedCards([]);
      setPermissions([]);
    } finally {
      setLoading(false);
    }
  }, [user, isAdmin, chamar]);

  useEffect(() => {
    if (!roleLoading && user) fetchPermissions();
  }, [fetchPermissions, roleLoading, user]);

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

  const isLoading = loading || roleLoading;

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
