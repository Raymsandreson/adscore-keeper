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

    const systemPrompt = `Você é um assistente especializado em organização de rotinas de trabalho. 
O usuário vai descrever o que precisa fazer durante a semana e você deve criar uma rotina estruturada em blocos de tempo.

Você DEVE retornar APENAS um array JSON de blocos de tempo. Cada bloco tem:
- activityType: string (chave única, sem espaços, ex: "tarefa", "reuniao", "audiencia")
- label: string (nome amigável em português)
- color: string (uma dessas: "bg-blue-500", "bg-green-500", "bg-yellow-500", "bg-purple-500", "bg-pink-500", "bg-orange-500", "bg-red-500", "bg-teal-500", "bg-indigo-500", "bg-cyan-500", "bg-emerald-500", "bg-rose-500")
- days: number[] (0=Seg, 1=Ter, 2=Qua, 3=Qui, 4=Sex)
- startHour: number (7 a 18)
- endHour: number (startHour+1 a 19, sempre maior que startHour)
- isCustom: boolean (sempre true para tipos criados)

Regras:
- Distribua as atividades de forma inteligente ao longo da semana
- Evite sobreposição de horários no mesmo dia
- Use cores diferentes para cada tipo
- Crie tipos adequados para o que o usuário descreveu
- Máximo 8 tipos de atividade
- Retorne APENAS o JSON, sem explicações ou markdown

Exemplo de formato:
[{"activityType":"reuniao","label":"Reuniões","color":"bg-blue-500","days":[1,3],"startHour":9,"endHour":11,"isCustom":true}]`;

    const result = await geminiChat({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Crie uma rotina semanal para: ${description}` },
      ],
    });

    const content = result.choices?.[0]?.message?.content || "[]";

    let configs;
    try {
      const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      configs = JSON.parse(cleaned);
    } catch {
      throw new Error("IA retornou formato inválido");
    }

    return new Response(JSON.stringify({ configs }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("suggest-routine error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Erro desconhecido" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
