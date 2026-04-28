import { useEffect, useState } from 'react';
import { useAuthContext } from '@/contexts/AuthContext';
import { remapToExternal } from '@/integrations/supabase/uuid-remap';

/**
 * Retorna o UUID do usuário **no Supabase Externo**, mapeado a partir do
 * UUID do Cloud auth via `auth_uuid_mapping`.
 *
 * Use quando precisar gravar `created_by`, `sender_id`, `assigned_to` etc.
 * em tabelas do Externo, OU comparar com valores já gravados lá.
 *
 * - Retorna `null` enquanto o cache carrega.
 * - Se o mapping não existir (usuário recém-criado), faz fallback para o
 *   próprio UUID Cloud (mesma semântica do helper).
 */
export function useExternalUserId(): string | null {
  const { user } = useAuthContext();
  const [extId, setExtId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!user?.id) {
      setExtId(null);
      return;
    }
    remapToExternal(user.id).then(id => {
      if (!cancelled) setExtId(id);
    });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  return extId;
}
