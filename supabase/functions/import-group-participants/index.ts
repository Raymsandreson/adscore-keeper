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
    // Suporta dois formatos: phones[] (legado) OU participants[] (enriquecido)
    const participantsIn: Array<any> = Array.isArray(body?.participants) ? body.participants : [];
    const phones: string[] = participantsIn.length > 0
      ? participantsIn.map((p: any) => String(p?.phone || ""))
      : (Array.isArray(body?.phones) ? body.phones : []);
    const detailsByPhone = new Map<string, any>();
    participantsIn.forEach((p: any) => {
      const ph = normalizePhone(String(p?.phone || ""));
      if (ph) detailsByPhone.set(ph, p);
    });
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
        const det = detailsByPhone.get(phone) || {};
        const enrichName: string | null = det?.name || null;
        const enrichEmail: string | null = det?.lead_email || null;
        const enrichCpfRaw: string | null = det?.lead_personalid || null;
        const enrichCpf = enrichCpfRaw ? String(enrichCpfRaw).replace(/\D/g, "").slice(0, 11) : null;
        const enrichAvatar: string | null = det?.image || null;
        const enrichNotes: string | null = det?.lead_notes || null;

        // 1) procurar contato existente pelo telefone (match por dígitos)
        const last10 = phone.slice(-10);
        const { data: existing } = await ext
          .from("contacts")
          .select("id, full_name, state, city, email, cpf, avatar_url")
          .ilike("phone", `%${last10}`)
          .is("deleted_at", null)
          .limit(1);

        let contactId: string | null = existing?.[0]?.id || null;
        const loc = getLocationFromDDD(phone);

        if (!contactId) {
          const { data: ins, error: insErr } = await ext
            .from("contacts")
            .insert({
              full_name: enrichName || `Participante ${phone.slice(-4)}`,
              phone,
              email: enrichEmail,
              cpf: enrichCpf && enrichCpf.length === 11 ? enrichCpf : null,
              avatar_url: enrichAvatar,
              notes: enrichNotes,
              state: loc?.state || null,
              city: loc?.city || null,
              classification: "prospect",
              whatsapp_group_id: group_jid,
              action_source: "group_import",
              action_source_detail: group_name || group_jid,
              tags: ["importado-grupo"],
              wa_synced_at: new Date().toISOString(),
            })
            .select("id")
            .single();
          if (insErr) throw insErr;
          contactId = ins.id;
          created++;
        } else {
          // Enriquece campos vazios sem sobrescrever dados existentes
          const exRow: any = existing![0];
          const patch: Record<string, any> = {};
          if (enrichName && (!exRow.full_name || exRow.full_name.startsWith("Participante "))) patch.full_name = enrichName;
          if (enrichEmail && !exRow.email) patch.email = enrichEmail;
          if (enrichCpf && enrichCpf.length === 11 && !exRow.cpf) patch.cpf = enrichCpf;
          if (enrichAvatar && !exRow.avatar_url) patch.avatar_url = enrichAvatar;
          if (Object.keys(patch).length > 0) {
            patch.wa_synced_at = new Date().toISOString();
            await ext.from("contacts").update(patch).eq("id", contactId);
          }
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
