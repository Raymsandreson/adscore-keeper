import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { geminiChat } from "../_shared/gemini.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { description, existing_config } = await req.json();
    if (!description?.trim()) {
      return new Response(JSON.stringify({ error: "Descrição é obrigatória" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const systemPrompt = `Você é um especialista em configurar agentes de IA para um sistema de CRM jurídico via WhatsApp.

O sistema funciona assim: quando o usuário envia "#nome_agente" no WhatsApp, o agente de IA é ativado e executa ações automatizadas.

Cada agente tem:
1. **shortcut_name**: Nome curto do agente (sem espaços, minúsculo, ex: "procuracao", "contrato", "honorarios")
2. **description**: Descrição breve do que o agente faz
3. **prompt_instructions**: Instruções COMPLETAS para a IA — inclui persona, tom de voz, instruções de coleta, regras de comportamento e instruções de follow-up. Este é o ÚNICO campo de prompt.
   IMPORTANTE: O prompt_instructions DEVE incluir TUDO: persona/personalidade, tom, instruções de coleta, regras de follow-up (o que dizer em cada etapa, como escalar o tom). NÃO há campos separados.
4. **media_extraction_prompt**: Instruções ESPECÍFICAS de como a IA deve interpretar documentos recebidos por mídia (RG, CNH, comprovantes de endereço, etc).
   - Se o agente solicita documentos, SEMPRE gere instruções detalhadas de extração
   - Inclua regras específicas para documentos brasileiros (RG, CNH, CPF, etc)
   - Se o agente NÃO envolve documentos, deixe este campo vazio
5. **followup_steps**: Array de etapas de follow-up automático — define apenas TIPO de ação e TEMPO de espera.

Tipos de ações para followup_steps:
- "whatsapp_message": Envia mensagem WhatsApp (o prompt define o que dizer)
- "call": Agenda ligação. Tem "assigned_to" (deixe vazio)
- "create_activity": Cria atividade/tarefa. Tem "assigned_to" (deixe vazio), "activity_type" (ex: "tarefa", "ligacao")

Para delay_minutes: use valores realistas e VARIADOS conforme a urgência e bom senso:
- 1ª cobrança: 60-120 min (1-2h)
- 2ª: 1440-2880 (1-2 dias)
- Ligação: geralmente após 2ª ou 3ª mensagem sem resposta
- Escale gradualmente os tempos
- Monte uma sequência infinita lógica (mínimo 4-6 etapas), alternando mensagens, ligações e atividades conforme faça sentido

O prompt_instructions deve ser COMPLETO e incluir:
- Papel/persona do agente
- Tom de voz adequado
- Dados que precisa coletar do cliente
- Fluxo da conversa (saudação → coleta → confirmação → geração)
- Regras de comportamento
- Formato das respostas (curtas, com emojis, profissional)
- Instruções de follow-up: o que dizer em cada etapa de cobrança, como escalar o tom, quando ser mais insistente

IMPORTANTE: O prompt_instructions deve ser extremamente detalhado e cobrir todas as situações possíveis.

Responda APENAS com JSON válido no formato:
{
  "shortcut_name": "string",
  "description": "string",
  "prompt_instructions": "string",
  "media_extraction_prompt": "string (instruções OCR, ou string vazia se não aplicável)",
  "followup_steps": [
    {
      "action_type": "whatsapp_message" | "call" | "create_activity",
      "delay_minutes": number,
      "assigned_to": "string (opcional, deixe vazio)",
      "activity_type": "string (opcional)"
    }
  ]
}`;

    let userMessage: string;
    if (existing_config) {
      userMessage = `O atalho atual é:
- Nome: ${existing_config.shortcut_name}
- Descrição: ${existing_config.description || '(sem descrição)'}
- Prompt: ${existing_config.prompt_instructions || '(sem prompt)'}
- Prompt de extração de mídia: ${existing_config.media_extraction_prompt || '(sem prompt de extração)'}
- Follow-up: ${JSON.stringify(existing_config.followup_steps || [])}

O usuário quer as seguintes mudanças: ${description.trim()}

Retorne a configuração COMPLETA atualizada (não apenas as mudanças), mantendo o que não foi pedido para alterar.`;
    } else {
      userMessage = `Crie um agente completo para: ${description.trim()}`;
    }

    const result = await geminiChat({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "set_agent_config",
            description: "Retorna a configuração completa do agente",
            parameters: {
              type: "object",
              properties: {
                shortcut_name: { type: "string" },
                description: { type: "string" },
                prompt_instructions: { type: "string" },
                media_extraction_prompt: { type: "string" },
                followup_steps: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      action_type: {
                        type: "string",
                        enum: ["whatsapp_message", "call", "create_activity"],
                      },
                      delay_minutes: { type: "number" },
                      assigned_to: { type: "string" },
                      activity_type: { type: "string" },
                    },
                    required: ["action_type", "delay_minutes"],
                  },
                },
              },
              required: ["shortcut_name", "prompt_instructions", "followup_steps"],
            },
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "set_agent_config" } },
      temperature: 0.4,
      max_tokens: 4000,
    });

    const toolArgs = result.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    const rawContent = result.choices?.[0]?.message?.content || "";

    const stripCodeFences = (value: string) =>
      value
        .trim()
        .replace(/^\uFEFF/, "")
        .replace(/^\s*```(?:\w+)?\s*/i, "")
        .replace(/\s*```\s*$/i, "")
        .trim();

    const autoCloseJson = (value: string) => {
      let inString = false;
      let escaped = false;
      const stack: string[] = [];

      for (const ch of value) {
        if (escaped) {
          escaped = false;
          continue;
        }

        if (ch === "\\") {
          escaped = true;
          continue;
        }

        if (ch === '"') {
          inString = !inString;
          continue;
        }

        if (inString) continue;

        if (ch === "{" || ch === "[") {
          stack.push(ch);
          continue;
        }

        if (ch === "}" && stack[stack.length - 1] === "{") {
          stack.pop();
          continue;
        }

        if (ch === "]" && stack[stack.length - 1] === "[") {
          stack.pop();
        }
      }

      let closed = value;
      for (let i = stack.length - 1; i >= 0; i--) {
        closed += stack[i] === "{" ? "}" : "]";
      }

      return closed;
    };

    const parseAiJson = (content: string) => {
      const normalized = content.trim().replace(/^\uFEFF/, "").replace(/\r/g, "");
      const fenced = normalized.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
      const firstBrace = normalized.indexOf("{");

      const candidates = [
        fenced,
        stripCodeFences(normalized),
        normalized,
        firstBrace !== -1 ? normalized.slice(firstBrace) : "",
      ].filter(Boolean) as string[];

      for (const candidate of candidates) {
        const base = candidate.trim();
        if (!base) continue;

        const variants = [
          base,
          base.replace(/,\s*([}\]])/g, "$1"),
          autoCloseJson(base),
          autoCloseJson(base).replace(/,\s*([}\]])/g, "$1"),
        ];

        for (const variant of variants) {
          try {
            return JSON.parse(variant);
          } catch {
            // try next variant
          }
        }
      }

      throw new Error("A IA retornou JSON inválido. Tente novamente.");
    };

    const buildFallbackConfig = () => {
      const normalizeShortcut = (text: string) =>
        text
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, " ")
          .trim()
          .split(/\s+/)
          .slice(0, 2)
          .join("_") || "agente";

      return {
        shortcut_name: existing_config?.shortcut_name || normalizeShortcut(description),
        description: description.trim(),
        prompt_instructions:
          existing_config?.prompt_instructions ||
          `Você é um agente de atendimento jurídico no WhatsApp.\nObjetivo: ${description.trim()}\n\nFluxo obrigatório:\n1) Saudação curta e profissional\n2) Coleta de dados essenciais\n3) Confirmação dos dados\n4) Orientação do próximo passo\n\nRegras:\n- Respostas curtas, claras e educadas\n- Nunca inventar dados\n- Quando faltar informação, pedir objetivamente\n- Se receber documentos, explicar o que foi identificado e o que ainda falta`,
        media_extraction_prompt:
          existing_config?.media_extraction_prompt ||
          "Ao receber imagem/PDF, extraia nome completo, CPF, RG, data de nascimento e endereço quando disponíveis. Se houver dúvida de leitura, sinalize claramente o campo como incerto.",
        followup_steps:
          existing_config?.followup_steps?.length
            ? existing_config.followup_steps
            : [
                { action_type: "whatsapp_message", delay_minutes: 90 },
                { action_type: "whatsapp_message", delay_minutes: 1440 },
                { action_type: "create_activity", delay_minutes: 2880, activity_type: "tarefa", assigned_to: "" },
                { action_type: "call", delay_minutes: 4320, assigned_to: "" },
              ],
      };
    };

    let parsed: any;
    try {
      parsed = toolArgs
        ? typeof toolArgs === "string"
          ? JSON.parse(toolArgs)
          : toolArgs
        : parseAiJson(rawContent);
    } catch (parseError) {
      console.warn("Falha ao interpretar saída da IA, usando fallback:", parseError);
      parsed = buildFallbackConfig();
    }

    // Validate structure
    if (!parsed.shortcut_name || !parsed.prompt_instructions) {
      throw new Error("Resposta incompleta da IA");
    }

    // Ensure followup_steps is array
    if (!Array.isArray(parsed.followup_steps)) {
      parsed.followup_steps = [];
    }

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-shortcut-config error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Erro ao gerar configuração" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
