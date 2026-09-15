import { supabase } from '@/integrations/supabase/client';
import { db } from '@/integrations/supabase';
import { comAcessoCloudPadrao } from '@/lib/cloudApiInstances';

export interface AccessProfileLike {
  id: string;
  name: string;
  is_system: boolean;
  module_permissions: Array<{ module_key: string; access_level: string }>;
  whatsapp_instance_ids: string[];
}

/**
 * Aplica um perfil de acesso a um usuário do Cloud:
 * grava user_roles (role + access_profile_id), recria member_module_permissions
 * e substitui os acessos de instância do WhatsApp.
 */
export async function applyAccessProfile(userId: string, profile: AccessProfileLike) {
  const isSystem = profile.is_system;
  const newRole = isSystem ? 'admin' : 'member';

  const { data: existingRole } = await supabase
    .from('user_roles')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle();

  if (existingRole) {
    const { error } = await supabase
      .from('user_roles')
      .update({ role: newRole, access_profile_id: profile.id } as any)
      .eq('user_id', userId);
    if (error) throw error;
  } else {
    const { error } = await supabase
      .from('user_roles')
      .insert({ user_id: userId, role: newRole, access_profile_id: profile.id } as any);
    if (error) throw error;
  }

  if (!isSystem) {
    await supabase.from('member_module_permissions').delete().eq('user_id', userId);
    if ((profile.module_permissions || []).length > 0) {
      const { error } = await supabase.from('member_module_permissions').insert(
        profile.module_permissions.map((p) => ({
          user_id: userId,
          module_key: p.module_key,
          access_level: p.access_level,
        })) as any
      );
      if (error) throw error;
    }

    // Perfil que não marca NENHUMA linha da WhatsApp API recebe a Abraci: é o
    // acesso padrão do canal. Sem isto o usuário novo nascia sem linha nenhuma
    // e a caixa /whatsapp-api abria vazia no primeiro dia.
    const { data: instancias } = await db
      .from('whatsapp_instances')
      .select('id, instance_name, instance_token')
      .eq('is_active', true);
    const instanceIds = comAcessoCloudPadrao(
      profile.whatsapp_instance_ids || [],
      (instancias || []) as Array<{ id: string; instance_name: string | null; instance_token: string | null }>,
    );

    const { data: accessResp, error: accessErr } = await supabase.functions.invoke(
      'admin-whatsapp-instance',
      {
        body: {
          action: 'replace_user_instance_accesses',
          user_id: userId,
          instance_ids: instanceIds,
        },
      }
    );
    if (accessErr || (accessResp as any)?.success === false) {
      throw accessErr || new Error((accessResp as any)?.error || 'Erro ao aplicar acessos do WhatsApp');
    }
  }
}
