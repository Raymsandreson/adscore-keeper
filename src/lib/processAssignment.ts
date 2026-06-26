/**
 * Mapeamento central de "título do processo" → responsável da atividade
 * automática criada quando o processo é cadastrado.
 *
 * IDs aqui são **Cloud UUIDs**. Os pontos de inserção devem chamar
 * `remapToExternal` antes de gravar em `lead_activities` (Externo).
 */
import { supabase } from '@/integrations/supabase/client';
import { remapToExternal } from '@/integrations/supabase/uuid-remap';

export const CASO_PROCESS_ASSIGNMENTS: Record<string, { userId: string; userName: string }> = {
  'Seguro de Vida': { userId: '807018be-a633-4d2c-8f89-30d1399e4df7', userName: 'Natasha' },
  'Inquérito Policial': { userId: '1f788b8d-e30e-484a-9460-39a881d25128', userName: 'Wanessa Vitoria' },
  'Onboarding': { userId: '1f788b8d-e30e-484a-9460-39a881d25128', userName: 'Wanessa Vitoria' },
  'Indenização': { userId: '1f788b8d-e30e-484a-9460-39a881d25128', userName: 'Wanessa Vitoria' },
  'Relatório de Acidente': { userId: '807018be-a633-4d2c-8f89-30d1399e4df7', userName: 'Natasha' },
  'TRCT + Verbas': { userId: '44fd2301-47c6-4912-a583-0213b1c368eb', userName: 'João Vitor' },
  'Organizar docs': { userId: '7f41a35e-7d98-4ade-8270-52d727433e6a', userName: 'Abderaman' },
};

// Opções dinâmicas usadas pelo Benefício INSS quando o caso é da família PREV.
export const INSS_PREV_OPTIONS: Array<{ userId: string; userName: string }> = [
  { userId: 'fdb5c9af-ec75-45c5-a6a3-a1b8a4dd84fe', userName: 'Maria Lydia' },
  { userId: '3dbad7c4-2bce-4bb8-9fb5-2c53784f86f8', userName: 'Thaíres' },
  { userId: '1d6f6602-5274-427c-8b70-54b6e19dc524', userName: 'Vanessa' },
];

// Maria Clara (Cloud UUID) — atribuição padrão de INSS para títulos de CASO.
export const INSS_CASO_DEFAULT = {
  userId: '1e488175-be0a-4726-a80f-1b00cf89cfb3',
  userName: 'Maria Clara',
};

/**
 * Resolve quem fica com a atividade automática "Dar andamento" para um processo
 * recém-cadastrado. Já devolve `extAssignedTo` (UUID Externo) pronto pra gravar.
 *
 * - Mapa fixo (Natasha, João Vitor, Wanessa, Abderaman) → vence sempre.
 * - "Benefício INSS" tem regra especial baseada no **título do caso**:
 *   - contém "PREV"  → abre um prompt nativo para escolher entre Maria Lydia,
 *     Thaíres ou Vanessa.
 *   - contém "CASO"  → Maria Clara.
 *   - nenhum dos dois → fallback no criador do caso.
 */
export async function resolveProcessAssignment(
  processTitle: string,
  caseTitle: string | null | undefined,
  currentUserId: string | undefined,
  caseNumber?: string | null | undefined,
): Promise<{ extAssignedTo: string | null; assignedName: string | null }> {
  const mapped = CASO_PROCESS_ASSIGNMENTS[processTitle];
  if (mapped) {
    const ext = await remapToExternal(mapped.userId);
    return { extAssignedTo: ext, assignedName: mapped.userName };
  }

  if (processTitle === 'Benefício INSS') {
    // Olhamos title + case_number juntos. Usuários frequentemente nomeiam casos
    // sem "PREV"/"CASO" no título (ex: "✅Familia 384 Cocal...") mas o
    // case_number sempre carrega o prefixo do funil ("CASO 384", "PREV 1607").
    const haystack = `${caseTitle || ''} ${caseNumber || ''}`.toUpperCase();
    if (haystack.includes('PREV')) {
      const choice = await pickInssPrevAssignee();
      if (choice) {
        const ext = await remapToExternal(choice.userId);
        return { extAssignedTo: ext, assignedName: choice.userName };
      }
      // usuário cancelou → cai para fallback no criador
    } else if (haystack.includes('CASO')) {
      const ext = await remapToExternal(INSS_CASO_DEFAULT.userId);
      return { extAssignedTo: ext, assignedName: INSS_CASO_DEFAULT.userName };
    }
    // fallback abaixo (criador)
  }


  if (currentUserId) {
    let name: string | null = null;
    try {
      const { data: prof } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('user_id', currentUserId)
        .maybeSingle();
      name = prof?.full_name || null;
    } catch {}
    const ext = await remapToExternal(currentUserId);
    return { extAssignedTo: ext, assignedName: name };
  }

  return { extAssignedTo: null, assignedName: null };
}

/**
 * Prompt nativo simples (window.prompt) para escolher o responsável do
 * Benefício INSS quando o caso é PREV. Retorna null se o usuário cancelar
 * ou digitar opção inválida.
 *
 * Optamos por prompt nativo para evitar refatorar 4 pontos de criação
 * diferentes para gerenciar estado de modal.
 */
function pickInssPrevAssignee(): { userId: string; userName: string } | null {
  if (typeof window === 'undefined') return null;
  const lines = INSS_PREV_OPTIONS.map((o, i) => `${i + 1} - ${o.userName}`).join('\n');
  const answer = window.prompt(
    `Benefício INSS (caso PREV) — escolha o responsável:\n\n${lines}\n\nDigite o número:`,
    '1',
  );
  if (!answer) return null;
  const idx = parseInt(answer.trim(), 10) - 1;
  if (Number.isNaN(idx) || idx < 0 || idx >= INSS_PREV_OPTIONS.length) {
    window.alert('Opção inválida. Nenhum responsável atribuído.');
    return null;
  }
  return INSS_PREV_OPTIONS[idx];
}
