import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ABDER_OLD = "7f41a35e-7d98-4ade-8270-52d727433e6a";
const ABDER_NEW = "b68dab6e"; // prefix; we'll resolve full

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const url = (Deno.env.get("EXTERNAL_SUPABASE_URL") || "").trim();
    const key = (Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY") || "").trim();
    const sb = createClient(url, key);

    // 1) Resolver Abder NEW pelo prefixo via profiles
    const { data: profs } = await sb.from("profiles").select("id, user_id, full_name, email").ilike("full_name", "%abder%");
    const newRow = (profs || []).find((p: any) => (p.user_id || p.id || "").startsWith(ABDER_NEW));
    const abderNewId = newRow?.user_id || newRow?.id || null;

    // 2) Comparativo com outros acolhedores: olhar agent_stage_assignments e team_members
    //    Pegar todos os usuários referenciados em agent_stage_assignments e ver se o ID bate com profiles.user_id ou só team_members
    const { data: stageAssigns } = await sb.from("agent_stage_assignments").select("*").limit(500);
    const { data: autoRules } = await sb.from("agent_automation_rules").select("*").limit(500);
    const { data: tmAll } = await sb.from("team_members").select("id, user_id, full_name, email, role").limit(500);
    const { data: profAll } = await sb.from("profiles").select("id, user_id, full_name, email").limit(2000);

    const profByUserId = new Map((profAll || []).map((p: any) => [p.user_id || p.id, p]));
    const tmByUserId = new Map((tmAll || []).map((t: any) => [t.user_id, t]));

    // Para cada user_id que aparece como assignee em agent_stage_assignments / agent_automation_rules,
    // verificar se: (a) tem profile, (b) tem team_member
    const collectIds = (rows: any[] | null) => {
      const ids = new Set<string>();
      for (const r of rows || []) {
        for (const v of Object.values(r)) {
          if (typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(v)) ids.add(v);
          if (v && typeof v === "object") {
            const s = JSON.stringify(v);
            const m = s.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g);
            if (m) m.forEach((id) => ids.add(id));
          }
        }
      }
      return ids;
    };

    const idsInStage = [...collectIds(stageAssigns)];
    const idsInRules = [...collectIds(autoRules)];

    const classify = (id: string) => ({
      id,
      hasProfile: profByUserId.has(id),
      hasTeamMember: tmByUserId.has(id),
      profileName: profByUserId.get(id)?.full_name || null,
      tmName: tmByUserId.get(id)?.full_name || null,
    });

    const stageClassified = idsInStage.map(classify).filter((c) => c.hasProfile || c.hasTeamMember);
    const rulesClassified = idsInRules.map(classify).filter((c) => c.hasProfile || c.hasTeamMember);

    // Estatística: quantos dos IDs em stage/rules têm profile vs só team_member
    const stat = (arr: any[]) => ({
      total: arr.length,
      withProfile: arr.filter((c) => c.hasProfile).length,
      withTeamMemberOnly: arr.filter((c) => !c.hasProfile && c.hasTeamMember).length,
      both: arr.filter((c) => c.hasProfile && c.hasTeamMember).length,
    });

    // Abder específico
    const abderOldProfile = profByUserId.get(ABDER_OLD) || null;
    const abderOldTM = tmByUserId.get(ABDER_OLD) || null;
    const abderNewProfile = abderNewId ? profByUserId.get(abderNewId) : null;
    const abderNewTM = abderNewId ? tmByUserId.get(abderNewId) : null;

    return new Response(
      JSON.stringify(
        {
          abderNewIdResolved: abderNewId,
          abderOld: { id: ABDER_OLD, profile: abderOldProfile, teamMember: abderOldTM },
          abderNew: { id: abderNewId, profile: abderNewProfile, teamMember: abderNewTM },
          comparativoOutrosAcolhedores: {
            agent_stage_assignments: stat(stageClassified),
            agent_automation_rules: stat(rulesClassified),
            interpretacao:
              "Se a maioria tem profile, o padrão canônico é o ID do profile; assignments órfãos (só team_member) são exceção.",
          },
          stageSamples: stageClassified.slice(0, 30),
          rulesSamples: rulesClassified.slice(0, 30),
        },
        null,
        2
      ),
      { headers: { ...cors, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { headers: { ...cors, "Content-Type": "application/json" } });
  }
});
