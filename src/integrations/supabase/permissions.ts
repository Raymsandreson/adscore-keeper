/**
 * Permissões — leitura autoritativa do Externo via edge function.
 *
 * Histórico: antes lia direto do Cloud (`whatsapp_instance_users`), mas o
 * mirror divergia do Externo (matriz da equipe lê Externo, inbox lia Cloud).
 * Resultado: instâncias visíveis na inbox não batiam com as atribuídas em
 * Gestão de Equipe. Agora a edge function `get-my-instance-accesses` lê do
 * Externo com service role e devolve a lista canônica.
 *
 * Para ler DADOS de negócio (instâncias, mensagens, leads), continue usando
 * `db` (Externo) filtrando pelos IDs retornados aqui via `.in('id', allowedIds)`.
 */

import { authClient } from './index';

/**
 * Retorna os IDs das instâncias WhatsApp que o usuário pode acessar.
 * Inclui assignments explícitos + default_instance_id do perfil.
 * Vazio = sem acesso (member sem atribuição).
 */
export async function getMyAllowedInstanceIds(userId: string): Promise<string[]> {
  try {
    const { data, error } = await authClient.functions.invoke('get-my-instance-accesses');
    if (error) throw error;
    if ((data as any)?.success === false) {
      console.warn('[getMyAllowedInstanceIds] edge returned failure:', (data as any)?.error);
    }
    const ids = ((data as any)?.instance_ids || []) as string[];
    return Array.from(new Set(ids.filter(Boolean)));
  } catch (e) {
    console.error('[getMyAllowedInstanceIds] edge failed, falling back to Cloud mirror:', e);
    // Fallback: leitura legada do mirror Cloud (pode estar fora de sincronia).
    const [permsRes, profileRes] = await Promise.all([
      authClient.from('whatsapp_instance_users').select('instance_id').eq('user_id', userId),
      authClient.from('profiles').select('default_instance_id').eq('user_id', userId).maybeSingle(),
    ]);
    const ids = new Set<string>();
    (permsRes.data || []).forEach((p: any) => { if (p.instance_id) ids.add(p.instance_id); });
    const defaultId = (profileRes.data as any)?.default_instance_id;
    if (defaultId) ids.add(defaultId);
    return Array.from(ids);
  }
}
