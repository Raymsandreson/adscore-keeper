/**
 * Single source of truth for the Lovable Cloud Functions base URL.
 *
 * This is used to invoke neighboring edge functions that still live on
 * the Lovable Cloud (e.g. wjia-agent, whatsapp-ai-agent-reply,
 * whatsapp-command-processor, auto-enrich-lead, member-ai-assistant,
 * execute-agent-automations, analyze-activity-chat).
 *
 * It is NOT for database access. For database persistence:
 *   - Business data → use resolveSupabaseUrl() (External DB)
 *   - Auth/metadata → use getCloudClient() from _shared/external-client.ts
 *
 * Hardcoded fallback intentional: SUPABASE_URL env var is always set on
 * Lovable Cloud; the hardcoded value matches the project ref and only
 * triggers on misconfiguration.
 */
export const CLOUD_FUNCTIONS_URL = Deno.env.get("SUPABASE_URL") ||
  "https://gliigkupoebmlbwyvijp.supabase.co";

export const CLOUD_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
