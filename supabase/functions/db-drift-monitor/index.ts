// Compara Cloud vs Externo nas 6 tabelas críticas.
// Retorna totais, última escrita, amostra dos últimos 50 ids, triggers ativos
// e (modo diagnóstico) amostra detalhada das últimas 10 linhas com colunas-chave.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

// Colunas-chave por tabela: usadas para identificar origem da escrita
// (instance_name, source, created_by, webhook_type, etc.)
const TABLE_KEYS: Record<string, string[]> = {
  whatsapp_messages: [
    'id', 'created_at', 'phone', 'instance_name', 'direction',
    'message_type', 'lead_id', 'contact_id', 'external_id',
  ],
  webhook_logs: [
    'id', 'created_at', 'instance_name', 'event_type', 'source',
    'phone', 'status',
  ],
  contacts: [
    'id', 'created_at', 'updated_at', 'phone', 'instance_name',
    'full_name', 'created_by', 'source',
  ],
  whatsapp_command_history: [
    'id', 'created_at', 'phone', 'instance_name', 'command',
    'executed_by', 'source',
  ],
  leads: [
    'id', 'created_at', 'updated_at', 'lead_name', 'lead_phone',
    'created_by', 'assigned_to', 'board_id', 'status', 'source',
  ],
  lead_activities: [
    'id', 'created_at', 'updated_at', 'lead_id', 'activity_type',
    'created_by', 'assigned_to', 'status', 'title',
  ],
};

const TABLES = Object.keys(TABLE_KEYS) as Array<keyof typeof TABLE_KEYS>;

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
    last_ids: (data ?? []).map((r: any) => String(r.id)),
    error: null as string | null,
  };
}

async function detailedSample(
  client: ReturnType<typeof createClient>,
  table: string,
  cols: string[],
  limit = 10,
) {
  // Tenta com todas as colunas; se alguma não existir, faz fallback pra id+created_at
  const { data, error } = await client
    .from(table)
    .select(cols.join(','))
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    const fb = await client
      .from(table)
      .select('id, created_at')
      .order('created_at', { ascending: false })
      .limit(limit);
    return { rows: fb.data ?? [], error: error.message };
  }
  return { rows: data ?? [], error: null as string | null };
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
          detail ? detailedSample(cloud, table, cols) : Promise.resolve({ rows: [], error: null }),
          detail ? detailedSample(ext, table, cols) : Promise.resolve({ rows: [], error: null }),
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
                columns: cols,
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
