import { externalSupabase, ensureExternalSession } from '@/integrations/supabase/external-client';

/**
 * Previsão de ausências da equipe (aba Férias em Gestão de Equipe).
 * Tabela member_time_off no Externo; user_id é o Cloud UUID (o mesmo dos
 * seletores de assessor). O bloqueio de atividade roda antes do remap.
 */

export type TimeOffType = 'ferias' | 'compensacao' | 'folga';

export const TIME_OFF_TYPE_LABELS: Record<TimeOffType, string> = {
  ferias: 'Férias',
  compensacao: 'Compensação de horas',
  folga: 'Folga',
};

export interface TimeOffEntry {
  id: string;
  user_id: string;
  user_name: string | null;
  type: TimeOffType;
  start_date: string; // YYYY-MM-DD
  end_date: string;   // YYYY-MM-DD
  note: string | null;
  created_by: string | null;
  created_at: string;
}

export function formatBrDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

export function describeTimeOff(t: TimeOffEntry): string {
  const period = t.start_date === t.end_date
    ? `em ${formatBrDate(t.start_date)}`
    : `de ${formatBrDate(t.start_date)} a ${formatBrDate(t.end_date)}`;
  return `${TIME_OFF_TYPE_LABELS[t.type] || t.type} ${period}`;
}

/**
 * Retorna as ausências que cobrem a data informada para qualquer um dos
 * usuários (Cloud UUIDs). Data no formato YYYY-MM-DD (aceita datetime — usa
 * só a parte da data). Em erro de rede, retorna [] para não travar o fluxo.
 */
export async function getTimeOffConflicts(
  userIds: (string | null | undefined)[],
  date: string | null | undefined,
): Promise<TimeOffEntry[]> {
  const ids = [...new Set(userIds.filter(Boolean))] as string[];
  const day = (date || '').slice(0, 10);
  if (ids.length === 0 || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return [];
  try {
    await ensureExternalSession();
    const { data, error } = await (externalSupabase as any)
      .from('member_time_off')
      .select('*')
      .in('user_id', ids)
      .lte('start_date', day)
      .gte('end_date', day);
    if (error) throw error;
    return (data || []) as TimeOffEntry[];
  } catch (e) {
    console.warn('[timeOff] Falha ao checar ausências (seguindo sem bloquear):', e);
    return [];
  }
}
