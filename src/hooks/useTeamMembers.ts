import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useUserRole } from './useUserRole';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';

interface TeamMember {
  id: string;
  user_id: string;
  role: 'admin' | 'member';
  email: string | null;
  full_name: string | null;
  created_at: string;
}

interface TeamInvitation {
  id: string;
  email: string;
  role: 'admin' | 'member';
  invited_by: string | null;
  accepted_at: string | null;
  expires_at: string;
  created_at: string;
}

export function useTeamMembers() {
  const { isAdmin } = useUserRole();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invitations, setInvitations] = useState<TeamInvitation[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchMembers = useCallback(async () => {
    try {
      // Fetch user roles with profile info
      const { data: roles, error: rolesError } = await supabase
        .from('user_roles')
        .select('id, user_id, role, created_at');

      if (rolesError) throw rolesError;

      // Fetch profiles for these users
      const userIds = roles?.map(r => r.user_id) || [];
      
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('user_id, full_name, email')
          .in('user_id', userIds);

        const profileMap = new Map(profiles?.map(p => [p.user_id, p]) || []);

        const membersWithProfiles: TeamMember[] = (roles || []).map(r => ({
          ...r,
          role: r.role as 'admin' | 'member',
          email: profileMap.get(r.user_id)?.email || null,
          full_name: profileMap.get(r.user_id)?.full_name || null,
        }));

        setMembers(membersWithProfiles);
      }

      // Fetch pending invitations
      const { data: invites, error: invitesError } = await supabase
        .from('team_invitations')
        .select('*')
        .is('accepted_at', null)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false });

      if (invitesError) throw invitesError;
      setInvitations((invites || []).map(i => ({ ...i, role: i.role as 'admin' | 'member' })));
    } catch (error) {
      console.error('Error fetching team members:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  const inviteMember = useCallback(async (
    email: string,
    role: 'admin' | 'member' = 'member',
    modulePermissions?: Array<{ module_key: string; access_level: string }>,
    whatsappInstanceIds?: string[],
  ) => {
    if (!isAdmin) {
      throw new Error('Only admins can invite members');
    }

    const { data: user } = await supabase.auth.getUser();
    const normalizedEmail = email.toLowerCase().trim();
    
    // Insert invitation into database with pre-configured permissions
    const { error } = await supabase
      .from('team_invitations')
      .insert({
        email: normalizedEmail,
        role,
        invited_by: user.user?.id,
        module_permissions: modulePermissions || [],
        whatsapp_instance_ids: whatsappInstanceIds || [],
      } as any);

    if (error) throw error;

    // Get inviter's name for the email
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('user_id', user.user?.id)
      .single();

    // Send invitation email via edge function
    try {
      const appUrl = window.location.origin;
      const response = await cloudFunctions.invoke('send-team-invitation', {
        body: {
          email: normalizedEmail,
          role,
          invitedByName: profile?.full_name || 'Um administrador',
          appUrl,
        },
      });

      if (response.error) {
        console.error('Error sending invitation email:', response.error);
      } else {
        console.log('Invitation email sent successfully');
      }
    } catch (emailError) {
      console.error('Failed to send invitation email:', emailError);
    }

    await fetchMembers();
  }, [isAdmin, fetchMembers]);

  const cancelInvitation = useCallback(async (invitationId: string) => {
    if (!isAdmin) {
      throw new Error('Only admins can cancel invitations');
    }

    const { error } = await supabase
      .from('team_invitations')
      .delete()
      .eq('id', invitationId);

    if (error) throw error;
    await fetchMembers();
  }, [isAdmin, fetchMembers]);

  const updateMemberRole = useCallback(async (userId: string, newRole: 'admin' | 'member') => {
    if (!isAdmin) {
      throw new Error('Only admins can update roles');
    }

    const { error } = await supabase
      .from('user_roles')
      .update({ role: newRole })
      .eq('user_id', userId);

    if (error) throw error;
    await fetchMembers();
  }, [isAdmin, fetchMembers]);

  const removeMember = useCallback(async (userId: string) => {
    if (!isAdmin) {
      throw new Error('Only admins can remove members');
    }

    const { error } = await supabase
      .from('user_roles')
      .delete()
      .eq('user_id', userId);

    if (error) throw error;
    await fetchMembers();
  }, [isAdmin, fetchMembers]);

  return {
    members,
    invitations,
    loading,
    inviteMember,
    cancelInvitation,
    updateMemberRole,
    removeMember,
    refetch: fetchMembers,
  };
}
