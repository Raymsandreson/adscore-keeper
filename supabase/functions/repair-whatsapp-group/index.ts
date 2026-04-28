import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { resolveSupabaseUrl, resolveServiceRoleKey } from '../_shared/supabase-url-resolver.ts';

const EXT = 'https://kmedldlepwiityjsdahz.supabase.co/functions/v1/repair-whatsapp-group';
const RAILWAY = 'https://adscore-keeper-production.up.railway.app/functions/repair-whatsapp-group';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-request-id',
};

interface Instance {
  id: string;
  instance_name: string;
  instance_token: string;
  base_url: string | null;
  owner_phone: string | null;
  is_active: boolean;
}

function normalizePhone(p: string | null | undefined): string | null {
  if (!p) return null;
  const d = p.replace(/\D/g, '');
  return d.length >= 10 ? d : null;
}

async function buildRailwayPayload(parsed: any) {
  const cloud = createClient(resolveSupabaseUrl(), resolveServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let actor: Instance | null = null;
  if (parsed.instance_id) {
    const { data } = await cloud
      .from('whatsapp_instances')
      .select('id, instance_name, instance_token, base_url, owner_phone, is_active')
      .eq('id', parsed.instance_id)
      .maybeSingle();
    actor = data as Instance | null;
  }

  if (!actor) {
    const { data } = await cloud
      .from('whatsapp_instances')
      .select('id, instance_name, instance_token, base_url, owner_phone, is_active')
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();
    actor = data as Instance | null;
  }

  if (!actor) throw new Error('No active instance found to act on group');

  let targets: Instance[] = [];
  if (parsed.scope === 'all_active') {
    const { data, error } = await cloud
      .from('whatsapp_instances')
      .select('id, instance_name, instance_token, base_url, owner_phone, is_active')
      .eq('is_active', true);
    if (error) throw error;
    targets = (data || []) as Instance[];
  } else if (parsed.board_id) {
    const { data, error } = await cloud
      .from('board_group_instances')
      .select('instance_id, whatsapp_instances!inner(id, instance_name, instance_token, base_url, owner_phone, is_active)')
      .eq('board_id', parsed.board_id);
    if (error) throw error;
    targets = (data || [])
      .map((row: any) => Array.isArray(row.whatsapp_instances) ? row.whatsapp_instances[0] : row.whatsapp_instances)
      .filter((i: Instance) => i && i.is_active);
  } else {
    throw new Error('board_id or scope=all_active required');
  }

  const targetNumbers: string[] = [];
  const seen = new Set<string>();
  for (const t of targets) {
    if (t.id === actor.id) continue;
    const phone = normalizePhone(t.owner_phone);
    if (!phone || seen.has(phone)) continue;
    seen.add(phone);
    targetNumbers.push(phone);
  }

  return {
    action: 'update_participants',
    group_jid: parsed.group_jid,
    actor,
    target_numbers: targetNumbers,
    promote_to_admin: parsed.promote_to_admin === true,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

  const rawBody = req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.text();

  // Parse para decidir roteamento
  let parsed: any = null;
  if (rawBody) {
    try { parsed = JSON.parse(rawBody); } catch { /* ignore */ }
  }

  const useRailway = parsed?.action === 'add_instances';
  const target = useRailway ? RAILWAY : EXT;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  let body = rawBody;
  if (useRailway) {
    const railwayKey = Deno.env.get('RAILWAY_API_KEY') ?? '';
    if (!railwayKey) {
      return new Response(JSON.stringify({ success: false, error: 'RAILWAY_API_KEY is not configured' }), {
        status: 500,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }
    if (railwayKey) headers['x-api-key'] = railwayKey;
    try {
      body = JSON.stringify(await buildRailwayPayload(parsed));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return new Response(JSON.stringify({ success: false, error: msg }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }
  } else {
    const externalKey = Deno.env.get('EXTERNAL_SUPABASE_SERVICE_ROLE_KEY') ?? '';
    headers['Authorization'] = `Bearer ${externalKey}`;
    headers['apikey'] = externalKey;
  }

  try {
    const resp = await fetch(target, { method: req.method, headers, body });
    const text = await resp.text();
    return new Response(text, {
      status: resp.status,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ success: false, error: `Proxy failed: ${msg}` }), {
      status: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
});
