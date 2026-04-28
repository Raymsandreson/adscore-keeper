// Audita, no External DB, quantas linhas referenciam:
//  - cloud_uuid (UUID atual no Cloud)
//  - ext_uuid   (UUID equivalente já existente no External com mesmo email)
// Isso decide a estratégia (A: reescrever FKs / B: forçar UUID Cloud / mix).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ext = createClient(
  Deno.env.get("EXTERNAL_SUPABASE_URL")!,
  Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);
const cloud = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

// Lista de (tabela, coluna) a auditar no External — colunas que apontam pra auth.users
const TARGETS: Array<{ table: string; col: string }> = [
  { table: "contacts", col: "created_by" },
  { table: "contacts", col: "user_id" },
  { table: "leads", col: "created_by" },
  { table: "leads", col: "user_id" },
  { table: "leads", col: "assigned_to" },
  { table: "lead_activities", col: "created_by" },
  { table: "lead_activities", col: "assigned_to" },
  { table: "financial_entries", col: "created_by" },
  { table: "financial_entries", col: "user_id" },
  { table: "profiles", col: "user_id" },
  { table: "user_roles", col: "user_id" },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    // 1. Pega todos users do Cloud
    const cloudUsers: any[] = [];
    let p = 1;
    while (true) {
      const { data } = await cloud.auth.admin.listUsers({ page: p, perPage: 1000 });
      cloudUsers.push(...(data?.users || []));
      if (!data?.users || data.users.length < 1000) break;
      p++;
    }
    // 2. Pega todos users do External
    const extUsers: any[] = [];
    p = 1;
    while (true) {
      const { data } = await ext.auth.admin.listUsers({ page: p, perPage: 1000 });
      extUsers.push(...(data?.users || []));
      if (!data?.users || data.users.length < 1000) break;
      p++;
    }
    const extByEmail = new Map<string, string>();
    for (const u of extUsers) if (u.email) extByEmail.set(u.email.toLowerCase(), u.id);

    // 3. Identifica divergências
    const divergent: Array<{ email: string; cloud_id: string; ext_id: string }> = [];
    for (const u of cloudUsers) {
      if (!u.email) continue;
      const extId = extByEmail.get(u.email.toLowerCase());
      if (extId && extId !== u.id) {
        divergent.push({ email: u.email, cloud_id: u.id, ext_id: extId });
      }
    }

    // 4. Para cada divergente, conta refs em External por (cloud_id) e (ext_id)
    const report: any[] = [];
    for (const d of divergent) {
      const row: any = { email: d.email, cloud_id: d.cloud_id, ext_id: d.ext_id, refs: {} };
      for (const t of TARGETS) {
        try {
          const { count: cCloud } = await ext
            .from(t.table)
            .select("*", { count: "exact", head: true })
            .eq(t.col, d.cloud_id);
          const { count: cExt } = await ext
            .from(t.table)
            .select("*", { count: "exact", head: true })
            .eq(t.col, d.ext_id);
          row.refs[`${t.table}.${t.col}`] = { cloud: cCloud || 0, ext: cExt || 0 };
        } catch (e) {
          row.refs[`${t.table}.${t.col}`] = { error: String(e).slice(0, 80) };
        }
      }
      report.push(row);
    }

    // 5. Totaliza
    const totals: Record<string, { cloud: number; ext: number }> = {};
    for (const r of report) {
      for (const [k, v] of Object.entries<any>(r.refs)) {
        if (v.error) continue;
        if (!totals[k]) totals[k] = { cloud: 0, ext: 0 };
        totals[k].cloud += v.cloud;
        totals[k].ext += v.ext;
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        cloud_users_total: cloudUsers.length,
        ext_users_total: extUsers.length,
        divergent_count: divergent.length,
        totals_by_column: totals,
        per_user: report,
      }, null, 2),
      { headers: { ...cors, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: String(e) }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
