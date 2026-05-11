// Edge function: CRUD de configuração e regras de roteamento do número de gerência (Meta Cloud API).
// Lê/escreve no Supabase Externo (regra do projeto).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-request-id',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function ext() {
  const url = (Deno.env.get('EXTERNAL_SUPABASE_URL') || 'https://kmedldlepwiityjsdahz.supabase.co').trim();
  const key = (Deno.env.get('EXTERNAL_SUPABASE_SERVICE_ROLE_KEY') || '').trim();
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function ok(payload: unknown) {
  return new Response(JSON.stringify({ success: true, ...((payload as object) || {}) }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
function fail(error: string, extra?: object) {
  return new Response(JSON.stringify({ success: false, error, ...(extra || {}) }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  let body: any = {};
  try {
    body = req.method === 'GET' ? Object.fromEntries(new URL(req.url).searchParams) : await req.json();
  } catch { body = {}; }
  const action = body.action || 'overview';
  const db = ext();

  try {
    if (action === 'overview') {
      const [{ data: config }, { data: rules }, { data: log }] = await Promise.all([
        db.from('whatsapp_cloud_config').select('*').eq('is_active', true).maybeSingle(),
        db.from('whatsapp_cloud_routing_rules').select('*').is('deleted_at', null).order('priority'),
        db.from('whatsapp_cloud_routing_log').select('*').order('created_at', { ascending: false }).limit(50),
      ]);
      return ok({ config, rules: rules || [], log: log || [] });
    }

    if (action === 'save_config') {
      const payload = {
        phone_number_id: body.phone_number_id,
        waba_id: body.waba_id,
        display_phone: body.display_phone || null,
        display_name: body.display_name || null,
        status: body.status || 'pending',
        is_active: true,
        updated_at: new Date().toISOString(),
      };
      // singleton: apaga ativos anteriores
      await db.from('whatsapp_cloud_config').update({ is_active: false } as any).eq('is_active', true);
      const { data, error } = await db.from('whatsapp_cloud_config').insert(payload as any).select().single();
      if (error) return fail(error.message);
      return ok({ config: data });
    }

    if (action === 'save_rule') {
      const r = body.rule || {};
      if (r.id) {
        const { error } = await db
          .from('whatsapp_cloud_routing_rules')
          .update({
            name: r.name,
            priority: r.priority ?? 100,
            match_type: r.match_type,
            match_value: r.match_value || null,
            eligible_user_ids: r.eligible_user_ids || [],
            is_active: r.is_active !== false,
            updated_at: new Date().toISOString(),
          } as any)
          .eq('id', r.id);
        if (error) return fail(error.message);
      } else {
        const { error } = await db.from('whatsapp_cloud_routing_rules').insert({
          name: r.name,
          priority: r.priority ?? 100,
          match_type: r.match_type,
          match_value: r.match_value || null,
          eligible_user_ids: r.eligible_user_ids || [],
          is_active: r.is_active !== false,
        } as any);
        if (error) return fail(error.message);
      }
      return ok({});
    }

    if (action === 'delete_rule') {
      const { error } = await db
        .from('whatsapp_cloud_routing_rules')
        .update({ deleted_at: new Date().toISOString(), is_active: false } as any)
        .eq('id', body.rule_id);
      if (error) return fail(error.message);
      return ok({});
    }

    return fail(`unknown_action:${action}`);
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
});
