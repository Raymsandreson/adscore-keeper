import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { rankings, weekStart, weekEnd, settings } = await req.json();

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    if (!rankings || rankings.length === 0) {
      return new Response(
        JSON.stringify({ error: "Nenhum dado de ranking disponível" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build ranking context
    const rankingDetails = rankings.map((r: any, i: number) => {
      const position = i + 1;
      const posChange = r.previous_rank_position 
        ? (r.previous_rank_position > position ? `subiu ${r.previous_rank_position - position} posição(ões)` : 
           r.previous_rank_position < position ? `caiu ${position - r.previous_rank_position} posição(ões)` : 'manteve posição')
        : 'nova entrada';
      
      return `${position}º lugar: @${r.username} - ${r.total_points} ações (${r.comments_count || 0} comentários, ${r.mentions_count || 0} DMs, ${r.leads_created || 0} leads, ${r.stage_changes || 0} etapas mudadas, badge: ${r.badge_level || 'none'}, ${posChange})`;
    }).join('\n');

    // Calculate interesting stats
    const leader = rankings[0];
    const totalParticipants = rankings.length;
    const totalPoints = rankings.reduce((sum: number, r: any) => sum + r.total_points, 0);
    const avgPoints = totalParticipants > 0 ? Math.round(totalPoints / totalParticipants) : 0;
    
    // Find biggest mover up
    const biggestMoverUp = rankings
      .filter((r: any) => r.previous_rank_position && r.previous_rank_position > (rankings.indexOf(r) + 1))
      .sort((a: any, b: any) => {
        const aGain = a.previous_rank_position - (rankings.indexOf(a) + 1);
        const bGain = b.previous_rank_position - (rankings.indexOf(b) + 1);
        return bGain - aGain;
      })[0];

    // Find biggest faller
    const biggestFaller = rankings
      .filter((r: any) => r.previous_rank_position && r.previous_rank_position < (rankings.indexOf(r) + 1))
      .sort((a: any, b: any) => {
        const aFall = (rankings.indexOf(a) + 1) - a.previous_rank_position;
        const bFall = (rankings.indexOf(b) + 1) - b.previous_rank_position;
        return bFall - aFall;
      })[0];

    let extraContext = "";
    if (biggestMoverUp) {
      extraContext += `\nDestaque positivo: @${biggestMoverUp.username} subiu ${biggestMoverUp.previous_rank_position - (rankings.indexOf(biggestMoverUp) + 1)} posições!`;
    }
    if (biggestFaller) {
      extraContext += `\nQuem caiu: @${biggestFaller.username} perdeu ${(rankings.indexOf(biggestFaller) + 1) - biggestFaller.previous_rank_position} posições.`;
    }

    // Gap analysis
    const gaps: string[] = [];
    for (let i = 0; i < Math.min(rankings.length - 1, 5); i++) {
      const diff = rankings[i].total_points - rankings[i + 1].total_points;
      if (diff > 0) {
        gaps.push(`Diferença do ${i + 1}º para o ${i + 2}º: ${diff} pontos`);
      }
    }

    const systemPrompt = `Você é um narrador esportivo que vai criar uma mensagem EMOCIONANTE e DIVERTIDA para WhatsApp sobre o ranking de engajamento do Instagram.

FORMATO DA NARRAÇÃO:
A mensagem deve ser um DIÁLOGO entre o Galvão Bueno e o Arnaldo César Coelho, como se estivessem narrando uma corrida (a "Corrida Maluca do Engajamento").

ESTILO:
- Galvão é EMPOLGADO, grita "OLHA ELE AÍ!", "É GOOOOL!", "INACREDITÁVEL!", usa bordões famosos
- Arnaldo é ANALÍTICO mas também empolgado, faz comentários técnicos e espirituosos tipo "A regra é clara", comenta as estratégias
- Use emojis de corrida 🏎️🏁🚀💨🔥🏆👑⚡ com moderação
- Inclua bordões do Galvão: "ACABOU!", "OLHA O GOL!", "HAJA CORAÇÃO!", "FECHOU!", "QUE JOGADAAAA!"
- Arnaldo pode fazer piadas e provocações amigáveis
- Mencione CADA participante pelo @ do Instagram
- Comente as ultrapassagens, quem subiu, quem caiu, quem está ameaçando
- Estimule a competição e a participação
- Termine com uma provocação motivacional para a próxima semana
- Use formatação do WhatsApp: *negrito*, _itálico_
- A mensagem deve ter entre 800-1500 caracteres
- NÃO use markdown de código, headers (#), ou formatação que não funcione no WhatsApp
- Comece com um cabeçalho tipo "🏁🏎️ *CORRIDA MALUCA DO ENGAJAMENTO* 🏎️🏁"

REGRAS:
1. Seja JUSTO - elogie quem subiu, provoque amigavelmente quem caiu, mas sem ofender
2. Destaque o LÍDER com empolgação
3. Mencione quem está perto de ultrapassar alguém (gaps pequenos)
4. Se alguém tem poucos pontos, incentive com humor
5. A narração deve parecer uma transmissão ao vivo de uma corrida emocionante
6. Finalize sempre estimulando todos a competirem mais na próxima semana`;

    const userPrompt = `Crie a narração da Corrida Maluca do Engajamento para o período de ${weekStart} a ${weekEnd}.

RANKING ATUAL:
${rankingDetails}

ESTATÍSTICAS:
- Total de participantes: ${totalParticipants}
- Total de pontos gerados: ${totalPoints}
- Média de pontos: ${avgPoints}
- Configuração: ${settings.points_per_mention} pts/menção, ${settings.points_per_comment} pts/comentário
${extraContext}

DIFERENÇAS ENTRE POSIÇÕES:
${gaps.join('\n')}

Agora crie o diálogo Galvão + Arnaldo narrando essa corrida!`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        max_tokens: 1500,
        temperature: 0.9,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const data = await response.json();
    const message = data.choices?.[0]?.message?.content?.trim() || "";

    return new Response(
      JSON.stringify({ success: true, message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error("Error generating corrida maluca:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
