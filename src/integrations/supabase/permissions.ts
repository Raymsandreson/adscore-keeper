/**
 * Permissões — leitura autoritativa do Cloud.
 *
 * REGRA: tabelas de permissão (`whatsapp_instance_users`,
 * `member_module_permissions`, `access_profiles`, `user_roles`) são metadado
 * de auth e DEVEM ser lidas do Cloud (`authClient`), onde `auth.uid()` é
 * válido e a RLS funciona corretamente.
 *
 * Para ler DADOS de negócio (instâncias, mensagens, leads), use `db`
 * (Externo) filtrando pelos IDs retornados aqui via `.in('id', allowedIds)`.
 *
 * Motivo: a sessão do frontend no Externo é anônima — RLS por user_id
 * esconde linhas de members e leituras silenciosamente retornam vazio.
 */

import { authClient } from './index';

/**
 * Retorna os IDs das instâncias WhatsApp que o usuário pode acessar.
 * Combina assignments explícitos + default_instance_id do perfil.
 * Vazio = sem acesso (member sem atribuição).
 */
export async function getMyAllowedInstanceIds(userId: string): Promise<string[]> {
  const [permsRes, profileRes] = await Promise.all([
    authClient
      .from('whatsapp_instance_users')
      .select('instance_id')
      .eq('user_id', userId),
    authClient
      .from('profiles')
      .select('default_instance_id')
      .eq('user_id', userId)
      .maybeSingle(),
  ]);

  const ids = new Set<string>();
  (permsRes.data || []).forEach((p: any) => {
    if (p.instance_id) ids.add(p.instance_id);
  });
  const defaultId = (profileRes.data as any)?.default_instance_id;
  if (defaultId) ids.add(defaultId);

  return Array.from(ids);
}
