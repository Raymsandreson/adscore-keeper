// Compara Cloud vs Externo nas 6 tabelas críticas.
// Retorna totais, última escrita, amostra dos últimos 50 ids, triggers ativos.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { corsHeaders } from 'https://esm.sh/@supabase/supabase-js@2.95.0/cors';

const TABLES = [
  'whatsapp_messages',
  'webhook_logs',
  'contacts',
  'whatsapp_command_history',
  'leads',
  'lead_activities',
] as const;

const cloud = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);
const ext = createClient(
  Deno.env.get('EXTERNAL_SUPABASE_URL')!,
  Deno.env.get('EXTERNAL_SUPABASE_SERVICE_ROLE_KEY')!,
);

async function statsFor(client: ReturnType<typeof createClient>, table: string) {
  // total
  const { count, error: cErr } = await client
    .from(table)
    .select('id', { count: 'exact', head: true });
  if (cErr) return { total: null, last_at: null, last_ids: [], error: cErr.message };

  // últimas 50 ids + última escrita
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

async function triggersFor(client: ReturnType<typeof createClient>, table: string) {
  // usa rpc-less query: fallback pra information_schema via rest é limitado,
  // então tentamos via from('information_schema.triggers')
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
    const results = await Promise.all(
      TABLES.map(async (table) => {
        const [c, e, tc, te] = await Promise.all([
          statsFor(cloud, table),
          statsFor(ext, table),
          triggersFor(cloud, table),
          triggersFor(ext, table),
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
        };
      }),
    );

    return new Response(
      JSON.stringify({ success: true, generated_at: new Date().toISOString(), results }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: String(err?.message ?? err) }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 },
    );
  }
});
