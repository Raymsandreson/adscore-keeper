/**
 * Fluxo de criação automática do grupo do WhatsApp de um lead.
 *
 * Nasceu dentro de `CadastrarCasoViavelDialog` (aba Notícias) e foi extraído para
 * cá porque o "Adicionar Lead" dos funis Trabalhista/Previdenciário precisa
 * exatamente do mesmo comportamento: sugerir o nº do lead, escolher a instância
 * autora, criar o grupo, buscar o link de convite e postar o resumo no grupo.
 *
 * Nada aqui é específico do board Trabalhista — o prefixo da sequência e o board
 * vêm por parâmetro.
 */
import { externalSupabase, ensureExternalSession } from '@/integrations/supabase/external-client';
import { supabase as cloudSupabase } from '@/integrations/supabase/client';
import { cloudFunctions } from '@/lib/functionRouter';
import { format } from 'date-fns';

export interface InstanceConnStatus {
  id: string;
  instance_name: string;
  connected: boolean;
}

// Autor do grupo = instância cujo token chama /group/create no UazAPI, virando
// criador/dono/admin. Sem isso, o edge escolhe "a primeira conectada" do board
// (query sem ORDER BY) → autor aleatório. IDs conferidos em whatsapp_instances.
export const GROUP_AUTHOR_OPTIONS: Array<{ label: string; instanceId: string }> = [
  { label: 'Analyne Sousa de Oliveira', instanceId: 'b9ced9ee-4469-4dc9-a7a0-3c0cbdb43508' }, // Analyne Oliveira
  { label: 'João Manoel', instanceId: '259203a6-d8e7-4638-b700-0a1eb1d29db9' }, // João Manoel- Acolhedor
  { label: 'Mateus', instanceId: 'f939bac7-bb57-47de-8620-8c6790643ae0' }, // Mateus Atendimento
  { label: 'Raym', instanceId: '35eefdd1-c554-4883-a7c8-93149723d61c' }, // Raym / Dr. Prudêncio
  { label: 'Juliana Clara Santos Pimentel', instanceId: '3a282d27-625d-4b3b-bf51-ddde7dd43063' }, // Juliana Pimentel
];
export const DEFAULT_GROUP_AUTHOR_INSTANCE_ID = 'b9ced9ee-4469-4dc9-a7a0-3c0cbdb43508'; // Analyne

/** Status de conexão (WhatsApp) de todas as instâncias ativas. */
export async function fetchInstanceConnStatus(): Promise<InstanceConnStatus[]> {
  try {
    const { data, error } = await cloudFunctions.invoke('check-whatsapp-status');
    if (error) throw error;
    return (Array.isArray(data) ? data : []) as InstanceConnStatus[];
  } catch (e) {
    console.warn('[leadGroupFlow] falha ao checar conexão das instâncias', e);
    return [];
  }
}

/**
 * Instâncias vinculadas ao funil (board_group_instances). É a mesma tabela que o
 * edge consulta quando precisa escolher uma instância criadora — usar ela na UI
 * evita oferecer, num funil Previdenciário, o WhatsApp de quem só atende o
 * Trabalhista.
 */
export async function fetchBoardInstanceIds(boardId: string | null | undefined): Promise<string[]> {
  if (!boardId) return [];
  try {
    await ensureExternalSession();
    const { data } = await (externalSupabase as any)
      .from('board_group_instances')
      .select('instance_id')
      .eq('board_id', boardId);
    return (data || []).map((r: any) => String(r.instance_id)).filter(Boolean);
  } catch (e) {
    console.warn('[leadGroupFlow] falha ao ler instâncias do board', e);
    return [];
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Extrai o nº de nomes tipo "LEAD94", "LEAD169", "LEAD132/jun.26" (ou com o
 * prefixo do funil, ex: "PREV 341"). Números com zero à esquerda ("LEAD0656")
 * são de outro funil e são ignorados.
 */
export function parseLeadSeq(name: string | null | undefined, prefix = 'LEAD'): number {
  const re = new RegExp(`^\\s*(?:✅\\s*)?${escapeRegex(prefix)}\\s*[-|:]?\\s*(\\d{1,6})\\b`, 'i');
  const m = String(name || '').match(re);
  if (!m || /^0/.test(m[1])) return 0;
  return Number(m[1]);
}

/**
 * Prefixo da sequência configurado para o funil (board_group_settings).
 * Lê o Externo (onde a configuração de fato mora) e, se não achar, cai no Cloud —
 * era de lá que o "Adicionar Lead" lia antes desta unificação.
 */
export async function fetchBoardSequencePrefix(boardId: string): Promise<string> {
  try {
    await ensureExternalSession();
    const { data } = await externalSupabase
      .from('board_group_settings')
      .select('group_name_prefix')
      .eq('board_id', boardId)
      .maybeSingle();
    const prefix = String((data as any)?.group_name_prefix || '').trim();
    if (prefix) return prefix;
  } catch { /* tenta o Cloud */ }
  try {
    const { data } = await cloudSupabase
      .from('board_group_settings')
      .select('group_name_prefix')
      .eq('board_id', boardId)
      .maybeSingle();
    return String((data as any)?.group_name_prefix || '').trim();
  } catch {
    return '';
  }
}

/**
 * Maior nº entre: contador oficial, maior lead_number do board, grupos vinculados
 * a leads do board (tempo real) e snapshot UazAPI (pega grupos criados
 * manualmente; sincroniza 1x/dia). Best-effort: cada fonte falha isolada e a
 * sugestão continua editável pelo usuário.
 */
export async function suggestNextSequence(boardId: string, prefix = 'LEAD'): Promise<number | null> {
  await ensureExternalSession();
  let best = 0;
  let seqStart: number | null = null;
  try {
    const { data } = await externalSupabase
      .from('board_group_settings')
      .select('current_sequence, sequence_start')
      .eq('board_id', boardId)
      .maybeSingle();
    if (data?.current_sequence) best = Math.max(best, data.current_sequence);
    seqStart = data?.sequence_start ?? null;
  } catch { /* segue com as outras fontes */ }
  // Fonte crítica: maior lead_number já persistido no board — evita colisão
  // com a constraint unique (product_id, lead_number).
  try {
    const { data } = await (externalSupabase as any)
      .from('leads')
      .select('lead_number')
      .eq('board_id', boardId)
      .order('lead_number', { ascending: false })
      .limit(1);
    const maxLead = Number((data?.[0] as any)?.lead_number || 0);
    if (maxLead > 0) best = Math.max(best, maxLead);
  } catch { /* segue */ }
  try {
    const { data } = await externalSupabase
      .from('lead_whatsapp_groups')
      .select('group_name, leads!inner(board_id)')
      .eq('leads.board_id', boardId)
      .ilike('group_name', `%${prefix}%`)
      .limit(1000);
    for (const r of data || []) best = Math.max(best, parseLeadSeq((r as any).group_name, prefix));
  } catch { /* segue */ }
  try {
    const { data } = await (externalSupabase as any)
      .from('whatsapp_groups_uazapi_snapshot')
      .select('group_name')
      .ilike('group_name', `%${prefix}%`)
      .limit(3000);
    for (const r of data || []) best = Math.max(best, parseLeadSeq((r as any).group_name, prefix));
  } catch { /* segue */ }
  if (best > 0) return best + 1;
  return seqStart;
}

/**
 * Próximo lead_number livre a partir de `desired`, checando colisões reais na
 * tabela leads (unique constraint em (product_id, lead_number)).
 */
export async function nextFreeLeadNumber(boardId: string, desired: number): Promise<number> {
  await ensureExternalSession();
  let candidate = Math.max(1, Math.floor(desired));
  for (let i = 0; i < 50; i++) {
    const { data } = await (externalSupabase as any)
      .from('leads')
      .select('id')
      .eq('board_id', boardId)
      .eq('lead_number', candidate)
      .limit(1);
    if (!data || data.length === 0) return candidate;
    candidate += 1;
  }
  return candidate;
}

export function formatISOToBR(iso: string): string {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso || '');
}

/** Iniciais do acolhedor: "Juliana Pimentel" → "JP", "Luiz Ricardo Silva" → "LR". */
export function initialsOf(name: string): string {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export interface GroupIntroFields {
  lead_title?: string;
  acolhedor?: string;
  case_type?: string;
  /** Origem do caso — "Internet" no fluxo de notícia, origem do lead no manual. */
  source_label?: string;
  status_label?: string;
  phone?: string;
  visit_city?: string;
  visit_state?: string;
  visit_region?: string;
  visit_address?: string;
  accident_date?: string; // ISO
  damage?: string;
  victim_name?: string;
  victim_age?: string;
  accident_address?: string;
  contractor_company?: string;
  main_company?: string;
  news_link?: string;
  company_size_justification?: string;
  liability_type?: string;
  liability_justification?: string;
  legal_viability?: string;
}

/**
 * Mensagem-resumo postada no grupo assim que ele é criado.
 *
 * `omitEmpty` existe para os funis que não são de acidente de trabalho: sem ele,
 * um lead Previdenciário geraria 15 linhas "Não informado". No fluxo de notícia
 * o padrão (false) mantém o formato histórico, linha a linha.
 */
export function composeGroupIntroMessage(
  f: GroupIntroFields,
  groupLink: string,
  opts: { omitEmpty?: boolean } = {}
): string {
  const omit = opts.omitEmpty === true;
  const today = format(new Date(), 'dd/MM/yyyy');
  const acolhedorLine = f.acolhedor
    ? `${f.acolhedor}${initialsOf(f.acolhedor) ? ` (${initialsOf(f.acolhedor)})` : ''}`
    : '';
  const respLine = [f.liability_type, (f.liability_justification || '').trim()]
    .filter(Boolean)
    .join(' — ');

  const entries: Array<[string, string]> = [
    ['📅 Data da criação', today],
    ['🔢 Lead título', (f.lead_title || '').trim()],
    [' ✅ STATUS', f.status_label || 'OUTBOUND'],
    ['👤 Acolhedor', acolhedorLine],
    ['⚠️ Tipo de Caso', f.case_type || ''],
    ['📰 Origem do Caso', f.source_label || 'Internet'],
    ['🔗 Link do Grupo do WhatsApp', groupLink || (omit ? '' : 'Não disponível')],
    ['📞 Telefone', (f.phone || '').trim()],
    ['📍 Cidade da Visita', f.visit_city || ''],
    ['🏛️ Estado da Visita', f.visit_state || ''],
    ['🌎 Região da Visita', f.visit_region || ''],
    ['📅 Data do Acidente', f.accident_date ? formatISOToBR(f.accident_date) : ''],
    ['💥 Dano', f.damage || ''],
    ['🆔 Nome da Vítima', f.victim_name || ''],
    ['🎂 Idade da Vítima', f.victim_age ? `${f.victim_age} anos` : ''],
    ['📌 Endereço do Acidente', f.accident_address || ''],
    ['🏠 Endereço da Visita', f.visit_address || [f.visit_city, f.visit_state].filter(Boolean).join(', ')],
    ['🏢 Nome da Empresa Terceirizada', f.contractor_company || ''],
    ['🏢 Nome da Empresa Tomadora', f.main_company || ''],
    ['📰 Link da Notícia', f.news_link || ''],
    ['💰 Justificativa do Porte da Empresa', f.company_size_justification || ''],
    ['⚖️ Tipo de Responsabilidade', respLine],
    ['📜 Viabilidade Jurídica', f.legal_viability || (omit ? '' : 'Positiva')],
  ];

  // O telefone não existia no formato histórico: só entra quando há valor.
  const linhas = entries
    .filter(([label, value]) => (label === '📞 Telefone' ? !!value : omit ? !!value : true))
    .map(([label, value]) => `${label}: ${value || 'Não informado'}`);

  return linhas.join('\n\n');
}

export type GroupFlowStep = 'group' | 'link' | 'intro';
export type GroupFlowState = 'running' | 'done' | 'error';

export interface CreateLeadGroupParams {
  leadId: string;
  leadName: string;
  boardId: string;
  creationOrigin: string;
  creatorInstanceId?: string | null;
  forcedSequence?: number | null;
  groupNameOverride?: string | null;
  phone?: string | null;
  /** Recebe o link de convite e devolve o texto do resumo. Omitido = não posta. */
  introMessage?: (inviteLink: string) => string;
  onStep?: (step: GroupFlowStep, state: GroupFlowState, detail?: string) => void;
}

export interface CreateLeadGroupResult {
  queued: boolean;
  groupJid: string | null;
  inviteLink: string;
  groupError?: string;
  linkError?: string;
  introError?: string;
}

/**
 * Cria o grupo, busca o link de convite (persistido em leads.group_link pela
 * própria função) e posta o resumo. Nunca lança: cada passo devolve o erro no
 * resultado para o chamador decidir o que mostrar.
 */
export async function createLeadWhatsappGroup(p: CreateLeadGroupParams): Promise<CreateLeadGroupResult> {
  const result: CreateLeadGroupResult = { queued: false, groupJid: null, inviteLink: '' };

  // Passo 1 — criar o grupo
  p.onStep?.('group', 'running');
  try {
    const { data, error } = await cloudFunctions.invoke('create-whatsapp-group', {
      body: {
        lead_id: p.leadId,
        lead_name: p.leadName,
        board_id: p.boardId,
        creation_origin: p.creationOrigin,
        phase: 'open',
        ...(p.phone ? { phone: p.phone, contact_phone: p.phone } : {}),
        // Fixa o criador/dono do grupo escolhido no dropdown (evita autor aleatório).
        ...(p.creatorInstanceId ? { creator_instance_id: p.creatorInstanceId } : {}),
        ...(p.forcedSequence && p.forcedSequence > 0 ? { forced_sequence: p.forcedSequence } : {}),
        ...(p.groupNameOverride?.trim() ? { group_name_override: p.groupNameOverride.trim() } : {}),
      },
    });
    if (error) throw error;
    if ((data as any)?.queued) {
      result.queued = true;
      p.onStep?.('group', 'error', 'queued');
      return result;
    }
    if (!(data as any)?.success || !(data as any)?.group_id) {
      throw new Error((data as any)?.error || 'Grupo não foi criado');
    }
    result.groupJid = String((data as any).group_id);
    p.onStep?.('group', 'done');
  } catch (e: any) {
    result.groupError = e?.message || String(e);
    p.onStep?.('group', 'error', result.groupError);
    return result;
  }

  // Passo 2 — link de convite (a função persiste em leads.group_link)
  p.onStep?.('link', 'running');
  try {
    const { data, error } = await cloudFunctions.invoke('get-group-invite-link', {
      body: { group_jid: result.groupJid, lead_id: p.leadId },
    });
    if (error || !(data as any)?.success || !(data as any)?.invite_link) {
      throw new Error((data as any)?.error || error?.message || 'Link não retornado');
    }
    result.inviteLink = String((data as any).invite_link);
    p.onStep?.('link', 'done');
  } catch (e: any) {
    result.linkError = e?.message || String(e);
    p.onStep?.('link', 'error', result.linkError);
  }

  // Passo 3 — resumo automático no próprio grupo recém-criado. Usa a mesma
  // instância que criou o grupo (send-whatsapp resolve pela JID); sem
  // necessidade de "associar número" — o grupo já pertence a essa instância.
  if (p.introMessage) {
    p.onStep?.('intro', 'running');
    try {
      await cloudFunctions.invoke('send-whatsapp', {
        body: {
          phone: result.groupJid,
          chat_id: result.groupJid,
          message: p.introMessage(result.inviteLink),
          lead_id: p.leadId,
        },
      });
      p.onStep?.('intro', 'done');
    } catch (e: any) {
      result.introError = e?.message || String(e);
      console.warn('[leadGroupFlow] falha ao enviar resumo no grupo', e);
      p.onStep?.('intro', 'error', result.introError);
    }
  }

  return result;
}
