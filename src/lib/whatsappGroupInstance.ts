import { ensureExternalSession, externalSupabase } from '@/integrations/supabase/external-client';
import { cloudFunctions } from '@/lib/functionRouter';

export const normalizeInstanceName = (s: string) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

/**
 * Instâncias DA FIRMA, em ordem de preferência por área do caso.
 *
 * Trabalhista sai pela Processual — pedido do usuário em 17/08/2026, depois de
 * um áudio morrer com "WhatsApp instance is disconnected" num grupo trabalhista
 * cuja Processual estava conectada e ativa no grupo no mesmo minuto.
 * As demais áreas mantêm a ordem antiga (Previdenciário primeiro).
 */
const SENDERS_TRABALHISTA = [
  'atendimento processual',
  'atendimento previdenciario 2',
  'atendimento previdenciario',
];
const SENDERS_PADRAO = [
  'atendimento previdenciario',
  'atendimento previdenciario 2',
  'atendimento processual',
];

// Instância que parou de espelhar o grupo há mais de 7 dias (enquanto o grupo seguiu
// ativo) provavelmente saiu dele — escolhê-la daria NOT_IN_GROUP.
const SAIU_DO_GRUPO_MS = 7 * 24 * 60 * 60 * 1000;

/** Status de conexão muda devagar e o resolver roda a cada envio. */
const STATUS_TTL_MS = 60_000;
let statusCache: { em: number; conectadas: Set<string> } | null = null;

/**
 * Nomes normalizados das instâncias conectadas AGORA, ou `null` quando não deu
 * para saber — e aí ninguém é filtrado, porque impedir o envio por causa de uma
 * checagem que falhou é pior do que tentar por uma instância possivelmente fora.
 */
async function instanciasConectadas(): Promise<Set<string> | null> {
  if (statusCache && Date.now() - statusCache.em < STATUS_TTL_MS) return statusCache.conectadas;
  try {
    const { data } = await cloudFunctions.invoke('check-whatsapp-status');
    const rows = (Array.isArray(data) ? data : []) as { instance_name?: string; connected?: boolean }[];
    if (rows.length === 0) return null;
    const conectadas = new Set(
      rows.filter(r => r?.connected && r.instance_name).map(r => normalizeInstanceName(r.instance_name!)),
    );
    statusCache = { em: Date.now(), conectadas };
    return conectadas;
  } catch {
    return null;
  }
}

/**
 * O 5º campo do CNJ (`NNNNNNN-DD.AAAA.J.TR.OOOO`) é o ramo da Justiça: `5` é
 * Trabalho. É o único sinal confiável de área que temos — `lead_processes.area`
 * está 95,6% vazia (1.797 de 1.880) e o pouco que tem é inconsistente ("CIVEL",
 * "CÍVEL", "Cível"), e 4,7% dos leads nem board têm.
 */
export function ehCnjTrabalhista(processNumber: string | null | undefined): boolean {
  const digitos = (processNumber || '').replace(/\D/g, '');
  return digitos.length === 20 && digitos[13] === '5';
}

/** O lead do grupo tem algum processo na Justiça do Trabalho? */
async function grupoEhTrabalhista(groupJid: string): Promise<boolean> {
  try {
    const { data: vinculos } = await externalSupabase
      .from('lead_whatsapp_groups')
      .select('lead_id')
      .eq('group_jid', groupJid);
    const leadIds = [...new Set(((vinculos || []) as { lead_id: string | null }[])
      .map(v => v.lead_id)
      .filter((id): id is string => !!id))];
    if (leadIds.length === 0) return false;

    const { data: processos } = await externalSupabase
      .from('lead_processes')
      .select('process_number')
      .in('lead_id', leadIds);
    return ((processos || []) as { process_number: string | null }[])
      .some(p => ehCnjTrabalhista(p.process_number));
  } catch {
    return false;
  }
}

/**
 * Resolve por qual instância enviar num GRUPO de WhatsApp.
 *
 * Grupos são espelhados por TODAS as instâncias-membro, então o histórico do
 * Externo é a fonte de quem está no grupo. Mensagem de grupo é da firma —
 * nunca resolver pela default_instance_id pessoal do usuário logado.
 *
 * Ordem de decisão:
 *  1. candidatas = espelharam o grupo e estão CONECTADAS agora;
 *  2. entre elas, a primeira instância da firma na ordem da área do caso
 *     (trabalhista → Processual), desde que não tenha sumido do grupo;
 *  3. senão, o espelho mais recente entre as conectadas;
 *  4. se nenhuma conectada sobrou, o espelho mais recente — comportamento
 *     antigo, para não deixar de tentar.
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

    const [conectadas, trabalhista] = await Promise.all([
      instanciasConectadas(),
      grupoEhTrabalhista(`${phone}@g.us`),
    ]);
    const conectada = (n: string) => !conectadas || conectadas.has(normalizeInstanceName(n));
    // Espelho antigo demais = provavelmente saiu do grupo.
    const noGrupo = (r: { created_at: string }) =>
      new Date(newest.created_at).getTime() - new Date(r.created_at).getTime() <= SAIU_DO_GRUPO_MS;

    const vivas = rows.filter(r => conectada(r.instance_name) && noGrupo(r));
    if (vivas.length === 0) return newest.instance_name;

    const ordem = trabalhista ? SENDERS_TRABALHISTA : SENDERS_PADRAO;
    for (const preferida of ordem) {
      const hit = vivas.find(r => normalizeInstanceName(r.instance_name) === preferida);
      if (hit) return hit.instance_name;
    }
    // Nenhuma da firma disponível: o espelho mais recente entre as conectadas.
    return vivas[0].instance_name;
  } catch {
    return undefined;
  }
}
