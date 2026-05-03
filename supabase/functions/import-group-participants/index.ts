// import-group-participants
// ============================================================
// Recebe lista de telefones (escolhidos pelo usuário num modal) e
// faz upsert em `contacts` no DB Externo, vinculando ao lead via
// `contact_leads`. Preenche state/city pelo DDD.
//
// Body: {
//   lead_id: string,
//   group_jid: string,
//   group_name?: string,
//   phones: string[]   // dígitos, com ou sem 55
// }
// Resposta: { success, created, linked, skipped, errors }
// ============================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getLocationFromDDD } from "../_shared/ddd-mapping.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function normalizePhone(raw: string): string {
  const d = String(raw || "").replace(/\D/g, "");
  if (!d) return "";
  // Garante formato com 55 quando aparenta ser BR (10/11 dígitos)
  if (d.length === 10 || d.length === 11) return `55${d}`;
  return d;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const lead_id: string = body?.lead_id;
    const group_jid: string = body?.group_jid;
    const group_name: string | undefined = body?.group_name;
    const phones: string[] = Array.isArray(body?.phones) ? body.phones : [];
    if (!lead_id || !group_jid || phones.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: "lead_id, group_jid and non-empty phones[] are required" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const ext = createClient(
      Deno.env.get("EXTERNAL_SUPABASE_URL")!,
      Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    let created = 0;
    let linked = 0;
    let skipped = 0;
    const errors: Array<{ phone: string; error: string }> = [];

    for (const raw of phones) {
      const phone = normalizePhone(raw);
      if (!phone || phone.length < 12) { skipped++; continue; }
      try {
        // 1) procurar contato existente pelo telefone (match por dígitos)
        const last10 = phone.slice(-10);
        const { data: existing } = await ext
          .from("contacts")
          .select("id, full_name, state, city")
          .ilike("phone", `%${last10}`)
          .is("deleted_at", null)
          .limit(1);

        let contactId: string | null = existing?.[0]?.id || null;

        if (!contactId) {
          const loc = getLocationFromDDD(phone);
          const { data: ins, error: insErr } = await ext
            .from("contacts")
            .insert({
              full_name: `Participante ${phone.slice(-4)}`,
              phone,
              state: loc?.state || null,
              city: loc?.city || null,
              classification: "prospect",
              whatsapp_group_id: group_jid,
              action_source: "group_import",
              action_source_detail: group_name || group_jid,
              tags: ["importado-grupo"],
            })
            .select("id")
            .single();
          if (insErr) throw insErr;
          contactId = ins.id;
          created++;
        }

        // 2) vincular ao lead se ainda não estiver
        const { data: link } = await ext
          .from("contact_leads")
          .select("id")
          .eq("contact_id", contactId!)
          .eq("lead_id", lead_id)
          .maybeSingle();
        if (!link) {
          const { error: linkErr } = await ext
            .from("contact_leads")
            .insert({ contact_id: contactId, lead_id });
          if (linkErr) throw linkErr;
          linked++;
        }
      } catch (e: any) {
        errors.push({ phone, error: e?.message || String(e) });
      }
    }

    return new Response(
      JSON.stringify({ success: true, created, linked, skipped, errors }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[import-group-participants] error:", e);
    return new Response(
      JSON.stringify({ success: false, error: String((e as any)?.message || e) }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
