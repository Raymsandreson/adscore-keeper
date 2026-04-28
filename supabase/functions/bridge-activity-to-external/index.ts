// Bridge: replica INSERT/UPDATE/DELETE de lead_activities (Cloud) para External.
// Chamada via pg_net pelo trigger no Cloud. Idempotente (upsert por id).
// Body: { op: 'INSERT'|'UPDATE'|'DELETE', table: string, row: any, old_row?: any }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-bridge-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const EXT_URL = Deno.env.get("EXTERNAL_SUPABASE_URL")!;
const EXT_KEY = Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY")!;
const CLOUD_URL = Deno.env.get("SUPABASE_URL")!;
const CLOUD_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const ext = createClient(EXT_URL, EXT_KEY, { auth: { persistSession: false } });
const cloud = createClient(CLOUD_URL, CLOUD_KEY, { auth: { persistSession: false } });

// Tabelas permitidas neste bridge
const ALLOWED_TABLES = new Set([
  "lead_activities",
  "activity_chat_messages",
  "activity_attachments",
]);

// Colunas FK auth que precisam remap cloud_uuid -> ext_uuid
const FK_AUTH_COLUMNS = new Set<string>([
  "created_by", "user_id", "assigned_to", "updated_by", "owner_id",
  "deleted_by", "uploaded_by", "sent_by", "completed_by", "approved_by", "reviewed_by",
]);

let UUID_MAP: Map<string, string> | null = null;
let UUID_MAP_LOADED_AT = 0;
async function loadUuidMap(): Promise<Map<string, string>> {
  // Cache 5min
  if (UUID_MAP && Date.now() - UUID_MAP_LOADED_AT < 5 * 60_000) return UUID_MAP;
  const { data, error } = await cloud.from("auth_uuid_mapping").select("cloud_uuid, ext_uuid");
  if (error) throw new Error(`load uuid_map: ${error.message}`);
  UUID_MAP = new Map((data || []).map((r: any) => [r.cloud_uuid, r.ext_uuid]));
  UUID_MAP_LOADED_AT = Date.now();
  return UUID_MAP;
}

function remapRow(row: any, map: Map<string, string>): any {
  if (!row) return row;
  const out: any = { ...row };
  for (const k of Object.keys(out)) {
    if (FK_AUTH_COLUMNS.has(k) && typeof out[k] === "string" && map.has(out[k])) {
      out[k] = map.get(out[k]);
    }
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const { op, table, row, old_row } = body || {};

    if (!op || !table) {
      return new Response(JSON.stringify({ success: false, error: "op and table required" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!ALLOWED_TABLES.has(table)) {
      return new Response(JSON.stringify({ success: false, error: `table not allowed: ${table}` }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const map = await loadUuidMap();

    if (op === "DELETE") {
      const id = old_row?.id || row?.id;
      if (!id) {
        return new Response(JSON.stringify({ success: false, error: "id required for DELETE" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // Soft-delete via flag (não hard delete)
      const { error } = await ext.from(table).update({ deleted_at: new Date().toISOString() }).eq("id", id);
      if (error) {
        return new Response(JSON.stringify({ success: false, error: error.message, op, table, id }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ success: true, op, table, id }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // INSERT / UPDATE -> upsert idempotente
    if (!row?.id) {
      return new Response(JSON.stringify({ success: false, error: "row.id required" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const remapped = remapRow(row, map);
    const { error } = await ext.from(table).upsert(remapped, { onConflict: "id", ignoreDuplicates: false });

    if (error) {
      return new Response(JSON.stringify({ success: false, error: error.message, op, table, id: row.id }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true, op, table, id: row.id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ success: false, error: String(e?.message || e) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
