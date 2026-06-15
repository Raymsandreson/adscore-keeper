// Edge function descartável: copia GOOGLE_MAIL_API_KEY_2 do Lovable Cloud
// para a variável de ambiente do serviço no Railway via GraphQL API.
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const RAILWAY_PROJECT_ID = '9bb2fb33-376f-463a-a82d-cd25a4270e61';
const RAILWAY_ENV_ID = 'a09acf1f-c28a-49fd-9b59-076629c0bf21';
const RAILWAY_SERVICE_ID = '4ef74b81-45b4-408e-a630-a72ac7784fb0';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const value = Deno.env.get('GOOGLE_MAIL_API_KEY_2');
    const railwayToken = Deno.env.get('RAILWAY_API_KEY');
    if (!value) return json({ success: false, error: 'GOOGLE_MAIL_API_KEY_2 not present in Cloud env' });
    if (!railwayToken) return json({ success: false, error: 'RAILWAY_API_KEY missing' });

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
        name: 'GOOGLE_MAIL_API_KEY_2',
        value,
      },
    };

    const resp = await fetch('https://backboard.railway.com/graphql/v2', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${railwayToken}`,
      },
      body: JSON.stringify({ query: mutation, variables }),
    });
    const text = await resp.text();
    let parsed: any = null;
    try { parsed = JSON.parse(text); } catch {}
    if (!resp.ok || parsed?.errors) {
      return json({ success: false, error: `Railway ${resp.status}: ${text.slice(0, 500)}` });
    }
    return json({ success: true, result: parsed, value_length: value.length });
  } catch (err: any) {
    return json({ success: false, error: err?.message || String(err) });
  }
});

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status: 200,
  });
}
