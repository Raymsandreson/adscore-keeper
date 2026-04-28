// Migração Cloud -> External: upsert por id, batch, idempotente, com introspection.
// POST { table: string, batch_size?: number, max_batches?: number, dry_run?: boolean }
// Ou POST { list_tables: true }  -> retorna tabelas comuns entre Cloud e External
// Ou POST { all: true, exclude?: string[] } -> migra todas comuns em sequência (síncrono, retorna sumário)

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

// Tabelas que NÃO devem ser migradas (Auth/metadata Cloud-only ou ruído)
const NEVER_MIGRATE = new Set<string>([
  "user_activity_log",
  "user_sessions",
  "webhook_logs",
  "audit_logs",
  "changelog_acknowledgments",
  "cbo_professions",
  "auth_uuid_mapping", // tabela auxiliar Cloud-only para reescrita de FKs
]);

// Colunas que referenciam auth.users e exigem remapeamento (cloud_uuid -> ext_uuid)
const FK_AUTH_COLUMNS = new Set<string>([
  "created_by", "user_id", "assigned_to", "updated_by", "owner_id",
  "deleted_by", "uploaded_by", "sent_by", "completed_by", "approved_by", "reviewed_by",
]);

// Cache do mapping cloud->ext
let UUID_MAP: Map<string, string> | null = null;
async function loadUuidMap(): Promise<Map<string, string>> {
  if (UUID_MAP) return UUID_MAP;
  const { data, error } = await cloud.from("auth_uuid_mapping").select("cloud_uuid, ext_uuid");
  if (error) throw new Error(`load uuid_map: ${error.message}`);
  UUID_MAP = new Map((data || []).map((r: any) => [r.cloud_uuid, r.ext_uuid]));
  return UUID_MAP;
}

function remapRow(row: any, fkCols: string[], map: Map<string, string>): any {
  if (fkCols.length === 0) return row;
  const out: any = { ...row };
  for (const c of fkCols) {
    if (c in out && typeof out[c] === "string" && map.has(out[c])) {
      out[c] = map.get(out[c]);
    }
  }
  return out;
}

async function listTables(client: ReturnType<typeof createClient>): Promise<string[]> {
  const { data, error } = await client.rpc("pg_tables_public" as any).select("*").maybeSingle();
  // fallback: usar query SQL via PostgREST não funciona; usamos REST direto
  if (error || !data) {
    const url = client === cloud ? CLOUD_URL : EXT_URL;
    const key = client === cloud ? CLOUD_KEY : EXT_KEY;
    const r = await fetch(`${url}/rest/v1/?apikey=${key}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    const json = await r.json();
    return Object.keys(json?.definitions || {});
  }
  return [];
}

async function getColumns(url: string, key: string, table: string): Promise<Set<string>> {
  const r = await fetch(`${url}/rest/v1/${table}?limit=0`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: "count=exact" },
  });
  // Usamos OPTIONS pra obter colunas? Mais fácil: pegar uma linha
  const r2 = await fetch(`${url}/rest/v1/${table}?limit=1`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  const rows = await r2.json();
  if (Array.isArray(rows) && rows.length > 0) {
    return new Set(Object.keys(rows[0]));
  }
  // Tabela vazia: tenta inferir via openapi
  const r3 = await fetch(`${url}/rest/v1/`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/openapi+json" },
  });
  const spec = await r3.json();
  const def = spec?.definitions?.[table];
  if (def?.properties) return new Set(Object.keys(def.properties));
  return new Set();
}

async function migrateTable(table: string, batchSize = 500, maxBatches = 9999, dryRun = false, afterId: string | null = null) {
  const result: any = { table, total_read: 0, total_upserted: 0, batches: 0, errors: [] as string[], last_id: afterId, done: false };

  const cloudCols = await getColumns(CLOUD_URL, CLOUD_KEY, table);
  const extCols = await getColumns(EXT_URL, EXT_KEY, table);
  if (extCols.size === 0) {
    result.errors.push(`Tabela não existe no External`);
    result.done = true;
    return result;
  }
  const commonCols = [...cloudCols].filter((c) => extCols.has(c));
  if (!commonCols.includes("id")) {
    result.errors.push(`Sem coluna 'id' em comum`);
    result.done = true;
    return result;
  }
  result.common_cols = commonCols.length;
  const fkColsInTable = commonCols.filter((c) => FK_AUTH_COLUMNS.has(c));
  result.fk_auth_columns = fkColsInTable;
  const uuidMap = fkColsInTable.length > 0 ? await loadUuidMap() : new Map();

  let cursor = afterId;
  for (let b = 0; b < maxBatches; b++) {
    let q = cloud.from(table).select(commonCols.join(",")).order("id", { ascending: true }).limit(batchSize);
    if (cursor) q = q.gt("id", cursor);
    const { data, error } = await q;

    if (error) {
      result.errors.push(`read batch ${b}: ${error.message}`);
      break;
    }
    if (!data || data.length === 0) {
      result.done = true;
      break;
    }

    result.total_read += data.length;
    result.batches++;
    cursor = (data[data.length - 1] as any).id;
    result.last_id = cursor;

    // Remap FK auth columns ANTES de upsert
    const remapped = fkColsInTable.length > 0
      ? data.map((row: any) => remapRow(row, fkColsInTable, uuidMap))
      : data;

    if (!dryRun) {
      const { error: upErr } = await ext.from(table).upsert(remapped, { onConflict: "id", ignoreDuplicates: false });
      if (upErr) {
        result.errors.push(`upsert batch ${b}: ${upErr.message.slice(0, 150)}`);
        let ok = 0;
        for (const row of remapped) {
          const { error: e2 } = await ext.from(table).upsert(row, { onConflict: "id" });
          if (!e2) ok++;
        }
        result.total_upserted += ok;
      } else {
        result.total_upserted += remapped.length;
      }
    }

    if (data.length < batchSize) {
      result.done = true;
      break;
    }
  }
  return result;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));

    if (body.list_tables) {
      // Lista tabelas comuns via openapi
      const fetchSpec = async (url: string, key: string) => {
        const r = await fetch(`${url}/rest/v1/`, {
          headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/openapi+json" },
        });
        return r.json();
      };
      const [cloudSpec, extSpec] = await Promise.all([fetchSpec(CLOUD_URL, CLOUD_KEY), fetchSpec(EXT_URL, EXT_KEY)]);
      const cloudTables = new Set(Object.keys(cloudSpec?.definitions || {}));
      const extTables = new Set(Object.keys(extSpec?.definitions || {}));
      const common = [...cloudTables].filter((t) => extTables.has(t));
      const onlyCloud = [...cloudTables].filter((t) => !extTables.has(t));
      return new Response(
        JSON.stringify({ success: true, cloud: cloudTables.size, ext: extTables.size, common, onlyCloud }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (body.all) {
      const exclude = new Set<string>([...(body.exclude || []), ...NEVER_MIGRATE]);
      const order: string[] = body.order || [];
      const results: any[] = [];
      for (const t of order) {
        if (exclude.has(t)) {
          results.push({ table: t, skipped: true });
          continue;
        }
        const res = await migrateTable(t, body.batch_size || 500, body.max_batches || 9999, !!body.dry_run);
        results.push(res);
      }
      return new Response(JSON.stringify({ success: true, results }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!body.table) {
      return new Response(JSON.stringify({ success: false, error: "table required" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (NEVER_MIGRATE.has(body.table) && !body.force) {
      return new Response(JSON.stringify({ success: false, error: `table in NEVER_MIGRATE; use force:true` }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const res = await migrateTable(body.table, body.batch_size || 500, body.max_batches || 9999, !!body.dry_run, body.after_id || null);
    return new Response(JSON.stringify({ success: true, ...res }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: String(e) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
