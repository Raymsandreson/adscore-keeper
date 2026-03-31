import { createClient } from 'npm:@supabase/supabase-js@2'

function resolveSupabaseUrl(): string {
  const candidates = [Deno.env.get('EXTERNAL_SUPABASE_URL'), Deno.env.get('SUPABASE_URL')];
  for (const c of candidates) { const v = (c || '').trim(); if (v.startsWith('https://') || v.startsWith('http://')) return v; }
  return 'https://kmedldlepwiityjsdahz.supabase.co';
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const url = resolveSupabaseUrl();
    const key = (Deno.env.get('EXTERNAL_SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '').trim();
    const supabase = createClient(url, key);

    // Test: try to read lead_status_board_ids
    const { data, error } = await supabase
      .from('wjia_command_shortcuts')
      .select('id, lead_status_board_ids, lead_status_filter')
      .limit(1);

    if (error) {
      return new Response(JSON.stringify({ error: error.message, code: error.code }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Test: try to update with those columns
    if (data && data.length > 0) {
      const testId = data[0].id;
      const currentVal = data[0].lead_status_board_ids;
      const { error: updateError } = await supabase
        .from('wjia_command_shortcuts')
        .update({ lead_status_board_ids: currentVal })
        .eq('id', testId);

      return new Response(JSON.stringify({ 
        success: true, 
        read_ok: true, 
        update_ok: !updateError,
        update_error: updateError?.message || null,
        sample: data[0]
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ success: true, read_ok: true, no_data: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
