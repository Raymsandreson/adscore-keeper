import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.EXTERNAL_SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.EXTERNAL_SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('⚠️ EXTERNAL_SUPABASE_URL e EXTERNAL_SUPABASE_SERVICE_ROLE_KEY são obrigatórios!');
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY };
