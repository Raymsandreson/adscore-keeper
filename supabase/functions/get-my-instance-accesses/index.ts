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

// Fetch com timeout — evita pendurar a function até o IDLE_TIMEOUT (150s)
// quando o External DB demora a responder.
function timeoutFetch(timeoutMs: number): typeof fetch {
  return (input, init) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const signal = init?.signal
      ? init.signal // respeita signal explícito
      : ctrl.signal;
    return fetch(input, { ...init, signal }).finally(() => clearTimeout(t));
  };
}

// Wrap qualquer Promise num timeout duro.
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout:${label}:${ms}ms`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); },
           (e) => { clearTimeout(t); reject(e); });
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Fallback global: se qualquer coisa azedar, devolve payload vazio em 200
  // para o cliente cair no Cloud mirror sem ver 504.
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const EXTERNAL_URL = Deno.env.get("EXTERNAL_SUPABASE_URL")!;
    const EXTERNAL_SR = Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") || "";
    const cloud = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader }, fetch: timeoutFetch(5000) },
    });
    const ext = createClient(EXTERNAL_URL, EXTERNAL_SR, {
      global: { fetch: timeoutFetch(7000) },
    });

    const userData = await withTimeout(cloud.auth.getUser(), 6000, "auth.getUser")
      .catch((e) => { console.warn("[get-my-instance-accesses] auth failed:", (e as Error).message); return null; });

    if (!userData || userData.error || !userData.data?.user) {
      return json({ success: false, error: "unauthenticated", instance_ids: [], default_instance_id: null });
    }

    const cloudUserId = userData.data.user.id;
    const extUserId = await withTimeout(remapToExternal(ext, cloudUserId), 4000, "remap")
      .catch(() => cloudUserId);
    const candidateIds = Array.from(new Set([cloudUserId, extUserId].filter(Boolean))) as string[];

    const accessP = ext
      .from("whatsapp_instance_users")
      .select("instance_id")
      .in("user_id", candidateIds);
    const profileP = ext
      .from("profiles")
      .select("default_instance_id")
      .in("user_id", candidateIds)
      .maybeSingle();

    const [accessRes, profileRes] = await Promise.all([
      withTimeout(accessP, 8000, "instance_users").catch((e) => ({ error: e, data: null } as any)),
      withTimeout(profileP, 8000, "profiles").catch((e) => ({ error: e, data: null } as any)),
    ]);

    if (accessRes.error) {
      console.warn("[get-my-instance-accesses] access error:", String(accessRes.error?.message || accessRes.error));
      return json({ success: false, error: String(accessRes.error?.message || accessRes.error), instance_ids: [], default_instance_id: null });
    }

    const ids = new Set<string>();
    (accessRes.data || []).forEach((r: any) => { if (r.instance_id) ids.add(r.instance_id); });
    const defaultId = (profileRes.data as any)?.default_instance_id || null;
    if (defaultId) ids.add(defaultId);

    return json({
      success: true,
      instance_ids: Array.from(ids),
      default_instance_id: defaultId,
    });
  } catch (e) {
    console.error("[get-my-instance-accesses] error:", (e as Error).message);
    return json({ success: false, error: (e as Error).message, instance_ids: [], default_instance_id: null });
  }
});

