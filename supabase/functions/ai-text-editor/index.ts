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
    const { text, action } = await req.json();
    if (!text || !action) {
      return new Response(JSON.stringify({ error: "text and action required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const systemPrompt = PROMPTS[action];
    if (!systemPrompt) {
      return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = await geminiChat({
      model: "google/gemini-2.5-flash-lite",
      temperature: 0.3,
      max_tokens: 2048,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: text },
      ],
    });

    return new Response(JSON.stringify({ result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("ai-text-editor error:", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
