/**
 * Returns a Supabase client pointed at the External DB (business data).
 * Use this for ALL writes/reads of business tables (lead_activities, etc).
 *
 * Cloud DB is reserved for Auth/Metadata only.
 */
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export function getExternalClient(): SupabaseClient {
  const url = (Deno.env.get("EXTERNAL_SUPABASE_URL") || "https://kmedldlepwiityjsdahz.supabase.co").trim();
  const key = (Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY") || "").trim();
  if (!url || !key) {
    throw new Error("EXTERNAL_SUPABASE_URL or EXTERNAL_SUPABASE_SERVICE_ROLE_KEY missing");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Returns a Supabase client pointed at the Lovable Cloud DB (auth/metadata only).
 * Use this ONLY for profiles, user_roles, auth_uuid_mapping and similar.
 */
export function getCloudClient(): SupabaseClient {
  const url = (Deno.env.get("SUPABASE_URL") || "").trim();
  const key = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
  if (!url || !key) {
    throw new Error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
