// Enriquece um lead a partir do PDF assinado da ZapSign
// - Baixa o PDF assinado
// - Roda Gemini Vision para extrair dados do titular (CPF, RG, endereço completo, data)
// - Atualiza o lead com cidade/estado/bairro/CEP/rua/CPF/RG/data nascimento
// - Define acolhedor = dono da instância (default_instance_id reverso, fallback owner_name)
// - Faz upload do PDF assinado na pasta Drive do lead com nome descritivo
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const AI_GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-2.5-flash"; // suporta PDF/imagem inline

interface Extracted {
  titular_name?: string | null;
  cpf?: string | null;
  rg?: string | null;
  birth_date?: string | null; // YYYY-MM-DD
  cep?: string | null;
  street?: string | null;
  street_number?: string | null;
  complement?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null; // UF 2 letras
  signature_date?: string | null; // YYYY-MM-DD
}

async function downloadAsBase64(url: string): Promise<{ base64: string; mime: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed [${res.status}]: ${url}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) {
    bin += String.fromCharCode.apply(null, Array.from(buf.subarray(i, i + chunk)));
  }
  return { base64: btoa(bin), mime: res.headers.get("content-type") || "application/pdf" };
}

async function extractFromPdf(pdfUrl: string): Promise<Extracted> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY missing");

  const { base64, mime } = await downloadAsBase64(pdfUrl);
  const dataUrl = `data:${mime};base64,${base64}`;

  const body = {
    model: MODEL,
    messages: [
      {
        role: "system",
        content:
          "Você extrai dados estruturados de procurações jurídicas brasileiras (PDF assinado pela ZapSign). Devolva APENAS via tool call. Use null quando não encontrar.",
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Extraia os dados do OUTORGANTE (cliente que assinou) desta procuração. Inclua endereço completo (logradouro, número, complemento, bairro, cidade, UF, CEP), CPF, RG, data de nascimento e a data de assinatura.",
          },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "save_extracted_data",
          description: "Salva os dados extraídos da procuração",
          parameters: {
            type: "object",
            properties: {
              titular_name: { type: ["string", "null"], description: "Nome completo do outorgante" },
              cpf: { type: ["string", "null"], description: "CPF apenas dígitos" },
              rg: { type: ["string", "null"], description: "RG com órgão emissor se disponível" },
              birth_date: { type: ["string", "null"], description: "Data nascimento YYYY-MM-DD" },
              cep: { type: ["string", "null"], description: "CEP apenas dígitos" },
              street: { type: ["string", "null"], description: "Logradouro (rua/avenida)" },
              street_number: { type: ["string", "null"] },
              complement: { type: ["string", "null"] },
              neighborhood: { type: ["string", "null"] },
              city: { type: ["string", "null"] },
              state: { type: ["string", "null"], description: "UF 2 letras maiúsculas" },
              signature_date: { type: ["string", "null"], description: "Data assinatura YYYY-MM-DD" },
            },
            required: [],
            additionalProperties: false,
          },
        },
      },
    ],
    tool_choice: { type: "function", function: { name: "save_extracted_data" } },
  };

  const res = await fetch(AI_GATEWAY, {
    method: "POST",
    headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`AI gateway [${res.status}]: ${t}`);
  }
  const data = await res.json();
  const args = data?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (!args) return {};
  try {
    return JSON.parse(args) as Extracted;
  } catch {
    return {};
  }
}

function cleanDigits(s?: string | null) {
  return s ? s.replace(/\D/g, "") : null;
}

// Procura no UAZAPI um grupo da instância em que o telefone do lead seja participante.
async function findGroupByParticipantPhone(
  baseUrl: string,
  token: string,
  participantPhone: string,
): Promise<{ jid: string; link: string | null; subject: string | null } | null> {
  if (!baseUrl || !token || !participantPhone) return null;
  const cleaned = participantPhone.replace(/\D/g, "");
  if (!cleaned) return null;
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/group/list`, {
      method: "POST",
      headers: { "Content-Type": "application/json", token },
      body: JSON.stringify({ getParticipants: true }),
    });
    if (!res.ok) { console.warn("[findGroup] list status", res.status); return null; }
    const data = await res.json().catch(() => null);
    const groups: any[] = Array.isArray(data) ? data : data?.groups || [];
    for (const g of groups) {
      const participants: any[] = g.participants || g.Participants || [];
      const match = participants.find((p) => {
        const id = String(p.id || p.jid || p.phone || "").replace(/\D/g, "");
        return id && (id.endsWith(cleaned) || cleaned.endsWith(id));
      });
      if (match) {
        return {
          jid: g.id || g.jid || g.JID || null,
          link: g.invite_link || g.inviteLink || null,
          subject: g.subject || g.name || null,
        };
      }
    }
  } catch (e) {
    console.warn("[findGroup] error:", e);
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const { lead_id, signed_file_url, instance_name, doc_token, document_name } = body;
    if (!lead_id) throw new Error("lead_id required");
    if (!signed_file_url) throw new Error("signed_file_url required");

    const ext = createClient(resolveSupabaseUrl(), resolveServiceRoleKey());

    // 1. Extract from PDF via Vision
    let extracted: Extracted = {};
    try {
      extracted = await extractFromPdf(signed_file_url);
      console.log("[zapsign-enrich-lead] extracted:", JSON.stringify(extracted));
    } catch (e) {
      console.error("[zapsign-enrich-lead] extraction failed:", e);
    }

    // 2. Resolve acolhedor = dono da instância
    let acolhedor: string | null = null;
    if (instance_name) {
      const { data: inst } = await ext
        .from("whatsapp_instances")
        .select("id, owner_name")
        .eq("instance_name", instance_name)
        .maybeSingle();

      if (inst?.id) {
        const { data: ownerProfile } = await ext
          .from("profiles")
          .select("full_name")
          .eq("default_instance_id", inst.id)
          .maybeSingle();
        acolhedor = ownerProfile?.full_name || inst.owner_name || null;
      } else if (inst?.owner_name) {
        acolhedor = inst.owner_name;
      }
    }

    // 3. Build update payload (only set fields when value present, do not overwrite with null)
    const update: Record<string, any> = {};
    const setIf = (k: string, v: any) => {
      if (v !== undefined && v !== null && v !== "") update[k] = v;
    };

    setIf("cpf", cleanDigits(extracted.cpf));
    setIf("rg", extracted.rg);
    setIf("birth_date", extracted.birth_date);
    setIf("cep", cleanDigits(extracted.cep));
    setIf("street", extracted.street);
    setIf("street_number", extracted.street_number);
    setIf("complement", extracted.complement);
    setIf("neighborhood", extracted.neighborhood);
    setIf("city", extracted.city);
    setIf("state", extracted.state?.toUpperCase()?.slice(0, 2));
    setIf("acolhedor", acolhedor);
    if (extracted.signature_date) update.became_client_date = extracted.signature_date;

    // Mirror visit_* if blank (used em visitas/perícia)
    setIf("visit_city", extracted.city);
    setIf("visit_state", extracted.state?.toUpperCase()?.slice(0, 2));
    setIf("visit_address", [extracted.street, extracted.street_number, extracted.complement]
      .filter(Boolean)
      .join(", ") || null);

    update.ocr_enriched_at = new Date().toISOString();
    update.ocr_source = "zapsign_procuracao";

    if (Object.keys(update).length > 0) {
      const { error: updErr } = await ext.from("leads").update(update).eq("id", lead_id);
      if (updErr) console.error("[zapsign-enrich-lead] lead update error:", updErr);
      else console.log(`[zapsign-enrich-lead] lead ${lead_id} updated with ${Object.keys(update).length} fields`);
    }

    // 4. Get lead name + phone for Drive folder, group resolution, contact
    const { data: lead } = await ext
      .from("leads")
      .select("lead_name, victim_name, lead_phone, whatsapp_group_id")
      .eq("id", lead_id)
      .maybeSingle();
    const leadName = lead?.lead_name || lead?.victim_name || extracted.titular_name || "Lead";
    const leadPhone = lead?.lead_phone || null;

    // 4a. Vincular grupo do WhatsApp ao lead (busca grupo onde o telefone é participante)
    let groupResult: any = null;
    if (leadPhone && instance_name && !lead?.whatsapp_group_id) {
      const { data: instRow } = await ext
        .from("whatsapp_instances")
        .select("base_url, instance_token")
        .ilike("instance_name", instance_name)
        .maybeSingle();
      if (instRow?.base_url && instRow?.instance_token) {
        const grp = await findGroupByParticipantPhone(instRow.base_url, instRow.instance_token, leadPhone);
        if (grp?.jid) {
          const groupUpdate: Record<string, any> = { whatsapp_group_id: grp.jid };
          if (grp.link) groupUpdate.group_link = grp.link;
          const { error: gErr } = await ext.from("leads").update(groupUpdate).eq("id", lead_id);
          if (gErr) console.error("[zapsign-enrich-lead] group link update error:", gErr);
          else console.log(`[zapsign-enrich-lead] lead ${lead_id} linked to group ${grp.jid}`);
          groupResult = { jid: grp.jid, subject: grp.subject };
        }
      }
    }

    // 4b. Auto-criar contato a partir do telefone (se ainda não houver vínculo em contact_leads)
    let contactResult: any = null;
    if (leadPhone) {
      const cleanedPhone = leadPhone.replace(/\D/g, "");
      const { data: existing } = await ext
        .from("contacts")
        .select("id")
        .eq("phone", cleanedPhone)
        .maybeSingle();
      let contactId = existing?.id || null;
      if (!contactId) {
        const { data: newContact, error: cErr } = await ext
          .from("contacts")
          .insert({
            full_name: extracted.titular_name || leadName,
            phone: cleanedPhone,
          })
          .select("id")
          .maybeSingle();
        if (cErr) console.error("[zapsign-enrich-lead] contact insert error:", cErr);
        else contactId = newContact?.id || null;
      }
      if (contactId) {
        // Vincula via contact_leads (idempotente)
        const { data: existingLink } = await ext
          .from("contact_leads")
          .select("id")
          .eq("contact_id", contactId)
          .eq("lead_id", lead_id)
          .maybeSingle();
        if (!existingLink) {
          const { error: linkErr } = await ext
            .from("contact_leads")
            .insert({ contact_id: contactId, lead_id, relationship_to_victim: "titular" });
          if (linkErr) console.error("[zapsign-enrich-lead] contact_leads insert error:", linkErr);
        }
        contactResult = { id: contactId, created: !existing };
        console.log(`[zapsign-enrich-lead] lead ${lead_id} linked to contact ${contactId}`);
      }
    }


    // 5. Upload signed PDF to Drive folder via lead-drive
    let driveResult: any = null;
    try {
      const dateLabel = (extracted.signature_date || new Date().toISOString().slice(0, 10)).replace(/-/g, "");
      const safeName = (extracted.titular_name || leadName).replace(/[\\/:*?"<>|]/g, "").slice(0, 60);
      const fileName = `Procuração - ${safeName} - ${dateLabel}.pdf`;

      const cloudUrl = Deno.env.get("SUPABASE_URL")!;
      const cloudKey = Deno.env.get("SUPABASE_ANON_KEY")!;
      const dRes = await fetch(`${cloudUrl}/functions/v1/lead-drive`, {
        method: "POST",
        headers: { Authorization: `Bearer ${cloudKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "upload_url",
          lead_id,
          lead_name: leadName,
          file_name: fileName,
          source_url: signed_file_url,
          mime_type: "application/pdf",
          metadata: { source: "zapsign", doc_token, document_name },
        }),
      });
      driveResult = await dRes.json().catch(() => null);
      console.log("[zapsign-enrich-lead] drive upload:", dRes.status, JSON.stringify(driveResult));
    } catch (e) {
      console.error("[zapsign-enrich-lead] drive upload failed:", e);
    }

    return new Response(
      JSON.stringify({ ok: true, extracted, applied: update, drive: driveResult, group: groupResult, contact: contactResult }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[zapsign-enrich-lead] error:", e);
    return new Response(
      JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
