// Sincroniza GOOGLE_MAIL_API_KEY_* do Lovable Cloud → variáveis do serviço Railway
// via GraphQL API. Por padrão sincroniza _2 e _3, e seta PROCESSUAL_INBOXES=inbox#4.
// Body opcional: { keys?: string[], extras?: Record<string,string> }
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const RAILWAY_PROJECT_ID = '9bb2fb33-376f-463a-a82d-cd25a4270e61';
const RAILWAY_ENV_ID = 'a09acf1f-c28a-49fd-9b59-076629c0bf21';
const RAILWAY_SERVICE_ID = '4ef74b81-45b4-408e-a630-a72ac7784fb0';

const DEFAULT_KEYS = ['GOOGLE_MAIL_API_KEY_2', 'GOOGLE_MAIL_API_KEY_3'];
const DEFAULT_EXTRAS: Record<string, string> = {
  PROCESSUAL_INBOXES: 'inbox#4',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const railwayToken = Deno.env.get('RAILWAY_API_KEY');
    if (!railwayToken) return json({ success: false, error: 'RAILWAY_API_KEY missing' });

    let body: any = {};
    try { body = await req.json(); } catch {}
    const keys: string[] = Array.isArray(body?.keys) && body.keys.length ? body.keys : DEFAULT_KEYS;
    const extras: Record<string, string> = { ...DEFAULT_EXTRAS, ...(body?.extras || {}) };

    const results: any[] = [];

    for (const name of keys) {
      const value = Deno.env.get(name);
      if (!value) {
        results.push({ name, ok: false, error: 'not present in Cloud env' });
        continue;
      }
      const r = await upsert(railwayToken, name, value);
      results.push({ name, ok: r.ok, value_length: value.length, error: r.error });
    }

    for (const [name, value] of Object.entries(extras)) {
      const r = await upsert(railwayToken, name, value);
      results.push({ name, ok: r.ok, value, error: r.error });
    }

    const allOk = results.every((r) => r.ok);
    return json({ success: allOk, results });
  } catch (err: any) {
    return json({ success: false, error: err?.message || String(err) });
  }
});

async function upsert(token: string, name: string, value: string): Promise<{ ok: boolean; error?: string }> {
  const mutation = `
    mutation upsert($input: VariableUpsertInput!) {
      variableUpsert(input: $input)
    }
  `;
  const variables = {
    input: {
      projectId: RAILWAY_PROJECT_ID,
      environmentId: RAILWAY_ENV_ID,
      serviceId: RAILWAY_SERVICE_ID,
      name,
      value,
    },
  };
  const resp = await fetch('https://backboard.railway.com/graphql/v2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query: mutation, variables }),
  });
  const text = await resp.text();
  let parsed: any = null;
  try { parsed = JSON.parse(text); } catch {}
  if (!resp.ok || parsed?.errors) {
    return { ok: false, error: `Railway ${resp.status}: ${text.slice(0, 300)}` };
  }
  return { ok: true };
}

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status: 200,
  });
}
