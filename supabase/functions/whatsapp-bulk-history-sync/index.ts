// Para cada conversa ATIVA de uma instância recém-reconectada, pede à UazAPI
// um sync de histórico das últimas N mensagens. Mensagens chegam depois via
// webhook (eventos history) e são gravadas em whatsapp_messages.
//
// Body: { instance_name: string, count?: number, max_chats?: number, lookback_days?: number }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id",
};

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function buildJid(phone: string): string {
  const p = String(phone || "").trim();
  if (!p) return p;
  if (p.includes("@")) return p;
  const digits = p.replace(/\D/g, "");
  return digits.length > 15 ? `${digits}@g.us` : `${digits}@s.whatsapp.net`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Cache em memória da última execução por instância (evita disparos repetidos
// quando o detector de reconexão dispara várias vezes seguidas).
const lastRunByInstance = new Map<string, number>();
const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutos

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url =
      Deno.env.get("EXTERNAL_SUPABASE_URL") || Deno.env.get("SUPABASE_URL")!;
    const key =
      Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY") ||
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(url, key);

    const body = await req.json().catch(() => ({}));
    const instanceName: string = body.instance_name;
    const count = Math.max(1, Math.min(100, Number(body.count ?? 50)));
    const maxChats = Math.max(1, Math.min(500, Number(body.max_chats ?? 200)));
    const lookbackDays = Math.max(
      1,
      Math.min(180, Number(body.lookback_days ?? 30)),
    );
    const force = body.force === true;

    if (!instanceName) {
      return jsonResponse(200, {
        success: false,
        error: "instance_name é obrigatório",
      });
    }

    const cacheKey = instanceName.toLowerCase();
    const lastRun = lastRunByInstance.get(cacheKey) ?? 0;
    if (!force && Date.now() - lastRun < COOLDOWN_MS) {
      return jsonResponse(200, {
        success: true,
        skipped: true,
        reason: "cooldown",
        cooldown_remaining_ms: COOLDOWN_MS - (Date.now() - lastRun),
      });
    }

    // Busca instância (case-insensitive)
    const { data: inst, error: instErr } = await supabase
      .from("whatsapp_instances")
      .select("id, instance_name, instance_token, base_url")
      .ilike("instance_name", instanceName)
      .limit(1)
      .maybeSingle();

    if (instErr || !inst) {
      return jsonResponse(200, {
        success: false,
        error: `Instância "${instanceName}" não encontrada`,
      });
    }
    if (!inst.instance_token) {
      return jsonResponse(200, {
        success: false,
        error: `Instância "${inst.instance_name}" sem token configurado`,
      });
    }

    const baseUrl = inst.base_url || "https://abraci.uazapi.com";
    const since = new Date(
      Date.now() - lookbackDays * 24 * 60 * 60 * 1000,
    ).toISOString();

    // Lista conversas ativas dessa instância nos últimos N dias.
    // Pula grupos (terminam com @g.us / phone com mais de 15 dígitos).
    const { data: rows, error: rowsErr } = await supabase
      .from("whatsapp_messages")
      .select("phone, external_message_id, created_at")
      .ilike("instance_name", instanceName)
      .gte("created_at", since)
      .not("external_message_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(20000);

    if (rowsErr) {
      return jsonResponse(200, { success: false, error: rowsErr.message });
    }

    // Agrupa por phone — pega o external_message_id MAIS ANTIGO de cada
    // conversa para servir de âncora (a UazAPI traz mensagens anteriores
    // a essa âncora).
    const byPhone = new Map<string, { anchor: string; oldest: string }>();
    for (const r of rows ?? []) {
      const phone = String(r.phone || "").replace(/\D/g, "");
      if (!phone || phone.length > 15) continue; // ignora grupos
      const cur = byPhone.get(phone);
      if (!cur || (r.created_at && r.created_at < cur.oldest)) {
        byPhone.set(phone, {
          anchor: r.external_message_id as string,
          oldest: r.created_at as string,
        });
      }
    }

    const phones = Array.from(byPhone.entries()).slice(0, maxChats);

    console.log(
      `[whatsapp-bulk-history-sync] instance=${inst.instance_name} chats=${phones.length} count=${count}`,
    );

    lastRunByInstance.set(cacheKey, Date.now());

    // Roda o bulk em background (fire-and-forget). Responde imediatamente.
    const task = (async () => {
      let ok = 0;
      let fail = 0;
      for (const [phone, info] of phones) {
        try {
          const resp = await fetch(`${baseUrl}/message/history-sync`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              token: inst.instance_token!,
            },
            body: JSON.stringify({
              number: buildJid(phone),
              mode: "history",
              count,
              messageid: info.anchor,
            }),
            signal: AbortSignal.timeout(15000),
          });
          if (resp.ok) ok++;
          else {
            fail++;
            const t = await resp.text().catch(() => "");
            console.warn(
              `[bulk-history-sync] phone=${phone} status=${resp.status} body=${t.slice(0, 200)}`,
            );
          }
        } catch (e) {
          fail++;
          console.warn(
            `[bulk-history-sync] phone=${phone} error=${e instanceof Error ? e.message : String(e)}`,
          );
        }
        // throttle leve para não sobrecarregar a UazAPI
        await sleep(250);
      }
      console.log(
        `[whatsapp-bulk-history-sync] done instance=${inst.instance_name} ok=${ok} fail=${fail}`,
      );
    })();

    // @ts-ignore - EdgeRuntime existe no runtime Supabase Edge Functions
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(task);
    } else {
      // fallback: deixa rodar mas não espera
      task.catch(() => {});
    }

    return jsonResponse(200, {
      success: true,
      instance: inst.instance_name,
      queued_chats: phones.length,
      count_per_chat: count,
      message:
        "Sync solicitado em background. Mensagens antigas chegam via webhook nos próximos minutos.",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[whatsapp-bulk-history-sync] error:", msg);
    return jsonResponse(200, { success: false, error: msg });
  }
});
