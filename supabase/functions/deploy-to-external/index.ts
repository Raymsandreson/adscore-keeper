// Helper one-shot: deploya uma edge function no Supabase EXTERNO usando
// EXTERNAL_SUPABASE_ACCESS_TOKEN (PAT) via Management API.
// Body: { slug: string, code: string, verify_jwt?: boolean }
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const PAT = Deno.env.get('EXTERNAL_SUPABASE_ACCESS_TOKEN')!;
const EXT_URL = Deno.env.get('EXTERNAL_SUPABASE_URL')!;
// Extrai ref do EXTERNAL_SUPABASE_URL (https://<ref>.supabase.co)
const EXT_REF = new URL(EXT_URL).hostname.split('.')[0];

function ok(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    if (!PAT) return ok({ success: false, error: 'EXTERNAL_SUPABASE_ACCESS_TOKEN missing' });
    const { slug, code, verify_jwt } = await req.json();
    if (!slug || !code) return ok({ success: false, error: 'slug and code required' });

    const base = `https://api.supabase.com/v1/projects/${EXT_REF}/functions`;
    const headers = {
      Authorization: `Bearer ${PAT}`,
      'Content-Type': 'application/json',
    };

    // Tenta criar; se 409, faz update via PATCH /:slug com body
    const createBody = {
      slug,
      name: slug,
      verify_jwt: verify_jwt ?? false,
      body: code,
    };
    let r = await fetch(base, { method: 'POST', headers, body: JSON.stringify(createBody) });
    let txt = await r.text();
    if (r.status === 409 || r.status === 400) {
      // Já existe → update
      r = await fetch(`${base}/${slug}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ body: code, verify_jwt: verify_jwt ?? false }),
      });
      txt = await r.text();
    }

    if (!r.ok) return ok({ success: false, status: r.status, response: txt });
    return ok({ success: true, slug, ref: EXT_REF, response: txt });
  } catch (e) {
    return ok({ success: false, error: e instanceof Error ? e.message : String(e) });
  }
});
