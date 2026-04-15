const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ORG_SLUG = 'prudencio-advogados';
const PROJECT_SLUG = 'javascript-react';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

  const SENTRY_AUTH_TOKEN = Deno.env.get('SENTRY_AUTH_TOKEN');
  if (!SENTRY_AUTH_TOKEN) {
    return new Response(JSON.stringify({ error: 'SENTRY_AUTH_TOKEN not configured' }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  const url = new URL(req.url);
  const endpoint = url.searchParams.get('endpoint') || 'issues';
  const query = url.searchParams.get('query') || 'is:unresolved';
  const statsPeriod = url.searchParams.get('statsPeriod') || '14d';

  let sentryUrl: string;

  if (endpoint === 'issues') {
    sentryUrl = `https://sentry.io/api/0/projects/${ORG_SLUG}/${PROJECT_SLUG}/issues/?statsPeriod=${encodeURIComponent(statsPeriod)}&query=${encodeURIComponent(query)}`;
  } else if (endpoint === 'events' || endpoint === 'issue-events') {
    const issueId = url.searchParams.get('issueId');
    if (!issueId) {
      return new Response(JSON.stringify({ error: 'issueId is required' }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }
    sentryUrl = `https://sentry.io/api/0/issues/${issueId}/events/`;
  } else if (endpoint === 'issue-details') {
    const issueId = url.searchParams.get('issueId');
    if (!issueId) {
      return new Response(JSON.stringify({ error: 'issueId is required' }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }
    sentryUrl = `https://sentry.io/api/0/issues/${issueId}/`;
  } else {
    sentryUrl = `https://sentry.io/api/0/projects/${ORG_SLUG}/${PROJECT_SLUG}/${endpoint}/`;
  }

  try {
    const resp = await fetch(sentryUrl, {
      headers: {
        'Authorization': `Bearer ${SENTRY_AUTH_TOKEN}`,
        'Content-Type': 'application/json',
      },
    });

    const body = await resp.text();

    if (!resp.ok) {
      return new Response(JSON.stringify({ error: 'Sentry API error', status: resp.status, details: body }), {
        status: resp.status,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    return new Response(body, {
      status: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Failed to fetch from Sentry', details: String(err) }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
});
