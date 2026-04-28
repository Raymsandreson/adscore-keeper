// Trigger-friendly: dado um cloud user_id, garante shell no Externo
// (mesmo UUID quando possível) e popula auth_uuid_mapping.
// POST { user_id: string, email?: string, full_name?: string }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const CLOUD_URL = Deno.env.get("SUPABASE_URL")!;
const CLOUD_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const EXT_URL = Deno.env.get("EXTERNAL_SUPABASE_URL")!;
const EXT_KEY = Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY")!;

const cloud = createClient(CLOUD_URL, CLOUD_KEY, { auth: { persistSession: false } });
const ext = createClient(EXT_URL, EXT_KEY, { auth: { persistSession: false } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const body = await req.json().catch(() => ({}));
    const userId: string | undefined = body.user_id;
    if (!userId) {
      return new Response(JSON.stringify({ success: false, error: "user_id required" }), {
        status: 200,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // 1. Fetch cloud user (fallback se body não trouxe email)
    let email: string | undefined = body.email;
    let userMeta: any = body.user_metadata || {};
    if (!email) {
      const { data: cu } = await cloud.auth.admin.getUserById(userId);
      email = cu?.user?.email;
      userMeta = cu?.user?.user_metadata || userMeta;
    }
    if (!email) {
      return new Response(JSON.stringify({ success: false, error: "no_email" }), {
        status: 200,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // 2. Já existe no Externo com mesmo UUID?
    let extUuid: string | null = null;
    const { data: existing } = await ext.auth.admin.getUserById(userId);
    if (existing?.user) {
      extUuid = existing.user.id;
    } else {
      // tenta criar shell com mesmo UUID
      const { data: created, error: createErr } = await ext.auth.admin.createUser({
        id: userId,
        email,
        email_confirm: true,
        user_metadata: userMeta,
      } as any);
      if (created?.user) {
        extUuid = created.user.id;
      } else if (createErr) {
        // fallback: procura por email
        let p = 1;
        while (true) {
          const { data: lst } = await ext.auth.admin.listUsers({ page: p, perPage: 1000 });
          const found = lst?.users?.find((x: any) => x.email?.toLowerCase() === email!.toLowerCase());
          if (found) { extUuid = found.id; break; }
          if (!lst?.users || lst.users.length < 1000) break;
          p++;
        }
        if (!extUuid) {
          return new Response(JSON.stringify({ success: false, error: createErr.message }), {
            status: 200,
            headers: { ...cors, "Content-Type": "application/json" },
          });
        }
      }
    }

    // 3. Upsert em auth_uuid_mapping no Externo
    const { error: mapErr } = await ext.from("auth_uuid_mapping").upsert(
      { cloud_uuid: userId, ext_uuid: extUuid, email },
      { onConflict: "cloud_uuid" },
    );
    if (mapErr) {
      return new Response(JSON.stringify({ success: false, error: `mapping: ${mapErr.message}` }), {
        status: 200,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ success: true, cloud_uuid: userId, ext_uuid: extUuid, identity: extUuid === userId }),
      { status: 200, headers: { ...cors, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    return new Response(JSON.stringify({ success: false, error: e?.message || String(e) }), {
      status: 200,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
