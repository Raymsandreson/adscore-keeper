import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { geminiChat } from "../_shared/gemini.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PROMPTS: Record<string, string> = {
  summarize: "Resuma o texto a seguir de forma concisa e objetiva em português brasileiro. Mantenha os pontos principais.",
  formal: "Reescreva o texto a seguir em tom formal e profissional em português brasileiro. Mantenha o significado original.",
  friendly: "Reescreva o texto a seguir em tom amigável e acolhedor em português brasileiro. Mantenha o significado original.",
  funny: "Reescreva o texto a seguir em tom engraçado e descontraído em português brasileiro. Mantenha o significado original.",
  engaging: "Reescreva o texto a seguir em tom cativante e envolvente em português brasileiro. Mantenha o significado original.",
  concise: "Reescreva o texto a seguir de forma mais concisa e direta em português brasileiro. Elimine redundâncias.",
  empathetic: "Reescreva o texto a seguir em tom empático e compreensivo em português brasileiro. Mantenha o significado original.",
  fix_typos: "Corrija erros de digitação, gramática e ortografia no texto a seguir em português brasileiro. Mantenha o estilo e tom originais. Retorne apenas o texto corrigido.",
  humanize: "Reescreva o texto a seguir de forma mais humana e natural em português brasileiro. Remova qualquer tom robótico ou artificial.",
  translate_en: "Traduza o texto a seguir para inglês. Mantenha o tom e estilo originais.",
  translate_es: "Traduza o texto a seguir para espanhol. Mantenha o tom e estilo originais.",
  translate_pt: "Traduza o texto a seguir para português brasileiro. Mantenha o tom e estilo originais.",
  draft_email: "Rascunhe o texto a seguir como um e-mail profissional em português brasileiro. Adicione saudação e despedida apropriadas.",
  draft_message: "Rascunhe o texto a seguir como uma mensagem de WhatsApp profissional e cordial em português brasileiro.",
  draft_report: "Rascunhe o texto a seguir como um relatório estruturado em português brasileiro, com seções claras.",
  help_write: "Melhore e expanda o texto a seguir em português brasileiro, tornando-o mais completo e bem escrito. Mantenha a ideia original.",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { text, action, custom_prompt } = await req.json();
    if (!text || !action) {
      return new Response(JSON.stringify({ error: "text and action required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let systemPrompt: string;
    if (action === 'custom' && custom_prompt) {
      systemPrompt = `Aplique a seguinte instrução ao texto do usuário: ${custom_prompt}. Mantenha o idioma original do texto.`;
    } else {
      systemPrompt = PROMPTS[action];
      if (!systemPrompt) {
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const multiOptionPrompt = `${systemPrompt}

IMPORTANTE: Você DEVE retornar EXATAMENTE 3 opções diferentes do texto reescrito/processado.
Retorne no formato JSON puro (sem markdown, sem backticks):
{"options": ["opção 1 aqui", "opção 2 aqui", "opção 3 aqui"]}

Cada opção deve ter uma abordagem ou estilo ligeiramente diferente, mas todas seguindo a instrução principal.
Retorne APENAS o JSON, nada mais.`;

    const response = await geminiChat({
      model: "google/gemini-2.5-flash-lite",
      temperature: 0.7,
      max_tokens: 4096,
      messages: [
        { role: "system", content: multiOptionPrompt },
        { role: "user", content: text },
      ],
    });

    const raw = response?.choices?.[0]?.message?.content || '';
    
    // Try to parse as JSON with options array
    let options: string[] = [];
    try {
      // Remove potential markdown code blocks
      const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed.options) && parsed.options.length > 0) {
        options = parsed.options.slice(0, 3);
      }
    } catch {
      // Fallback: use the raw text as single option
      options = [raw.trim()];
    }

    // Ensure we always have at least 1 option
    if (options.length === 0) {
      options = [raw.trim() || text];
    }

    return new Response(JSON.stringify({ options }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("ai-text-editor error:", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
