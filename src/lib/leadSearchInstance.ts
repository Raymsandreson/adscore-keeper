import { supabase } from '@/integrations/supabase/client';
import { ensureExternalSession, externalSupabase } from '@/integrations/supabase/external-client';
import { ensureRemapCache, remapToExternalSync } from '@/integrations/supabase/uuid-remap';
import { normalizeInstanceName } from '@/lib/whatsappGroupInstance';

// Mesmas instâncias "da firma" preferidas no envio para grupo — são as que
// participam da maioria dos grupos de cliente, então dão o melhor resultado
// quando o lead ainda não tem histórico próprio.
const PREFERRED = ['atendimento previdenciario', 'atendimento previdenciario 2'];

/**
 * Resolve a instância usada para BUSCAR grupos de um lead. É leitura pura
 * (listar grupos / participantes) — nunca use isto para decidir por onde
 * ENVIAR mensagem de grupo: para envio vale `resolveGroupSenderInstanceName`,
 * que só considera quem tem espelho recente no próprio grupo.
 *
 * Cadeia, do mais específico ao mais genérico:
 *   1. instância que espelha o histórico do próprio lead;
 *   2. `default_instance_id` do perfil de quem está logado (só 8 de 4.161
 *      perfis têm o campo preenchido — por isso não dá para parar aqui);
 *   3. instância ativa agora, medida pelo espelho global mais recente.
 *
 * `undefined` = nenhuma resolvida. Não é bloqueio: a busca por NOME varre
 * todas as instâncias no backend e funciona sem instância definida.
 */
export async function resolveLeadSearchInstanceName(leadId?: string): Promise<string | undefined> {
  try {
    await ensureExternalSession();
  } catch {/* segue: as queries abaixo têm try próprio */}

  // 1) Espelho do próprio lead — cobre ~63% dos leads com atividade recente.
  if (leadId) {
    try {
      const { data } = await externalSupabase
        .from('whatsapp_messages')
        .select('instance_name')
        .eq('lead_id', leadId)
        .not('instance_name', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1);
      const name = (data?.[0] as { instance_name?: string } | undefined)?.instance_name;
      if (name) return name;
    } catch {/* cai para a próxima camada */}
  }

  // 2) Instância padrão de quem está logado. O `profiles` do Externo é a fonte
  // da verdade (é lá que o ProfilePage grava), com o Cloud só completando quem
  // configurou pelo painel da equipe — e os user_id diferem entre os bancos.
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await ensureRemapCache();
      const extUserId = remapToExternalSync(user.id) || user.id;
      const [extRes, cloudRes] = await Promise.all([
        externalSupabase.from('profiles').select('default_instance_id').eq('user_id', extUserId).maybeSingle(),
        supabase.from('profiles').select('default_instance_id').eq('user_id', user.id).maybeSingle(),
      ]);
      const defaultId =
        (extRes.data as { default_instance_id?: string } | null)?.default_instance_id ||
        (cloudRes.data as { default_instance_id?: string } | null)?.default_instance_id;
      if (defaultId) {
        const { data: inst } = await externalSupabase
          .from('whatsapp_instances')
          .select('instance_name')
          .eq('id', defaultId)
          .maybeSingle();
        const name = (inst as { instance_name?: string } | null)?.instance_name;
        if (name) return name;
      }
    }
  } catch {/* cai para a próxima camada */}

  // 3) Instância ativa no momento: quem aparece no espelho global mais recente.
  // Índice `idx_whatsapp_messages_created_at (created_at DESC)` cobre a leitura.
  try {
    const { data } = await externalSupabase
      .from('whatsapp_messages')
      .select('instance_name')
      .not('instance_name', 'is', null)
      .order('created_at', { ascending: false })
      .limit(100);
    const rows = (data || []) as { instance_name: string }[];
    const preferred = rows.find((r) => PREFERRED.includes(normalizeInstanceName(r.instance_name)));
    return preferred?.instance_name || rows[0]?.instance_name || undefined;
  } catch {
    return undefined;
  }
}
