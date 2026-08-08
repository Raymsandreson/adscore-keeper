/**
 * UUID do Externo de quem está logado — para carimbar autoria em escrita.
 *
 * O front autentica no Cloud; as tabelas de negócio vivem no Externo e a sessão
 * que o `externalSupabase` carrega é ANÔNIMA (`auth.users.is_anonymous = true`).
 * Ou seja: `auth.uid()` no Externo NÃO identifica a pessoa — nenhum trigger lá
 * consegue descobrir sozinho quem fez a alteração. Toda escrita que precise
 * registrar autor (`updated_by`, `created_by`, `completed_by`) tem que mandar o
 * UUID explicitamente, senão a tela mostra "sem registro".
 */
import { authClient } from '@/integrations/supabase';
import { remapToExternal } from '@/integrations/supabase/uuid-remap';

export async function currentExtUserId(): Promise<string | null> {
  const { data: { user } } = await authClient.auth.getUser();
  return remapToExternal(user?.id || null);
}
