import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { geminiChat } from "../_shared/gemini.ts";

import { resolveSupabaseUrl, resolveServiceRoleKey } from "../_shared/supabase-url-resolver.ts";

// Use external Supabase project when configured (hybrid architecture)
const RESOLVED_SUPABASE_URL = resolveSupabaseUrl();
const RESOLVED_SERVICE_ROLE_KEY = resolveServiceRoleKey();
const RESOLVED_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { campaign_id, board_id, stage_id, batch_size = 10, offset = 0, instance_name } = await req.json();
    if (!campaign_id) {
      return new Response(JSON.stringify({ error: "campaign_id required" }), { status: 400, headers: corsHeaders });
    }

    const supabase = createClient(
      RESOLVED_SUPABASE_URL,
      RESOLVED_SERVICE_ROLE_KEY
    );

    // 1. Get all unique phones from this campaign
    const { data: allMsgs } = await supabase
      .from("whatsapp_messages")
      .select("phone, contact_name, instance_name")
      .eq("campaign_id", campaign_id)
      .not("phone", "like", "%@g.us");

    const phoneMap = new Map<string, { phone: string; contact_name: string | null; instance_name: string }>();
    (allMsgs || []).forEach((m: any) => {
      const norm = m.phone?.replace(/\D/g, "");
      if (norm && !phoneMap.has(norm)) {
        phoneMap.set(norm, { phone: m.phone, contact_name: m.contact_name, instance_name: m.instance_name });
      }
    });

    const allPhones = Array.from(phoneMap.entries());
    const total = allPhones.length;

    // 2. Filter out phones that already have leads
    const phonesToProcess: typeof allPhones = [];
    for (const [norm, info] of allPhones) {
      // Check if lead already exists with this phone
      const { data: existingLead } = await supabase
        .from("leads")
        .select("id")
        .ilike("lead_phone", `%${norm.slice(-8)}%`)
        .limit(1);

      if (!existingLead?.length) {
        phonesToProcess.push([norm, info]);
      }
    }

    const totalNew = phonesToProcess.length;
    const batch = phonesToProcess.slice(offset, offset + batch_size);

    if (batch.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        total,
        total_new: totalNew,
        processed: 0,
        offset,
        done: true,
        message: `Processamento concluído. ${total - totalNew} já tinham lead.`,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 3. Process each phone in this batch
    const results: any[] = [];

    for (const [norm, info] of batch) {
      try {
        // Fetch last 30 messages of this conversation
        const { data: msgs } = await supabase
          .from("whatsapp_messages")
          .select("message_text, direction, created_at, contact_name")
          .eq("phone", info.phone)
          .order("created_at", { ascending: true })
          .limit(30);

        if (!msgs?.length) {
          results.push({ phone: info.phone, status: "skipped", reason: "no messages" });
          continue;
        }

        // Build conversation text
        const convoText = msgs.map((m: any) => {
          const dir = m.direction === "inbound" ? "CLIENTE" : "EQUIPE";
          return `[${dir}] ${m.message_text || "(mídia)"}`;
        }).join("\n");

        const contactName = msgs.find((m: any) => m.contact_name)?.contact_name || info.contact_name || "";

        // 4. Call AI to extract data
        const aiResult = await geminiChat({
          model: "google/gemini-2.5-flash",
          messages: [
            {
              role: "system",
              content: `Você é um assistente que analisa conversas de WhatsApp entre uma equipe jurídica e um potencial cliente que veio de um anúncio.
Extraia os dados estruturados da conversa. Se um dado NÃO estiver explicitamente na conversa, retorne null.
NUNCA invente dados. Somente extraia o que foi mencionado explicitamente.`,
            },
            {
              role: "user",
              content: `Nome do contato no WhatsApp: ${contactName}
Telefone: ${info.phone}

CONVERSA:
${convoText}

Extraia os dados disponíveis desta conversa.`,
            },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "extract_lead_data",
                description: "Extrair dados estruturados da conversa",
                parameters: {
                  type: "object",
                  properties: {
                    lead_name: { type: "string", description: "Nome completo do cliente/vítima" },
                    victim_name: { type: "string", description: "Nome da vítima (se diferente do cliente)" },
                    city: { type: "string", description: "Cidade mencionada" },
                    state: { type: "string", description: "Estado/UF mencionado" },
                    neighborhood: { type: "string", description: "Bairro mencionado" },
                    case_type: { type: "string", description: "Tipo do caso (ex: acidente de trabalho, auxílio maternidade)" },
                    accident_date: { type: "string", description: "Data do acidente se mencionada (formato YYYY-MM-DD)" },
                    damage_description: { type: "string", description: "Descrição do ocorrido/dano" },
                    contractor_company: { type: "string", description: "Empresa empregadora" },
                    interest_level: { type: "string", enum: ["high", "medium", "low", "none"], description: "Nível de interesse baseado no engajamento" },
                    conversation_summary: { type: "string", description: "Resumo breve da conversa em 1-2 frases" },
                    email: { type: "string", description: "Email se mencionado" },
                  },
                  required: ["lead_name", "interest_level", "conversation_summary"],
                },
              },
            },
          ],
          tool_choice: { type: "function", function: { name: "extract_lead_data" } },
          temperature: 0.1,
        });

        let extracted: any = {};
        const toolCall = aiResult?.choices?.[0]?.message?.tool_calls?.[0];
        if (toolCall?.function?.arguments) {
          extracted = JSON.parse(toolCall.function.arguments);
        }

        const leadName = extracted.lead_name || contactName || info.phone;

        // 5. Create Lead
        const leadPayload: any = {
          lead_name: leadName,
          lead_phone: info.phone,
          lead_email: extracted.email || null,
          source: "whatsapp_ctwa",
          status: "new",
          lead_status: "active",
          campaign_id: campaign_id,
          notes: extracted.conversation_summary || null,
          city: extracted.city || null,
          state: extracted.state || null,
          neighborhood: extracted.neighborhood || null,
          victim_name: extracted.victim_name || null,
          case_type: extracted.case_type || null,
          accident_date: extracted.accident_date || null,
          damage_description: extracted.damage_description || null,
          contractor_company: extracted.contractor_company || null,
          action_source: "system",
          action_source_detail: "bulk-create-from-campaign",
        };

        if (board_id) leadPayload.board_id = board_id;
        if (stage_id) leadPayload.status = stage_id;

        const { data: newLead, error: leadErr } = await supabase
          .from("leads")
          .insert(leadPayload)
          .select("id")
          .single();

        if (leadErr) {
          console.error("Lead insert error:", leadErr);
          results.push({ phone: info.phone, status: "error", reason: leadErr.message });
          continue;
        }

        // 6. Create Contact
        const { data: newContact, error: contactErr } = await supabase
          .from("contacts")
          .insert({
            full_name: leadName,
            phone: info.phone,
            email: extracted.email || null,
            city: extracted.city || null,
            state: extracted.state || null,
            neighborhood: extracted.neighborhood || null,
            lead_id: newLead.id,
            action_source: "system",
            action_source_detail: "bulk-create-from-campaign",
          })
          .select("id")
          .single();

        // 7. Create contact_lead link
        if (newContact && !contactErr) {
          await supabase.from("contact_leads").insert({
            contact_id: newContact.id,
            lead_id: newLead.id,
            notes: extracted.conversation_summary || "Criado via análise de campanha CTWA",
          });
        }

        // 8. Update whatsapp_messages with lead_id
        await supabase
          .from("whatsapp_messages")
          .update({ lead_id: newLead.id, contact_id: newContact?.id || null })
          .eq("phone", info.phone)
          .eq("campaign_id", campaign_id);

        results.push({
          phone: info.phone,
          status: "created",
          lead_id: newLead.id,
          contact_id: newContact?.id,
          name: leadName,
          interest: extracted.interest_level,
        });
      } catch (err) {
        console.error(`Error processing ${info.phone}:`, err);
        results.push({ phone: info.phone, status: "error", reason: String(err) });
      }
    }

    const created = results.filter(r => r.status === "created").length;
    const nextOffset = offset + batch_size;
    const done = nextOffset >= totalNew;

    return new Response(JSON.stringify({
      success: true,
      total,
      total_new: totalNew,
      processed: created,
      errors: results.filter(r => r.status === "error").length,
      skipped: results.filter(r => r.status === "skipped").length,
      offset: nextOffset,
      done,
      results,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    console.error("Bulk create error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
