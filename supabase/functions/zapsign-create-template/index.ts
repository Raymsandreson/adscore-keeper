// Cria/atualiza MODELOS (templates) na ZapSign a partir de um .docx.
//
// Por que existe: o zapsign-api só CONSOME modelos (list/get/create_doc). Criar
// modelo é operação administrativa e rara, então fica isolada aqui em vez de
// inchar o zapsign-api — que é o caminho crítico de geração de documento e não
// pode quebrar.
//
// Self-contained de propósito: o deploy é feito pela Management API, que não
// resolve os imports de ../_shared/.
//
// Segurança: operação administrativa (cria contrato-modelo do escritório).
// O gateway (verify_jwt: true) já validou a ASSINATURA do JWT contra o segredo
// do projeto antes de encaminhar. Aqui só lemos o claim `role` e exigimos
// service_role — a anon key é pública (vai no front, role: anon) e é barrada.
// Não depende de nenhum secret casar por string.

const ZAPSIGN_API_URL = "https://api.zapsign.com.br/api/v1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Lê o claim `role` do JWT já validado pelo gateway. Só decodifica o payload
 * (não re-verifica assinatura — isso o verify_jwt do gateway já fez). Retorna
 * true apenas para service_role; anon/usuário comum não passa.
 */
function isServiceRole(token: string): boolean {
  try {
    const payload = token.split(".")[1];
    if (!payload) return false;
    const b64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const claims = JSON.parse(
      new TextDecoder().decode(Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))),
    );
    return claims?.role === "service_role";
  } catch {
    return false;
  }
}

async function zapsign(path: string, token: string, payload: unknown) {
  const res = await fetch(`${ZAPSIGN_API_URL}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let parsed: unknown = text;
  try { parsed = JSON.parse(text); } catch { /* ZapSign devolveu texto puro */ }
  return { ok: res.ok, status: res.status, body: parsed };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const presented = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!isServiceRole(presented)) {
      return json({ success: false, error: "forbidden: service role required" }, 403);
    }

    const zapsignToken = Deno.env.get("ZAPSIGN_API_TOKEN");
    if (!zapsignToken) {
      return json({ success: false, error: "ZAPSIGN_API_TOKEN not configured" }, 500);
    }

    const body = await req.json();
    const { action } = body;

    // ------------------------------------------------------------------
    // CREATE TEMPLATE (docx) — POST /templates/create/
    // ------------------------------------------------------------------
    if (action === "create_template") {
      const { name, base64_docx, lang, first_signer, folder_path } = body;
      if (!name || !base64_docx) {
        return json({ success: false, error: "name and base64_docx are required" }, 400);
      }

      const created = await zapsign("/templates/create/", zapsignToken, {
        name,
        base64_docx,
        lang: lang || "pt-br",
        ...(folder_path ? { folder_path } : {}),
        ...(first_signer ? { first_signer } : {}),
      });

      if (!created.ok) {
        // Nunca logar o base64 (é o contrato inteiro) nem o token.
        console.error("[zapsign-create-template] create falhou", created.status, created.body);
        return json({ success: false, step: "create", status: created.status, error: created.body }, 502);
      }

      const token = (created.body as any)?.token;
      console.log("[zapsign-create-template] modelo criado", { name, token });
      return json({ success: true, template: created.body });
    }

    // ------------------------------------------------------------------
    // UPDATE FORM — POST /templates/update-form/
    // Define o input_type de cada variável (signer_fullname, email, etc).
    // ------------------------------------------------------------------
    if (action === "update_form") {
      const { template_id, inputs, custom_intro } = body;
      if (!template_id || !Array.isArray(inputs)) {
        return json({ success: false, error: "template_id and inputs[] are required" }, 400);
      }

      const updated = await zapsign("/templates/update-form/", zapsignToken, {
        template_id,
        inputs,
        ...(custom_intro !== undefined ? { custom_intro } : {}),
      });

      if (!updated.ok) {
        console.error("[zapsign-create-template] update-form falhou", updated.status, updated.body);
        return json({ success: false, step: "update_form", status: updated.status, error: updated.body }, 502);
      }

      console.log("[zapsign-create-template] form atualizado", { template_id, inputs: inputs.length });
      return json({ success: true, template: updated.body });
    }

    return json({ success: false, error: `unknown action: ${action}` }, 400);
  } catch (err) {
    console.error("[zapsign-create-template] erro inesperado", err);
    return json({ success: false, error: (err as Error).message }, 500);
  }
});
