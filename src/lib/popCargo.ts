// =============================================================================
// Cargo → membro, pelo time vinculado ao POP.
//
// Fonte: team_member_cargos (Externo) — cargo por membro de cada time, texto
// livre, chaveado por NOME do time. O POP guarda o ID do time
// (settings.responsible_team_id), então a tradução passa por teams (id → name)
// antes de chegar aos cargos. Renomear o time pelo TeamsManager migra as
// linhas de cargo para o novo nome (desde 13/08/2026); se um rename entrar
// por outra via e órfã-los, este módulo devolve vazio (e a cascata segue
// pelos degraus de pessoa). Edição inline dos cargos no contexto do POP:
// src/components/workflow/PopTeamCargosSection.tsx.
//
// Regra de empate: cargo com MAIS DE UM ocupante no time não resolve (null).
// Dono de passo precisa ser único — premissa do sino e das atividades — e
// escolher um dos dois aqui seria arbitrariedade silenciosa. O editor do POP
// avisa; a cascata desce para o próximo degrau.
// =============================================================================
import { externalSupabase, ensureExternalSession } from '@/integrations/supabase/external-client';
import { supabase } from '@/integrations/supabase/client';

export interface CargoMap {
  /** Cargos existentes no time (nome de exibição, sem duplicatas). */
  cargos: string[];
  /** user_id do único ocupante do cargo, ou null (inexistente ou empate). */
  membroPorCargo: (cargo: string) => string | null;
  /** Quantos membros ocupam o cargo — o editor usa pra avisar empate. */
  ocupantes: (cargo: string) => number;
}

const VAZIO: CargoMap = { cargos: [], membroPorCargo: () => null, ocupantes: () => 0 };

const chave = (cargo: string) => cargo.trim().toLowerCase();

/**
 * Carrega os cargos do time vinculado ao POP. Sem time (ou com erro de rede)
 * devolve o mapa vazio — quem consome cai nos degraus de pessoa da cascata.
 */
export async function fetchCargoMap(teamId: string | null | undefined): Promise<CargoMap> {
  if (!teamId) return VAZIO;
  try {
    await ensureExternalSession();
    const { data: team } = await externalSupabase
      .from('teams')
      .select('name')
      .eq('id', teamId)
      .maybeSingle();
    const teamName = (team as { name?: string } | null)?.name;
    if (!teamName) return VAZIO;

    const { data: rows } = await (externalSupabase as any)
      .from('team_member_cargos')
      .select('user_id, cargo')
      .eq('team_name', teamName);

    const porCargo = new Map<string, { display: string; userIds: string[] }>();
    for (const r of ((rows as { user_id: string; cargo: string | null }[]) || [])) {
      const display = (r.cargo || '').trim();
      if (!display) continue;
      const k = chave(display);
      const entry = porCargo.get(k) || { display, userIds: [] };
      entry.userIds.push(r.user_id);
      porCargo.set(k, entry);
    }

    // Cargos FORMAIS (job_positions, Cloud) entram como opção mesmo sem
    // ocupante no time — é o que fecha o ciclo "IA sugere cargo → usuário
    // confirma e cria → IA/usuário atribui nos passos → pessoa é definida
    // depois". Sem ocupante o cargo não resolve (membroPorCargo null) e a
    // cascata segue; o seletor mostra "— ninguém no time".
    try {
      const { data: posRows } = await (supabase as any)
        .from('job_positions').select('name').eq('is_active', true);
      for (const p of ((posRows as { name: string | null }[]) || [])) {
        const display = (p.name || '').trim();
        if (!display) continue;
        const k = chave(display);
        if (!porCargo.has(k)) porCargo.set(k, { display, userIds: [] });
      }
    } catch (e) {
      console.warn('Cargos formais indisponíveis (segue só com os do time):', e);
    }

    return {
      cargos: [...porCargo.values()].map(e => e.display).sort((a, b) => a.localeCompare(b)),
      membroPorCargo: (cargo: string) => {
        const e = porCargo.get(chave(cargo));
        return e && e.userIds.length === 1 ? e.userIds[0] : null;
      },
      ocupantes: (cargo: string) => porCargo.get(chave(cargo))?.userIds.length ?? 0,
    };
  } catch (e) {
    console.error('Erro ao carregar cargos do time (cascata segue por pessoa):', e);
    return VAZIO;
  }
}
