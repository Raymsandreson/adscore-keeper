/**
 * Resolves the correct backend URL for edge functions.
 * Prefer the current Lovable Cloud project and only fall back to an external URL
 * when the Cloud URL is not available.
 */
export function resolveSupabaseUrl(): string {
  const candidates = [
    Deno.env.get('SUPABASE_URL'),
    Deno.env.get('EXTERNAL_SUPABASE_URL'),
  ];

  for (const c of candidates) {
    const v = (c || '').trim();
    if (v.startsWith('https://') || v.startsWith('http://')) return v;
  }

  throw new Error('No valid backend URL configured for this function');
}

export function resolveServiceRoleKey(): string {
  return (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('EXTERNAL_SUPABASE_SERVICE_ROLE_KEY') || '').trim();
}
