import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { geminiChat } from "../_shared/gemini.ts";
import { resolveSupabaseUrl, resolveServiceRoleKey } from "../_shared/supabase-url-resolver.ts";

const SUPABASE_URL = resolveSupabaseUrl();
const SERVICE_ROLE_KEY = resolveServiceRoleKey();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { lead_id, regenerate, custom_prompt } = await req.json();
    if (!lead_id) {
      return new Response(JSON.stringify({ error: "lead_id é obrigatório" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // 1. Fetch lead data
    const { data: lead, error: leadErr } = await sb
      .from("leads")
      .select("id, lead_name, lead_phone, lead_status, board_id, city, state, product_service_id, nucleus_id, acolhedor, campaign_name, notes, collected_data")
      .eq("id", lead_id)
      .maybeSingle();

    if (leadErr || !lead) {
      return new Response(JSON.stringify({ error: "Lead não encontrado" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. Check for existing AI activities
    const { data: existingActivities } = await sb
      .from("lead_activities")
      .select("id, title, status, assigned_to_name, created_at")
      .eq("lead_id", lead_id)
      .eq("created_by_ai", true);

    if (existingActivities && existingActivities.length > 0 && !regenerate) {
      return new Response(JSON.stringify({
        activities: existingActivities,
        count: existingActivities.length,
        message: `Lead já possui ${existingActivities.length} atividades IA geradas. Use regenerate=true para recriar.`,
        already_exists: true,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // If regenerating, delete previous AI activities
    if (regenerate && existingActivities && existingActivities.length > 0) {
      await sb.from("lead_activities").delete()
        .eq("lead_id", lead_id)
        .eq("created_by_ai", true);
    }

    // 3. Fetch WhatsApp messages (last 100)
    const phone = (lead.lead_phone || "").replace(/\D/g, "");
    let messages: any[] = [];
    if (phone) {
      const { data: msgs } = await sb
        .from("whatsapp_messages")
        .select("direction, message_text, created_at")
        .like("phone", `%${phone.slice(-8)}%`)
        .order("created_at", { ascending: true })
        .limit(100);
      messages = msgs || [];
    }

    // 4. Fetch process tracking data
    const { data: caseData } = await sb
      .from("legal_cases")
      .select("id, case_number, description, nucleus_id")
      .eq("lead_id", lead_id)
      .limit(5);

    let processData: any[] = [];
    if (caseData && caseData.length > 0) {
      const caseIds = caseData.map((c: any) => c.id);
      const { data: procs } = await sb
        .from("case_process_tracking")
        .select("tipo, status_processo, observacao, pendencia, numero_processo")
        .in("case_id", caseIds);
      processData = procs || [];
    }

    // 5. Fetch product info
    let productName = "";
    if (lead.product_service_id) {
      const { data: prod } = await sb
        .from("products_services")
        .select("name")
        .eq("id", lead.product_service_id)
        .maybeSingle();
      productName = prod?.name || "";
    }

    // 6. Fetch team members with job positions
    const { data: memberPositions } = await sb
      .from("member_positions")
      .select("user_id, position_id")
      .order("assigned_at");

    const positionIds = [...new Set((memberPositions || []).map((mp: any) => mp.position_id))];
    const userIds = [...new Set((memberPositions || []).map((mp: any) => mp.user_id))];

    let positions: any[] = [];
    let profiles: any[] = [];

    if (positionIds.length > 0) {
      const { data: pos } = await sb
        .from("job_positions")
        .select("id, name, description, department")
        .in("id", positionIds)
        .eq("is_active", true);
      positions = pos || [];
    }

    if (userIds.length > 0) {
      const { data: profs } = await sb
        .from("profiles")
        .select("user_id, full_name")
        .in("user_id", userIds);
      profiles = profs || [];
    }

    // Build team roster with roles
    const teamRoster = (memberPositions || []).map((mp: any) => {
      const pos = positions.find((p: any) => p.id === mp.position_id);
      const prof = profiles.find((p: any) => p.user_id === mp.user_id);
      if (!pos || !prof) return null;
      return {
        user_id: mp.user_id,
        full_name: prof.full_name,
        position_name: pos.name,
        position_description: pos.description || "",
        department: pos.department || "",
      };
    }).filter(Boolean);

    if (teamRoster.length === 0) {
      return new Response(JSON.stringify({ error: "Nenhum membro com cargo cadastrado" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 7. Build context for AI
    const conversationSummary = messages.length > 0
      ? messages.map((m: any) => `[${m.direction === 'inbound' ? 'Cliente' : 'Agente'}] ${m.message_text || ''}`).join("\n")
      : "Sem histórico de mensagens disponível.";

    const leadContext = `
DADOS DO LEAD:
- Nome: ${lead.lead_name || "N/A"}
- Telefone: ${lead.lead_phone || "N/A"}
- Cidade/UF: ${lead.city || "N/A"}/${lead.state || "N/A"}
- Produto: ${productName || "N/A"}
- Acolhedor: ${lead.acolhedor || "N/A"}
- Campanha: ${lead.campaign_name || "N/A"}
- Observações: ${lead.notes || "Nenhuma"}
- Dados Coletados: ${lead.collected_data ? JSON.stringify(lead.collected_data) : "Nenhum"}
`.trim();

    const processContext = processData.length > 0
      ? `PROCESSOS:\n${processData.map((p: any) => `- Tipo: ${p.tipo || "N/A"} | Status: ${p.status_processo || "N/A"} | Nº: ${p.numero_processo || "N/A"} | Obs: ${p.observacao || "N/A"} | Pendência: ${p.pendencia || "N/A"}`).join("\n")}`
      : "Sem processos registrados ainda.";

    const teamContext = teamRoster.map((t: any) =>
      `- ${t.full_name} (${t.position_name}): ${t.position_description}`
    ).join("\n");

    // 8. Call Gemini
    const result = await geminiChat({
      model: "google/gemini-3-flash-preview",
      messages: [
        {
          role: "system",
          content: custom_prompt || `Você é um coordenador jurídico inteligente. Analise o caso fechado abaixo e crie atividades específicas para cada membro da equipe processual, baseando-se na DESCRIÇÃO DO CARGO de cada um.

Regras:
- Crie atividades RELEVANTES para o caso específico, não genéricas
- Cada atividade deve ser atribuída ao membro cujo cargo é mais adequado
- O título deve ser curto e em MAIÚSCULAS
- A descrição deve ser detalhada com o que precisa ser feito
- Defina prazos razoáveis em dias úteis a partir de hoje
- Prioridade: "normal", "alta" ou "urgente" dependendo da natureza
- Use as informações das mensagens e dados coletados para contextualizar
- Não crie mais de 2 atividades por membro
- Se um cargo não tem relação com o caso, não crie atividade para ele
- Tipo de atividade: use "tarefa", "prazo", "audiencia", "reuniao" conforme aplicável`,
        },
        {
          role: "user",
          content: `${leadContext}\n\n${processContext}\n\nCONVERSA COM O CLIENTE:\n${conversationSummary.substring(0, 8000)}\n\nEQUIPE DISPONÍVEL:\n${teamContext}`,
        },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "create_activities",
            description: "Cria as atividades processuais para a equipe",
            parameters: {
              type: "object",
              properties: {
                activities: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      title: { type: "string", description: "Título curto em MAIÚSCULAS" },
                      description: { type: "string", description: "Descrição detalhada do que deve ser feito" },
                      activity_type: { type: "string", enum: ["tarefa", "prazo", "audiencia", "reuniao"] },
                      priority: { type: "string", enum: ["normal", "alta", "urgente"] },
                      assigned_to_name: { type: "string", description: "Nome completo do membro responsável" },
                      deadline_days: { type: "number", description: "Prazo em dias úteis a partir de hoje" },
                      next_steps: { type: "string", description: "Próximos passos após concluir" },
                    },
                    required: ["title", "description", "activity_type", "priority", "assigned_to_name", "deadline_days"],
                  },
                },
              },
              required: ["activities"],
            },
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "create_activities" } },
    });

    const toolCall = result.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) {
      throw new Error("IA não retornou atividades estruturadas");
    }

    const { activities } = JSON.parse(toolCall.function.arguments);
    if (!activities || activities.length === 0) {
      return new Response(JSON.stringify({ activities: [], message: "Nenhuma atividade gerada" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 9. Map names to user_ids and insert
    const insertedActivities: any[] = [];
    const now = new Date();

    for (const act of activities) {
      const member = teamRoster.find((t: any) =>
        t.full_name.toLowerCase() === act.assigned_to_name.toLowerCase()
      );
      if (!member) continue;

      const deadline = new Date(now);
      deadline.setDate(deadline.getDate() + (act.deadline_days || 3));
      // Skip weekends
      while (deadline.getDay() === 0 || deadline.getDay() === 6) {
        deadline.setDate(deadline.getDate() + 1);
      }

      const activityData = {
        lead_id: lead.id,
        lead_name: lead.lead_name,
        title: act.title,
        description: act.description,
        activity_type: act.activity_type,
        status: "pendente",
        priority: act.priority,
        assigned_to: member.user_id,
        assigned_to_name: member.full_name,
        deadline: deadline.toISOString().split("T")[0],
        next_steps: act.next_steps || null,
        created_by_ai: true,
        ai_generation_context: {
          lead_id: lead.id,
          product: productName,
          position_name: member.position_name,
          generated_at: now.toISOString(),
        },
      };

      const { data: inserted, error: insertErr } = await sb
        .from("lead_activities")
        .insert(activityData)
        .select()
        .single();

      if (!insertErr && inserted) {
        insertedActivities.push(inserted);
      }
    }

    return new Response(JSON.stringify({
      activities: insertedActivities,
      count: insertedActivities.length,
      message: `${insertedActivities.length} atividades criadas com sucesso`,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("generate-case-activities error:", e);
    return new Response(JSON.stringify({ error: e.message || "Erro desconhecido" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
