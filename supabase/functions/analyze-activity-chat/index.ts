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
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const MAX_FILE_SIZE = 4 * 1024 * 1024; // 4MB limit to prevent WORKER_LIMIT

async function fetchFileAsBase64(url: string): Promise<{ base64: string; mimeType: string } | null> {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const contentLength = resp.headers.get("content-length");
    if (contentLength && parseInt(contentLength) > MAX_FILE_SIZE) {
      console.warn(`File too large (${contentLength} bytes), skipping: ${url}`);
      return null;
    }
    const buffer = await resp.arrayBuffer();
    if (buffer.byteLength > MAX_FILE_SIZE) {
      console.warn(`File too large after download (${buffer.byteLength} bytes), skipping`);
      return null;
    }
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
      binary += String.fromCharCode(...chunk);
    }
    const base64 = btoa(binary);
    const mimeType = resp.headers.get("content-type") || "application/octet-stream";
    return { base64, mimeType };
  } catch (e) {
    console.error("Error fetching file:", url, e);
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const { messages, mode, context, action } = body;

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

    // ==========================================
    // Mode: summarize_text
    // ==========================================
    if (action === "summarize_text") {
      const { text, context: summaryContext } = body;
      if (!text) {
        return new Response(JSON.stringify({ error: "text required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const summaryData = await geminiChat({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "Você é um assistente que resume transcrições de ligações telefônicas. Gere um resumo conciso e objetivo em português, destacando: pontos principais discutidos, decisões tomadas, próximos passos acordados. Seja direto e use bullet points quando apropriado." },
          { role: "user", content: `${summaryContext ? `Contexto: ${summaryContext}\n\n` : ''}Transcrição:\n${text}` },
        ],
        temperature: 0.3,
        max_tokens: 1000,
      });

      const summaryText = summaryData?.choices?.[0]?.message?.content || "Não foi possível gerar o resumo.";

      return new Response(JSON.stringify({ summary: summaryText }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ==========================================
    // Mode: transcribe_call
    // ==========================================
    if (action === "transcribe_call") {
      const { audio_url, call_record_id, phone } = body;
      if (!audio_url) {
        return new Response(JSON.stringify({ error: "audio_url required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (!LOVABLE_API_KEY) {
        return new Response(JSON.stringify({ success: false, error: "LOVABLE_API_KEY not configured" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const supabaseUrl = RESOLVED_SUPABASE_URL;
      const supabaseKey = RESOLVED_SERVICE_ROLE_KEY;
      const supabase = createClient(supabaseUrl, supabaseKey);

      const fileData = await fetchFileAsBase64(audio_url);
      if (!fileData) {
        return new Response(JSON.stringify({ success: false, error: "Could not fetch audio file" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      let leadContext = "";
      let leadId: string | null = null;
      let contactId: string | null = null;
      let callResult: string | null = null;

      if (call_record_id) {
        const { data: callRecord } = await supabase
          .from("call_records")
          .select("lead_id, contact_id, contact_name, contact_phone, call_result")
          .eq("id", call_record_id)
          .single();

        callResult = callRecord?.call_result || null;

        if (callRecord?.lead_id) {
          leadId = callRecord.lead_id;
          const { data: lead } = await supabase
            .from("leads")
            .select("lead_name, city, state, neighborhood, victim_name, victim_age, accident_date, damage_description, contractor_company, main_company, sector, case_type, accident_address, visit_city, visit_state, acolhedor")
            .eq("id", leadId)
            .single();
          if (lead) {
            leadContext = `\n\nDados atuais do Lead:\n${JSON.stringify(lead, null, 2)}`;
          }
        }
        if (callRecord?.contact_id) {
          contactId = callRecord.contact_id;
          const { data: contact } = await supabase
            .from("contacts")
            .select("full_name, phone, email, city, state, neighborhood, profession")
            .eq("id", contactId)
            .single();
          if (contact) {
            leadContext += `\n\nDados atuais do Contato:\n${JSON.stringify(contact, null, 2)}`;
          }
        }
      }

      const transcribePrompt = `Você recebeu uma gravação de áudio de uma ligação telefônica de um escritório de advocacia trabalhista.

Faça o seguinte:
1. Transcreva o áudio completo
2. Faça um resumo objetivo em bullet points
3. Identifique os próximos passos mencionados
4. Identifique informações mencionadas na ligação que possam atualizar campos do lead ou contato (cidade, estado, bairro, nome da vítima, idade, data do acidente, empresa, tipo de caso, profissão, etc.)
${leadContext}

Responda em português do Brasil.`;

      const contentParts: any[] = [
        { type: "text", text: transcribePrompt },
        { type: "input_audio", input_audio: { data: fileData.base64, format: "wav" } },
      ];

      const aiData = await geminiChat({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "Você é um assistente jurídico que transcreve e resume ligações telefônicas e extrai informações para atualizar o CRM." },
          { role: "user", content: contentParts },
        ],
        tools: [{
          type: "function",
          function: {
            name: "save_transcription_and_suggestions",
            description: "Salva a transcrição, resumo e sugestões de atualização de campos",
            parameters: {
              type: "object",
              properties: {
                transcript: { type: "string", description: "Transcrição completa do áudio" },
                summary: { type: "string", description: "Resumo objetivo em bullet points" },
                next_steps: { type: "string", description: "Próximos passos identificados" },
                field_suggestions: {
                  type: "array",
                  description: "Sugestões de atualização de campos do lead ou contato mencionados na ligação.",
                  items: {
                    type: "object",
                    properties: {
                      entity_type: { type: "string", enum: ["lead", "contact"] },
                      field_name: { type: "string" },
                      field_label: { type: "string" },
                      suggested_value: { type: "string" },
                    },
                    required: ["entity_type", "field_name", "field_label", "suggested_value"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["transcript", "summary", "next_steps", "field_suggestions"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "save_transcription_and_suggestions" } },
      });

      let transcript = "";
      let summary = "";
      let nextSteps = "";
      let fieldSuggestions: any[] = [];

      const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
      if (toolCall?.function?.arguments) {
        const parsed = JSON.parse(toolCall.function.arguments);
        transcript = parsed.transcript || "";
        summary = parsed.summary || "";
        nextSteps = parsed.next_steps || "";
        fieldSuggestions = parsed.field_suggestions || [];
      } else {
        transcript = aiData.choices?.[0]?.message?.content || "";
        summary = transcript;
      }

      if (call_record_id && (transcript || summary)) {
        await supabase
          .from("call_records")
          .update({
            ai_transcript: transcript,
            ai_summary: summary,
            next_step: nextSteps,
          })
          .eq("id", call_record_id);
      }

      const skipSuggestions = callResult === "nao_atendeu" || callResult === "caixa_postal";
      if (skipSuggestions) {
        console.log(`Skipping field suggestions: call_result=${callResult}`);
      }

      if (call_record_id && fieldSuggestions.length > 0 && (leadId || contactId) && !skipSuggestions) {
        let leadData: any = null;
        let contactData: any = null;

        if (leadId) {
          const { data } = await supabase.from("leads").select("*").eq("id", leadId).single();
          leadData = data;
        }
        if (contactId) {
          const { data } = await supabase.from("contacts").select("*").eq("id", contactId).single();
          contactData = data;
        }

        const suggestions = fieldSuggestions
          .filter((s: any) => {
            const entityId = s.entity_type === "lead" ? leadId : contactId;
            return entityId != null;
          })
          .map((s: any) => {
            const entityId = s.entity_type === "lead" ? leadId : contactId;
            const entityData = s.entity_type === "lead" ? leadData : contactData;
            const currentValue = entityData?.[s.field_name] ?? null;
            if (currentValue && String(currentValue).toLowerCase() === String(s.suggested_value).toLowerCase()) {
              return null;
            }
            return {
              call_record_id,
              entity_type: s.entity_type,
              entity_id: entityId,
              field_name: s.field_name,
              field_label: s.field_label,
              current_value: currentValue ? String(currentValue) : null,
              suggested_value: s.suggested_value,
              status: "pending",
            };
          })
          .filter(Boolean);

        if (suggestions.length > 0) {
          const { error: sugError } = await supabase.from("call_field_suggestions").insert(suggestions);
          if (sugError) console.error("Error saving field suggestions:", sugError);
          else console.log(`Saved ${suggestions.length} field suggestions for review`);
        }
      }

      return new Response(JSON.stringify({ success: true, transcript, summary, next_steps: nextSteps, suggestions_count: fieldSuggestions.length }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    // ==========================================
    // Mode: assistant — conversational AI that guides, suggests actions, and fills fields
    // ==========================================
    if (mode === "assistant") {
      const { chat_history, activity_context, lead_context, contact_context, activity_history } = context || {};

      // Fetch registered users (assessors) and activity types from DB
      const supabaseUrl = RESOLVED_SUPABASE_URL;
      const supabaseKey = RESOLVED_SERVICE_ROLE_KEY;
      const sb = createClient(supabaseUrl, supabaseKey);

      const [profilesRes, typesRes] = await Promise.all([
        sb.from("profiles").select("user_id, full_name").order("full_name"),
        sb.from("activity_types").select("key, label").eq("is_active", true).order("display_order"),
      ]);

      const assessors = (profilesRes.data || []).filter((p: any) => p.full_name);
      const actTypes = (typesRes.data || []);
      const assessorsList = assessors.map((a: any) => `- "${a.full_name}" (id: ${a.user_id})`).join("\n");
      const actTypesList = actTypes.map((t: any) => `"${t.key}" (${t.label})`).join(", ");
      const actTypeKeys = actTypes.map((t: any) => t.key);

      const systemPrompt = `Você é o assistente IA de um CRM jurídico trabalhista (Abraci). Você está conversando com um assessor sobre uma atividade/caso.

CONTEXTO ATUAL:
${activity_context ? `Atividade: ${JSON.stringify(activity_context)}` : 'Sem atividade vinculada'}
${lead_context ? `Lead/Caso: ${JSON.stringify(lead_context)}` : 'Sem lead vinculado'}
${contact_context ? `Contato: ${JSON.stringify(contact_context)}` : 'Sem contato vinculado'}
${activity_history?.length ? `Histórico de atividades recentes do lead:\n${activity_history.map((a: any) => `- ${a.title} (${a.status}) - ${a.activity_type} - ${a.deadline || ''} - ${a.what_was_done || ''}`).join('\n')}\n\nTotal de atividades pendentes: ${activity_history.filter((a: any) => a.status === 'pendente').length}\nTotal em andamento: ${activity_history.filter((a: any) => a.status === 'em_andamento').length}\nTotal concluídas: ${activity_history.filter((a: any) => a.status === 'concluida').length}` : ''}

ASSESSORES CADASTRADOS (usuários do sistema):
${assessorsList}
- Quando o assessor mencionar um nome, identifique qual assessor cadastrado corresponde
- Se houver dúvida (nome ambíguo ou parcial), pergunte qual assessor ele quis dizer
- Use o user_id para preencher o campo assigned_to e o full_name para assigned_to_name

TIPOS DE ATIVIDADE DISPONÍVEIS: ${actTypesList}

SEU PAPEL:
1. Guie o assessor sobre como prosseguir com o caso
2. Responda dúvidas sobre procedimentos jurídicos trabalhistas
3. Sugira próximos passos baseados no contexto
4. Quando o assessor fornecer informações sobre o andamento, ofereça organizar nos campos corretos
5. Ao criar atividades, SEMPRE classifique na Matriz de Eisenhower (do_now, schedule, delegate, eliminate) com base na urgência e importância
6. Analise a carga de trabalho atual (atividades pendentes/em andamento) e sugira datas adequadas para novas atividades, evitando sobrecarga
7. Se houver muitas atividades pendentes, alerte o assessor e sugira priorização
8. QUANDO RECEBER UM COMANDO DE VOZ (mensagem com prefixo [COMANDO DE VOZ]), EXECUTE IMEDIATAMENTE a ação solicitada. NÃO peça confirmação, NÃO faça perguntas — extraia todas as informações do texto e crie a atividade usando new_activity com TODOS os campos preenchidos. Se faltar informação, use valores padrão sensatos.
9. Se o assessor iniciar uma conversa sem atividade vinculada e sem comando de voz, pergunte sobre o que precisa ser feito e crie a atividade com todos os campos preenchidos
9. TODA atividade DEVE ter prazo (deadline) e data de notificação (notification_date). A notificação geralmente é 1 dia antes do prazo. Use formato YYYY-MM-DDTHH:mm.
10. Sugira leads e contatos para vincular à atividade quando o contexto indicar (suggested_lead_name, suggested_contact_name)
11. Preencha TODOS os campos possíveis: descrição (notes), o que foi feito (what_was_done), observações (current_status_notes) e próximos passos (next_steps)
12. Quando o assessor mencionar alguém para atribuir a atividade, identifique o assessor cadastrado e preencha assigned_to (user_id) e assigned_to_name

MATRIZ DE EISENHOWER:
- do_now (🔥 Faça Agora): Urgente + Importante — prazos judiciais próximos, audiências iminentes
- schedule (📅 Agende): Não urgente + Importante — acompanhamentos, preparação de documentos
- delegate (🤝 Delegue): Urgente + Pouco importante — tarefas administrativas urgentes
- eliminate (🗑️ Retire): Não urgente + Pouco importante — tarefas que podem ser eliminadas

DATA ATUAL: ${new Date().toISOString().split('T')[0]} (use esta data como referência para todas as datas — NUNCA use anos anteriores como 2024 ou 2025)

IMPORTANTE:
- Seja conciso e objetivo (máximo 3-4 parágrafos)
- Use linguagem profissional mas acessível
- Quando identificar informações que podem preencher campos, use a ferramenta disponível
- Sempre que criar uma nova atividade, inclua o quadrante da matriz de Eisenhower (matrix_quadrant)
- SEMPRE inclua deadline e notification_date ao criar atividades — use o ANO ATUAL (${new Date().getFullYear()})
- NUNCA sugira datas em sábados, domingos ou feriados nacionais brasileiros. Se a data calculada cair em fim de semana ou feriado, avance para o próximo dia útil
- Sugira datas realistas considerando a carga de trabalho atual
- Responda em português do Brasil

SUGESTÕES DE CONTINUAÇÃO (OBRIGATÓRIO):
- SEMPRE inclua 2-4 sugestões de continuação no campo "follow_up_suggestions" da ferramenta
- Cada sugestão tem "label" (texto curto do botão, max 25 chars, com emoji) e "message" (texto completo que o usuário enviaria)
- As sugestões devem ser frases completas e autossuficientes — ao ser enviada, você deve conseguir agir sem pedir mais informações
- Cubra cenários como: detalhes faltantes, próximos passos, criação de atividades com campos completos, atualização de status
- Sempre que possível, inclua dados concretos (datas, tipos, prioridades, matriz) nas sugestões para preencher todos os campos automaticamente
- Exemplo: label="📅 Agendar para amanhã", message="Agende reunião com o cliente para amanhã às 14h, prioridade normal, tipo reunião, matriz Agende"
- Adapte as sugestões ao contexto atual da conversa e da atividade`;

      // Build conversation for AI
      const aiMessages: any[] = [
        { role: "system", content: systemPrompt },
      ];

      // Add chat history (limit media to last 3 to save memory)
      if (chat_history && Array.isArray(chat_history)) {
        let mediaCount = 0;
        const MAX_MEDIA = 3;
        // Process in reverse to prioritize recent media, then re-reverse
        const reversedHistory = [...chat_history].reverse();
        const processedReverse: any[] = [];
        
        for (const msg of reversedHistory) {
          if (msg.role === "ai") {
            processedReverse.push({ role: "assistant", content: msg.content });
            continue;
          }
          
          const hasMedia = (msg.type === "audio" || msg.type === "image" || msg.type === "pdf") && msg.file_url;
          
          if (hasMedia && mediaCount < MAX_MEDIA) {
            const fileData = await fetchFileAsBase64(msg.file_url);
            if (fileData) {
              mediaCount++;
              if (msg.type === "audio") {
                processedReverse.push({
                  role: "user",
                  content: [
                    { type: "text", text: msg.content || "Áudio enviado:" },
                    { type: "input_audio", input_audio: { data: fileData.base64, format: "wav" } },
                  ],
                });
              } else {
                processedReverse.push({
                  role: "user",
                  content: [
                    { type: "text", text: msg.content || `${msg.type === "image" ? "Imagem" : "Documento"} enviado:` },
                    { type: "image_url", image_url: { url: `data:${fileData.mimeType};base64,${fileData.base64}` } },
                  ],
                });
              }
              continue;
            }
          } else if (hasMedia) {
            // Skip media beyond limit, just add text reference
            processedReverse.push({ role: "user", content: msg.content || `[${msg.type} enviado: ${msg.file_name || 'arquivo'}]` });
            continue;
          }
          
          processedReverse.push({ role: "user", content: msg.content || "" });
        }
        
        // Re-reverse to restore original order
        aiMessages.push(...processedReverse.reverse());
      }

      const tools = [
        {
          type: "function",
          function: {
            name: "suggest_field_updates",
            description: "Sugere atualizações para campos da atividade, lead e/ou contato com base na conversa. Use quando o assessor fornecer informações que devem ser registradas nos campos do sistema.",
            parameters: {
              type: "object",
              properties: {
                response_text: { type: "string", description: "Texto da resposta conversacional para o assessor" },
                activity_fields: {
                  type: "object",
                  description: "Campos da atividade para atualizar",
                  properties: {
                    title: { type: "string" },
                    what_was_done: { type: "string" },
                    current_status_notes: { type: "string" },
                    next_steps: { type: "string" },
                    notes: { type: "string" },
                    priority: { type: "string", enum: ["baixa", "normal", "alta", "urgente"] },
                    activity_type: { type: "string", enum: actTypeKeys.length > 0 ? actTypeKeys : ["tarefa", "audiencia", "prazo", "acompanhamento", "reuniao", "diligencia"] },
                  },
                  additionalProperties: false,
                },
                lead_fields: {
                  type: "object",
                  description: "Campos do lead para atualizar. Só inclua se mencionados na conversa.",
                  properties: {
                    city: { type: "string" },
                    state: { type: "string" },
                    neighborhood: { type: "string" },
                    victim_name: { type: "string" },
                    victim_age: { type: "string" },
                    accident_date: { type: "string" },
                    damage_description: { type: "string" },
                    contractor_company: { type: "string" },
                    main_company: { type: "string" },
                    sector: { type: "string" },
                    case_type: { type: "string" },
                    accident_address: { type: "string" },
                  },
                  additionalProperties: false,
                },
                contact_fields: {
                  type: "object",
                  description: "Campos do contato para atualizar. Só inclua se mencionados na conversa.",
                  properties: {
                    phone: { type: "string" },
                    email: { type: "string" },
                    city: { type: "string" },
                    state: { type: "string" },
                    neighborhood: { type: "string" },
                    profession: { type: "string" },
                    cep: { type: "string" },
                  },
                  additionalProperties: false,
                },
                new_activity: {
                  type: "object",
                  description: "Sugere criação de uma nova atividade. Use quando o assessor mencionar uma tarefa futura ou quando estiver criando uma atividade via chat. SEMPRE inclua matrix_quadrant. SEMPRE inclua deadline (prazo da atividade) e notification_date (data de notificação/lembrete, geralmente 1 dia antes do deadline). Sugira lead_name e contact_name quando o contexto indicar. Quando o assessor mencionar um nome para atribuir, identifique o assessor cadastrado e preencha assigned_to e assigned_to_name.",
                  properties: {
                    title: { type: "string" },
                    activity_type: { type: "string", enum: actTypeKeys.length > 0 ? actTypeKeys : ["tarefa", "audiencia", "prazo", "acompanhamento", "reuniao", "diligencia"] },
                    priority: { type: "string", enum: ["baixa", "normal", "alta", "urgente"] },
                    assigned_to: { type: "string", description: "user_id do assessor responsável pela atividade. Use o ID da lista de assessores cadastrados." },
                    assigned_to_name: { type: "string", description: "Nome completo do assessor responsável pela atividade." },
                    what_was_done: { type: "string" },
                    current_status_notes: { type: "string" },
                    next_steps: { type: "string" },
                    notes: { type: "string" },
                    deadline: { type: "string", description: "Prazo da atividade no formato YYYY-MM-DDTHH:mm. OBRIGATÓRIO." },
                    notification_date: { type: "string", description: "Data de notificação/lembrete no formato YYYY-MM-DDTHH:mm. Geralmente 1 dia antes do deadline." },
                    matrix_quadrant: { type: "string", enum: ["do_now", "schedule", "delegate", "eliminate"], description: "Quadrante da Matriz de Eisenhower" },
                    suggested_lead_name: { type: "string", description: "Nome do lead sugerido para vincular, se mencionado no contexto" },
                    suggested_contact_name: { type: "string", description: "Nome do contato sugerido para vincular, se mencionado no contexto" },
                  },
                  required: ["title", "matrix_quadrant", "deadline", "notification_date"],
                  additionalProperties: false,
                },
                follow_up_suggestions: {
                  type: "array",
                  description: "OBRIGATÓRIO: 2-4 sugestões de continuação da conversa. Cada sugestão é um botão clicável que preenche o campo de texto do usuário.",
                  items: {
                    type: "object",
                    properties: {
                      label: { type: "string", description: "Texto curto do botão (max 25 chars, com emoji). Ex: '📅 Agendar para amanhã'" },
                      message: { type: "string", description: "Texto completo que será enviado como mensagem do usuário ao clicar. Deve ser autossuficiente." },
                    },
                    required: ["label", "message"],
                    additionalProperties: false,
                  },
                  minItems: 2,
                  maxItems: 4,
                },
              },
              required: ["response_text", "follow_up_suggestions"],
              additionalProperties: false,
            },
          },
        },
      ];

      const aiData = await geminiChat({
        model: "google/gemini-2.5-flash",
        messages: aiMessages,
        tools,
      });

      const choice = aiData.choices?.[0]?.message;

      // Check if AI used tool calling
      const toolCall = choice?.tool_calls?.[0];
      if (toolCall?.function?.name === "suggest_field_updates") {
        const parsed = JSON.parse(toolCall.function.arguments);
        return new Response(JSON.stringify({
          response_text: parsed.response_text || "",
          activity_fields: parsed.activity_fields || null,
          lead_fields: parsed.lead_fields || null,
          contact_fields: parsed.contact_fields || null,
          new_activity: parsed.new_activity || null,
          follow_up_suggestions: parsed.follow_up_suggestions || null,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Plain text response
      return new Response(JSON.stringify({
        response_text: choice?.content || "Desculpe, não consegui processar sua mensagem.",
        activity_fields: null,
        lead_fields: null,
        contact_fields: null,
        new_activity: null,
        follow_up_suggestions: null,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ==========================================
    // Mode: describe_file
    // ==========================================
    if (mode === "describe_file") {
      const { file_url: fUrl, file_type: fType, file_name: fName, audio_duration: fDuration, custom_prompt: customPrompt, max_chars: maxChars } = context || {};

      const charLimit = maxChars || 600;
      const lengthInstruction = `\nIMPORTANTE: O resumo deve ter no máximo ${charLimit} caracteres (aproximadamente ${Math.round(charLimit / 70)} linhas). Seja conciso e direto.`;
      const customInstruction = customPrompt ? `\nInstruções adicionais do usuário: ${customPrompt}` : '';

      let descriptionPrompt = "";
      const contentParts: any[] = [];

      if (fType === "audio" && fUrl) {
        descriptionPrompt = `Você recebeu uma gravação de áudio${fDuration ? ` com duração de ${Math.floor(fDuration / 60)}min ${fDuration % 60}s` : ''}. 
Transcreva o áudio e faça um resumo objetivo da ligação/conversa em formato de bullet points. 
Inclua: participantes identificados, assuntos tratados, decisões tomadas e próximos passos mencionados.
Responda em português do Brasil.${lengthInstruction}${customInstruction}`;
        const fileData = await fetchFileAsBase64(fUrl);
        if (fileData) {
          contentParts.push({
            type: "input_audio",
            input_audio: { data: fileData.base64, format: "wav" }
          });
        }
      } else if (fType === "image" && fUrl) {
        descriptionPrompt = `Você recebeu uma imagem chamada "${fName || 'imagem'}". 
Descreva o conteúdo da imagem de forma objetiva. Se for um documento, extraia o texto. Se for uma captura de tela de conversa, resuma os pontos principais.
Responda em português do Brasil.${lengthInstruction}${customInstruction}`;
        const fileData = await fetchFileAsBase64(fUrl);
        if (fileData) {
          contentParts.push({
            type: "image_url",
            image_url: { url: `data:${fileData.mimeType};base64,${fileData.base64}` }
          });
        }
      } else if (fType === "pdf" && fUrl) {
        descriptionPrompt = `Você recebeu um documento PDF chamado "${fName || 'documento'}". 
Analise o conteúdo do documento e faça um resumo objetivo dos pontos principais. Se for um documento jurídico, destaque prazos, partes envolvidas e obrigações.
Responda em português do Brasil.${lengthInstruction}${customInstruction}`;
        const fileData = await fetchFileAsBase64(fUrl);
        if (fileData) {
          contentParts.push({
            type: "image_url",
            image_url: { url: `data:${fileData.mimeType};base64,${fileData.base64}` }
          });
        }
      }

      if (contentParts.length === 0) {
        return new Response(JSON.stringify({ description: "Não foi possível analisar o arquivo." }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const userContent: any[] = [{ type: "text", text: descriptionPrompt }, ...contentParts];

      const descData = await geminiChat({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "Você é um assistente jurídico de um CRM de advocacia trabalhista. Analise o arquivo recebido e forneça uma descrição/resumo útil." },
          { role: "user", content: userContent },
        ],
      });

      const description = descData.choices?.[0]?.message?.content || "Não foi possível gerar uma descrição.";

      return new Response(JSON.stringify({ description }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ==========================================
    // Mode: suggest_actions
    // ==========================================
    if (mode === "suggest_actions" && context) {
      const actionsPrompt = `Você é um assistente jurídico de um CRM de advocacia trabalhista. Com base no contexto abaixo, gere exatamente 3 ações práticas e objetivas que o usuário pode tomar agora para dar continuidade ao caso.

Contexto da Atividade:
- Título: ${context.activity_title || 'N/A'}
- Tipo: ${context.activity_type || 'N/A'}
- O que foi feito: ${context.what_was_done || 'Nada registrado'}
- Status atual: ${context.current_status_notes || 'Não informado'}
- Próximo passo: ${context.next_steps || 'Não definido'}
- Observações: ${context.notes || 'Nenhuma'}

${context.lead_name ? `Lead: ${context.lead_name}` : ''}
${context.case_type ? `Tipo de caso: ${context.case_type}` : ''}
${context.lead_status ? `Status do lead: ${context.lead_status}` : ''}
${context.contact_name ? `Contato: ${context.contact_name}` : ''}
${context.contact_phone ? `Telefone: ${context.contact_phone}` : ''}

Cada ação deve ser uma frase curta (máximo 15 palavras) e começar com um verbo de ação. Pense em ações como: ligar para o contato, enviar documentação, agendar reunião, verificar prazo, etc.`;

      const actionsData = await geminiChat({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "Retorne exatamente 3 ações práticas." },
          { role: "user", content: actionsPrompt },
        ],
        tools: [{
          type: "function",
          function: {
            name: "suggest_actions",
            description: "Retorna 3 sugestões de ação",
            parameters: {
              type: "object",
              properties: {
                actions: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      label: { type: "string" },
                      detail: { type: "string" },
                      icon: { type: "string", enum: ["phone", "document", "meeting", "email", "check", "search"] },
                    },
                    required: ["label", "detail", "icon"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["actions"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "suggest_actions" } },
      });

      const toolCall = actionsData.choices?.[0]?.message?.tool_calls?.[0];
      let actions = [];
      if (toolCall?.function?.arguments) {
        const parsed = JSON.parse(toolCall.function.arguments);
        actions = parsed.actions || [];
      }

      return new Response(JSON.stringify({ actions: actions.slice(0, 3) }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ==========================================
    // Default: analyze chat messages (fill activity fields)
    // ==========================================
    const systemPrompt = `Você é um assistente jurídico que analisa conversas de chat de atividades de um CRM de advocacia trabalhista.

Analise TODAS as mensagens do chat, incluindo o conteúdo de áudios transcritos, imagens analisadas e documentos PDF.

Você DEVE retornar um JSON com exatamente estes campos:
- what_was_done: string (resumo do que foi feito/discutido)
- current_status_notes: string (status atual da situação)
- next_steps: string (próximos passos identificados)
- notes: string (observações adicionais relevantes)

Seja conciso mas completo. Use linguagem profissional. Se algum campo não tiver informação suficiente, deixe como string vazia.

IMPORTANTE: Retorne APENAS o JSON, sem markdown, sem código, sem explicações.`;

    const contentParts: any[] = [];
    let textSummary = "Analise estas mensagens de chat e extraia as informações:\n\n";
    let mediaCount = 0;
    const MAX_MEDIA_DEFAULT = 3;
    
    for (const m of messages) {
      const senderLabel = m.sender_name || 'Usuário';
      
      if (m.message_type === 'text') {
        textSummary += `[${senderLabel}]: ${m.content || ''}\n`;
      } else if (m.message_type === 'ai_suggestion') {
        continue;
      } else if (m.file_url && mediaCount < MAX_MEDIA_DEFAULT) {
        const fileData = await fetchFileAsBase64(m.file_url);
        if (fileData) {
          mediaCount++;
          if (m.message_type === 'audio') {
            textSummary += `[${senderLabel}] enviou um áudio (${m.audio_duration || '?'}s):\n`;
            contentParts.push({ type: "input_audio", input_audio: { data: fileData.base64, format: "wav" } });
          } else {
            textSummary += `[${senderLabel}] enviou ${m.message_type === 'image' ? 'uma imagem' : 'um documento'} (${m.file_name || 'arquivo'}):\n`;
            contentParts.push({ type: "image_url", image_url: { url: `data:${fileData.mimeType};base64,${fileData.base64}` } });
          }
        }
      } else if (m.file_url) {
        textSummary += `[${senderLabel}] enviou ${m.message_type} (${m.file_name || 'arquivo'}) [não processado por limite]\n`;
      }
    }

    const userContent: any[] = [{ type: "text", text: textSummary }, ...contentParts];

    const data = await geminiChat({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "fill_activity_fields",
            description: "Preenche os campos da atividade com base no chat",
            parameters: {
              type: "object",
              properties: {
                what_was_done: { type: "string" },
                current_status_notes: { type: "string" },
                next_steps: { type: "string" },
                notes: { type: "string" },
              },
              required: ["what_was_done", "current_status_notes", "next_steps", "notes"],
              additionalProperties: false,
            },
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "fill_activity_fields" } },
    });

    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    let suggestion;
    if (toolCall?.function?.arguments) {
      suggestion = JSON.parse(toolCall.function.arguments);
    } else {
      const content = data.choices?.[0]?.message?.content || '{}';
      suggestion = JSON.parse(content);
    }

    return new Response(JSON.stringify({ suggestion }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("analyze-activity-chat error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
