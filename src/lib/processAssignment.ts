/**
 * Mapeamento central de "título do processo" → responsável da atividade
 * automática criada quando o processo é cadastrado.
 *
 * IDs aqui são **Cloud UUIDs**. Os pontos de inserção devem chamar
 * `remapToExternal` antes de gravar em `lead_activities` (Externo).
 */
import { supabase } from '@/integrations/supabase/client';
import { externalSupabase } from '@/integrations/supabase/external-client';
import { remapToExternal, remapToCloud } from '@/integrations/supabase/uuid-remap';
import { formatProcessLabel } from '@/lib/processLabel';


export const CASO_PROCESS_ASSIGNMENTS: Record<string, { userId: string; userName: string }> = {
  'Seguro de Vida': { userId: '807018be-a633-4d2c-8f89-30d1399e4df7', userName: 'Natasha' },
  'Inquérito Policial': { userId: '1f788b8d-e30e-484a-9460-39a881d25128', userName: 'Wanessa Vitoria' },
  'Onboarding': { userId: '1f788b8d-e30e-484a-9460-39a881d25128', userName: 'Wanessa Vitoria' },
  'Indenização': { userId: '1f788b8d-e30e-484a-9460-39a881d25128', userName: 'Wanessa Vitoria' },
  'Relatório de Acidente': { userId: '807018be-a633-4d2c-8f89-30d1399e4df7', userName: 'Natasha' },
  'TRCT + Verbas': { userId: '44fd2301-47c6-4912-a583-0213b1c368eb', userName: 'João Vitor' },
  'Organizar docs': { userId: '7f41a35e-7d98-4ade-8270-52d727433e6a', userName: 'Abderaman' },
};

export interface PrevAssignee {
  /** Cloud UUID — passa por `remapToExternal` antes de gravar. */
  userId: string;
  /** Nome canônico gravado em `assigned_to_name` (mesmo full_name do profiles). */
  userName: string;
  /** Rótulo curto exibido no prompt de escolha. */
  shortName: string;
}

/**
 * Assessores que podem receber o Benefício INSS de um caso PREV.
 * A ordem define a numeração do prompt — mudar aqui muda o que o usuário digita.
 */
export const INSS_PREV_OPTIONS: PrevAssignee[] = [
  { userId: '04826c43-15e1-48b8-b54f-51d3fe532651', userName: 'Andressa Leão da Silva Duarte', shortName: 'Andressa' },
  // Keliane Sousa Amorim Araújo — NÃO confundir com KEILANE DE LIMA TEIXEIRA
  // (f0a5dad8…), que está na ASSIGNEE_BLOCKLIST e não é funcionária.
  { userId: '5b5ac716-69de-4f4a-9370-0bc63816cda3', userName: 'Keliane Sousa Amorim Araújo', shortName: 'Keliane' },
  { userId: 'e1849012-7d6b-49b9-a5e5-36a2332e6eb8', userName: 'Jose Francisco Campos de Oliveira', shortName: 'José' },
  { userId: 'fdb5c9af-ec75-45c5-a6a3-a1b8a4dd84fe', userName: 'Maria Lydia Ribeiro', shortName: 'Maria Lydia' },
  { userId: '1d6f6602-5274-427c-8b70-54b6e19dc524', userName: 'Vanessa Miranda Macêdo', shortName: 'Vanessa' },
  { userId: '4dba2de0-5357-49ab-8bf9-4c248a1440de', userName: 'Gisele Borges dos Santos', shortName: 'Gisele' },
  { userId: '461d55d7-7185-4b47-98fb-f4f1505cba1d', userName: 'ISABELA MARIA DE SOUSA ANDRADE', shortName: 'Isabela' },
];

/**
 * Rodízio do PREV **administrativo**, pelo último dígito do número do caso:
 * 0-1 Andressa · 2-3 Keliane · 4-5 José · 6-7 Maria Lydia · 8-9 Vanessa.
 * Valores são índices em `INSS_PREV_OPTIONS`.
 */
const PREV_ADMIN_BY_DIGIT = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4] as const;

/** PREV **judicial**: final ímpar → Gisele, final par → Isabela. */
const PREV_JUD_ODD = 5;
const PREV_JUD_EVEN = 6;

/**
 * Um caso PREV pode ter as duas frentes ao mesmo tempo, e aí tem **dois
 * responsáveis** — um por trilha, cada um na sua coluna de `legal_cases`.
 */
export type PrevTrilha = 'administrativo' | 'judicial';

export const COLUNA_RESPONSAVEL: Record<PrevTrilha, string> = {
  administrativo: 'assigned_to',
  judicial: 'assigned_to_judicial',
};

/**
 * Extrai o número do PREV ("✅PREV 1984 - AMANDA…" → "1984"). O `case_number`
 * tem prioridade sobre o título porque é ele que carrega o prefixo do funil de
 * forma consistente; o título é renomeado à mão pela equipe.
 */
export function extractPrevNumber(
  caseNumber?: string | null,
  caseTitle?: string | null,
): string | null {
  for (const source of [caseNumber, caseTitle]) {
    const m = String(source || '').match(/PREV[^0-9A-Za-z]{0,4}(\d{1,6})/i);
    if (m) return m[1];
  }
  return null;
}

/** `true` para 'judicial' (e variações de caixa); qualquer outra coisa é administrativo. */
export function isJudicialProcess(processType?: string | null): boolean {
  return String(processType || '').trim().toLowerCase().startsWith('jud');
}

/**
 * Quem o prompt já deixa pré-selecionado. Retorna null quando não dá pra
 * extrair o número do PREV — aí o usuário escolhe do zero, sem chute nosso.
 */
export function suggestPrevAssignee(
  prevNumber: string | null,
  judicial: boolean,
): PrevAssignee | null {
  if (!prevNumber) return null;
  const lastDigit = Number(prevNumber.slice(-1));
  if (Number.isNaN(lastDigit)) return null;
  const idx = judicial
    ? (lastDigit % 2 === 0 ? PREV_JUD_EVEN : PREV_JUD_ODD)
    : PREV_ADMIN_BY_DIGIT[lastDigit];
  return INSS_PREV_OPTIONS[idx] ?? null;
}

// Maria Clara (Cloud UUID) — atribuição padrão de INSS para títulos de CASO.
export const INSS_CASO_DEFAULT = {
  userId: '1e488175-be0a-4726-a80f-1b00cf89cfb3',
  userName: 'Maria Clara',
};

/** `true` quando título ou número do caso identificam um caso do funil PREV. */
export function isPrevCase(
  caseTitle?: string | null,
  caseNumber?: string | null,
): boolean {
  return `${caseTitle || ''} ${caseNumber || ''}`.toUpperCase().includes('PREV');
}

/**
 * Lê o responsável do caso na trilha pedida (**UUID Externo**).
 *
 * O nome sai do `INSS_PREV_OPTIONS` quando o uuid é de um dos 7 assessores
 * (fonte canônica do `assigned_to_name` das atividades); para qualquer outro
 * usuário cai no `profiles` do Externo, que casa por `user_id` — `profiles.id`
 * dá null para praticamente todo mundo.
 */
export async function getCaseAssignee(
  caseId: string | null | undefined,
  trilha: PrevTrilha = 'administrativo',
): Promise<{ extUuid: string; name: string | null; option: PrevAssignee | null } | null> {
  if (!caseId) return null;
  const coluna = COLUNA_RESPONSAVEL[trilha];
  try {
    const { data } = await externalSupabase
      .from('legal_cases')
      .select(coluna)
      .eq('id', caseId)
      .maybeSingle();
    const extUuid = (data as any)?.[coluna] as string | null;
    if (!extUuid) return null;

    const cloudUuid = await remapToCloud(extUuid);
    const known = INSS_PREV_OPTIONS.find((o) => o.userId === cloudUuid) || null;
    if (known) return { extUuid, name: known.userName, option: known };

    const { data: prof } = await externalSupabase
      .from('profiles')
      .select('full_name')
      .eq('user_id', extUuid)
      .maybeSingle();
    return { extUuid, name: (prof as any)?.full_name || null, option: null };
  } catch {
    return null;
  }
}

/** Grava o responsável da trilha. Silencioso em erro: nunca deve travar o cadastro. */
export async function setCaseAssignee(
  caseId: string | null | undefined,
  extUuid: string | null,
  trilha: PrevTrilha = 'administrativo',
): Promise<void> {
  if (!caseId || !extUuid) return;
  try {
    await externalSupabase
      .from('legal_cases')
      .update({ [COLUNA_RESPONSAVEL[trilha]]: extUuid } as never)
      .eq('id', caseId);
  } catch (e: any) {
    console.warn('[setCaseAssignee] falhou:', e?.message);
  }
}

/**
 * Prompt de responsável na **criação** de um caso PREV. Retorna null para
 * qualquer caso que não seja PREV (nada muda) e também quando o usuário
 * cancela — nesse caso `assigned_to` fica nulo e o primeiro processo
 * administrativo do caso volta a perguntar.
 *
 * Sugere pelo rodízio administrativo: na criação ainda não existe processo,
 * então não há como saber se será judicial.
 */
export async function pickCaseAssigneeForNewCase(
  caseNumber?: string | null,
  caseTitle?: string | null,
): Promise<{ extAssignedTo: string; assignedName: string } | null> {
  if (!isPrevCase(caseTitle, caseNumber)) return null;
  const choice = pickInssPrevAssignee(
    extractPrevNumber(caseNumber, caseTitle),
    false,
    { kind: 'novo-caso' },
  );
  if (!choice) return null;
  const ext = await remapToExternal(choice.userId);
  if (!ext) return null;
  return { extAssignedTo: ext, assignedName: choice.userName };
}

/**
 * Resolve quem fica com a atividade automática "Dar andamento" para um processo
 * recém-cadastrado. Já devolve `extAssignedTo` (UUID Externo) pronto pra gravar.
 *
 * Ordem de precedência:
 *
 * 1. **Caso PREV** → o responsável mora no caso e vence tudo, **inclusive o
 *    mapa fixo**: num caso PREV até a atividade automática de "Seguro de Vida"
 *    ou "Organizar docs" fica com o assessor do caso (decisão da firma,
 *    ago/2026). São **duas trilhas independentes**, porque um caso pode ter as
 *    duas frentes ao mesmo tempo:
 *      - administrativa → `assigned_to`, rodízio pelo último dígito;
 *      - judicial       → `assigned_to_judicial`, Gisele/ímpar ou Isabela/par.
 *    O primeiro processo de cada trilha define o dono dela (prompt); daí em
 *    diante todo processo daquela trilha herda calado. Uma trilha nunca
 *    sobrescreve a outra.
 * 2. Fora do PREV, mapa fixo (Natasha, João Vitor, Wanessa, Abderaman).
 * 3. "Benefício INSS" em caso "CASO" → Maria Clara.
 * 4. Nada disso → fallback no criador.
 */
export async function resolveProcessAssignment(
  processTitle: string,
  caseTitle: string | null | undefined,
  currentUserId: string | undefined,
  caseNumber?: string | null | undefined,
  processType?: string | null | undefined,
  caseId?: string | null | undefined,
): Promise<{ extAssignedTo: string | null; assignedName: string | null }> {
  // Olhamos title + case_number juntos. Usuários frequentemente nomeiam casos
  // sem "PREV"/"CASO" no título (ex: "✅Familia 384 Cocal...") mas o
  // case_number sempre carrega o prefixo do funil ("CASO 384", "PREV 1607").
  if (isPrevCase(caseTitle, caseNumber)) {
    const judicial = isJudicialProcess(processType);
    const trilha: PrevTrilha = judicial ? 'judicial' : 'administrativo';

    // A trilha já tem dono: herda calado. Nunca olha a outra trilha.
    const current = await getCaseAssignee(caseId, trilha);
    if (current) return { extAssignedTo: current.extUuid, assignedName: current.name };

    // Primeiro processo desta trilha no caso: pergunta e fixa o dono dela.
    const choice = pickInssPrevAssignee(
      extractPrevNumber(caseNumber, caseTitle),
      judicial,
      { kind: judicial ? 'primeiro-judicial' : 'sem-responsavel' },
    );
    if (choice) {
      const ext = await remapToExternal(choice.userId);
      await setCaseAssignee(caseId, ext, trilha);
      return { extAssignedTo: ext, assignedName: choice.userName };
    }
    return fallbackNoCriador(currentUserId);
  }

  const mapped = CASO_PROCESS_ASSIGNMENTS[processTitle];
  if (mapped) {
    const ext = await remapToExternal(mapped.userId);
    return { extAssignedTo: ext, assignedName: mapped.userName };
  }

  if (processTitle === 'Benefício INSS'
      && `${caseTitle || ''} ${caseNumber || ''}`.toUpperCase().includes('CASO')) {
    const ext = await remapToExternal(INSS_CASO_DEFAULT.userId);
    return { extAssignedTo: ext, assignedName: INSS_CASO_DEFAULT.userName };
  }

  return fallbackNoCriador(currentUserId);
}

/** Último recurso: a atividade fica com quem está cadastrando. */
async function fallbackNoCriador(
  currentUserId: string | undefined,
): Promise<{ extAssignedTo: string | null; assignedName: string | null }> {
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
 * Mesma decisão do `resolveProcessAssignment`, mas buscando título e número do
 * caso a partir do `caseId` — que é o que os pontos de cadastro têm em mãos.
 */
export async function resolveAssignmentForCase(
  processTitle: string,
  caseId: string,
  currentUserId: string | undefined,
  processType?: string | null | undefined,
): Promise<{ extAssignedTo: string | null; assignedName: string | null }> {
  let caseTitle: string | null = null;
  let caseNumber: string | null = null;
  try {
    const { data } = await externalSupabase
      .from('legal_cases')
      .select('title, case_number')
      .eq('id', caseId)
      .maybeSingle();
    caseTitle = (data as any)?.title || null;
    caseNumber = (data as any)?.case_number || null;
  } catch {}
  return resolveProcessAssignment(processTitle, caseTitle, currentUserId, caseNumber, processType, caseId);
}

/** Em qual dos três momentos o prompt está sendo aberto. */
interface PrevPromptContext {
  kind: 'novo-caso' | 'primeiro-judicial' | 'sem-responsavel';
}

/**
 * Prompt nativo simples (window.prompt) para escolher o responsável de um
 * caso PREV. Retorna null se o usuário cancelar ou digitar opção inválida.
 *
 * A lista traz todos os assessores; o rodízio só decide qual já vem digitado
 * no campo — quem está criando pode sobrescrever.
 *
 * Optamos por prompt nativo para evitar refatorar 5 pontos de criação
 * diferentes para gerenciar estado de modal.
 */
function pickInssPrevAssignee(
  prevNumber: string | null,
  judicial: boolean,
  ctx: PrevPromptContext,
): PrevAssignee | null {
  if (typeof window === 'undefined') return null;

  const suggested = suggestPrevAssignee(prevNumber, judicial);
  const suggestedIdx = suggested ? INSS_PREV_OPTIONS.indexOf(suggested) : -1;

  const lines = INSS_PREV_OPTIONS
    .map((o, i) => `${i + 1} - ${o.shortName}${i === suggestedIdx ? '   ← sugerido' : ''}`)
    .join('\n');

  const alvo = prevNumber
    ? `PREV ${prevNumber} (final ${prevNumber.slice(-1)})`
    : 'caso PREV';
  const titulo = {
    'novo-caso': `Novo caso ${alvo}\nQuem responde pela parte ADMINISTRATIVA?`,
    'primeiro-judicial': `1º processo JUDICIAL do ${alvo}\nQuem responde pela parte JUDICIAL?\n(não muda o responsável administrativo)`,
    'sem-responsavel': `${alvo} ainda sem responsável administrativo\nQuem responde por ele?`,
  }[ctx.kind];

  const answer = window.prompt(
    `${titulo}\n\n${lines}\n\nDigite o número:`,
    suggestedIdx >= 0 ? String(suggestedIdx + 1) : '',
  );
  if (!answer) return null;
  const idx = parseInt(answer.trim(), 10) - 1;
  if (Number.isNaN(idx) || idx < 0 || idx >= INSS_PREV_OPTIONS.length) {
    window.alert('Opção inválida. Nenhum responsável atribuído.');
    return null;
  }
  return INSS_PREV_OPTIONS[idx];
}

/**
 * Cria a atividade "Dar andamento - <titulo>" do processo recém-cadastrado.
 *
 * Existe um índice único parcial em `lead_activities` (lead_id + lower(trim(title))
 * + activity_type, WHERE status='pendente') que impede duplicar pendentes para o
 * mesmo lead. Se já existe uma pendente com o mesmo título (caso clássico:
 * atividade-fantasma criada antes do caso existir), em vez de violar a constraint
 * e perder a atividade, **anexamos a pendente existente** ao caso/processo novo.
 *
 * Retorna { ok, mode: 'inserted'|'attached'|'skipped', error? }.
 */
export interface AndamentoActivityInput {
  /** Null em caso órfão (lead purgado): a atividade nasce ligada só ao caso. */
  leadId: string | null;
  caseId: string | null;
  caseTitle?: string | null;
  processId: string | null;
  processTitle: string;
  /** Nº do processo. Se omitido, é buscado em `lead_processes` pelo processId. */
  processNumber?: string | null;
  extAssignedTo: string | null;
  assignedName: string | null;
  extCreatedBy: string | null;
}

/** `%` e `_` em título de processo viram curinga no ilike e casam com atividade alheia. */
function escapeLike(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/[%_]/g, (c) => `\\${c}`);
}

export async function createOrAttachAndamentoActivity(
  input: AndamentoActivityInput,
): Promise<{ ok: boolean; mode: 'inserted' | 'attached' | 'skipped'; error?: string }> {
  const title = `Dar andamento - ${input.processTitle}`;
  const today = new Date().toISOString().slice(0, 10);
  const description = `Atividade criada automaticamente para o processo: ${input.processTitle}`;

  // Sem process_id a atividade nasce órfã: o lápis "Editar processo" não abre
  // nada, o nº do processo não aparece e o usuário não consegue editá-la.
  // Falhar visível é melhor do que gerar mais uma inútil.
  if (!input.processId) {
    return { ok: false, mode: 'skipped', error: 'processo não retornou id — atividade não criada' };
  }

  // `process_title` da atividade tem que sair no mesmo formato que o formulário
  // grava ("<nº> - <título>"), senão a atividade auto-criada mostra só
  // "INDENIZAÇÃO" onde deveria aparecer o número do processo. Nenhum dos 5
  // callers repassa o número, então buscamos aqui — vale 1 SELECT por atividade.
  let processNumber = input.processNumber?.trim() || null;
  if (!processNumber) {
    try {
      const { data: p } = await externalSupabase
        .from('lead_processes')
        .select('process_number')
        .eq('id', input.processId)
        .maybeSingle();
      processNumber = (p?.process_number || '').trim() || null;
    } catch {
      // processo sem número (ou consulta falhou): rótulo fica só com o título
    }
  }
  const processLabel = formatProcessLabel(processNumber, input.processTitle);

  // O caller nem sempre tem o título do caso à mão (AddProcessDialog só recebe
  // o caseId). Busca aqui para que case_title nunca fique nulo.
  let caseTitle = input.caseTitle?.trim() || null;
  if (input.caseId && !caseTitle) {
    try {
      const { data: c } = await externalSupabase
        .from('legal_cases')
        .select('title')
        .eq('id', input.caseId)
        .maybeSingle();
      caseTitle = (c?.title || '').trim() || null;
    } catch {
      // segue sem o título; o vínculo por case_id é o que importa
    }
  }

  // Reaproveita uma atividade pendente equivalente. A busca é restrita ao caso:
  // títulos como "Organizar docs" se repetem entre casos do mesmo lead e, sem
  // esse filtro, o caso B adotava a atividade do caso A — B ficava sem atividade
  // nenhuma (retornando ok) e A trocava de responsável.
  try {
    let q = externalSupabase
      .from('lead_activities')
      .select('id')
      .eq('status', 'pendente')
      .is('deleted_at', null)
      .ilike('title', escapeLike(title));
    // Sem lead o filtro viraria `lead_id=eq.null`; o vínculo por case_id
    // (aplicado logo abaixo) é o que de fato restringe a busca.
    q = input.leadId ? q.eq('lead_id', input.leadId) : q;
    q = input.caseId ? q.eq('case_id', input.caseId) : q.is('case_id', null);

    const { data: existing } = await q
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing?.id) {
      // Reescreve o vínculo inteiro. Antes só preenchia quando estava NULL, o
      // que deixava atividade apontando para processo errado sem conserto.
      const updates: any = {
        assigned_to: input.extAssignedTo,
        assigned_to_name: input.assignedName,
        process_id: input.processId,
        process_title: processLabel,
        description,
      };
      if (input.caseId) updates.case_id = input.caseId;
      if (caseTitle) updates.case_title = caseTitle;

      const { error: upErr } = await externalSupabase
        .from('lead_activities')
        .update(updates)
        .eq('id', existing.id);
      if (upErr) return { ok: false, mode: 'attached', error: upErr.message };
      return { ok: true, mode: 'attached' };
    }
  } catch (e: any) {
    // segue para tentar inserir
    console.warn('[createOrAttachAndamentoActivity] lookup failed:', e?.message);
  }

  const payload: any = {
    lead_id: input.leadId,
    title,
    description,
    activity_type: 'tarefa',
    status: 'pendente',
    priority: 'normal',
    assigned_to: input.extAssignedTo,
    assigned_to_name: input.assignedName,
    created_by: input.extCreatedBy,
    deadline: today,
    // Sem notification_date o Salvar do editor reprova qualquer edição posterior.
    notification_date: today,
    process_id: input.processId,
    process_title: processLabel,
  };
  if (input.caseId) payload.case_id = input.caseId;
  if (caseTitle) payload.case_title = caseTitle;

  const { error: insErr } = await externalSupabase.from('lead_activities').insert(payload);
  if (insErr) return { ok: false, mode: 'inserted', error: insErr.message };
  return { ok: true, mode: 'inserted' };
}
