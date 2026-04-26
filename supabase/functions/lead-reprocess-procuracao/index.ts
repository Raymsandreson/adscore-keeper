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
    const { lead_id: lead_id_in, lead_name, force_instance_name } = body as { lead_id?: string; lead_name?: string; force_instance_name?: string };
    if (!lead_id_in && !lead_name) {
      return new Response(JSON.stringify({ ok: false, error: "lead_id or lead_name required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const extUrl = Deno.env.get("EXTERNAL_SUPABASE_URL");
    const extKey = Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY");
    if (!extUrl || !extKey) throw new Error("EXTERNAL_SUPABASE_* not configured");

    const ext = createClient(extUrl, extKey);

    // Resolve lead_id by name if needed
    let lead_id = lead_id_in || null;
    if (!lead_id && lead_name) {
      const { data: found } = await ext
        .from("leads")
        .select("id, lead_name")
        .ilike("lead_name", `%${lead_name}%`)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      lead_id = found?.id || null;
      if (!lead_id) {
        return new Response(JSON.stringify({ ok: false, error: `lead not found by name: ${lead_name}` }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // 1) Find latest signed procuração for this lead
    const { data: docs, error: docErr } = await ext
      .from("zapsign_documents")
      .select("id, doc_token, document_name, signed_file_url, instance_name, whatsapp_phone, signed_at, created_by")
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

    // 2) Resolve instance_name fallback chain:
    //    a) doc.instance_name
    //    b) latest whatsapp_messages by lead phone
    //    c) created_by -> profiles.default_instance_id -> whatsapp_instances.instance_name (Cloud)
    let instanceName = force_instance_name || doc.instance_name || null;
    let resolvedVia = force_instance_name ? "force" : (doc.instance_name ? "doc" : null);

    // Fetch lead once (need lead_phone + created_by for fallbacks)
    const { data: leadRow } = await ext
      .from("leads")
      .select("lead_phone, created_by, assigned_to, acolhedor")
      .eq("id", lead_id)
      .maybeSingle();

    if (!instanceName) {
      const phone = (leadRow?.lead_phone || doc.whatsapp_phone || "").replace(/\D/g, "");
      if (phone) {
        // Brazilian mobile numbers: try both with and without the 9th digit
        // e.g. 5575988157201 (with 9) <-> 557588157201 (without 9)
        const variants = new Set<string>([phone]);
        // Strip leading 55 if present, then DDD = 2 digits, then number
        const m = phone.match(/^(55)?(\d{2})(\d+)$/);
        if (m) {
          const [, cc, ddd, rest] = m;
          const ccPart = cc || "55";
          if (rest.length === 9 && rest.startsWith("9")) {
            // with 9 -> generate without 9
            variants.add(`${ccPart}${ddd}${rest.slice(1)}`);
            variants.add(`${ddd}${rest.slice(1)}`);
          } else if (rest.length === 8) {
            // without 9 -> generate with 9
            variants.add(`${ccPart}${ddd}9${rest}`);
            variants.add(`${ddd}9${rest}`);
          }
          // Also include DDD+rest without country code
          variants.add(`${ddd}${rest}`);
        }
        // Also a "last 8 digits" suffix match as final safety net
        const last8 = phone.slice(-8);

        const phoneList = Array.from(variants);
        // Try exact-match across variants first (priority: any instance with messages)
        const { data: msgs } = await ext
          .from("whatsapp_messages")
          .select("instance_name, phone, created_at")
          .in("phone", phoneList)
          .order("created_at", { ascending: false })
          .limit(50);

        let pickedInstance: string | null = null;
        if (msgs && msgs.length > 0) {
          // Prefer the instance with the most messages for this lead (most active conversation)
          const counts = new Map<string, number>();
          for (const r of msgs) {
            counts.set(r.instance_name, (counts.get(r.instance_name) || 0) + 1);
          }
          pickedInstance = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
        }

        // Fallback: suffix match on last 8 digits (handles other normalization quirks)
        if (!pickedInstance && last8.length === 8) {
          const { data: msgs2 } = await ext
            .from("whatsapp_messages")
            .select("instance_name, phone")
            .like("phone", `%${last8}`)
            .order("created_at", { ascending: false })
            .limit(50);
          if (msgs2 && msgs2.length > 0) {
            const counts = new Map<string, number>();
            for (const r of msgs2) {
              counts.set(r.instance_name, (counts.get(r.instance_name) || 0) + 1);
            }
            pickedInstance = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
          }
        }

        if (pickedInstance) {
          instanceName = pickedInstance;
          resolvedVia = "whatsapp_messages.phone_variants";
          console.log("[lead-reprocess-procuracao] resolved via phone variants:", { phone, variants: phoneList, picked: pickedInstance });
        }
      }
    }

    // Fallback c) created_by/assigned_to/acolhedor -> default_instance_id (Cloud DB)
    if (!instanceName) {
      const cloudUrlEarly = Deno.env.get("SUPABASE_URL")!;
      const cloudSrkEarly = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const cloud = createClient(cloudUrlEarly, cloudSrkEarly);

      // Try in order: doc.created_by, lead.created_by, lead.assigned_to
      const candidateUserIds = [
        (doc as any).created_by,
        leadRow?.created_by,
        leadRow?.assigned_to,
      ].filter(Boolean) as string[];

      let resolvedUserId: string | null = null;
      let resolvedSource: string | null = null;

      for (const uid of candidateUserIds) {
        const { data: prof } = await cloud
          .from("profiles")
          .select("default_instance_id")
          .eq("user_id", uid)
          .maybeSingle();
        if (prof?.default_instance_id) {
          const { data: inst } = await cloud
            .from("whatsapp_instances")
            .select("instance_name")
            .eq("id", prof.default_instance_id)
            .maybeSingle();
          if (inst?.instance_name) {
            instanceName = inst.instance_name;
            resolvedUserId = uid;
            resolvedSource = uid === (doc as any).created_by ? "doc.created_by"
              : uid === leadRow?.created_by ? "lead.created_by"
              : "lead.assigned_to";
            break;
          }
        }
      }

      // Last resort: match acolhedor name -> profile.full_name -> default_instance_id
      if (!instanceName && leadRow?.acolhedor) {
        const { data: prof } = await cloud
          .from("profiles")
          .select("default_instance_id, user_id")
          .ilike("full_name", `%${leadRow.acolhedor.trim()}%`)
          .not("default_instance_id", "is", null)
          .limit(1)
          .maybeSingle();
        if (prof?.default_instance_id) {
          const { data: inst } = await cloud
            .from("whatsapp_instances")
            .select("instance_name")
            .eq("id", prof.default_instance_id)
            .maybeSingle();
          if (inst?.instance_name) {
            instanceName = inst.instance_name;
            resolvedUserId = prof.user_id;
            resolvedSource = "lead.acolhedor.name_match";
          }
        }
      }

      console.log("[lead-reprocess-procuracao] fallback profile lookup:", {
        candidateUserIds, acolhedor: leadRow?.acolhedor, resolvedUserId, resolvedSource, instanceName,
      });
      if (resolvedSource) resolvedVia = resolvedSource;
    }

    console.log("[lead-reprocess-procuracao] instance resolved:", instanceName, "via", resolvedVia);

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
