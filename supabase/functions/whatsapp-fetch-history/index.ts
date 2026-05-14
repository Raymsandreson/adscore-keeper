// Solicita à UazAPI um sync sob demanda de mensagens antigas para um chat específico.
// As mensagens chegam depois via webhook (eventos history) e são gravadas normalmente
// em whatsapp_messages. Útil quando o webhook caiu/perdeu mensagens ou para puxar
// histórico mais antigo do que o que existe localmente.
//
// Body: { phone: string, instance_name: string, count?: number, messageid?: string, mode?: 'history'|'exact' }

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
  // Se tiver mais de 15 dígitos é provavelmente um grupo (jid sem @g.us)
  return digits.length > 15 ? `${digits}@g.us` : `${digits}@s.whatsapp.net`;
}

function toProviderMessageId(messageId?: string): string | undefined {
  const raw = String(messageId || "").trim();
  if (!raw) return undefined;
  // Internamente algumas mensagens são salvas como "telefone:id" para evitar
  // colisão entre instâncias. A UazAPI espera só o id real da mensagem.
  return raw.includes(":") ? raw.split(":").pop() || raw : raw;
}

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
    const phone: string = body.phone;
    const instanceName: string = body.instance_name;
    const mode: "history" | "exact" = body.mode === "exact" ? "exact" : "history";
    const requestedCount = Number(body.count ?? 50);
    const count = Math.max(1, Math.min(100, isNaN(requestedCount) ? 50 : requestedCount));
    let messageid: string | undefined = body.messageid;

    if (!phone || !instanceName) {
      return jsonResponse(200, {
        success: false,
        error: "phone e instance_name são obrigatórios",
      });
    }

    // Busca instância (case-insensitive no nome)
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

    // Em mode=history sem messageid: usa a mensagem mais ANTIGA local como âncora
    // (a UazAPI busca mensagens anteriores a essa).
    if (mode === "history" && !messageid) {
      const { data: oldest } = await supabase
        .from("whatsapp_messages")
        .select("external_message_id, created_at")
        .eq("phone", String(phone).replace(/\D/g, ""))
        .ilike("instance_name", instanceName)
        .not("external_message_id", "is", null)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (oldest?.external_message_id) {
        messageid = oldest.external_message_id;
      }
    }

    if (mode === "exact" && !messageid) {
      return jsonResponse(200, {
        success: false,
        error: "messageid é obrigatório em mode=exact",
      });
    }

    const number = buildJid(phone);
    const providerMessageId = toProviderMessageId(messageid);
    const payload: Record<string, unknown> = { number, mode };
    if (mode === "history") payload.count = count;
    if (providerMessageId) payload.messageid = providerMessageId;

    console.log("[whatsapp-fetch-history] →", JSON.stringify({
      instance: inst.instance_name,
      number,
      mode,
      count: mode === "history" ? count : undefined,
      messageid: providerMessageId || null,
      had_local_anchor: !!messageid,
    }));

    const resp = await fetch(`${baseUrl}/message/history-sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        token: inst.instance_token,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20000),
    });

    const text = await resp.text();
    let data: unknown = null;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    console.log("[whatsapp-fetch-history] ← upstream", resp.status, text.slice(0, 300));

    if (!resp.ok) {
      return jsonResponse(200, {
        success: false,
        error: `UazAPI ${resp.status}`,
        upstream: data,
      });
    }

    return jsonResponse(200, {
      success: true,
      mode,
      count: mode === "history" ? count : undefined,
      anchor_message_id: providerMessageId || null,
      message:
        "Sync solicitado. As mensagens antigas chegarão via webhook nos próximos segundos. Pode ser necessário abrir o WhatsApp no celular.",
      upstream: data,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[whatsapp-fetch-history] error:", msg);
    return jsonResponse(200, { success: false, error: msg });
  }
});
