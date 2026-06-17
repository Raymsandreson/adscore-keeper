async function fetchAnalytics(projectRef, sql) {
  const token = process.env.EXTERNAL_SUPABASE_ACCESS_TOKEN;
  if (!token) throw new Error("No token found");
  
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/analytics/endpoints/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ sql })
  });
  
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Failed to fetch analytics for ${projectRef}: ${response.status} ${err}`);
  }
  
  return await response.json();
}

const cloudRef = 'gliigkupoebmlbwyvijp';
const externalRef = 'kmedldlepwiityjsdahz';

const query1 = `
SELECT m.function_id, COUNT(*) as errs
FROM function_logs
CROSS JOIN unnest(metadata) as m
WHERE timestamp > now() - interval '7 days'
  AND (event_message ILIKE '%error%' OR event_message ILIKE '%exception%' OR event_message ILIKE '%failed%')
GROUP BY m.function_id ORDER BY errs DESC LIMIT 10
`;

const query2 = `
SELECT m.function_id, response.status_code, COUNT(*) c
FROM function_edge_logs
CROSS JOIN unnest(metadata) m
CROSS JOIN unnest(m.response) response
WHERE timestamp > now() - interval '7 days' AND response.status_code >= 500
GROUP BY 1,2 ORDER BY c DESC LIMIT 10
`;

const queryPostgres = `
SELECT 
  event_message, 
  COUNT(*) as c
FROM postgres_logs
WHERE timestamp > now() - interval '7 days'
  AND (event_message ILIKE '%ERROR%' OR event_message ILIKE '%FATAL%')
GROUP BY 1 ORDER BY c DESC LIMIT 5
`;

async function main() {
  try {
    console.log("--- Cloud Project Errors (Query 1) ---");
    const res1 = await fetchAnalytics(cloudRef, query1).catch(e => ({ error: e.message }));
    console.log(JSON.stringify(res1, null, 2));

    console.log("\n--- Cloud Project HTTP 5xx (Query 2) ---");
    const res2 = await fetchAnalytics(cloudRef, query2).catch(e => ({ error: e.message }));
    console.log(JSON.stringify(res2, null, 2));

    console.log("\n--- Cloud Postgres Errors ---");
    const resP = await fetchAnalytics(cloudRef, queryPostgres).catch(e => ({ error: e.message }));
    console.log(JSON.stringify(resP, null, 2));

    // Also check external just in case the "Cloud" was a misnomer in the user prompt 
    // or if they want both.
  } catch (e) {
    console.error(e);
  }
}

main();
