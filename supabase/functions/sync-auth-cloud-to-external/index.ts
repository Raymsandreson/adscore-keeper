// Sincroniza shells de auth.users do Cloud -> External (mesmo UUID, sem senha).
// Objetivo: satisfazer FKs auth.users(id) no External para a migração de dados.
// POST {} -> roda sync completo
// POST { dry_run: true } -> só relata o gap sem criar
// POST { user_ids: ["uuid1", ...] } -> só processa esses

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-request-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const CLOUD_URL = Deno.env.get("SUPABASE_URL")!;
const CLOUD_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const EXT_URL = Deno.env.get("EXTERNAL_SUPABASE_URL")!;
const EXT_KEY = Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY")!;

const cloud = createClient(CLOUD_URL, CLOUD_KEY, { auth: { persistSession: false } });
const ext = createClient(EXT_URL, EXT_KEY, { auth: { persistSession: false } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const dryRun = !!body.dry_run;
    const filterIds: string[] | null = Array.isArray(body.user_ids) ? body.user_ids : null;

    // 1. Lista todos users do Cloud (paginado)
    const cloudUsers: any[] = [];
    let page = 1;
    while (true) {
      const { data, error } = await cloud.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) throw new Error(`cloud listUsers: ${error.message}`);
      cloudUsers.push(...(data?.users || []));
      if (!data?.users || data.users.length < 1000) break;
      page++;
    }

    const result: any = {
      total_cloud: cloudUsers.length,
      already_in_ext: 0,
      created: 0,
      skipped_no_email: 0,
      errors: [] as Array<{ id: string; email?: string; error: string }>,
      created_users: [] as Array<{ id: string; email: string }>,
    };

    for (const u of cloudUsers) {
      if (filterIds && !filterIds.includes(u.id)) continue;

      // Tenta buscar no External
      const { data: existing } = await ext.auth.admin.getUserById(u.id);
      if (existing?.user) {
        result.already_in_ext++;
        continue;
      }

      if (!u.email) {
        result.skipped_no_email++;
        continue;
      }

      if (dryRun) {
        result.created++; // contagem de "seria criado"
        result.created_users.push({ id: u.id, email: u.email });
        continue;
      }

      // Cria shell no External com mesmo id + email, sem senha real
      const { error: createErr } = await ext.auth.admin.createUser({
        id: u.id,
        email: u.email,
        email_confirm: true,
        user_metadata: u.user_metadata || {},
        app_metadata: u.app_metadata || {},
      } as any);

      if (createErr) {
        // Lookup por email no External pra ver se existe com UUID diferente
        let extUuid: string | null = null;
        try {
          let p = 1;
          while (true) {
            const { data: lst } = await ext.auth.admin.listUsers({ page: p, perPage: 1000 });
            const found = lst?.users?.find((x: any) => x.email?.toLowerCase() === u.email.toLowerCase());
            if (found) { extUuid = found.id; break; }
            if (!lst?.users || lst.users.length < 1000) break;
            p++;
          }
        } catch (_) { /* ignore */ }
        result.errors.push({
          id: u.id,
          email: u.email,
          error: createErr.message.slice(0, 200),
          ext_uuid_found: extUuid,
          uuid_mismatch: extUuid && extUuid !== u.id ? true : false,
        } as any);
      } else {
        result.created++;
        result.created_users.push({ id: u.id, email: u.email });
      }
    }

    return new Response(JSON.stringify({ success: true, dry_run: dryRun, ...result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: String(e) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
