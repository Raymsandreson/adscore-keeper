import { ensureExternalSession, externalSupabase } from '@/integrations/supabase/external-client';

export const normalizeInstanceName = (s: string) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

const PREFERRED_GROUP_SENDERS = ['atendimento previdenciario', 'atendimento previdenciario 2'];

// Instância que parou de espelhar o grupo há mais de 7 dias (enquanto o grupo seguiu
// ativo) provavelmente saiu dele — escolhê-la daria NOT_IN_GROUP.
const SAIU_DO_GRUPO_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Resolve por qual instância enviar num GRUPO de WhatsApp: prioriza
 * Atendimento Previdenciário 1/2 quando são membros (têm espelho recente no
 * histórico do grupo); senão, a instância do espelho mais recente.
 *
 * Grupos são espelhados por TODAS as instâncias-membro, então o histórico do
 * Externo é a fonte de quem está no grupo. Mensagem de grupo é da firma —
 * nunca resolver pela default_instance_id pessoal do usuário logado.
 *
 * `undefined` = sem histórico utilizável; deixar a edge send-whatsapp decidir
 * (ela tem o próprio fallback de instância-membro).
 */
export async function resolveGroupSenderInstanceName(groupTarget: string): Promise<string | undefined> {
  const phone = groupTarget.replace(/@.*$/, '').replace(/\D/g, '');
  if (!phone) return undefined;
  try {
    await ensureExternalSession();
    const { data } = await externalSupabase
      .from('whatsapp_messages')
      .select('instance_name, created_at')
      .eq('phone', phone)
      .not('instance_name', 'is', null)
      .order('created_at', { ascending: false })
      .limit(150);
    const rows = (data || []) as { instance_name: string; created_at: string }[];
    const newest = rows[0];
    if (!newest) return undefined;
    const preferred = rows.find(r => PREFERRED_GROUP_SENDERS.includes(normalizeInstanceName(r.instance_name)));
    const aindaNoGrupo =
      preferred &&
      new Date(newest.created_at).getTime() - new Date(preferred.created_at).getTime() <= SAIU_DO_GRUPO_MS;
    return aindaNoGrupo ? preferred.instance_name : newest.instance_name;
  } catch {
    return undefined;
  }
}
