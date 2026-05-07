// Dispara redeploy no Railway via GraphQL API.
// Body opcional: { service_id?, environment_id?, project_id? }
// Defaults vêm de env: RAILWAY_SERVICE_ID, RAILWAY_ENVIRONMENT_ID, RAILWAY_PROJECT_ID.
// Retorna SEMPRE 200 com { success, ... } por convenção do projeto.
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const RAILWAY_API_KEY = Deno.env.get('RAILWAY_API_KEY')!;
const ENV_SERVICE_ID = Deno.env.get('RAILWAY_SERVICE_ID') || '';
const ENV_ENVIRONMENT_ID = Deno.env.get('RAILWAY_ENVIRONMENT_ID') || '';
const ENV_PROJECT_ID = Deno.env.get('RAILWAY_PROJECT_ID') || '';

function ok(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

async function gql(query: string, variables: Record<string, unknown>) {
  const r = await fetch('https://backboard.railway.app/graphql/v2', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RAILWAY_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  const data = await r.json().catch(() => ({}));
  return { httpOk: r.ok, status: r.status, data };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    if (!RAILWAY_API_KEY) return ok({ success: false, error: 'RAILWAY_API_KEY missing' });

    let body: any = {};
    try { body = await req.json(); } catch { /* GET-like ping */ }

    let service_id: string = body?.service_id || ENV_SERVICE_ID;
    let environment_id: string = body?.environment_id || ENV_ENVIRONMENT_ID;
    let project_id: string = body?.project_id || ENV_PROJECT_ID;

    // Auto-discover: se faltar service/environment, descobre via project_id (ou primeiro projeto do token)
    if (!service_id || !environment_id) {
      const meQ = `query { projects { edges { node { id name services { edges { node { id name } } } environments { edges { node { id name } } } } } } }`;
      const me = await gql(meQ, {});
      if (!me.httpOk) return ok({ success: false, step: 'discover', status: me.status, response: me.data });
      const projects = me.data?.data?.projects?.edges?.map((e: any) => e.node) || [];
      const proj = project_id
        ? projects.find((p: any) => p.id === project_id)
        : projects[0];
      if (!proj) return ok({ success: false, error: 'no projects accessible by token', projects: projects.map((p: any) => ({ id: p.id, name: p.name })) });
      project_id = proj.id;
      const services = proj.services?.edges?.map((e: any) => e.node) || [];
      const envs = proj.environments?.edges?.map((e: any) => e.node) || [];
      if (!service_id) service_id = services[0]?.id;
      if (!environment_id) {
        environment_id = envs.find((e: any) => e.name === 'production')?.id || envs[0]?.id;
      }
      if (!service_id || !environment_id) {
        return ok({ success: false, error: 'could not auto-discover service/environment', services, envs });
      }
    }

    // Pega último deployment desse service/env e redeploya
    const lastQ = `query($serviceId: String!, $environmentId: String!) {
      deployments(first: 1, input: { serviceId: $serviceId, environmentId: $environmentId }) {
        edges { node { id status createdAt } }
      }
    }`;
    const last = await gql(lastQ, { serviceId: service_id, environmentId: environment_id });
    if (!last.httpOk) return ok({ success: false, step: 'lastDeployment', status: last.status, response: last.data });
    const deployment = last.data?.data?.deployments?.edges?.[0]?.node;
    if (!deployment?.id) {
      return ok({ success: false, error: 'no previous deployment found to redeploy', service_id, environment_id });
    }

    const redeployM = `mutation($id: String!) { deploymentRedeploy(id: $id) { id status } }`;
    const r = await gql(redeployM, { id: deployment.id });
    if (!r.httpOk || r.data?.errors) {
      return ok({ success: false, step: 'redeploy', status: r.status, response: r.data });
    }
    return ok({
      success: true,
      project_id,
      service_id,
      environment_id,
      previous_deployment_id: deployment.id,
      new_deployment: r.data?.data?.deploymentRedeploy,
    });
  } catch (e) {
    return ok({ success: false, error: e instanceof Error ? e.message : String(e) });
  }
});
