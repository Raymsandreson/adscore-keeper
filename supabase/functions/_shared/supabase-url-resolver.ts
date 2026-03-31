/**
 * Resolves the correct Supabase API URL, filtering out non-HTTP values
 * (e.g. postgresql:// connection strings that may be stored in EXTERNAL_SUPABASE_URL).
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
  // Hardcoded fallback for the external project
  return 'https://kmedldlepwiityjsdahz.supabase.co';
}

export function resolveServiceRoleKey(): string {
  return (Deno.env.get('EXTERNAL_SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '').trim();
}
