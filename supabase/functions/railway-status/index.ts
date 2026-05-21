const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };
const KEY = Deno.env.get('RAILWAY_API_KEY')!;
const SVC = Deno.env.get('RAILWAY_SERVICE_ID') || '4ef74b81-45b4-408e-a630-a72ac7784fb0';
const ENV = Deno.env.get('RAILWAY_ENVIRONMENT_ID') || 'a09acf1f-c28a-49fd-9b59-076629c0bf21';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const url = new URL(req.url);
  const depId = url.searchParams.get('deployment_id') || 'aa7114f9-ea11-42b8-bd0b-2a3e9b13afc7';
  const q = `query($id:String!){buildLogs(deploymentId:$id, limit:300){message severity timestamp}}`;
  const r = await fetch('https://backboard.railway.app/graphql/v2', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: q, variables: { id: depId } }),
  });
  const j = await r.json();
  return new Response(JSON.stringify(j, null, 2), { headers: { ...cors, 'Content-Type': 'application/json' } });
});
