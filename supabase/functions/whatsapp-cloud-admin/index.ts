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

    if (action === 'check_meta_status' || action === 'validate_phone_number_id') {
      const token = (Deno.env.get('WHATSAPP_CLOUD_ACCESS_TOKEN') || Deno.env.get('META_ACCESS_TOKEN') || '').trim();
      if (!token) return fail('missing_secret:WHATSAPP_CLOUD_ACCESS_TOKEN_or_META_ACCESS_TOKEN');
      const { data: cfg } = await db
        .from('whatsapp_cloud_config')
        .select('*')
        .eq('is_active', true)
        .maybeSingle();
      if (!cfg?.phone_number_id) return fail('no_active_config');

      // Validação: lista phone numbers da WABA e confere se o phone_number_id salvo existe
      let validation: any = null;
      if (cfg.waba_id) {
        const listUrl = `https://graph.facebook.com/v21.0/${cfg.waba_id}/phone_numbers?fields=id,display_phone_number,verified_name`;
        const listResp = await fetch(listUrl, { headers: { Authorization: `Bearer ${token}` } });
        const listJson = await listResp.json();
        if (listResp.ok && Array.isArray(listJson?.data)) {
          const numbers = listJson.data.map((n: any) => ({
            id: String(n.id),
            display_phone_number: n.display_phone_number,
            verified_name: n.verified_name,
          }));
          const match = numbers.find((n: any) => n.id === String(cfg.phone_number_id));
          validation = {
            saved_phone_number_id: cfg.phone_number_id,
            matches: !!match,
            matched: match || null,
            available_numbers: numbers,
          };
        } else {
          validation = {
            saved_phone_number_id: cfg.phone_number_id,
            matches: null,
            error: listJson?.error?.message || `list_failed_${listResp.status}`,
          };
        }
      }

      // Se foi só validação OU se a validação falhou em encontrar o ID, retorna antes de consultar
      if (action === 'validate_phone_number_id') {
        return ok({ validation });
      }
      if (validation && validation.matches === false) {
        return fail('phone_number_id_mismatch', { validation });
      }

      const fields = 'verified_name,code_verification_status,display_phone_number,quality_rating,name_status,messaging_limit_tier';
      const url = `https://graph.facebook.com/v21.0/${cfg.phone_number_id}?fields=${fields}`;
      const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const meta = await resp.json();
      if (!resp.ok) return fail(meta?.error?.message || `graph_api_${resp.status}`, { meta, validation });

      // Mapeia name_status -> status interno: APPROVED => approved, resto => pending
      const nameStatus = String(meta.name_status || '').toUpperCase();
      const newStatus = nameStatus === 'APPROVED' ? 'approved' : 'pending';

      const update: any = {
        status: newStatus,
        last_heartbeat_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      if (meta.display_phone_number) update.display_phone = meta.display_phone_number;
      if (meta.verified_name) update.display_name = meta.verified_name;

      const { data: updated, error } = await db
        .from('whatsapp_cloud_config')
        .update(update)
        .eq('id', cfg.id)
        .select()
        .single();
      if (error) return fail(error.message, { meta });
      return ok({ config: updated, meta, validation });
    }

    return fail(`unknown_action:${action}`);
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
});

