// Compara Cloud vs Externo em 19 tabelas críticas.
// Resiliente a colunas inexistentes: se o select falha, tenta apenas (id, created_at).
// Modo diagnóstico (?detail=1) retorna últimas 10 linhas com colunas-chave.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

// Colunas-chave por tabela (usadas só no modo diagnóstico).
// Se alguma coluna não existir em um dos bancos, o sample faz fallback gracioso.
const TABLE_KEYS: Record<string, string[]> = {
  // Núcleo CRM
  leads: ['id','created_at','updated_at','lead_name','lead_phone','created_by','board_id','status','source'],
  lead_activities: ['id','created_at','updated_at','lead_id','activity_type','created_by','status','title'],
  lead_processes: ['id','created_at','lead_id','workflow_id','status'],
  lead_followups: ['id','created_at','lead_id','followup_type','followup_date'],
  lead_stage_history: ['id','created_at','lead_id','stage_id','changed_by'],
  contact_leads: ['id','created_at','contact_id','lead_id','relationship_type'],

  // WhatsApp
  whatsapp_messages: ['id','created_at','phone','instance_name','direction','message_type','lead_id','contact_id','external_id'],
  webhook_logs: ['id','created_at','instance_name','event_type','source','phone','status'],
  whatsapp_command_history: ['id','created_at','phone','instance_name','executed_by','source'],
  whatsapp_conversation_agents: ['id','created_at','phone','instance_name','agent_id','is_active','activated_by'],
  whatsapp_instances: ['id','created_at','instance_name','status','owner_id'],
  lead_whatsapp_groups: ['id','created_at','lead_id','group_jid','instance_name'],

  // Jurídico
  legal_cases: ['id','created_at','case_number','lead_id','nucleus_id','status','closed_at'],
  process_parties: ['id','created_at','process_id','party_type','name','document'],
  process_movements: ['id','created_at','process_id','movement_date','description'],

  // Contatos
  contacts: ['id','created_at','updated_at','phone','full_name','created_by','source'],

  // Equipe / Auth
  profiles: ['id','created_at','user_id','full_name','email'],
  user_roles: ['id','created_at','user_id','role'],
  auth_uuid_mapping: ['cloud_uuid','ext_uuid','created_at','email'],
};

const TABLES = Object.keys(TABLE_KEYS);

const cloud = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);
const ext = createClient(
  Deno.env.get('EXTERNAL_SUPABASE_URL')!,
  Deno.env.get('EXTERNAL_SUPABASE_SERVICE_ROLE_KEY')!,
);

async function statsFor(client: ReturnType<typeof createClient>, table: string) {
  const { count, error: cErr } = await client
    .from(table)
    .select('id', { count: 'exact', head: true });
  if (cErr) return { total: null, last_at: null, last_ids: [], error: cErr.message };

  const { data, error: dErr } = await client
    .from(table)
    .select('id, created_at')
    .order('created_at', { ascending: false })
    .limit(50);
  if (dErr) return { total: count ?? 0, last_at: null, last_ids: [], error: dErr.message };

  return {
    total: count ?? 0,
    last_at: data?.[0]?.created_at ?? null,
    last_ids: (data ?? []).map((r: any) => String(r.id ?? r.cloud_uuid ?? '')),
    error: null as string | null,
  };
}

// Tenta colunas-chave; se falhar (coluna inexistente), retira a coluna problemática
// e tenta de novo. Em último caso, cai para id+created_at SEM marcar erro.
async function detailedSample(
  client: ReturnType<typeof createClient>,
  table: string,
  cols: string[],
  limit = 10,
) {
  let currentCols = [...cols];
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data, error } = await client
      .from(table)
      .select(currentCols.join(','))
      .order('created_at', { ascending: false })
      .limit(limit);
    if (!error) return { rows: data ?? [], columns: currentCols, error: null as string | null };

    // Extrai nome da coluna inexistente do erro do Postgres
    const m = error.message.match(/column [^.]+\.(\w+) does not exist/i);
    if (m && currentCols.includes(m[1]) && currentCols.length > 2) {
      currentCols = currentCols.filter((c) => c !== m[1]);
      continue;
    }
    // Não é "column does not exist": fallback final
    break;
  }
  // Fallback final silencioso
  const fb = await client
    .from(table)
    .select('id, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  return { rows: fb.data ?? [], columns: ['id', 'created_at'], error: null as string | null };
}

async function triggersFor(client: ReturnType<typeof createClient>, table: string) {
  const { data, error } = await client
    .schema('information_schema' as any)
    .from('triggers')
    .select('trigger_name, action_timing, event_manipulation, action_statement')
    .eq('event_object_schema', 'public')
    .eq('event_object_table', table);
  if (error) return [];
  return (data ?? []).map((t: any) => ({
    name: t.trigger_name,
    when: `${t.action_timing} ${t.event_manipulation}`,
    fn: (t.action_statement || '').replace(/^EXECUTE FUNCTION\s+/i, '').slice(0, 120),
  }));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const detail = url.searchParams.get('detail') === '1';

    const results = await Promise.all(
      TABLES.map(async (table) => {
        const cols = TABLE_KEYS[table];
        const [c, e, tc, te, dc, de] = await Promise.all([
          statsFor(cloud, table),
          statsFor(ext, table),
          triggersFor(cloud, table),
          triggersFor(ext, table),
          detail ? detailedSample(cloud, table, cols) : Promise.resolve({ rows: [], columns: [], error: null }),
          detail ? detailedSample(ext, table, cols) : Promise.resolve({ rows: [], columns: [], error: null }),
        ]);
        const cloudSet = new Set(c.last_ids);
        const extSet = new Set(e.last_ids);
        const in_both = c.last_ids.filter((id) => extSet.has(id)).length;
        const only_cloud = c.last_ids.filter((id) => !extSet.has(id)).length;
        const only_ext = e.last_ids.filter((id) => !cloudSet.has(id)).length;
        return {
          table,
          cloud: { total: c.total, last_at: c.last_at, error: c.error },
          ext: { total: e.total, last_at: e.last_at, error: e.error },
          delta: (c.total ?? 0) - (e.total ?? 0),
          sample: { in_both, only_cloud, only_ext, sample_size: 50 },
          triggers: { cloud: tc, ext: te },
          detail: detail
            ? {
                cloud_columns: dc.columns,
                ext_columns: de.columns,
                cloud_rows: dc.rows,
                ext_rows: de.rows,
                cloud_error: dc.error,
                ext_error: de.error,
              }
            : null,
        };
      }),
    );

    return new Response(
      JSON.stringify({ success: true, generated_at: new Date().toISOString(), detail, results }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 },
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ success: false, error: String(err?.message ?? err) }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 },
    );
  }
});
