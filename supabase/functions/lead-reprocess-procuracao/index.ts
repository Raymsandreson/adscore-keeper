// Reprocessa a procuração assinada mais recente de um lead:
// - Busca a última zapsign_documents (status='signed', signed_file_url not null) no DB externo
// - Dispara zapsign-enrich-lead, que extrai dados via Vision, atualiza lead e
//   sobe o PDF na pasta Drive.
//
// Use-case: leads cuja procuração foi assinada antes do enrich existir, ou
// quando o usuário quer regenerar o upload/preencher acolhedor.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const { lead_id } = body as { lead_id?: string };
    if (!lead_id) {
      return new Response(JSON.stringify({ ok: false, error: "lead_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const extUrl = Deno.env.get("EXTERNAL_SUPABASE_URL");
    const extKey = Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY");
    if (!extUrl || !extKey) throw new Error("EXTERNAL_SUPABASE_* not configured");

    const ext = createClient(extUrl, extKey);

    // 1) Find latest signed procuração for this lead
    const { data: docs, error: docErr } = await ext
      .from("zapsign_documents")
      .select("id, doc_token, document_name, signed_file_url, instance_name, whatsapp_phone, signed_at")
      .eq("lead_id", lead_id)
      .eq("status", "signed")
      .not("signed_file_url", "is", null)
      .order("signed_at", { ascending: false })
      .limit(1);

    if (docErr) throw new Error(`zapsign_documents query failed: ${docErr.message}`);
    const doc = docs?.[0];
    if (!doc) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "Nenhuma procuração assinada encontrada para este lead.",
        }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 2) Resolve instance_name fallback (lead.lead_phone -> latest message instance)
    let instanceName = doc.instance_name || null;
    if (!instanceName) {
      const { data: lead } = await ext
        .from("leads")
        .select("lead_phone")
        .eq("id", lead_id)
        .maybeSingle();
      const phone = (lead?.lead_phone || doc.whatsapp_phone || "").replace(/\D/g, "");
      if (phone) {
        const { data: msg } = await ext
          .from("whatsapp_messages")
          .select("instance_name")
          .eq("phone", phone)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        instanceName = msg?.instance_name || null;
      }
    }

    // 3) Invoke zapsign-enrich-lead (Cloud function)
    const cloudUrl = Deno.env.get("SUPABASE_URL")!;
    const cloudKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const enrichRes = await fetch(`${cloudUrl}/functions/v1/zapsign-enrich-lead`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cloudKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        lead_id,
        signed_file_url: doc.signed_file_url,
        instance_name: instanceName,
        doc_token: doc.doc_token,
        document_name: doc.document_name,
      }),
    });
    const enrichJson = await enrichRes.json().catch(() => ({}));

    return new Response(
      JSON.stringify({
        ok: enrichRes.ok,
        document: { id: doc.id, name: doc.document_name, signed_at: doc.signed_at },
        instance_resolved: instanceName,
        enrich_status: enrichRes.status,
        enrich: enrichJson,
      }),
      {
        status: enrichRes.ok ? 200 : 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (e) {
    console.error("[lead-reprocess-procuracao] error:", e);
    return new Response(
      JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
