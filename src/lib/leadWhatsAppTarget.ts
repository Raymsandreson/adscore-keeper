import { ensureExternalSession, externalSupabase } from '@/integrations/supabase/external-client';

export type LeadGroupOption = { jid: string; name: string | null; source: 'vinculado' | 'legado' };

/**
 * Grupos de WhatsApp do lead, lidos NA HORA do banco.
 *
 * Ordem: `lead_whatsapp_groups` (a mesma fonte que o CompleteAndNotifyDialog usa
 * pro texto) e, só se não houver nenhum, o campo legado `leads.whatsapp_group_id`.
 */
export async function fetchLeadGroups(leadId: string): Promise<LeadGroupOption[]> {
  await ensureExternalSession();
  const { data } = await externalSupabase
    .from('lead_whatsapp_groups')
    .select('group_jid, group_name')
    .eq('lead_id', leadId);

  const vinculados: LeadGroupOption[] = ((data || []) as any[])
    .filter((g) => g.group_jid)
    .map((g) => ({ jid: g.group_jid as string, name: (g.group_name as string) || null, source: 'vinculado' as const }));
  if (vinculados.length > 0) return vinculados;

  const { data: lead } = await externalSupabase
    .from('leads')
    .select('whatsapp_group_id, lead_name')
    .eq('id', leadId)
    .maybeSingle();
  const legacy = (lead as any)?.whatsapp_group_id as string | undefined;
  return legacy ? [{ jid: legacy, name: ((lead as any)?.lead_name as string) || null, source: 'legado' }] : [];
}

// Objeto único (e não union discriminada) porque o projeto compila com
// strictNullChecks off, e nesse modo o TS não estreita `if (!r.ok)`.
// `jid` preenchido = pode enviar; `error` preenchido = mostrar e abortar.
export type LeadAudioTarget = { jid: string | null; name: string | null; error: string | null };

/**
 * Destino do áudio de uma atividade, resolvido pelo lead da atividade no momento
 * do clique — nunca por state da tela.
 *
 * Incidente 06/08/2026: o botão "Concluir + próxima e enviar áudio no grupo" lia
 * `leadPreview.whatsapp_group_id`, um state que sobrevive à troca de atividade
 * quando a query do preview falha ou responde fora de ordem. O áudio do
 * "CG 90- Inventário Isaías" foi parar no grupo do "CASO 244" (cliente de outro
 * caso) enquanto o texto, que consulta o lead na hora, foi pro grupo certo.
 *
 * Com mais de um grupo vinculado não se adivinha: mantém o campo legado quando
 * ele está entre os vinculados (destino histórico) e, se não estiver, recusa o
 * envio e manda escolher pelo "Concluir + próxima", que tem seletor de grupo.
 */
export async function resolveLeadAudioTarget(leadId: string | null | undefined): Promise<LeadAudioTarget> {
  const fail = (error: string): LeadAudioTarget => ({ jid: null, name: null, error });
  if (!leadId) return fail('Atividade sem lead vinculado — não dá pra saber o grupo de destino.');
  let groups: LeadGroupOption[];
  try {
    groups = await fetchLeadGroups(leadId);
  } catch (e: any) {
    return fail(`Não foi possível confirmar o grupo do lead (${e?.message || 'erro'}). Áudio não enviado.`);
  }
  if (groups.length === 0) return fail('Este lead não tem grupo de WhatsApp vinculado.');
  if (groups.length === 1) return { jid: groups[0].jid, name: groups[0].name, error: null };

  const { data: lead } = await externalSupabase
    .from('leads')
    .select('whatsapp_group_id')
    .eq('id', leadId)
    .maybeSingle();
  const legacy = (lead as any)?.whatsapp_group_id as string | undefined;
  const match = legacy ? groups.find((g) => g.jid === legacy) : undefined;
  if (match) return { jid: match.jid, name: match.name, error: null };
  return fail(
    `Este lead tem ${groups.length} grupos vinculados. Use "Concluir + próxima" e escolha o grupo antes de enviar o áudio.`,
  );
}
