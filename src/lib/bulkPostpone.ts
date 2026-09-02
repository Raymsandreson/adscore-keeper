/**
 * Divisão do lote no "Adiar" de várias atividades de uma vez.
 *
 * O adiar individual (PostponeActivityPopover → useLeadActivities.updateActivity)
 * bloqueia prazo que cai em ausência registrada e não mexe em concluída. Em lote
 * bloquear tudo por causa de uma linha seria pior do que inútil: a pessoa marca
 * 40 atividades e o botão recusa sem dizer qual. Então aqui as exceções são
 * SEPARADAS e relatadas — o resto do lote anda.
 *
 * Função pura de propósito: é a regra que decide o que vai ser reescrito no
 * banco, e ela precisa de teste sem tocar em Supabase.
 */

export interface AtividadeAdiavel {
  id: string;
  status: string;
  title?: string | null;
  /** UUID do Externo (é assim que a linha guarda o responsável). */
  assigned_to?: string | null;
  assigned_to_ids?: string[] | null;
}

export interface PlanoAdiamento<T extends AtividadeAdiavel> {
  /** O que recebe o prazo novo. */
  adiar: T[];
  /** Concluída não se adia — a data dela registra quando o trabalho foi feito. */
  concluidas: T[];
  /** Responsável de férias/folga no dia escolhido: fica de fora, com o motivo. */
  ausentes: { a: T; motivo: string }[];
}

/**
 * @param activities   as marcadas na tela (objetos completos)
 * @param ausentes     Cloud UUID → motivo já formatado ("Fulana — Férias de X a Y"),
 *                     só de quem está ausente NA DATA escolhida
 * @param paraCloud    ext UUID → Cloud UUID (member_time_off guarda Cloud UUID)
 */
export function planejarAdiamento<T extends AtividadeAdiavel>(
  activities: T[],
  ausentes: Map<string, string>,
  paraCloud: (extId: string | null | undefined) => string | null,
): PlanoAdiamento<T> {
  const plano: PlanoAdiamento<T> = { adiar: [], concluidas: [], ausentes: [] };
  for (const a of activities) {
    if (a.status === 'concluida') { plano.concluidas.push(a); continue; }
    // Co-assessor também tem a agenda mexida — férias dele conta igual.
    const responsaveis = [a.assigned_to, ...(a.assigned_to_ids || [])];
    let motivo: string | null = null;
    for (const ext of responsaveis) {
      const cloud = paraCloud(ext);
      const m = cloud ? ausentes.get(cloud) : null;
      if (m) { motivo = m; break; }
    }
    if (motivo) plano.ausentes.push({ a, motivo });
    else plano.adiar.push(a);
  }
  return plano;
}

/** Ids do Cloud dos responsáveis do lote, sem repetir — entrada do getTimeOffConflicts. */
export function responsaveisNoCloud(
  activities: AtividadeAdiavel[],
  paraCloud: (extId: string | null | undefined) => string | null,
): string[] {
  const ids = new Set<string>();
  for (const a of activities) {
    if (a.status === 'concluida') continue;
    for (const ext of [a.assigned_to, ...(a.assigned_to_ids || [])]) {
      const cloud = paraCloud(ext);
      if (cloud) ids.add(cloud);
    }
  }
  return [...ids];
}
