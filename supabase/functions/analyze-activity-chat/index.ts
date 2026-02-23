import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function fetchFileAsBase64(url: string): Promise<{ base64: string; mimeType: string } | null> {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const buffer = await resp.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
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

    // Mode: transcribe_call — transcribe audio and save AI summary to call_records
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

      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const supabase = createClient(supabaseUrl, supabaseKey);

      // Fetch audio and transcribe with AI
      const fileData = await fetchFileAsBase64(audio_url);
      if (!fileData) {
        return new Response(JSON.stringify({ success: false, error: "Could not fetch audio file" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Get lead/contact context for field extraction
      let leadContext = "";
      let leadId: string | null = null;
      let contactId: string | null = null;

      if (call_record_id) {
        const { data: callRecord } = await supabase
          .from("call_records")
          .select("lead_id, contact_id, contact_name, contact_phone")
          .eq("id", call_record_id)
          .single();

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

      const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
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
                    description: "Sugestões de atualização de campos do lead ou contato mencionados na ligação. Só inclua se a informação for CLARAMENTE mencionada.",
                    items: {
                      type: "object",
                      properties: {
                        entity_type: { type: "string", enum: ["lead", "contact"], description: "Se é campo do lead ou do contato" },
                        field_name: { type: "string", description: "Nome do campo no banco (ex: city, state, victim_name, profession)" },
                        field_label: { type: "string", description: "Nome amigável do campo em português (ex: Cidade, Estado, Nome da Vítima)" },
                        suggested_value: { type: "string", description: "Valor sugerido baseado na ligação" },
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
        }),
      });

      let transcript = "";
      let summary = "";
      let nextSteps = "";
      let fieldSuggestions: any[] = [];

      if (aiResponse.ok) {
        const aiData = await aiResponse.json();
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
      } else {
        console.error("AI transcription error:", aiResponse.status, await aiResponse.text());
      }

      // Update call_record
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

      // Save field suggestions for user confirmation
      if (call_record_id && fieldSuggestions.length > 0 && (leadId || contactId)) {
        // Get current values for each suggestion
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
            // Skip if value is the same
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

    // Mode: describe_file - auto-analyze a single uploaded file (image, pdf, audio)
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

      const descResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: "Você é um assistente jurídico de um CRM de advocacia trabalhista. Analise o arquivo recebido e forneça uma descrição/resumo útil." },
            { role: "user", content: userContent },
          ],
        }),
      });

      if (!descResponse.ok) {
        const t = await descResponse.text();
        console.error("AI describe error:", descResponse.status, t);
        return new Response(JSON.stringify({ description: "Erro ao analisar arquivo com IA." }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const descData = await descResponse.json();
      const description = descData.choices?.[0]?.message?.content || "Não foi possível gerar uma descrição.";

      return new Response(JSON.stringify({ description }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Mode: suggest_actions
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

      const actionsResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
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
                        label: { type: "string", description: "Ação curta (ex: Ligar para o contato)" },
                        detail: { type: "string", description: "Detalhe breve do que fazer" },
                        icon: { type: "string", enum: ["phone", "document", "meeting", "email", "check", "search"], description: "Ícone da ação" },
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
        }),
      });

      if (!actionsResponse.ok) {
        const t = await actionsResponse.text();
        console.error("AI actions error:", actionsResponse.status, t);
        return new Response(JSON.stringify({ actions: [] }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const actionsData = await actionsResponse.json();
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

    // Default: analyze chat messages
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
    
    for (const m of messages) {
      const senderLabel = m.sender_name || 'Usuário';
      
      if (m.message_type === 'text') {
        textSummary += `[${senderLabel}]: ${m.content || ''}\n`;
      } else if (m.message_type === 'ai_suggestion') {
        continue;
      } else if (m.message_type === 'image' && m.file_url) {
        textSummary += `[${senderLabel}] enviou uma imagem (${m.file_name || 'imagem'}). Analise o conteúdo da imagem abaixo:\n`;
        const fileData = await fetchFileAsBase64(m.file_url);
        if (fileData) {
          contentParts.push({
            type: "image_url",
            image_url: { url: `data:${fileData.mimeType};base64,${fileData.base64}` }
          });
        }
      } else if (m.message_type === 'audio' && m.file_url) {
        textSummary += `[${senderLabel}] enviou um áudio (${m.audio_duration || '?'}s). Transcreva e analise o áudio abaixo:\n`;
        const fileData = await fetchFileAsBase64(m.file_url);
        if (fileData) {
          contentParts.push({
            type: "input_audio",
            input_audio: { data: fileData.base64, format: "wav" }
          });
        }
      } else if (m.message_type === 'pdf' && m.file_url) {
        textSummary += `[${senderLabel}] enviou um documento PDF (${m.file_name || 'documento'}). Analise o conteúdo do documento abaixo:\n`;
        const fileData = await fetchFileAsBase64(m.file_url);
        if (fileData) {
          contentParts.push({
            type: "image_url",
            image_url: { url: `data:${fileData.mimeType};base64,${fileData.base64}` }
          });
        }
      }
    }

    const userContent: any[] = [{ type: "text", text: textSummary }, ...contentParts];

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
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
                  what_was_done: { type: "string", description: "O que foi feito" },
                  current_status_notes: { type: "string", description: "Status atual" },
                  next_steps: { type: "string", description: "Próximos passos" },
                  notes: { type: "string", description: "Observações" },
                },
                required: ["what_was_done", "current_status_notes", "next_steps", "notes"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "fill_activity_fields" } },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Payment required" }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(JSON.stringify({ error: "AI gateway error" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
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
