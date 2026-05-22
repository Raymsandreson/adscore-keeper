// Returns the WhatsApp instance IDs the authenticated user has access to.
// Reads AUTHORITATIVELY from the External DB (source of truth) to avoid
// drift between Cloud mirror (whatsapp_instance_users) and External.
//
// Why this exists: the Cloud mirror was drifting from External (the matrix
// in Team management reads External, the inbox was reading Cloud) — leading
// to inconsistent instance lists. This function eliminates the mirror as a
// read path.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { remapToExternal } from "../_shared/uuid-remap.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const EXTERNAL_URL = Deno.env.get("EXTERNAL_SUPABASE_URL")!;
    const EXTERNAL_SR = Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") || "";
    const cloud = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await cloud.auth.getUser();
    if (userErr || !userData?.user) {
      return json({ success: false, error: "unauthenticated", instance_ids: [], default_instance_id: null });
    }

    const ext = createClient(EXTERNAL_URL, EXTERNAL_SR);
    const cloudUserId = userData.user.id;
    const extUserId = await remapToExternal(ext, cloudUserId);
    const candidateIds = Array.from(new Set([cloudUserId, extUserId].filter(Boolean))) as string[];

    const [accessRes, profileRes] = await Promise.all([
      ext
        .from("whatsapp_instance_users")
        .select("instance_id")
        .in("user_id", candidateIds),
      ext
        .from("profiles")
        .select("default_instance_id")
        .in("user_id", candidateIds)
        .maybeSingle(),
    ]);

    if (accessRes.error) {
      return json({ success: false, error: accessRes.error.message, instance_ids: [], default_instance_id: null });
    }

    const ids = new Set<string>();
    (accessRes.data || []).forEach((r: any) => {
      if (r.instance_id) ids.add(r.instance_id);
    });
    const defaultId = (profileRes.data as any)?.default_instance_id || null;
    if (defaultId) ids.add(defaultId);

    return json({
      success: true,
      instance_ids: Array.from(ids),
      default_instance_id: defaultId,
    });
  } catch (e) {
    console.error("[get-my-instance-accesses] error:", e);
    return json({ success: false, error: (e as Error).message, instance_ids: [], default_instance_id: null });
  }
});
