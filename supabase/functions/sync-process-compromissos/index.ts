// =============================================================================
// Cria atividades (lead_activities) a partir dos COMPROMISSOS detectados nas
// movimentações do Escavador (audiência / perícia / prazo).
//
// Roteamento do responsável — regra definida pelo usuário (10/07/2026):
//   - Justiça do Trabalho (dígito J=5 do CNJ) → Felipe
//   - Justiça Federal    (dígito J=4 do CNJ) → Gisele
//   - Demais ramos → responsible_user_id do processo; sem ele, NÃO cria.
//
// Idempotente: dedupe por action_source='escavador_compromissos' +
// action_source_detail=<hash do compromisso> — sem migration nova.
//
// Modos:
//   { process_id, movimentacoes? }  → um processo (usa movs passadas, senão as
//                                     salvas em lead_processes, senão Escavador)
//   { sweep: true, limit? }         → varre processos com movimentações salvas
// =============================================================================
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getExternalClient } from "../_shared/external-client.ts";
import { extractCompromissos, type CompromissoExtraido } from "../_shared/escavadorCompromissos.ts";
import { classifyUpdates } from "../_shared/processUpdateClassifier.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-request-id',
};

const ACTION_SOURCE = 'escavador_compromissos';

// UUIDs do Supabase Externo (profiles) — conferidos no banco em 10/07/2026.
const ASSIGNEE_BY_RAMO: Record<string, { id: string; name: string }> = {
  // J=5 — Justiça do Trabalho
  '5': { id: '8fc1df70-2592-419c-ba72-14f2cc9765b7', name: 'Felipe Estefânio Cardoso Lopes de Sousa' },
  // J=4 — Justiça Federal
  '4': { id: '81fc8558-7b52-4a24-9871-73958472fb9f', name: 'Gisele Borges dos Santos' },
};

// Só considera movimentações recentes ao ligar num processo com histórico longo
// (evita criar tarefa de intimação de meses atrás no primeiro sync).
const DEFAULT_DESDE_DIAS = 60;

/** Dígito J (ramo da Justiça) do número CNJ: NNNNNNN-DD.AAAA.J.TR.OOOO */
function ramoFromCnj(processNumber: string | null): string | null {
  const m = (processNumber || '').match(/\d{7}-?\d{2}\.\d{4}\.(\d)\./);
  return m ? m[1] : null;
}

/** Hoje em Brasília (UTC-3), ISO YYYY-MM-DD. */
function hojeBrasilia(): string {
  return new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate.slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

interface ProcessRow {
  id: string;
  process_number: string | null;
  title: string | null;
  lead_id: string | null;
  case_id: string | null;
  responsible_user_id: string | null;
  movimentacoes: unknown[] | null;
  leads: { lead_name: string | null } | null;
  legal_cases: { title: string | null } | null;
}

interface SyncCounts {
  extraidos: number;
  criados: number;
  duplicados: number;
  vencidos: number;
  sem_responsavel: number;
  feed: number;
}

async function fetchMovsFromEscavador(numeroCnj: string): Promise<unknown[]> {
  const token = Deno.env.get('ESCAVADOR_API_TOKEN');
  if (!token) return [];
  const resp = await fetch(
    `https://api.escavador.com/api/v2/processos/numero_cnj/${encodeURIComponent(numeroCnj)}/movimentacoes`,
    { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' } },
  );
  if (!resp.ok) return [];
  const d = await resp.json();
  return d.items || d.data || (Array.isArray(d) ? d : []);
}

async function resolveAssignee(
  ext: ReturnType<typeof getExternalClient>,
  process: ProcessRow,
): Promise<{ id: string; name: string } | null> {
  const ramo = ramoFromCnj(process.process_number);
  if (ramo && ASSIGNEE_BY_RAMO[ramo]) return ASSIGNEE_BY_RAMO[ramo];
  if (process.responsible_user_id) {
    const { data } = await ext
      .from('profiles')
      .select('id, full_name')
      .eq('id', process.responsible_user_id)
      .maybeSingle();
    if (data?.id) return { id: data.id, name: data.full_name || 'Responsável do processo' };
  }
  return null;
}

function buildActivityRow(
  c: CompromissoExtraido,
  process: ProcessRow,
  assignee: { id: string; name: string },
  hoje: string,
) {
  const isEvento = c.tipo !== 'prazo';
  const deadline = isEvento
    ? (c.data_evento ? c.data_evento.slice(0, 10) : null)
    : (c.prazo_dias && c.data_movimentacao ? addDays(c.data_movimentacao, c.prazo_dias) : null);

  const activityType = c.tipo === 'prazo' ? 'prazo' : 'audiencia';
  const leadName = process.leads?.lead_name || null;

  const partes: string[] = [];
  if (c.descricao) partes.push(c.descricao);
  if (c.data_movimentacao) partes.push(`📌 Movimentação de ${c.data_movimentacao.slice(0, 10)}.`);
  if (isEvento && c.hora_evento) partes.push(`🕐 Horário: ${c.hora_evento}.`);
  if (c.tipo === 'prazo' && c.prazo_dias) {
    partes.push(`⚠️ Prazo de ${c.prazo_dias} dias contado em dias CORRIDOS a partir da movimentação — conferir dias úteis e data de publicação antes de confiar na data.`);
  }
  if (c.tipo === 'prazo' && !c.prazo_dias) {
    partes.push('⚠️ Intimação sem prazo em dias explícito — conferir o prazo aplicável.');
  }

  // urgente quando falta <= 3 dias; alta no resto (compromisso processual nunca é baixa)
  const priority = deadline && addDays(hoje, 3) >= deadline ? 'urgente' : 'alta';

  return {
    lead_id: process.lead_id,
    lead_name: leadName,
    case_id: process.case_id,
    case_title: process.legal_cases?.title || null,
    process_id: process.id,
    process_title: process.title || process.process_number,
    title: `${c.titulo}${leadName ? ` — ${leadName}` : ` — ${process.process_number || ''}`}`.trim(),
    description: partes.join('\n\n') || null,
    activity_type: activityType,
    status: 'pendente',
    priority,
    assigned_to: assignee.id,
    assigned_to_name: assignee.name,
    deadline,
    notification_date: deadline ? (addDays(deadline, -2) > hoje ? addDays(deadline, -2) : hoje) : null,
    created_by: assignee.id,
    is_system: true,
    created_by_ai: false,
    action_source: ACTION_SOURCE,
    action_source_detail: c.conteudo_hash,
    ai_generation_context: {
      origem: 'escavador_compromissos',
      tipo: c.tipo,
      data_evento: c.data_evento,
      hora_evento: c.hora_evento,
      data_movimentacao: c.data_movimentacao,
      prazo_dias: c.prazo_dias,
      escavador_movimentacao_id: c.escavador_movimentacao_id,
      numero_cnj: process.process_number,
    },
  };
}

/** Alimenta o feed do sino (process_updates) com toda movimentação da janela, classificada. */
async function syncFeed(
  ext: ReturnType<typeof getExternalClient>,
  process: ProcessRow,
  movs: unknown[],
  desde: string,
): Promise<number> {
  // deno-lint-ignore no-explicit-any
  const updates = classifyUpdates(movs as any, {
    numeroCnj: process.process_number || process.id,
    desde,
  });
  if (!updates.length) return 0;

  const rows = updates.map((u) => ({
    process_id: process.id,
    lead_id: process.lead_id,
    case_id: process.case_id,
    numero_cnj: process.process_number,
    processo_titulo: process.title || process.leads?.lead_name || process.process_number,
    categoria: u.categoria,
    titulo: u.titulo,
    descricao: u.descricao,
    data_movimentacao: u.data_movimentacao,
    escavador_movimentacao_id: u.escavador_movimentacao_id,
    conteudo_hash: u.conteudo_hash,
  }));

  const { error } = await ext
    .from('process_updates')
    .upsert(rows, { onConflict: 'process_id,conteudo_hash', ignoreDuplicates: true });
  if (error) {
    // Tabela pode ainda não existir (migration pendente) — não derruba os compromissos.
    console.error(`Feed upsert error for process ${process.id}:`, error.message);
    return 0;
  }
  return rows.length;
}

async function syncProcess(
  ext: ReturnType<typeof getExternalClient>,
  process: ProcessRow,
  movsIn: unknown[] | undefined,
  desde: string,
  hoje: string,
): Promise<SyncCounts> {
  const counts: SyncCounts = { extraidos: 0, criados: 0, duplicados: 0, vencidos: 0, sem_responsavel: 0, feed: 0 };

  let movs: unknown[] = Array.isArray(movsIn) && movsIn.length ? movsIn : (process.movimentacoes || []);
  if (!movs.length && process.process_number) {
    movs = await fetchMovsFromEscavador(process.process_number);
  }
  if (!movs.length) return counts;

  counts.feed = await syncFeed(ext, process, movs, desde);

  // deno-lint-ignore no-explicit-any
  const compromissos = extractCompromissos(movs as any, {
    numeroCnj: process.process_number || process.id,
    desde,
  });
  counts.extraidos = compromissos.length;
  if (!compromissos.length) return counts;

  const assignee = await resolveAssignee(ext, process);
  if (!assignee) {
    counts.sem_responsavel = compromissos.length;
    return counts;
  }

  const { data: existing } = await ext
    .from('lead_activities')
    .select('action_source_detail')
    .eq('process_id', process.id)
    .eq('action_source', ACTION_SOURCE);
  const existingHashes = new Set((existing || []).map((r: { action_source_detail: string | null }) => r.action_source_detail));

  const rows = [];
  for (const c of compromissos) {
    if (existingHashes.has(c.conteudo_hash)) {
      counts.duplicados++;
      continue;
    }
    const row = buildActivityRow(c, process, assignee, hoje);
    // Compromisso já vencido não vira tarefa (audiência passada, prazo estourado).
    if (row.deadline && row.deadline < hoje) {
      counts.vencidos++;
      continue;
    }
    rows.push(row);
  }

  if (rows.length) {
    const { error } = await ext.from('lead_activities').insert(rows);
    if (error) {
      console.error(`Insert error for process ${process.id}:`, error.message);
      return counts;
    }
    counts.criados = rows.length;
  }
  return counts;
}

const PROCESS_SELECT = 'id, process_number, title, lead_id, case_id, responsible_user_id, movimentacoes, leads(lead_name), legal_cases(title)';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { process_id, movimentacoes, desde: desdeIn, sweep, limit } = await req.json();
    const ext = getExternalClient();
    const hoje = hojeBrasilia();
    const desde = typeof desdeIn === 'string' && desdeIn ? desdeIn : addDays(hoje, -DEFAULT_DESDE_DIAS);

    const total: SyncCounts = { extraidos: 0, criados: 0, duplicados: 0, vencidos: 0, sem_responsavel: 0, feed: 0 };
    let processos = 0;

    if (sweep) {
      const { data, error } = await ext
        .from('lead_processes')
        .select(PROCESS_SELECT)
        .not('movimentacoes', 'is', null)
        .order('id')
        .limit(Math.min(Number(limit) || 200, 500));
      if (error) throw error;
      for (const p of (data || []) as unknown as ProcessRow[]) {
        processos++;
        const c = await syncProcess(ext, p, undefined, desde, hoje);
        total.extraidos += c.extraidos;
        total.criados += c.criados;
        total.duplicados += c.duplicados;
        total.vencidos += c.vencidos;
        total.sem_responsavel += c.sem_responsavel;
        total.feed += c.feed;
      }
    } else {
      if (!process_id) throw new Error('process_id é obrigatório (ou use sweep: true)');
      const { data, error } = await ext
        .from('lead_processes')
        .select(PROCESS_SELECT)
        .eq('id', process_id)
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error(`Processo ${process_id} não encontrado`);
      processos = 1;
      const c = await syncProcess(ext, data as unknown as ProcessRow, movimentacoes, desde, hoje);
      Object.assign(total, c);
    }

    console.log(`sync-process-compromissos: ${processos} processo(s) — ${JSON.stringify(total)}`);
    return new Response(JSON.stringify({ success: true, processos, ...total }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('sync-process-compromissos error:', error);
    const msg = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
