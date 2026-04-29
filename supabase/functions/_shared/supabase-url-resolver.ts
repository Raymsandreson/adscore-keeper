/**
 * Resolves the correct backend URL for edge functions.
 *
 * IMPORTANT: External Supabase is the source of truth for ALL business data
 * (leads, contacts, whatsapp_messages, activities, profiles, user_roles, etc.).
 * Cloud DB only holds auth + a small mirror. So we prefer EXTERNAL_SUPABASE_URL
 * and only fall back to the Cloud URL when the external one is missing.
 *
 * If a function specifically needs the Cloud DB (e.g. auth_uuid_mapping bridge),
 * it must use `getCloudClient()` from `_shared/external-client.ts` explicitly.
 */
export function resolveSupabaseUrl(): string {
  const candidates = [
    Deno.env.get('EXTERNAL_SUPABASE_URL'),
    Deno.env.get('SUPABASE_URL'),
  ];

  for (const c of candidates) {
    const v = (c || '').trim();
    if (v.startsWith('https://') || v.startsWith('http://')) return v;
  }

  throw new Error('No valid backend URL configured for this function');
}

export function resolveServiceRoleKey(): string {
  return (
    Deno.env.get('EXTERNAL_SUPABASE_SERVICE_ROLE_KEY') ||
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ||
    ''
  ).trim();
}
