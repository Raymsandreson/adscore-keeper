import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { geminiChat } from "../_shared/gemini.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { description } = await req.json();
    if (!description?.trim()) {
      return new Response(JSON.stringify({ error: "Descrição é obrigatória" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const systemPrompt = `Você é um especialista em configurar atalhos de automação para um sistema de CRM jurídico via WhatsApp.

O sistema funciona assim: quando o usuário envia "@wjia <nome_atalho>" no WhatsApp, o robô executa ações automatizadas.

Cada atalho tem:
1. **shortcut_name**: Nome curto do atalho (sem espaços, minúsculo, ex: "procuracao", "contrato", "honorarios")
2. **description**: Descrição breve do que o atalho faz
3. **prompt_instructions**: Instruções detalhadas para a IA sobre como conduzir a conversa, coletar dados, gerar documentos, etc.
4. **followup_steps**: Array de etapas de follow-up automático quando o cliente não responde/assina

Tipos de ações para followup_steps:
- "whatsapp_message": Envia mensagem WhatsApp. Tem "message_template" com variáveis {{nome}}, {{documento}}, {{link}}
- "call": Agenda ligação. Tem "assigned_to" (deixe vazio)
- "create_activity": Cria atividade/tarefa. Tem "assigned_to" (deixe vazio), "activity_type" (ex: "tarefa", "ligacao")

Para delay_minutes no follow-up: use valores realistas (60=1h, 1440=1dia, 2880=2dias, etc.)

O prompt_instructions deve ser COMPLETO e incluir:
- Papel/persona do agente
- Tom de voz adequado
- Dados que precisa coletar do cliente
- Fluxo da conversa (saudação → coleta → confirmação → geração)
- Regras de comportamento
- Formato das respostas (curtas, com emojis, profissional)

IMPORTANTE: O prompt_instructions deve ser extremamente detalhado e cobrir todas as situações possíveis.

Responda APENAS com JSON válido no formato:
{
  "shortcut_name": "string",
  "description": "string",
  "prompt_instructions": "string",
  "followup_steps": [
    {
      "action_type": "whatsapp_message" | "call" | "create_activity",
      "delay_minutes": number,
      "message_template": "string (opcional)",
      "assigned_to": "string (opcional, deixe vazio)",
      "activity_type": "string (opcional)"
    }
  ]
}`;

    const result = await geminiChat({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Crie um atalho completo para: ${description.trim()}` },
      ],
      temperature: 0.7,
      max_tokens: 4000,
    });

    const rawContent = result.choices?.[0]?.message?.content || "";
    
    // Extract JSON from response (may be wrapped in markdown code blocks)
    let jsonStr = rawContent;
    const jsonMatch = rawContent.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) jsonStr = jsonMatch[1];
    
    // Try to parse
    const parsed = JSON.parse(jsonStr.trim());

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
