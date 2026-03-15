import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { geminiChat } from "../_shared/gemini.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const APP_URL = "https://adscore-keeper.lovable.app";

// ── helpers ──────────────────────────────────────────────────────────
const buildPhoneVariants = (rawPhone: string) => {
  const digits = (rawPhone || "").replace(/\D/g, "").replace(/^0+/, "");
  if (!digits) return [] as string[];
  const variants = new Set<string>();
  const add = (v?: string) => { if (v) variants.add(v); };
  add(digits);
  const local = digits.startsWith("55") ? digits.slice(2) : digits;
  add(local);
  if (local.length === 10) {
    const withNine = `${local.slice(0, 2)}9${local.slice(2)}`;
    add(withNine); add(`55${withNine}`);
  }
  if (local.length === 11 && local[2] === "9") {
    const withoutNine = `${local.slice(0, 2)}${local.slice(3)}`;
    add(withoutNine); add(`55${withoutNine}`);
  }
  return Array.from(variants);
};

async function sendWhatsAppText(baseUrl: string, token: string, number: string, text: string) {
  await fetch(`${baseUrl}/send/text`, {
    method: "POST",
    headers: { "Content-Type": "application/json", token },
    body: JSON.stringify({ number, text }),
  });
}

async function sendWhatsAppButtons(baseUrl: string, token: string, number: string, text: string, buttons: { id: string; text: string }[]) {
  // uazapi send/quickReply – up to 3 buttons
  try {
    const res = await fetch(`${baseUrl}/send/quickReply`, {
      method: "POST",
      headers: { "Content-Type": "application/json", token },
      body: JSON.stringify({
        number,
        message: text,
        buttons: buttons.slice(0, 3).map(b => ({ buttonId: b.id, buttonText: b.text })),
      }),
    });
    if (res.ok) return true;
    console.warn("quickReply failed, falling back to text", await res.text());
  } catch (e) {
    console.warn("quickReply error, falling back to text:", e);
  }
  // Fallback: send as numbered text
  const fallbackText = text + "\n\n" + buttons.map((b, i) => `${i + 1}️⃣ ${b.text}`).join("\n") + "\n\n_Responda com o número da opção_";
  await sendWhatsAppText(baseUrl, token, number, fallbackText);
  return false;
}

async function sendWhatsAppList(baseUrl: string, token: string, number: string, text: string, items: { id: string; title: string; description?: string }[]) {
  // uazapi send/list – up to 10 items
  try {
    const res = await fetch(`${baseUrl}/send/list`, {
      method: "POST",
      headers: { "Content-Type": "application/json", token },
      body: JSON.stringify({
        number,
        message: text,
        buttonText: "Ver opções",
        listItems: items.slice(0, 10).map(i => ({ title: i.title, description: i.description || "", id: i.id })),
      }),
    });
    if (res.ok) return true;
    console.warn("sendList failed, falling back to text", await res.text());
  } catch (e) {
    console.warn("sendList error, falling back to text:", e);
  }
  // Fallback: send as numbered text
  const fallbackText = text + "\n\n" + items.map((item, i) => `${i + 1}️⃣ *${item.title}*${item.description ? ` – ${item.description}` : ""}`).join("\n") + "\n\n_Responda com o número da opção_";
  await sendWhatsAppText(baseUrl, token, number, fallbackText);
  return false;
}

// ── Batch collection markers ──
const COLLECTING_MARKER = "__COLLECTING__";
const FINISH_KEYWORDS = ["pronto", "executar", "só isso", "somente isso", "pode executar", "finalizar", "é isso", "isso é tudo", "pode fazer", "manda", "envia", "go", "ok pronto", "feito"];

function isFinishMessage(text: string): boolean {
  const normalized = text.trim().toLowerCase().replace(/[.!?,]/g, "");
  return FINISH_KEYWORDS.some(k => normalized === k || normalized.startsWith(k + " ") || normalized.endsWith(" " + k));
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const { phone, instance_name, media_url, message_type } = body;
    let message_text = body.message_text;

    if (!phone || !instance_name) {
      return new Response(JSON.stringify({ error: "Missing fields" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Audio transcription: convert voice messages to text ──
    const isAudio = message_type === 'audio' || message_type === 'ptt';
    if (isAudio && media_url && !message_text) {
      console.log('Transcribing audio for command processing:', media_url);
      try {
        const transcriptionResult = await geminiChat({
          model: "google/gemini-2.5-flash",
          messages: [
            {
              role: "system",
              content: "Transcreva EXATAMENTE o que a pessoa disse no áudio. Retorne APENAS a transcrição literal, sem comentários, sem pontuação extra. Se não conseguir entender, retorne string vazia.",
            },
            {
              role: "user",
              content: [{ type: "image_url", image_url: { url: media_url } }],
            },
          ],
        });
        const transcript = transcriptionResult.choices?.[0]?.message?.content?.trim();
        if (transcript) {
          console.log('Audio transcribed for command:', transcript.substring(0, 100));
          message_text = transcript;
        }
      } catch (e) {
        console.error('Audio transcription error:', e);
      }
    }

    // Build the content to save (text + media reference)
    const hasMedia = media_url && message_type !== 'text';
    const contentToSave = [
      message_text || '',
      hasMedia ? `[MÍDIA: ${message_type} - ${media_url}]` : '',
    ].filter(Boolean).join('\n');

    if (!contentToSave) {
      return new Response(JSON.stringify({ error: "No content to process" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    const GOOGLE_AI_API_KEY = Deno.env.get("GOOGLE_AI_API_KEY");
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!GOOGLE_AI_API_KEY && !LOVABLE_API_KEY) {
      throw new Error("No AI provider configured (GOOGLE_AI_API_KEY or LOVABLE_API_KEY)");
    }

    const normalizedPhone = phone.replace(/\D/g, "").replace(/^0+/, "");
    const phoneVariants = buildPhoneVariants(normalizedPhone);

    // 1) Authorize
    let config: any = null;
    for (const variant of phoneVariants) {
      const { data } = await supabase
        .from("whatsapp_command_config")
        .select("*")
        .eq("authorized_phone", variant)
        .eq("instance_name", instance_name)
        .eq("is_active", true)
        .maybeSingle();
      if (data) { config = data; break; }
    }

    if (!config) {
      console.log(`Phone ${normalizedPhone} not authorized for commands on ${instance_name}`);
      return new Response(JSON.stringify({ skipped: true, reason: "not_authorized" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Command from authorized user: ${config.user_name} (${normalizedPhone})`);

    // 2) Check if we're in batch collection mode
    const { data: recentHistory } = await supabase
      .from("whatsapp_command_history")
      .select("role, content, tool_data, created_at")
      .eq("phone", normalizedPhone)
      .eq("instance_name", instance_name)
      .order("created_at", { ascending: false })
      .limit(30);

    const lastAssistantMsg = (recentHistory || []).find((m: any) => m.role === "assistant");
    const isInCollectingMode = lastAssistantMsg?.tool_data?.collecting === true;
    const isFinish = message_text ? isFinishMessage(message_text) : false;

    // Get WhatsApp instance for sending messages
    const { data: inst } = await supabase
      .from("whatsapp_instances")
      .select("instance_token, base_url")
      .eq("instance_name", instance_name)
      .maybeSingle();
    const baseUrl = inst?.base_url || "https://abraci.uazapi.com";
    const instToken = inst?.instance_token || "";

    // ── CASE 1: First message (not in collecting mode) → Start collecting ──
    if (!isInCollectingMode && !isFinish) {
      // Save the message
      await supabase.from("whatsapp_command_history").insert({
        phone: normalizedPhone, instance_name, role: "user", content: contentToSave,
        tool_data: hasMedia ? { media_url, message_type } : null,
      });

      // Ask if there's more
      const collectMsg = `📥 *Recebido!*\n\nTem mais alguma coisa pra enviar? (áudio, documento, link, foto, ou mais informações)\n\n_Quando terminar, responda *PRONTO* que eu processo tudo de uma vez_ ✅`;
      
      await supabase.from("whatsapp_command_history").insert({
        phone: normalizedPhone, instance_name, role: "assistant", content: collectMsg,
        tool_data: { collecting: true },
      });

      if (instToken) {
        await sendWhatsAppText(baseUrl, instToken, normalizedPhone, `🤖 *WhatsJUD IA*\n\n${collectMsg}`).catch(e => console.error("Send error:", e));
      }

      return new Response(JSON.stringify({ success: true, status: "collecting", message: "Waiting for more content" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── CASE 2: In collecting mode, user sends more content (not "pronto") ──
    if (isInCollectingMode && !isFinish) {
      // Save additional content
      await supabase.from("whatsapp_command_history").insert({
        phone: normalizedPhone, instance_name, role: "user", content: contentToSave,
        tool_data: hasMedia ? { media_url, message_type } : null,
      });

      // Acknowledge and keep collecting
      const ackMsg = `📥 *Anotado!* Mais alguma coisa?\n\n_Responda *PRONTO* quando terminar_ ✅`;
      
      await supabase.from("whatsapp_command_history").insert({
        phone: normalizedPhone, instance_name, role: "assistant", content: ackMsg,
        tool_data: { collecting: true },
      });

      if (instToken) {
        await sendWhatsAppText(baseUrl, instToken, normalizedPhone, `🤖 *WhatsJUD IA*\n\n${ackMsg}`).catch(e => console.error("Send error:", e));
      }

      return new Response(JSON.stringify({ success: true, status: "collecting_more", message: "More content added" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── CASE 3: User says "pronto" → Consolidate all buffered content and process ──
    // Gather all user messages since the first collecting prompt
    const allHistory = (recentHistory || []).reverse(); // chronological
    
    // Find the first "collecting" assistant message
    let collectStartIdx = -1;
    for (let i = 0; i < allHistory.length; i++) {
      if (allHistory[i].role === "assistant" && allHistory[i].tool_data?.collecting === true) {
        // Find the user message just before this
        collectStartIdx = Math.max(0, i - 1);
        break;
      }
    }

    // Consolidate all user messages from the collection period
    const bufferedMessages: string[] = [];
    const bufferedMedia: { url: string; type: string }[] = [];
    
    for (let i = collectStartIdx >= 0 ? collectStartIdx : 0; i < allHistory.length; i++) {
      const msg = allHistory[i];
      if (msg.role !== "user") continue;
      if (msg.content) bufferedMessages.push(msg.content);
      if (msg.tool_data?.media_url) {
        bufferedMedia.push({ url: msg.tool_data.media_url, type: msg.tool_data.message_type || 'document' });
      }
    }

    // Build consolidated message for AI
    const consolidatedText = bufferedMessages.join("\n\n---\n\n");
    const mediaContext = bufferedMedia.length > 0
      ? `\n\n[MÍDIAS ANEXADAS: ${bufferedMedia.map(m => `${m.type}: ${m.url}`).join(", ")}]`
      : "";
    
    const finalMessage = consolidatedText + mediaContext;
    console.log(`Processing consolidated command (${bufferedMessages.length} messages, ${bufferedMedia.length} media):`, finalMessage.substring(0, 200));

    // Save the "pronto" message
    await supabase.from("whatsapp_command_history").insert({
      phone: normalizedPhone, instance_name, role: "user", content: "[EXECUTAR COMANDO]",
    });

    // Now replace message_text with consolidated content for AI processing
    // and continue with the normal flow below
    const message_text_final = finalMessage;

    // Clear collecting state by saving a non-collecting assistant placeholder
    // (will be replaced by the actual response below)

    // 3) Rebuild history WITHOUT the collecting messages for clean AI context
    const chatHistory: any[] = [];
    for (const msg of allHistory) {
      if (msg.role === "assistant" && msg.tool_data?.collecting === true) continue; // skip collecting prompts
      if (msg.content === "[EXECUTAR COMANDO]") continue; // skip execute marker
      if (msg.role === "user" || msg.role === "assistant") {
        chatHistory.push(msg);
      }
    }

    // 4) Fetch system context
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

    // ── System Prompt ──
    const systemPrompt = `Você é o assistente IA do CRM WhatsJUD, recebendo comandos via WhatsApp do assessor "${config.user_name}".

VOCÊ PODE:
1. Criar atividades/tarefas (new_activity)
2. Criar leads (new_lead)
3. Buscar informações sobre leads, atividades e contatos (search_info)
4. Atualizar status de atividades (update_activity)
5. Gerar relatórios de produtividade (productivity_report)
6. Consultar metas e progresso de cada trabalhador
7. Dar feedback sobre desempenho individual ou da equipe
8. Informar tarefas atrasadas, tempo no sistema, pontos de melhoria
9. Responder perguntas sobre o sistema

ASSESSORES CADASTRADOS:
${assessorsList}

TIPOS DE ATIVIDADE (USE EXATAMENTE ESTAS KEYS): ${actTypesList}
IMPORTANTE: Use SEMPRE a key exata (ex: "tarefa", "audiencia"). Nunca invente tipos novos.

QUADROS KANBAN:
${boardsList}

DATA ATUAL: ${new Date().toISOString().split("T")[0]} (ANO: ${new Date().getFullYear()})

REGRAS CRÍTICAS DE COMPORTAMENTO:
1. DECIDA VOCÊ MESMO todos os campos com base no contexto. NUNCA liste todas as opções pedindo para o usuário escolher.
2. Para "activity_type": analise o conteúdo do comando e escolha o tipo mais adequado automaticamente. Ex: "ligar para fulano" → tipo ligação; "audiência dia X" → tipo audiência; "reunião com equipe" → tipo reunião. Se não houver tipo claro, use "tarefa".
3. Para "priority": infira do contexto (palavras como "urgente", "importante", "quando puder"). Default: "normal".
4. Para "matrix_quadrant": infira automaticamente (urgente+importante=do_now, importante+não urgente=schedule, etc). Default: "schedule".
5. Para "assigned_to": se não mencionado, use o próprio assessor que enviou o comando.
6. Execute comandos IMEDIATAMENTE sem pedir confirmação.
7. Responda de forma CONCISA (mensagens curtas para WhatsApp).
8. Use emojis para tornar a leitura mais fácil.
9. SEMPRE inclua deadline e notification_date ao criar atividades.
10. NUNCA sugira datas em fins de semana ou feriados.
11. Após criar atividade ou lead, inclua na response_text um resumo do que foi criado com os campos preenchidos.
12. O assessor que enviou o comando é: "${config.user_name}" (id: ${config.user_id})
13. Responda em português do Brasil

RELATÓRIOS E PRODUTIVIDADE:
- Quando pedirem relatório, feedback, desempenho ou produtividade: use productivity_report
- Você pode consultar: tarefas atrasadas, metas definidas vs atingidas, tempo online, ranking da equipe
- Se perguntarem sobre "mim" ou "eu", use o user_id do assessor atual
- Se perguntarem sobre outra pessoa, identifique pelo nome na lista de assessores
- Formate o relatório de forma clara com seções e emojis
- Inclua pontos de melhoria e sugestões quando relevante
- Compare metas definidas com progresso atual

EXEMPLO DE RESPOSTA BOA:
Usuário: "criar tarefa teste para amanhã"
→ Crie imediatamente com activity_type="tarefa", priority="normal", deadline=amanhã 09:00, notification_date=amanhã 08:00
→ response_text: "✅ Atividade criada!\\n📋 *teste*\\n📅 Prazo: 14/03/2026 09:00\\n🔔 Notificação: 14/03/2026 08:00\\n👤 ${config.user_name}\\n\\n✏️ Editar: {link}"

EXEMPLO DE RESPOSTA RUIM (NUNCA faça isso):
"Qual o tipo de atividade? Escolha entre: tarefa, audiência, prazo..." ← PROIBIDO listar opções`;

    // Build AI messages
    const aiMessages: any[] = [{ role: "system", content: systemPrompt }];
    for (const msg of chatHistory) {
      if (msg.role === "user") aiMessages.push({ role: "user", content: msg.content });
      else if (msg.role === "assistant") aiMessages.push({ role: "assistant", content: msg.content });
    }

    const tools = [
      {
        type: "function",
        function: {
          name: "execute_command",
          description: "Executa um comando do assessor: cria atividades, leads, busca informações ou atualiza dados. SEMPRE decida os campos automaticamente baseado no contexto.",
          parameters: {
            type: "object",
            properties: {
              response_text: { type: "string", description: "Resposta concisa para enviar ao assessor via WhatsApp. Inclua resumo do que foi feito." },
              new_activity: {
                type: "object",
                description: "Criar nova atividade. Preencha TODOS os campos automaticamente baseado no contexto.",
                properties: {
                  title: { type: "string" },
                  activity_type: { type: "string", enum: actTypeKeys.length > 0 ? actTypeKeys : ["tarefa", "audiencia", "prazo", "acompanhamento", "reuniao", "diligencia"], description: "Escolha automaticamente o tipo mais adequado ao contexto do comando" },
                  priority: { type: "string", enum: ["baixa", "normal", "alta", "urgente"], description: "Infira do contexto. Default: normal" },
                  assigned_to: { type: "string", description: "user_id do responsável. Default: assessor atual" },
                  assigned_to_name: { type: "string" },
                  notes: { type: "string" },
                  what_was_done: { type: "string" },
                  next_steps: { type: "string" },
                  deadline: { type: "string", description: "YYYY-MM-DDTHH:mm" },
                  notification_date: { type: "string", description: "YYYY-MM-DDTHH:mm" },
                  matrix_quadrant: { type: "string", enum: ["do_now", "schedule", "delegate", "eliminate"], description: "Infira automaticamente. Default: schedule" },
                  lead_name: { type: "string", description: "Nome do lead para vincular" },
                },
                required: ["title", "activity_type", "deadline", "notification_date"],
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
                  board_id: { type: "string", description: "ID do quadro Kanban. Escolha o mais adequado automaticamente." },
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
              productivity_report: {
                type: "object",
                description: "Consultar produtividade, metas, tarefas atrasadas, tempo online, ranking e gerar feedback. Use quando pedirem relatório, desempenho, feedback ou informações sobre metas.",
                properties: {
                  user_id: { type: "string", description: "user_id do assessor a consultar. Se sobre si mesmo, use o id do assessor atual." },
                  user_name: { type: "string", description: "Nome do assessor consultado" },
                  report_type: { type: "string", enum: ["full", "overdue_tasks", "goals", "session_time", "ranking", "feedback"], description: "Tipo do relatório: full=completo, overdue_tasks=só atrasadas, goals=metas, session_time=tempo online, ranking=posição, feedback=pontos de melhoria" },
                },
                required: ["user_id", "report_type"],
              },
            },
            required: ["response_text"],
          },
        },
      },
    ];

    // ── Call AI ──
    const useGoogleDirect = !!GOOGLE_AI_API_KEY;
    let aiResponse: Response;

    if (useGoogleDirect) {
      const googleContents = aiMessages
        .filter((msg: any) => msg.role !== "system")
        .map((msg: any) => ({
          role: msg.role === "assistant" ? "model" : "user",
          parts: [{ text: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content ?? "") }],
        }));

      aiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GOOGLE_AI_API_KEY}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: googleContents.length > 0 ? googleContents : [{ role: "user", parts: [{ text: message_text_final }] }],
          tools: [{
            functionDeclarations: [{
              name: "execute_command",
              description: tools[0].function.description,
              parameters: tools[0].function.parameters,
            }],
          }],
          toolConfig: { functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["execute_command"] } },
          generationConfig: { temperature: 0.2 },
        }),
      });
    } else {
      // Fallback: use shared Gemini helper
      const geminiResult = await geminiChat({ model: "google/gemini-2.5-flash", messages: aiMessages, tools });
      aiResponse = new Response(JSON.stringify(geminiResult), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    // ── Handle AI errors ──
    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      console.error("AI error:", aiResponse.status, errText);
      const fallbackText = aiResponse.status === 402
        ? "⚠️ Estou sem créditos de IA no momento."
        : aiResponse.status === 429
          ? "⏳ Muitos pedidos. Tente em instantes."
          : "⚠️ Erro temporário. Tente novamente em minutos.";

      await supabase.from("whatsapp_command_history").insert({
        phone: normalizedPhone, instance_name, role: "assistant", content: fallbackText, tool_data: { error_status: aiResponse.status },
      });

      if (instToken) {
        await sendWhatsAppText(baseUrl, instToken, normalizedPhone, `🤖 *WhatsJUD IA*\n\n${fallbackText}`).catch(e => console.error("Send error:", e));
      }
      return new Response(JSON.stringify({ success: false, error: fallbackText }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ── Parse AI response ──
    const aiData = await aiResponse.json();
    let responseText = "Comando processado.";
    let toolData: any = null;
    let parsed: any = null;

    if (useGoogleDirect) {
      const parts = aiData?.candidates?.[0]?.content?.parts || [];
      const fcPart = parts.find((p: any) => p?.functionCall?.name === "execute_command");
      const txtPart = parts.find((p: any) => typeof p?.text === "string" && p.text.trim());
      if (fcPart?.functionCall?.args) parsed = fcPart.functionCall.args;
      if (txtPart?.text) responseText = txtPart.text;
    } else {
      const choice = aiData.choices?.[0]?.message;
      const toolCall = choice?.tool_calls?.[0];
      responseText = choice?.content || responseText;
      if (toolCall?.function?.name === "execute_command") {
        try { parsed = JSON.parse(toolCall.function.arguments); } catch (e) { console.error("Parse error:", e); }
      }
    }

    if (parsed) {
      responseText = parsed.response_text || responseText;
      toolData = {};

      // ── Create activity ──
      if (parsed.new_activity) {
        const act = parsed.new_activity;
        let leadId = null;
        if (act.lead_name) {
          const { data: leads } = await supabase.from("leads").select("id").ilike("lead_name", `%${act.lead_name}%`).limit(1);
          if (leads?.[0]) leadId = leads[0].id;
        }

        // Validate activity_type against known keys (case-insensitive match)
        let validatedType = "tarefa";
        if (act.activity_type) {
          const match = actTypeKeys.find((k: string) => k.toLowerCase() === act.activity_type.toLowerCase());
          validatedType = match || "tarefa";
        }

        const { data: newAct, error: actErr } = await supabase
          .from("lead_activities")
          .insert({
            title: act.title,
            activity_type: validatedType,
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
          // Append edit link
          responseText += `\n\n✏️ Editar: ${APP_URL}/activities?edit=${newAct?.id}`;
          console.log("Activity created via WhatsApp:", newAct?.id);
        }
      }

      // ── Create lead ──
      if (parsed.new_lead) {
        const lead = parsed.new_lead;
        const { data: stages } = await supabase
          .from("kanban_stages").select("id")
          .eq("board_id", lead.board_id || boards[0]?.id)
          .order("display_order").limit(1);

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
          const boardId = lead.board_id || boards[0]?.id;
          responseText += `\n\n✏️ Editar: ${APP_URL}/leads?board=${boardId}&openLead=${newLead?.id}`;
          console.log("Lead created via WhatsApp:", newLead?.id);
        }
      }

      // ── Search ──
      if (parsed.search_query) {
        const sq = parsed.search_query;
        let results: any[] = [];

        if (sq.search_type === "lead") {
          const { data } = await supabase.from("leads").select("id, lead_name, status, stage_id, lead_phone, victim_name").ilike("lead_name", `%${sq.query}%`).limit(5);
          results = data || [];
        } else if (sq.search_type === "activity") {
          const { data } = await supabase.from("lead_activities").select("id, title, status, priority, deadline, assigned_to_name").or(`title.ilike.%${sq.query}%,notes.ilike.%${sq.query}%`).order("created_at", { ascending: false }).limit(5);
          results = data || [];
        } else if (sq.search_type === "contact") {
          const { data } = await supabase.from("contacts").select("id, full_name, phone, email").ilike("full_name", `%${sq.query}%`).limit(5);
          results = data || [];
        }

        toolData.search_results = results;
        if (results.length > 0) {
          const resultTexts = results.map((r: any) => {
            if (sq.search_type === "lead") return `• ${r.lead_name} (${r.status}) - ${r.lead_phone || "sem tel"}`;
            if (sq.search_type === "activity") return `• ${r.title} (${r.status}/${r.priority}) - ${r.deadline || "sem prazo"} - ${r.assigned_to_name || ""}`;
            return `• ${r.full_name} - ${r.phone || ""} - ${r.email || ""}`;
          });
          responseText += "\n\n📋 Resultados:\n" + resultTexts.join("\n");
        } else {
          responseText += "\n\n🔍 Nenhum resultado encontrado.";
        }
      }

      // ── Productivity Report ──
      if (parsed.productivity_report) {
        const pr = parsed.productivity_report;
        const targetUserId = pr.user_id || config.user_id;
        const targetName = pr.user_name || config.user_name;
        const today = new Date().toISOString().split("T")[0];
        const monthStart = `${today.slice(0, 7)}-01`;
        const todayStart = today + "T00:00:00";
        const todayEnd = today + "T23:59:59";

        // Fetch user's evaluated_metrics from team_members
        const { data: memberEntries } = await supabase
          .from("team_members")
          .select("evaluated_metrics")
          .eq("user_id", targetUserId);
        
        // Union of all evaluated_metrics across all teams the user belongs to
        const evaluatedMetrics = new Set<string>();
        (memberEntries || []).forEach((m: any) => {
          ((m.evaluated_metrics as string[]) || []).forEach((k: string) => evaluatedMetrics.add(k));
        });
        // If no metrics configured, show all by default
        const showAll = evaluatedMetrics.size === 0;
        const hasMetric = (key: string) => showAll || evaluatedMetrics.has(key);

        // Fetch ALL data sources in parallel
        const [
          overdueRes, goalsRes, sessionsRes, allActivitiesRes, snapshotsRes,
          contactsRes, dmsRes, repliesRes, stageHistoryRes, followupsRes,
          leadsRes, catContactsRes, completedActsRes, activityLogRes,
        ] = await Promise.all([
          // Overdue tasks
          supabase.from("lead_activities")
            .select("id, title, deadline, priority, lead_name")
            .eq("assigned_to", targetUserId).eq("status", "pendente")
            .lt("deadline", new Date().toISOString())
            .order("deadline", { ascending: true }).limit(10),
          // Goals
          supabase.from("commission_goals")
            .select("id, metric_key, target_value, period, period_start, period_end")
            .eq("is_active", true)
            .or(`user_id.eq.${targetUserId},user_id.is.null`)
            .order("created_at", { ascending: false }),
          // Sessions today
          supabase.from("user_sessions")
            .select("started_at, ended_at, duration_seconds")
            .eq("user_id", targetUserId)
            .gte("started_at", todayStart)
            .order("started_at", { ascending: false }),
          // Activities this month
          supabase.from("lead_activities")
            .select("id, status, activity_type, completed_at")
            .eq("assigned_to", targetUserId)
            .gte("created_at", monthStart + "T00:00:00"),
          // Daily goal snapshots
          supabase.from("daily_goal_snapshots")
            .select("snapshot_date, progress_percent, achieved, metrics_detail")
            .eq("user_id", targetUserId)
            .gte("snapshot_date", monthStart),
          // Contacts created today
          supabase.from("contacts")
            .select("id")
            .eq("created_by", targetUserId)
            .gte("created_at", todayStart).lte("created_at", todayEnd),
          // DMs sent today
          supabase.from("dm_history")
            .select("id, action_type")
            .eq("user_id", targetUserId)
            .gte("created_at", todayStart).lte("created_at", todayEnd),
          // Comment replies today
          supabase.from("instagram_comments")
            .select("id")
            .eq("replied_by", targetUserId)
            .gte("replied_at", todayStart).lte("replied_at", todayEnd),
          // Stage changes today
          supabase.from("lead_stage_history")
            .select("id, lead_id, to_stage")
            .eq("changed_by", targetUserId)
            .gte("changed_at", todayStart).lte("changed_at", todayEnd),
          // Followups today
          supabase.from("lead_followups")
            .select("id")
            .gte("created_at", todayStart).lte("created_at", todayEnd),
          // Leads created today
          supabase.from("leads")
            .select("id, status")
            .eq("created_by", targetUserId)
            .gte("created_at", todayStart).lte("created_at", todayEnd),
          // Calls today (CAT contacts)
          supabase.from("cat_lead_contacts")
            .select("id, contact_channel")
            .eq("contacted_by", targetUserId)
            .gte("created_at", todayStart).lte("created_at", todayEnd),
          // Completed activities today
          supabase.from("lead_activities")
            .select("id")
            .eq("completed_by", targetUserId).eq("status", "concluida")
            .gte("completed_at", todayStart).lte("completed_at", todayEnd),
          // Activity log today (page visits, checklist)
          supabase.from("user_activity_log")
            .select("id, action_type")
            .eq("user_id", targetUserId)
            .gte("created_at", todayStart).lte("created_at", todayEnd),
        ]);

        const overdue = overdueRes.data || [];
        const goals = goalsRes.data || [];
        const sessions = sessionsRes.data || [];
        const allActs = allActivitiesRes.data || [];
        const snapshots = snapshotsRes.data || [];
        const contacts = contactsRes.data || [];
        const dms = dmsRes.data || [];
        const replies = repliesRes.data || [];
        const stageHistory = stageHistoryRes.data || [];
        const followups = followupsRes.data || [];
        const leadsCreated = leadsRes.data || [];
        const catContacts = catContactsRes.data || [];
        const completedToday = completedActsRes.data || [];
        const activityLog = activityLogRes.data || [];

        // Calculate detailed metrics
        const totalSessionMinutes = sessions.reduce((sum: number, s: any) => sum + (s.duration_seconds || 0), 0) / 60;
        const completedMonth = allActs.filter((a: any) => a.status === "concluida").length;
        const pendingMonth = allActs.filter((a: any) => a.status === "pendente").length;
        const daysAchieved = snapshots.filter((s: any) => s.achieved).length;
        const avgProgress = snapshots.length > 0 ? Math.round(snapshots.reduce((sum: number, s: any) => sum + (s.progress_percent || 0), 0) / snapshots.length) : 0;

        const dmsSent = dms.filter((d: any) => d.action_type !== "received").length;
        const dmsReceived = dms.filter((d: any) => d.action_type === "received").length;
        const callsMade = catContacts.filter((c: any) => c.contact_channel === "phone" || c.contact_channel === "ligacao").length;
        const uniqueLeadsProgressed = new Set(stageHistory.map((s: any) => s.lead_id)).size;
        const CLOSED_STAGES = ["closed", "fechado", "done"];
        const leadsClosed = stageHistory.filter((s: any) => CLOSED_STAGES.includes(s.to_stage)).length;
        const checklistChecked = activityLog.filter((a: any) => a.action_type === "checklist_item_checked").length;

        let report = `📊 *Relatório de Produtividade*\n👤 *${targetName}*\n📅 ${today}\n\n`;

        // ── Today's Metrics ──
        // ── Today's Metrics (filtered by evaluated_metrics) ──
        if (pr.report_type === "full" || pr.report_type === "feedback") {
          report += `📌 *Métricas de Hoje*\n`;
          if (hasMetric("calls")) report += `  📞 Ligações: *${callsMade}*\n`;
          if (hasMetric("dms")) report += `  💬 DMs enviadas: *${dmsSent}*\n`;
          if (hasMetric("dms")) report += `  💬 DMs recebidas: *${dmsReceived}*\n`;
          if (hasMetric("replies")) report += `  💬 Respostas (comentários): *${replies.length}*\n`;
          if (hasMetric("contacts")) report += `  👥 Contatos cadastrados: *${contacts.length}*\n`;
          if (hasMetric("leads")) report += `  📋 Leads cadastrados: *${leadsCreated.length}*\n`;
          if (hasMetric("stage_changes")) report += `  🔄 Mudanças de fase: *${stageHistory.length}*\n`;
          if (hasMetric("stage_changes")) report += `  📈 Leads progredidos: *${uniqueLeadsProgressed}*\n`;
          if (hasMetric("leads_closed")) report += `  🏆 Leads fechados: *${leadsClosed}*\n`;
          if (hasMetric("activities")) report += `  ✅ Atividades concluídas: *${completedToday.length}*\n`;
          if (hasMetric("checklist_items")) report += `  ☑️ Checklist marcados: *${checklistChecked}*\n`;
          report += "\n";
        }

        // ── Session Time ──
        if (pr.report_type === "full" || pr.report_type === "session_time") {
          report += `🕐 *Tempo Online Hoje: ${Math.round(totalSessionMinutes)} min*\n`;
          report += `  📍 Sessões: ${sessions.length}\n\n`;
        }

        // ── Overdue Tasks ──
        if (pr.report_type === "full" || pr.report_type === "overdue_tasks") {
          report += `⚠️ *Tarefas Atrasadas: ${overdue.length}*\n`;
          if (overdue.length > 0) {
            overdue.slice(0, 5).forEach((t: any) => {
              const deadline = t.deadline ? new Date(t.deadline).toLocaleDateString("pt-BR") : "sem prazo";
              report += `  • ${t.title} (${deadline}) ${t.priority === "urgente" ? "🔴" : t.priority === "alta" ? "🟠" : ""}\n`;
            });
            if (overdue.length > 5) report += `  ... e mais ${overdue.length - 5}\n`;
          } else {
            report += `  ✅ Nenhuma tarefa atrasada!\n`;
          }
          report += "\n";
        }

        // ── Goals ──
        if (pr.report_type === "full" || pr.report_type === "goals") {
          report += `🎯 *Metas (${snapshots.length} dias com dados)*\n`;
          report += `  📈 Progresso médio: ${avgProgress}%\n`;
          report += `  ✅ Dias batidos: ${daysAchieved}/${snapshots.length}\n`;
          if (goals.length > 0) {
            report += `  📋 Metas ativas:\n`;
            goals.slice(0, 8).forEach((g: any) => {
              report += `    • ${g.metric_key}: alvo *${g.target_value}* (${g.period})\n`;
            });
          }
          report += "\n";
        }

        // ── Monthly Summary & Feedback ──
        if (pr.report_type === "full" || pr.report_type === "feedback") {
          report += `📋 *Atividades do Mês*\n`;
          report += `  ✅ Concluídas: ${completedMonth}\n`;
          report += `  ⏳ Pendentes: ${pendingMonth}\n`;
          report += `  ⚠️ Atrasadas: ${overdue.length}\n\n`;

          report += `💡 *Pontos de Atenção*\n`;
          if (overdue.length > 3) report += `  🔴 Muitas tarefas atrasadas (${overdue.length}). Priorize as mais urgentes.\n`;
          if (overdue.length === 0 && completedToday.length > 0) report += `  🟢 Excelente! Sem atrasos e com entregas hoje.\n`;
          if (hasMetric("session_minutes") && totalSessionMinutes < 120 && sessions.length > 0) report += `  🟡 Tempo online baixo hoje (${Math.round(totalSessionMinutes)} min).\n`;
          if (avgProgress < 50 && snapshots.length > 5) report += `  🟠 Progresso médio abaixo de 50%. Revise prioridades.\n`;
          if (daysAchieved > snapshots.length * 0.7) report += `  🌟 Ótima consistência! Metas batidas em ${daysAchieved}/${snapshots.length} dias.\n`;
          const noProspecting = (!hasMetric("dms") || dmsSent === 0) && (!hasMetric("calls") || callsMade === 0) && (!hasMetric("contacts") || contacts.length === 0);
          if (noProspecting && (hasMetric("dms") || hasMetric("calls") || hasMetric("contacts"))) report += `  🟡 Nenhuma ação de prospecção registrada hoje.\n`;
          if (hasMetric("calls") && callsMade >= 5) report += `  🟢 Bom volume de ligações hoje (${callsMade}).\n`;
          if (hasMetric("dms") && dmsSent >= 10) report += `  🟢 Bom volume de DMs enviadas (${dmsSent}).\n`;
          
          if (!showAll) {
            const metricLabels: Record<string, string> = { replies: "Respostas", dms: "DMs", leads: "Leads", session_minutes: "Tempo de sessão", contacts: "Contatos", calls: "Ligações", activities: "Atividades", stage_changes: "Fases", leads_closed: "Fechados", checklist_items: "Passos" };
            const activeList = Array.from(evaluatedMetrics).map(k => metricLabels[k] || k).join(", ");
            report += `\n📋 _Métricas avaliadas: ${activeList}_\n`;
          }
        }

        toolData.productivity_report = {
          overdue: overdue.length, completed_month: completedMonth, pending: pendingMonth,
          session_minutes: Math.round(totalSessionMinutes), avg_progress: avgProgress,
          today: { calls: callsMade, dms_sent: dmsSent, dms_received: dmsReceived, replies: replies.length,
            contacts: contacts.length, leads_created: leadsCreated.length, stage_changes: stageHistory.length,
            leads_progressed: uniqueLeadsProgressed, leads_closed: leadsClosed,
            activities_completed: completedToday.length, checklist: checklistChecked, followups: followups.length },
        };
        responseText = report;
      }
    }

    // 5) Save AI response
    await supabase.from("whatsapp_command_history").insert({
      phone: normalizedPhone, instance_name, role: "assistant", content: responseText, tool_data: toolData,
    });

    // 6) Send response via WhatsApp (inst already fetched above)
    if (instToken) {
      try {
        await sendWhatsAppText(baseUrl, instToken, normalizedPhone, `🤖 *WhatsJUD IA*\n\n${responseText}`);
        console.log("Response sent to WhatsApp:", normalizedPhone);
      } catch (e) {
        console.error("Error sending response:", e);
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
