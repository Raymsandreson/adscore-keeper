// Valida paridade Cloud <-> External: conta linhas e investiga FK órfãs em whatsapp_messages.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const cloud = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const ext = createClient(Deno.env.get("EXTERNAL_SUPABASE_URL")!, Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY")!);

const TABLES_TO_CHECK = [
  "profiles", "user_roles", "teams", "team_members", "companies", "company_areas",
  "specialized_nuclei", "products_services", "kanban_boards", "leads", "contacts",
  "lead_activities", "whatsapp_instances", "whatsapp_messages", "whatsapp_command_history",
  "lead_followups", "lead_processes", "legal_cases", "contact_leads", "checklist_templates",
];

async function countTable(client: any, table: string): Promise<number | string> {
  const { count, error } = await client.from(table).select("*", { count: "exact", head: true });
  if (error) return `ERR: ${error.message.slice(0, 80)}`;
  return count ?? 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const body = await req.json().catch(() => ({}));

  if (body.investigate_orphans) {
    // Comparar IDs de whatsapp_messages cloud x external para descobrir as ~295 que falharam
    // Estratégia: buscar por chunks de id
    const { data: cloudIds } = await cloud
      .from("whatsapp_messages").select("id, lead_id, contact_id, instance_name, created_at").order("created_at", { ascending: false }).limit(50000);
    const cloudSet = new Set((cloudIds || []).map((r: any) => r.id));

    const { data: extIds } = await ext
      .from("whatsapp_messages").select("id").order("created_at", { ascending: false }).limit(50000);
    const extSet = new Set((extIds || []).map((r: any) => r.id));

    const missing = (cloudIds || []).filter((r: any) => !extSet.has(r.id));
    const sample = missing.slice(0, 20);

    // Agrupar por instance e por causa provável
    const byInstance: Record<string, number> = {};
    const withLeadId = missing.filter((r: any) => r.lead_id).length;
    const withContactId = missing.filter((r: any) => r.contact_id).length;
    for (const r of missing) {
      byInstance[r.instance_name || "null"] = (byInstance[r.instance_name || "null"] || 0) + 1;
    }

    return new Response(JSON.stringify({
      checked_recent_cloud: cloudIds?.length,
      checked_recent_ext: extIds?.length,
      missing_in_external_recent: missing.length,
      with_lead_id: withLeadId,
      with_contact_id: withContactId,
      by_instance: byInstance,
      sample,
    }, null, 2), { headers: { ...cors, "Content-Type": "application/json" } });
  }

  // Default: contagens lado a lado
  const results: any[] = [];
  for (const t of TABLES_TO_CHECK) {
    const [c, e] = await Promise.all([countTable(cloud, t), countTable(ext, t)]);
    const cloudN = typeof c === "number" ? c : -1;
    const extN = typeof e === "number" ? e : -1;
    const diff = cloudN >= 0 && extN >= 0 ? cloudN - extN : null;
    results.push({ table: t, cloud: c, external: e, diff_cloud_minus_ext: diff });
  }
  return new Response(JSON.stringify({ success: true, results }, null, 2), {
    headers: { ...cors, "Content-Type": "application/json" },
  });
});
