/**
 * Shared auth helpers for edge functions.
 * - requireAuth: validates JWT, returns user or null
 * - requireAdmin: validates JWT + checks admin role on External DB
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export async function requireAuth(req: Request): Promise<{ userId: string; email: string | null } | null> {
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return null;
  const cloudUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const cloud = createClient(cloudUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data, error } = await cloud.auth.getUser();
  if (error || !data?.user) return null;
  return { userId: data.user.id, email: data.user.email ?? null };
}

export async function requireAdmin(req: Request): Promise<{ userId: string; email: string | null } | null> {
  const user = await requireAuth(req);
  if (!user) return null;

  const extUrl = (Deno.env.get("EXTERNAL_SUPABASE_URL") || "").trim();
  const extKey = (Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY") || "").trim();
  if (!extUrl || !extKey) return null;
  const ext = createClient(extUrl, extKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Try both Cloud UUID and any remapped External UUID
  const candidates = new Set<string>([user.userId]);
  try {
    const cloud = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: map } = await cloud
      .from("auth_uuid_mapping")
      .select("external_user_id")
      .eq("cloud_user_id", user.userId)
      .maybeSingle();
    if (map?.external_user_id) candidates.add(map.external_user_id);
  } catch { /* ignore */ }

  const { data: roles } = await ext
    .from("user_roles")
    .select("role")
    .in("user_id", Array.from(candidates))
    .eq("role", "admin")
    .limit(1);

  if (!roles?.length) return null;
  return user;
}

export const unauthorized = (corsHeaders: Record<string, string>) =>
  new Response(JSON.stringify({ success: false, error: "unauthorized" }), {
    status: 401,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

export const forbidden = (corsHeaders: Record<string, string>) =>
  new Response(JSON.stringify({ success: false, error: "forbidden" }), {
    status: 403,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
