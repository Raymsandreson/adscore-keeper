// Register an orphan WhatsApp instance into the External DB.
// Detects names that appear in whatsapp_messages but are missing in
// whatsapp_instances, then creates the row and attempts to auto-link the
// owner profile by name (case-insensitive substring match).
//
// If a Cloud-side `whatsapp_instances` row exists for the same name we
// reuse its `instance_token` / `base_url` so connectivity keeps working.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalize(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const rawName = typeof body?.instance_name === "string" ? body.instance_name.trim() : "";
    if (!rawName) return jsonResponse({ error: "instance_name is required" }, 400);

    const externalUrl = Deno.env.get("EXTERNAL_SUPABASE_URL");
    const externalKey = Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY");
    if (!externalUrl || !externalKey) {
      return jsonResponse({ error: "External Supabase credentials not configured" }, 500);
    }
    const cloudUrl = Deno.env.get("SUPABASE_URL")!;
    const cloudKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const ext = createClient(externalUrl, externalKey);
    const cloud = createClient(cloudUrl, cloudKey);

    // 1) Already registered? (case-insensitive)
    const { data: existing, error: existingErr } = await ext
      .from("whatsapp_instances")
      .select("id, instance_name")
      .ilike("instance_name", rawName);
    if (existingErr) throw existingErr;
    if (existing && existing.length > 0) {
      return jsonResponse({
        ok: true,
        already_registered: true,
        instance_id: existing[0].id,
        instance_name: existing[0].instance_name,
      });
    }

    // 2) Check if Cloud has a same-name instance we can borrow credentials from
    const { data: cloudRows } = await cloud
      .from("whatsapp_instances")
      .select("instance_name, instance_token, base_url, owner_phone, owner_name")
      .ilike("instance_name", rawName);
    const cloudRow = cloudRows && cloudRows.length > 0 ? cloudRows[0] : null;

    // 3) Auto-link owner by name (External profiles)
    const norm = normalize(rawName);
    // Try main words: split, drop generic tokens like "atendimento"
    const generic = new Set([
      "atendimento", "sdr", "acolhedor", "acolhedora", "gerente",
      "ia", "whatsjud", "previdenciario", "processual", "maternidade",
      "abraci", "teste", "prev", "prudencred",
    ]);
    const tokens = norm.split(/\s+|[-_]/).filter((t) => t && !generic.has(t));
    let ownerProfile: { user_id: string; full_name: string; default_instance_id: string | null } | null = null;
    for (const tok of tokens) {
      if (tok.length < 3) continue;
      const { data: profs } = await ext
        .from("profiles")
        .select("user_id, full_name, default_instance_id")
        .ilike("full_name", `%${tok}%`)
        .limit(5);
      if (profs && profs.length > 0) {
        // Prefer exact-ish match (longest token coverage)
        ownerProfile = profs[0] as any;
        break;
      }
    }

    // 4) Insert into External
    const insertPayload: Record<string, unknown> = {
      instance_name: rawName,
      instance_token: cloudRow?.instance_token ?? "",
      base_url: cloudRow?.base_url ?? "https://abraci.uazapi.com",
      owner_phone: cloudRow?.owner_phone ?? null,
      owner_name: cloudRow?.owner_name ?? ownerProfile?.full_name ?? null,
      is_active: true,
    };
    const { data: inserted, error: insErr } = await ext
      .from("whatsapp_instances")
      .insert(insertPayload)
      .select("id, instance_name")
      .single();
    if (insErr) throw insErr;

    // 5) Link owner profile if it has no default_instance_id yet
    let linked = false;
    if (ownerProfile && !ownerProfile.default_instance_id) {
      const { error: updErr } = await ext
        .from("profiles")
        .update({ default_instance_id: inserted.id })
        .eq("user_id", ownerProfile.user_id);
      if (!updErr) linked = true;
    }

    return jsonResponse({
      ok: true,
      already_registered: false,
      instance_id: inserted.id,
      instance_name: inserted.instance_name,
      owner_user_id: ownerProfile?.user_id ?? null,
      owner_name: ownerProfile?.full_name ?? null,
      owner_linked: linked,
      borrowed_credentials_from_cloud: !!cloudRow,
    });
  } catch (e) {
    console.error("[register-whatsapp-instance] error:", e);
    return jsonResponse({ error: (e as Error)?.message || "internal_error" }, 500);
  }
});
