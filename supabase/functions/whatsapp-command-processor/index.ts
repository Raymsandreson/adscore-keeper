import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { phone, instance_name, message_text } = await req.json();
    if (!phone || !instance_name || !message_text) {
      return new Response(JSON.stringify({ error: "Missing fields" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    // 1) Check if this phone is authorized for commands
    const normalizedPhone = phone.replace(/\D/g, "").replace(/^0+/, "");
    const { data: config } = await supabase
      .from("whatsapp_command_config")
      .select("*")
      .eq("authorized_phone", normalizedPhone)
      .eq("instance_name", instance_name)
      .eq("is_active", true)
      .maybeSingle();

    if (!config) {
      console.log(`Phone ${normalizedPhone} not authorized for commands on ${instance_name}`);
      return new Response(JSON.stringify({ skipped: true, reason: "not_authorized" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Command from authorized user: ${config.user_name} (${normalizedPhone})`);

    // 2) Save incoming command to history
    await supabase.from("whatsapp_command_history").insert({
      phone: normalizedPhone,
      instance_name,
      role: "user",
      content: message_text,
    });

    // 3) Load recent conversation history (last 20 messages)
    const { data: history } = await supabase
      .from("whatsapp_command_history")
      .select("role, content, tool_data, created_at")
      .eq("phone", normalizedPhone)
      .eq("instance_name", instance_name)
      .order("created_at", { ascending: false })
      .limit(20);

    const chatHistory = (history || []).reverse();

    // 4) Fetch system context (assessors, activity types, leads, boards)
    const [profilesRes, typesRes, boardsRes] = await Promise.all([
      supabase.from("profiles").select("user_id, full_name").order("full_name"),
      supabase.from("activity_types").select("key, label").eq("is_active", true).order("display_order"),
      supabase.from("kanban_boards").select("id, name").eq("is_active", true).order("display_order"),
    ]);

    const assessors = (profilesRes.data || []).filter((p: any) => p.full_name);
    const actTypes = typesRes.data || [];
    const boards = boardsRes.data || [];
    const assessorsList = assessors.map((a: any) => `- "${a.full_name}" (id: ${a.user_id})`).join("\n");
    const actTypesList = actTypes.map((t: any) => `"${t.key}" (${t.label})`).join(", ");
    const actTypeKeys = actTypes.map((t: any) => t.key);
    const boardsList = boards.map((b: any) => `- "${b.name}" (id: ${b.id})`).join("\n");

    const systemPrompt = `Você é o assistente IA do CRM WhatsJUD, recebendo comandos via WhatsApp do assessor "${config.user_name}".

VOCÊ PODE:
1. Criar atividades/tarefas (new_activity)
2. Criar leads (new_lead)
3. Buscar informações sobre leads e atividades (search_info)
4. Atualizar status de atividades (update_activity)
5. Responder perguntas sobre o sistema

ASSESSORES CADASTRADOS:
${assessorsList}

TIPOS DE ATIVIDADE: ${actTypesList}

QUADROS KANBAN:
${boardsList}

DATA ATUAL: ${new Date().toISOString().split("T")[0]} (ANO: ${new Date().getFullYear()})

REGRAS:
- Execute comandos IMEDIATAMENTE sem pedir confirmação desnecessária
- Responda de forma CONCISA (mensagens curtas para WhatsApp)
- Use emojis para tornar a leitura mais fácil
- SEMPRE inclua deadline e notification_date ao criar atividades
- NUNCA sugira datas em fins de semana ou feriados
- O assessor que enviou o comando é: "${config.user_name}" (id: ${config.user_id})
- Se não especificar responsável, atribua ao próprio assessor
- Responda em português do Brasil`;

    // Build AI messages
    const aiMessages: any[] = [{ role: "system", content: systemPrompt }];
    for (const msg of chatHistory) {
      if (msg.role === "user") {
        aiMessages.push({ role: "user", content: msg.content });
      } else if (msg.role === "assistant") {
        aiMessages.push({ role: "assistant", content: msg.content });
      }
    }

    const tools = [
      {
        type: "function",
        function: {
          name: "execute_command",
          description: "Executa um comando do assessor: cria atividades, leads, busca informações ou atualiza dados.",
          parameters: {
            type: "object",
            properties: {
              response_text: { type: "string", description: "Resposta para enviar ao assessor via WhatsApp" },
              new_activity: {
                type: "object",
                description: "Criar nova atividade",
                properties: {
                  title: { type: "string" },
                  activity_type: { type: "string", enum: actTypeKeys.length > 0 ? actTypeKeys : ["tarefa", "audiencia", "prazo", "acompanhamento", "reuniao", "diligencia"] },
                  priority: { type: "string", enum: ["baixa", "normal", "alta", "urgente"] },
                  assigned_to: { type: "string", description: "user_id do responsável" },
                  assigned_to_name: { type: "string" },
                  notes: { type: "string" },
                  what_was_done: { type: "string" },
                  next_steps: { type: "string" },
                  deadline: { type: "string", description: "YYYY-MM-DDTHH:mm" },
                  notification_date: { type: "string", description: "YYYY-MM-DDTHH:mm" },
                  matrix_quadrant: { type: "string", enum: ["do_now", "schedule", "delegate", "eliminate"] },
                  lead_name: { type: "string", description: "Nome do lead para vincular" },
                },
                required: ["title", "deadline", "notification_date"],
              },
              new_lead: {
                type: "object",
                description: "Criar novo lead",
                properties: {
                  lead_name: { type: "string" },
                  lead_phone: { type: "string" },
                  victim_name: { type: "string" },
                  city: { type: "string" },
                  state: { type: "string" },
                  board_id: { type: "string", description: "ID do quadro Kanban" },
                  notes: { type: "string" },
                },
                required: ["lead_name"],
              },
              search_query: {
                type: "object",
                description: "Buscar informações no sistema",
                properties: {
                  search_type: { type: "string", enum: ["lead", "activity", "contact"] },
                  query: { type: "string" },
                },
                required: ["search_type", "query"],
              },
            },
            required: ["response_text"],
          },
        },
      },
    ];

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: aiMessages,
        tools,
      }),
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      console.error("AI error:", aiResponse.status, errText);
      throw new Error(`AI gateway error: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    const choice = aiData.choices?.[0]?.message;
    const toolCall = choice?.tool_calls?.[0];

    let responseText = choice?.content || "Comando processado.";
    let toolData: any = null;

    if (toolCall?.function?.name === "execute_command") {
      const parsed = JSON.parse(toolCall.function.arguments);
      responseText = parsed.response_text || responseText;
      toolData = {};

      // Execute: Create activity
      if (parsed.new_activity) {
        const act = parsed.new_activity;
        // Try to find lead by name
        let leadId = null;
        if (act.lead_name) {
          const { data: leads } = await supabase
            .from("leads")
            .select("id")
            .ilike("lead_name", `%${act.lead_name}%`)
            .limit(1);
          if (leads?.[0]) leadId = leads[0].id;
        }

        const { data: newAct, error: actErr } = await supabase
          .from("lead_activities")
          .insert({
            title: act.title,
            activity_type: act.activity_type || "tarefa",
            priority: act.priority || "normal",
            status: "pendente",
            assigned_to: act.assigned_to || config.user_id,
            assigned_to_name: act.assigned_to_name || config.user_name,
            created_by: config.user_id,
            deadline: act.deadline,
            notification_date: act.notification_date,
            notes: act.notes || null,
            what_was_done: act.what_was_done || null,
            next_steps: act.next_steps || null,
            matrix_quadrant: act.matrix_quadrant || "schedule",
            lead_id: leadId,
            lead_name: act.lead_name || null,
          })
          .select("id, title")
          .single();

        if (actErr) {
          console.error("Error creating activity:", actErr);
          responseText += "\n\n⚠️ Erro ao criar atividade: " + actErr.message;
        } else {
          toolData.activity_created = newAct;
          console.log("Activity created via WhatsApp command:", newAct?.id);
        }
      }

      // Execute: Create lead
      if (parsed.new_lead) {
        const lead = parsed.new_lead;
        const { data: stages } = await supabase
          .from("kanban_stages")
          .select("id")
          .eq("board_id", lead.board_id || boards[0]?.id)
          .order("display_order")
          .limit(1);

        const { data: newLead, error: leadErr } = await supabase
          .from("leads")
          .insert({
            lead_name: lead.lead_name,
            lead_phone: lead.lead_phone || null,
            victim_name: lead.victim_name || null,
            city: lead.city || null,
            state: lead.state || null,
            board_id: lead.board_id || boards[0]?.id || null,
            stage_id: stages?.[0]?.id || null,
            notes: lead.notes || null,
            created_by: config.user_id,
            status: "novo",
          })
          .select("id, lead_name")
          .single();

        if (leadErr) {
          console.error("Error creating lead:", leadErr);
          responseText += "\n\n⚠️ Erro ao criar lead: " + leadErr.message;
        } else {
          toolData.lead_created = newLead;
          console.log("Lead created via WhatsApp command:", newLead?.id);
        }
      }

      // Execute: Search
      if (parsed.search_query) {
        const sq = parsed.search_query;
        let results: any[] = [];

        if (sq.search_type === "lead") {
          const { data } = await supabase
            .from("leads")
            .select("id, lead_name, status, stage_id, lead_phone, victim_name")
            .ilike("lead_name", `%${sq.query}%`)
            .limit(5);
          results = data || [];
        } else if (sq.search_type === "activity") {
          const { data } = await supabase
            .from("lead_activities")
            .select("id, title, status, priority, deadline, assigned_to_name")
            .or(`title.ilike.%${sq.query}%,notes.ilike.%${sq.query}%`)
            .order("created_at", { ascending: false })
            .limit(5);
          results = data || [];
        } else if (sq.search_type === "contact") {
          const { data } = await supabase
            .from("contacts")
            .select("id, full_name, phone, email")
            .ilike("full_name", `%${sq.query}%`)
            .limit(5);
          results = data || [];
        }

        toolData.search_results = results;
        if (results.length > 0) {
          const resultTexts = results.map((r: any) => {
            if (sq.search_type === "lead") return `• ${r.lead_name} (${r.status}) - ${r.lead_phone || "sem telefone"}`;
            if (sq.search_type === "activity") return `• ${r.title} (${r.status}/${r.priority}) - ${r.deadline || "sem prazo"} - ${r.assigned_to_name || ""}`;
            return `• ${r.full_name} - ${r.phone || ""} - ${r.email || ""}`;
          });
          responseText += "\n\n📋 Resultados:\n" + resultTexts.join("\n");
        } else {
          responseText += "\n\n🔍 Nenhum resultado encontrado.";
        }
      }
    }

    // 5) Save AI response to history
    await supabase.from("whatsapp_command_history").insert({
      phone: normalizedPhone,
      instance_name,
      role: "assistant",
      content: responseText,
      tool_data: toolData,
    });

    // 6) Send response back via WhatsApp
    const { data: inst } = await supabase
      .from("whatsapp_instances")
      .select("instance_token, base_url")
      .eq("instance_name", instance_name)
      .maybeSingle();

    if (inst?.instance_token) {
      const baseUrl = inst.base_url || "https://abraci.uazapi.com";
      try {
        await fetch(`${baseUrl}/send/text`, {
          method: "POST",
          headers: { "Content-Type": "application/json", token: inst.instance_token },
          body: JSON.stringify({
            number: normalizedPhone,
            text: `🤖 *Abraci IA*\n\n${responseText}`,
          }),
        });
        console.log("Command response sent to WhatsApp:", normalizedPhone);
      } catch (e) {
        console.error("Error sending command response:", e);
      }
    }

    return new Response(JSON.stringify({ success: true, response: responseText, tool_data: toolData }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Command processor error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
