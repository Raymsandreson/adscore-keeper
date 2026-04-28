/**
 * Server-side UUID remap helpers.
 *
 * Cloud user IDs (auth.users in Lovable Cloud) must be translated to External
 * user IDs before persisting in business tables on the External DB.
 *
 * Strategy A (per user choice): direct query to auth_uuid_mapping on the
 * External DB on every call. No cache. Edge functions are short-lived; the
 * extra latency is acceptable and avoids stale mappings.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

/**
 * Convert a Cloud UUID to an External UUID using auth_uuid_mapping (External DB).
 * Returns the input unchanged when:
 *  - input is null/undefined/empty
 *  - no mapping row exists (assume identity, i.e. cloud_uuid == ext_uuid)
 */
export async function remapToExternal(
  externalClient: SupabaseClient,
  cloudUuid: string | null | undefined,
): Promise<string | null> {
  if (!cloudUuid) return cloudUuid ?? null;
  try {
    const { data, error } = await externalClient
      .from("auth_uuid_mapping")
      .select("ext_uuid")
      .eq("cloud_uuid", cloudUuid)
      .maybeSingle();
    if (error) {
      console.warn("[remapToExternal] lookup failed:", error.message);
      return cloudUuid;
    }
    return (data?.ext_uuid as string | undefined) ?? cloudUuid;
  } catch (e) {
    console.warn("[remapToExternal] threw:", (e as Error).message);
    return cloudUuid;
  }
}

/**
 * Convert an External UUID back to a Cloud UUID. Used by aggregations that
 * group/display by Cloud user. Returns input unchanged when mapping is absent.
 */
export async function remapToCloud(
  externalClient: SupabaseClient,
  extUuid: string | null | undefined,
): Promise<string | null> {
  if (!extUuid) return extUuid ?? null;
  try {
    const { data, error } = await externalClient
      .from("auth_uuid_mapping")
      .select("cloud_uuid")
      .eq("ext_uuid", extUuid)
      .maybeSingle();
    if (error) {
      console.warn("[remapToCloud] lookup failed:", error.message);
      return extUuid;
    }
    return (data?.cloud_uuid as string | undefined) ?? extUuid;
  } catch (e) {
    console.warn("[remapToCloud] threw:", (e as Error).message);
    return extUuid;
  }
}
