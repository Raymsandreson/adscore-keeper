/**
 * Shared constants, types, and utilities for all WJIA Agent handlers.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  resolveServiceRoleKey,
  resolveSupabaseUrl,
} from "../../_shared/supabase-url-resolver.ts";

// Resolved URLs (use external Supabase when configured)
export const RESOLVED_SUPABASE_URL = resolveSupabaseUrl();
export const RESOLVED_SERVICE_ROLE_KEY = resolveServiceRoleKey();
export const RESOLVED_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

export function errorResponse(msg: string, status = 400) {
  return new Response(JSON.stringify({ success: false, error: msg }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function createSupabaseClient() {
  return createClient(RESOLVED_SUPABASE_URL, RESOLVED_SERVICE_ROLE_KEY);
}
