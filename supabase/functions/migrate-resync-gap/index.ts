// Re-sincroniza gaps Cloud -> External com upsert REAL (ignoreDuplicates: false).
// Sobrescreve registros existentes no External para garantir paridade total.
// POST { table: "whatsapp_messages" | "legal_cases", batch_size?: 500, max_batches?: 30, after_id?: string }
// Retorna progresso e re-dispara fire-and-forget se ainda não terminou.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CLOUD_URL = Deno.env.get("SUPABASE_URL")!;
const CLOUD_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const EXT_URL = Deno.env.get("EXTERNAL_SUPABASE_URL")!;
const EXT_KEY = Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

const cloud = createClient(CLOUD_URL, CLOUD_KEY, { auth: { persistSession: false } });
const ext = createClient(EXT_URL, EXT_KEY, { auth: { persistSession: false } });

const ALLOWED = new Set(["whatsapp_messages", "legal_cases"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const body = await req.json().catch(() => ({}));
    const table: string = body.table;
    const batchSize: number = body.batch_size || 500;
    const maxBatches: number = body.max_batches || 30;
    const softTimeoutMs: number = 110_000;
    let afterId: string | null = body.after_id || null;

    if (!ALLOWED.has(table)) {
      return new Response(JSON.stringify({ success: false, error: `tabela não permitida: ${table}` }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const startedAt = Date.now();
    let totalRead = 0;
    let totalUpserted = 0;
    let batches = 0;
    let done = false;
    let lastError: string | null = null;

    for (let i = 0; i < maxBatches; i++) {
      if (Date.now() - startedAt > softTimeoutMs) break;

      // Ordena por created_at (indexado) + id como tiebreaker
      let q = cloud.from(table).select("*").order("created_at", { ascending: true }).order("id", { ascending: true }).limit(batchSize);
      if (afterId) {
        // afterId aqui vira "created_at|id" pra cursor composto
        const [ts, idPart] = afterId.split("|");
        q = q.or(`created_at.gt.${ts},and(created_at.eq.${ts},id.gt.${idPart})`);
      }
      const { data, error } = await q;
      if (error) {
        lastError = `read: ${error.message}`;
        break;
      }
      if (!data || data.length === 0) {
        done = true;
        break;
      }

      totalRead += data.length;
      const last = data[data.length - 1] as any;
      afterId = `${last.created_at}|${last.id}`;

      // Upsert REAL: sobrescreve se existir
      const { error: upErr } = await ext.from(table).upsert(data, {
        onConflict: "id",
        ignoreDuplicates: false,
      });

      if (upErr) {
        // fallback row-by-row
        let ok = 0;
        for (const r of data) {
          const { error: e2 } = await ext.from(table).upsert(r, { onConflict: "id", ignoreDuplicates: false });
          if (!e2) ok++;
        }
        totalUpserted += ok;
        lastError = `bulk: ${upErr.message.slice(0, 200)}`;
      } else {
        totalUpserted += data.length;
      }

      batches++;
      if (data.length < batchSize) {
        done = true;
        break;
      }
    }

    // re-dispara se não terminou
    if (!done && afterId && !body.no_chain) {
      fetch(`${CLOUD_URL}/functions/v1/migrate-resync-gap`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${ANON}` },
        body: JSON.stringify({ table, batch_size: batchSize, max_batches: maxBatches, after_id: afterId }),
      }).catch(() => {});
    }

    return new Response(JSON.stringify({
      success: true,
      table,
      batches,
      total_read: totalRead,
      total_upserted: totalUpserted,
      done,
      next_after_id: done ? null : afterId,
      elapsed_ms: Date.now() - startedAt,
      last_error: lastError,
    }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: String(e) }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
