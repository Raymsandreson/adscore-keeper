// Cloud edge proxy → Railway
// Resolve a instância no Cloud DB e encaminha pro Railway, que chama a UazAPI.
// Body: { instance_id?, instance_name?, group_jid, action: 'add'|'remove'|'promote'|'demote', numbers: string[] }
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const RAILWAY = 'https://adscore-keeper-production.up.railway.app/functions/manage-whatsapp-group-participants';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-request-id',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

  try {
    const body = await req.json().catch(() => ({}));
    const { instance_id, instance_name, group_jid, action, numbers } = body || {};

    if (!group_jid || !action || !Array.isArray(numbers) || numbers.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: 'group_jid, action and numbers[] are required' }),
        { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } },
      );
    }

    const cloud = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } },
    );

    let q = cloud
      .from('whatsapp_instances')
      .select('id, instance_name, instance_token, base_url, is_active')
      .eq('is_active', true);
    if (instance_id) q = q.eq('id', instance_id);
    else if (instance_name) q = q.ilike('instance_name', instance_name);
    const { data: inst } = await q.limit(1).maybeSingle();

    if (!inst?.instance_token) {
      return new Response(
        JSON.stringify({ success: false, error: 'instance not found or missing token' }),
        { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } },
      );
    }

    const railwayKey = Deno.env.get('RAILWAY_API_KEY') ?? '';
    if (!railwayKey) {
      return new Response(
        JSON.stringify({ success: false, error: 'RAILWAY_API_KEY not configured' }),
        { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } },
      );
    }

    const resp = await fetch(RAILWAY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': railwayKey },
      body: JSON.stringify({
        actor: {
          id: inst.id,
          instance_name: inst.instance_name,
          instance_token: inst.instance_token,
          base_url: inst.base_url,
        },
        group_jid,
        action,
        numbers,
      }),
    });
    const text = await resp.text();
    return new Response(text, {
      status: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    return new Response(
      JSON.stringify({ success: false, error: e?.message || String(e) }),
      { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } },
    );
  }
});
