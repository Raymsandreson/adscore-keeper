// ROTINA SEMANAL POR IA — versão de FALLBACK.
//
// O caminho principal é `railway-server/src/functions/suggest-routine.ts` (ver
// functionRouter.ts: 'suggest-routine' → 'railway'). Esta edge só roda quando o
// Railway falha e o roteador cai para o Cloud. Ela NÃO lê PDF/print — só texto.
//
// ATENÇÃO: alterar este arquivo não muda nada em produção até rodar o deploy:
//   supabase functions deploy suggest-routine --project-ref gliigkupoebmlbwyvijp
//
// O que foi consertado aqui (15/09/2026): a versão anterior mandava a IA INVENTAR
// os tipos de atividade ("reuniao", "audiencia", isCustom: true) e nunca recebia os
// tipos que existem no banco — cujas keys são `custom_<timestamp>`. A tela descartava
// tudo que não casasse e mostrava "A IA não conseguiu mapear sugestões aos tipos
// globais existentes". Falhava sempre, não às vezes. Agora os tipos reais vão no
// prompt e a IA é obrigada a escolher entre eles.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { geminiChat } from "../_shared/gemini.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-request-id, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface AvailableType {
  key: string;
  label: string;
  description?: string | null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { description, text, available_types } = await req.json();

    const types: AvailableType[] = (Array.isArray(available_types) ? available_types : [])
      .map((t: any) => ({
        key: String(t?.key || "").trim(),
        label: String(t?.label || "").trim(),
        description: t?.description ? String(t.description).trim() : "",
      }))
      .filter((t: AvailableType) => t.key && t.label)
      .slice(0, 60);

    if (types.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: "Nenhum tipo de atividade disponível para montar a rotina." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const pedido = [description, text].map((v) => String(v || "").trim()).filter(Boolean).join("\n\n");
    if (!pedido) {
      return new Response(
        JSON.stringify({ success: false, error: "Descreva a semana antes de gerar a rotina." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const typesList = types
      .map((t) => `- key: ${t.key} | nome: ${t.label}${t.description ? ` | o que é: ${t.description}` : ""}`)
      .join("\n");

    const systemPrompt = `Você organiza a ROTINA SEMANAL de trabalho de um escritório de advocacia, em blocos de horário de segunda a sexta.

REGRA MAIS IMPORTANTE: use SOMENTE os tipos de atividade que já existem, listados abaixo. É PROIBIDO inventar tipo ou key. Escolha sempre o tipo existente mais próximo do que a pessoa descreveu. O que não tiver tipo correspondente vai para "unmatched", com as palavras dela.

TIPOS EXISTENTES (use exatamente estas keys):
${typesList}

Formato da resposta: APENAS um JSON, sem markdown e sem explicação, assim:
{"blocks":[{"activityType":"<uma das keys acima>","days":[0,1,2,3,4],"startHour":9,"startMinute":0,"endHour":11,"endMinute":30}],"unmatched":["o que ficou de fora"],"summary":"uma ou duas frases"}

Regras dos blocos:
- days: 0=Seg, 1=Ter, 2=Qua, 3=Qui, 4=Sex. Bloco que se repete a semana toda usa [0,1,2,3,4] — não repita cinco blocos iguais.
- startHour/endHour de 0 a 23; startMinute/endMinute só 0, 15, 30 ou 45. Respeite o horário que a pessoa falou (8h30 → startHour 8, startMinute 30).
- Fim sempre depois do início; sem sobrepor blocos no mesmo dia.
- Sem horário informado, distribua dentro do expediente (8h–18h), deixando 12h–14h livre.
- Não invente compromisso que a pessoa não citou.`;

    const result = await geminiChat({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Monte a rotina semanal para: ${pedido}` },
      ],
    });

    const content = result.choices?.[0]?.message?.content || "{}";

    let parsed: any;
    try {
      const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      parsed = JSON.parse(cleaned);
    } catch {
      throw new Error("IA retornou formato inválido");
    }

    // Aceita tanto o formato novo ({blocks}) quanto um array cru, por segurança.
    const bruto = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.blocks) ? parsed.blocks : []);
    const validKeys = new Set(types.map((t) => t.key));
    const blocks = bruto
      .filter((b: any) => validKeys.has(String(b?.activityType || "")))
      .map((b: any) => {
        const label = types.find((t) => t.key === b.activityType)?.label || "";
        return {
          activityType: String(b.activityType),
          label,
          days: Array.isArray(b.days) ? b.days.map((d: any) => Number(d)).filter((d: number) => d >= 0 && d <= 4) : [0, 1, 2, 3, 4],
          startHour: Number(b.startHour) || 9,
          startMinute: [0, 15, 30, 45].includes(Number(b.startMinute)) ? Number(b.startMinute) : 0,
          endHour: Number(b.endHour) || 11,
          endMinute: [0, 15, 30, 45].includes(Number(b.endMinute)) ? Number(b.endMinute) : 0,
        };
      });

    return new Response(
      JSON.stringify({
        success: true,
        blocks,
        unmatched: Array.isArray(parsed?.unmatched) ? parsed.unmatched.map((u: any) => String(u)) : [],
        summary: parsed?.summary ? String(parsed.summary) : "",
        // Compatibilidade com telas antigas que liam `configs`.
        configs: blocks,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("suggest-routine error:", e);
    return new Response(JSON.stringify({ success: false, error: e instanceof Error ? e.message : "Erro desconhecido" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
