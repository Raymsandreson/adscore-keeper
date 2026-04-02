import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuthContext } from '@/contexts/AuthContext';
import { useUserRole } from '@/hooks/useUserRole';

export type AccessLevel = 'none' | 'view' | 'edit';

export interface ModulePermission {
  user_id: string;
  module_key: string;
  access_level: AccessLevel;
}

export const MODULE_DEFINITIONS = [
  { key: 'activities', label: 'Atividades', icon: 'CheckSquare', route: '/' },
  { key: 'leads', label: 'Leads / Funis', icon: 'Users', route: '/leads' },
  { key: 'analytics', label: 'Analytics / Métricas', icon: 'BarChart3', route: '/analytics' },
  { key: 'finance', label: 'Financeiro', icon: 'DollarSign', route: '/finance' },
  { key: 'instagram', label: 'Instagram / Comentários', icon: 'MessageCircle', route: '/workflow' },
  { key: 'calls', label: 'Ligações', icon: 'Phone', route: '/calls' },
  { key: 'whatsapp', label: 'WhatsApp', icon: 'MessageSquare', route: '/whatsapp' },
  { key: 'whatsapp_private', label: 'Conversas Privadas', icon: 'Lock', route: '/whatsapp' },
  { key: 'contacts', label: 'Contatos', icon: 'Contact', route: '/leaderboard' },
  { key: 'team_management', label: 'Gestão de Equipe', icon: 'Settings', route: '/team' },
] as const;

export function useModulePermissions() {
  const { user } = useAuthContext();
  const { isAdmin } = useUserRole();
  const [permissions, setPermissions] = useState<ModulePermission[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPermissions = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('member_module_permissions')
        .select('user_id, module_key, access_level');
      if (error) throw error;
      setPermissions((data || []) as ModulePermission[]);
    } catch (err) {
      console.error('Error fetching module permissions:', err);
    } finally {
      setLoading(false);
    }
  }, [user?.id]); // use user.id instead of user object to avoid re-fetching on reference changes

  useEffect(() => {
    fetchPermissions();
  }, [fetchPermissions]);

  const getAccess = useCallback((moduleKey: string, userId?: string): AccessLevel => {
    const uid = userId || user?.id;
    if (!uid) return 'none';
    // Admins always have full access
    if (isAdmin && !userId) return 'edit';
    const perm = permissions.find(p => p.user_id === uid && p.module_key === moduleKey);
    // Members: only access explicitly granted modules; default is 'none'
    return perm ? perm.access_level as AccessLevel : 'none';
  }, [permissions, user, isAdmin]);

  const canView = useCallback((moduleKey: string, userId?: string): boolean => {
    const level = getAccess(moduleKey, userId);
    return level === 'view' || level === 'edit';
  }, [getAccess]);

  const canEdit = useCallback((moduleKey: string, userId?: string): boolean => {
    return getAccess(moduleKey, userId) === 'edit';
  }, [getAccess]);

  const setPermission = useCallback(async (userId: string, moduleKey: string, accessLevel: AccessLevel) => {
    try {
      const { error } = await supabase
        .from('member_module_permissions')
        .upsert(
          { user_id: userId, module_key: moduleKey, access_level: accessLevel },
          { onConflict: 'user_id,module_key' }
        );
      if (error) throw error;
      await fetchPermissions();
    } catch (err) {
      console.error('Error setting permission:', err);
      throw err;
    }
  }, [fetchPermissions]);

  const getUserPermissions = useCallback((userId: string): Record<string, AccessLevel> => {
    const result: Record<string, AccessLevel> = {};
    MODULE_DEFINITIONS.forEach(mod => {
      const perm = permissions.find(p => p.user_id === userId && p.module_key === mod.key);
      result[mod.key] = perm ? perm.access_level as AccessLevel : 'none';
    });
    return result;
  }, [permissions]);

  return { permissions, loading, getAccess, canView, canEdit, setPermission, getUserPermissions, fetchPermissions };
}
