// =============================================================================
// dom-rascunho — o Dom escrevendo sem falar com ninguém.
//
// Roda no Supabase EXTERNO (kmedldlepwiityjsdahz).
//
// POR QUE ISTO EXISTE
// A integração de verdade do Dom mora dentro de whatsapp-ai-agent-reply, que
// tem 50 mil caracteres e atende ~5,9 mil chamadas/dia. Trocar aquele arquivo
// para começar um piloto é apostar o caminho quente inteiro numa mudança que
// ainda não foi vista funcionando.
//
// No modo `rascunho` o Dom NÃO ENVIA NADA: ele lê o contexto, escreve, e a
// resposta vai para dom_respostas_pendentes. Ou seja, tudo o que o piloto
// precisa cabe aqui, sem encostar na função de produção. Quando os rascunhos
// passarem no olho da equipe, aí sim a integração definitiva sobe e esta
// função sai de cena.
//
// COMO É ACIONADA
// Cron (dom-rascunho-tick). Sem webhook novo: ela varre as perguntas sem
// resposta nos grupos do piloto. Um grupo em que a equipe já respondeu não
// gera rascunho — o Dom só escreve onde o cliente está esperando.
//
// CONTRATO
//   POST {}                        → varre todos os grupos ativos do piloto
//   POST { group_jid }             → só aquele grupo (para teste)
//   POST { limite }                → teto de grupos por rodada (padrão 8)
//   →     { grupos, rascunhos, pulados: [{ grupo, motivo }] }
//
// SEGURANÇA: nada de texto de cliente nos logs. Só JID, contagem e motivo.
// =============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const DOM_AGENT_ID = "d6ad8eee-d6a3-452c-b852-b94ef8dd54bf";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-request-id",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

// Mesma chamada que _shared/gemini.ts faz em produção, no essencial: v1beta,
// systemInstruction separado e thinkingBudget 0 (o "thinking" do 2.5 come o
// maxOutputTokens antes de gerar texto e trunca a resposta).
async function gerar(systemPrompt: string, historico: any[], maxTokens: number, temperatura: number) {
  const key = Deno.env.get("GOOGLE_AI_API_KEY");
  if (!key) throw new Error("GOOGLE_AI_API_KEY não configurada");

  const body: any = {
    contents: historico,
    systemInstruction: { parts: [{ text: systemPrompt }] },
    generationConfig: {
      maxOutputTokens: maxTokens,
      temperature: temperatura,
      thinkingConfig: { thinkingBudget: 0 },
    },
  };

  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(key)}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
  );
  if (!resp.ok) throw new Error(`Gemini HTTP ${resp.status}`);
  const data = await resp.json();
  const partes = data?.candidates?.[0]?.content?.parts ?? [];
  return partes.map((p: any) => p?.text ?? "").join("").trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  try {
    const corpo = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const soEsteGrupo = corpo?.group_jid ? String(corpo.group_jid).split("@")[0] : null;
    const limite = Math.min(Math.max(Number(corpo?.limite) || 8, 1), 20);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // O prompt do Dom vem da TABELA, não da view: aqui ele é lido mesmo com
    // is_active = false. É de propósito — o agente segue desligado no caminho
    // de produção enquanto os rascunhos rodam.
    const { data: agente } = await supabase
      .from("wjia_command_shortcuts")
      .select("prompt_instructions, base_prompt, temperature, max_tokens, history_limit")
      .eq("id", DOM_AGENT_ID)
      .maybeSingle();

    if (!agente) return json({ error: "agente Dom não encontrado" }, 500);

    let q = supabase
      .from("dom_grupos_piloto")
      .select("group_jid, group_name, lead_id, modo")
      .eq("ativo", true);
    if (soEsteGrupo) q = q.eq("group_jid", soEsteGrupo);
    const { data: grupos } = await q.limit(limite);

    const pulados: any[] = [];
    let rascunhos = 0;

    for (const g of grupos ?? []) {
      // 1. Última mensagem do grupo. Se foi a equipe que falou por último, o
      //    cliente não está esperando nada — não há o que rascunhar.
      const { data: ultimas } = await supabase
        .from("whatsapp_messages")
        .select("direction, message_text, message_type, contact_name, instance_name, created_at")
        .eq("phone", g.group_jid)
        .order("created_at", { ascending: false })
        .limit(agente.history_limit || 20);

      const lista = (ultimas ?? []).slice().reverse();
      const ultima = lista[lista.length - 1];
      if (!ultima) { pulados.push({ grupo: g.group_jid, motivo: "sem mensagens" }); continue; }
      if (ultima.direction !== "inbound") { pulados.push({ grupo: g.group_jid, motivo: "equipe respondeu por último" }); continue; }

      const pergunta = (ultima.message_text || "").trim();
      if (pergunta.length < 8) { pulados.push({ grupo: g.group_jid, motivo: "última mensagem sem texto útil" }); continue; }

      // 2. Já existe rascunho para esta mesma pergunta? Não repete.
      const { data: jaTem } = await supabase
        .from("dom_respostas_pendentes")
        .select("id")
        .eq("group_jid", g.group_jid)
        .eq("pergunta", pergunta)
        .limit(1)
        .maybeSingle();
      if (jaTem) { pulados.push({ grupo: g.group_jid, motivo: "já rascunhado" }); continue; }

      // 3. Contexto: andamento real + exemplos do próprio grupo + as regras de
      //    linguagem. É a mesma função que a integração definitiva chama.
      const ctxResp = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/dom-contexto`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({ group_jid: g.group_jid, pergunta }),
      });
      const domCtx = await ctxResp.json().catch(() => null);
      if (!domCtx || domCtx.error) { pulados.push({ grupo: g.group_jid, motivo: "contexto indisponível" }); continue; }
      if (domCtx.atende === false) { pulados.push({ grupo: g.group_jid, motivo: domCtx.motivo || "fora do piloto" }); continue; }

      // 4. Histórico do grupo, e SÓ deste grupo.
      const historico = lista
        .map((m: any) => {
          const texto = (m.message_text || "").trim();
          const t = texto || (m.message_type && m.message_type !== "text" ? `[${m.message_type}]` : "");
          if (!t) return null;
          return { role: m.direction === "inbound" ? "user" : "model", parts: [{ text: t }] };
        })
        .filter(Boolean);

      const systemPrompt =
        (agente.prompt_instructions || agente.base_prompt || "") + "\n\n" + (domCtx.blocos || "");

      let resposta = "";
      try {
        resposta = await gerar(
          systemPrompt,
          historico,
          Math.min(Math.max(agente.max_tokens || 1024, 256), 4096),
          (agente.temperature ?? 70) / 100,
        );
      } catch (e) {
        pulados.push({ grupo: g.group_jid, motivo: `modelo falhou: ${(e as Error).message}` });
        continue;
      }
      if (!resposta) { pulados.push({ grupo: g.group_jid, motivo: "resposta vazia" }); continue; }

      // 5. O marcador [REVISAR: motivo] sai do texto e vira o motivo da fila —
      //    igual ao [HANDOFF:...] que a função de produção já faz.
      let motivo: string | null = null;
      resposta = resposta
        .replace(/\[REVISAR:\s*([^\]]*?)\s*\]/gi, (_m, mot) => {
          motivo = (String(mot) || "").trim() || "sem motivo informado";
          return "";
        })
        .replace(/\n{3,}/g, "\n\n")
        .trim();

      const { error: errFila } = await supabase.from("dom_respostas_pendentes").insert({
        group_jid: g.group_jid,
        group_name: g.group_name || domCtx.contexto?.grupo || null,
        instance_name: ultima.instance_name,
        lead_id: g.lead_id || domCtx.contexto?.lead_id || null,
        pergunta,
        pergunta_autor: ultima.contact_name || null,
        resposta_sugerida: resposta,
        motivo_revisao: motivo || "modo rascunho: tudo passa por revisão",
        contexto_usado: domCtx.contexto || null,
        status: "pendente",
      });
      if (errFila) { pulados.push({ grupo: g.group_jid, motivo: `fila: ${errFila.message}` }); continue; }

      rascunhos++;
      console.log(`[dom-rascunho] grupo=${g.group_jid} rascunho gravado (${resposta.length}ch)`);
    }

    return json({ grupos: (grupos ?? []).length, rascunhos, pulados });
  } catch (e) {
    console.error("[dom-rascunho] erro", (e as Error)?.message);
    return json({ error: (e as Error)?.message ?? "erro" }, 500);
  }
});
