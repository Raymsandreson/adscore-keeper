import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Returns Supabase URL and Service Role Key, preferring EXTERNAL_ overrides
 * so Edge Functions on Lovable Cloud can write to the external Supabase project.
 */
export function getSupabaseConfig() {
  const url = Deno.env.get('EXTERNAL_SUPABASE_URL') || Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('EXTERNAL_SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  return { url, serviceRoleKey };
}

export function createServiceClient() {
  const { url, serviceRoleKey } = getSupabaseConfig();
  return createClient(url, serviceRoleKey);
}

export function getSupabaseUrl() {
  return Deno.env.get('EXTERNAL_SUPABASE_URL') || Deno.env.get('SUPABASE_URL')!;
}

export function getSupabaseAnonKey() {
  return Deno.env.get('SUPABASE_ANON_KEY')!;
}
