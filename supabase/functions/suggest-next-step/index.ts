import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { phone } = await req.json();
    if (!phone) throw new Error("phone is required");

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch recent messages
    const { data: messages } = await supabase
      .from("whatsapp_messages")
      .select("message_text, direction, created_at, media_type")
      .eq("phone", phone)
      .order("created_at", { ascending: false })
      .limit(30);

    if (!messages || messages.length === 0) {
      return new Response(JSON.stringify({ suggestion: "Sem mensagens para analisar. Envie uma mensagem para iniciar a conversa." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check if contact/lead exists
    const normalizedPhone = phone.replace(/\D/g, "");
    const phoneSuffix = normalizedPhone.slice(-8);

    const [contactResult, leadResult] = await Promise.all([
      supabase.from("contacts").select("id, full_name, classification").ilike("phone", `%${phoneSuffix}`).maybeSingle(),
      supabase.from("contact_leads").select("lead_id, leads:lead_id(lead_name, status, board_id)").ilike("contacts.phone", `%${phoneSuffix}`).limit(1),
    ]);

    const contact = contactResult.data;
    
    // Try lead via contact_leads or direct phone match
    let leadInfo: any = null;
    if (leadResult.data) {
      leadInfo = (leadResult.data as any)?.leads;
    }
    if (!leadInfo) {
      const { data: directLead } = await supabase
        .from("leads")
        .select("lead_name, status, board_id")
        .ilike("lead_phone", `%${phoneSuffix}`)
        .maybeSingle();
      leadInfo = directLead;
    }

    // Build conversation transcript
    const transcript = messages
      .reverse()
      .map((m: any) => {
        const dir = m.direction === "inbound" ? "CONTATO" : "EQUIPE";
        const text = m.message_text || (m.media_type ? `[${m.media_type}]` : "[mídia]");
        return `${dir}: ${text}`;
      })
      .join("\n");

    const contextParts = [];
    if (contact) contextParts.push(`Contato cadastrado: ${contact.full_name} (classificação: ${contact.classification || "sem classificação"})`);
    else contextParts.push("Contato NÃO cadastrado no sistema.");
    if (leadInfo) contextParts.push(`Lead vinculado: ${leadInfo.lead_name} (status: ${leadInfo.status})`);
    else contextParts.push("Nenhum lead vinculado.");

    const systemPrompt = `Você é um assistente de CRM jurídico brasileiro. Analise a conversa de WhatsApp e o contexto do contato para sugerir o PRÓXIMO PASSO mais estratégico.

Contexto:
${contextParts.join("\n")}

Regras:
- Responda em português brasileiro, de forma direta e objetiva (máximo 3 frases)
- Sugira UMA ação concreta e específica (ex: "Criar lead para caso trabalhista", "Agendar ligação de retorno", "Enviar proposta de honorários")
- Se não tem contato cadastrado, sugira criar contato primeiro
- Se tem contato mas não lead, sugira criar lead se a conversa indicar interesse
- Se já tem lead, sugira o próximo passo no funil (follow-up, enviar documento, agendar reunião)
- Considere o tom e urgência da conversa
- NÃO use listas, bullets ou formatação markdown complexa`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Conversa:\n${transcript}` },
        ],
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Limite de requisições atingido. Tente novamente em alguns segundos." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Créditos de IA esgotados." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const aiData = await response.json();
    const suggestion = aiData.choices?.[0]?.message?.content || "Não foi possível gerar sugestão.";

    return new Response(JSON.stringify({ suggestion, hasContact: !!contact, hasLead: !!leadInfo }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("suggest-next-step error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Erro desconhecido" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
