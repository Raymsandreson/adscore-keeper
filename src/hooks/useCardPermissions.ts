import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
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

export function useCardPermissions() {
  const { user } = useAuth();
  const { isAdmin, loading: roleLoading } = useUserRole();
  const [permissions, setPermissions] = useState<CardPermission[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [allowedCards, setAllowedCards] = useState<string[]>([]);
  const [allKnownCards, setAllKnownCards] = useState<string[]>([]);

  // Fetch all known cards from transactions (for admin access)
  const fetchAllCards = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('credit_card_transactions')
        .select('card_last_digits')
        .not('card_last_digits', 'is', null);

      if (error) throw error;
      
      const uniqueCards = [...new Set((data || []).map(t => t.card_last_digits).filter(Boolean))] as string[];
      setAllKnownCards(uniqueCards);
      return uniqueCards;
    } catch (error) {
      console.error('Error fetching all cards:', error);
      return [];
    }
  }, []);

  // Fetch all permissions (for admins) or just own (for members)
  const fetchPermissions = useCallback(async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from('user_card_permissions')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setPermissions(data || []);

      // Calculate allowed cards for current user
      const myCards = (data || [])
        .filter(p => p.user_id === user.id)
        .map(p => p.card_last_digits);
      
      // Fetch all cards to know what exists (for admin permission management UI)
      await fetchAllCards();
      
      // ALL users (including admins) follow only explicit permissions
      // Admins must be granted access to cards just like any other user
      setAllowedCards(myCards);
    } catch (error) {
      console.error('Error fetching card permissions:', error);
    } finally {
      setLoading(false);
    }
  }, [user, isAdmin, fetchAllCards]);

  // Fetch team members for admin UI
  const fetchTeamMembers = useCallback(async () => {
    if (!isAdmin) return;

    try {
      const { data: roles, error: rolesError } = await supabase
        .from('user_roles')
        .select('id, user_id, role, created_at');

      if (rolesError) throw rolesError;

      const userIds = roles?.map(r => r.user_id) || [];
      
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('user_id, full_name, email')
          .in('user_id', userIds);

        const profileMap = new Map(profiles?.map(p => [p.user_id, p]) || []);

        const members: TeamMember[] = (roles || []).map(r => ({
          id: r.id,
          user_id: r.user_id,
          role: r.role as 'admin' | 'member',
          email: profileMap.get(r.user_id)?.email || null,
          full_name: profileMap.get(r.user_id)?.full_name || null,
        }));

        setTeamMembers(members);
      }
    } catch (error) {
      console.error('Error fetching team members:', error);
    }
  }, [isAdmin]);

  // Wait for role loading to complete before fetching permissions
  useEffect(() => {
    if (!roleLoading && user) {
      fetchPermissions();
      fetchTeamMembers();
    }
  }, [fetchPermissions, fetchTeamMembers, roleLoading, user]);

  // Grant card permission to a user
  const grantPermission = useCallback(async (userId: string, cardLastDigits: string, pluggyAccountId?: string) => {
    if (!isAdmin || !user) {
      throw new Error('Only admins can grant card permissions');
    }

    const { error } = await supabase
      .from('user_card_permissions')
      .insert({
        user_id: userId,
        card_last_digits: cardLastDigits,
        pluggy_account_id: pluggyAccountId || null,
        granted_by: user.id,
      });

    if (error) throw error;
    await fetchPermissions();
  }, [isAdmin, user, fetchPermissions]);

  // Revoke card permission from a user
  const revokePermission = useCallback(async (userId: string, cardLastDigits: string) => {
    if (!isAdmin) {
      throw new Error('Only admins can revoke card permissions');
    }

    const { error } = await supabase
      .from('user_card_permissions')
      .delete()
      .eq('user_id', userId)
      .eq('card_last_digits', cardLastDigits);

    if (error) throw error;
    await fetchPermissions();
  }, [isAdmin, fetchPermissions]);

  // Grant multiple cards to a user at once
  const grantMultiplePermissions = useCallback(async (userId: string, cards: { cardLastDigits: string; pluggyAccountId?: string }[]) => {
    if (!isAdmin || !user) {
      throw new Error('Only admins can grant card permissions');
    }

    const records = cards.map(card => ({
      user_id: userId,
      card_last_digits: card.cardLastDigits,
      pluggy_account_id: card.pluggyAccountId || null,
      granted_by: user.id,
    }));

    const { error } = await supabase
      .from('user_card_permissions')
      .upsert(records, { onConflict: 'user_id,card_last_digits' });

    if (error) throw error;
    await fetchPermissions();
  }, [isAdmin, user, fetchPermissions]);

  // Revoke all permissions from a user
  const revokeAllPermissions = useCallback(async (userId: string) => {
    if (!isAdmin) {
      throw new Error('Only admins can revoke card permissions');
    }

    const { error } = await supabase
      .from('user_card_permissions')
      .delete()
      .eq('user_id', userId);

    if (error) throw error;
    await fetchPermissions();
  }, [isAdmin, fetchPermissions]);

  // Get permissions for a specific user
  const getPermissionsForUser = useCallback((userId: string) => {
    return permissions.filter(p => p.user_id === userId);
  }, [permissions]);

  // Check if current user can view a specific card
  const canViewCard = useCallback((cardLastDigits: string) => {
    return allowedCards.includes(cardLastDigits);
  }, [allowedCards]);

  // Filter transactions to only show permitted cards
  const filterByPermissions = useCallback(<T extends { card_last_digits: string | null }>(items: T[]): T[] => {
    if (allowedCards.length === 0) return [];
    return items.filter(item => 
      item.card_last_digits && allowedCards.includes(item.card_last_digits)
    );
  }, [allowedCards]);

  // Combined loading state includes role loading
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
