// =============================================================================
// dom-rascunho — o Dom escrevendo sem falar com ninguém.
//
// Roda no Supabase EXTERNO (kmedldlepwiityjsdahz).
//
// POR QUE ISTO EXISTE
// A integração definitiva do Dom mora dentro de whatsapp-ai-agent-reply, que
// tem 50 mil caracteres e atende ~5,9 mil chamadas/dia. No modo `rascunho` o
// Dom NÃO ENVIA NADA ao cliente: lê o contexto, escreve, e a resposta vai para
// dom_respostas_pendentes. Tudo o que o piloto precisa cabe aqui, sem encostar
// na função de produção.
//
// O QUE A PRIMEIRA RODADA (04/09/2026) ENSINOU
//   1. Cliente escreveu "Muito obrigada" e o Dom respondeu com relatório de 7
//      processos. Disparar em qualquer inbound é errado.
//   2. Cliente reclamou que o app da Caixa travava; o Dom falou de Bolsa
//      Família. O contexto do processo atropelava o que foi dito.
//   3. Toda mensagem de grupo está gravada 2,5 a 4,8 vezes — cada número nosso
//      no grupo tem webhook próprio e grava sua cópia. O histórico ia repetido.
//   4. Mensagem da equipe chega como `inbound` para os outros números nossos.
//      O maior remetente dos grupos do piloto é a própria equipe (198 mensagens
//      únicas em 20 dias). Sem filtrar, o Dom responde os colegas.
//
// Daí esta versão: deduplica por messageid, separa equipe de cliente pelo
// remetente, e classifica a INTENÇÃO antes de decidir se escreve.
//
// CONTRATO
//   POST {}                → varre todos os grupos ativos do piloto
//   POST { group_jid }     → só aquele grupo (teste)
//   POST { limite }        → teto de grupos por rodada (padrão 8)
//   →     { grupos, rascunhos, pulados: [{ grupo, motivo }] }
//
// SEGURANÇA: nada de texto de cliente nos logs. Só JID, intenção e contagem.
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

const so = (v: unknown) => String(v ?? "").replace(/\D/g, "");

// As 19 intenções levantadas sobre 45 dias de mensagem real dos grupos do
// piloto. O agrupamento é o que decide a ação, não o rótulo:
//   A responde | B acolhe sem falar de processo | C confirma curto
//   D silêncio | E humano
const INTENCOES = `
A1  pergunta sobre andamento do processo
A2  pedido de explicação de algo que já foi dito
A3  problema prático ou obstáculo (app fora do ar, não conseguiu acesso)
A4  dúvida sobre o que ELE precisa fazer
B5  desabafo, ansiedade, busca de reforço ("vai dar certo?")
B6  notícia boa que o cliente traz
B7  notícia ruim ou dificuldade pessoal
C8  está entregando dado que a equipe pediu
C9  está mandando documento
C10 agendamento ou disponibilidade
C11 fato novo do caso (foi na perícia, chegou carta)
D12 só cumprimento, sem pedido junto
D13 agradecimento ou fechamento de conversa
D14 assunto fora do caso (corrente, figurinha, bom-dia religioso)
D15 mensagem da própria equipe
E16 reclamação, insatisfação, ameaça de sair
E17 pergunta sobre dinheiro ou prazo
E18 quer falar com uma pessoa específica
E19 assunto jurídico novo, fora deste processo
`.trim();

async function gemini(model: string, systemPrompt: string, historico: any[], maxTokens: number, temperatura: number) {
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
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
  );
  if (!resp.ok) throw new Error(`Gemini HTTP ${resp.status}`);
  const data = await resp.json();
  return (data?.candidates?.[0]?.content?.parts ?? [])
    .map((p: any) => p?.text ?? "").join("").trim();
}

// Classificador barato: roda no flash-lite antes de gastar o modelo bom.
async function classificar(pergunta: string, ultimasTrocas: string) {
  const sys = [
    "Você classifica a INTENÇÃO da última mensagem do cliente num grupo de WhatsApp",
    "de um escritório de advocacia. Responda APENAS um JSON, sem cercas de código:",
    '{"intencao":"<código>","conversa_encerrada":<true|false>}',
    "",
    "Códigos possíveis:",
    INTENCOES,
    "",
    "conversa_encerrada = true quando a última mensagem do cliente só reconhece o",
    "que já foi dito (obrigada, ok, tá bom, 👍) e não pede nada novo. Nesse caso a",
    "conversa acabou e ninguém precisa responder de volta.",
  ].join("\n");

  const txt = await gemini(
    "gemini-2.5-flash-lite",
    sys,
    [{ role: "user", parts: [{ text: `Últimas trocas:\n${ultimasTrocas}\n\nÚltima mensagem do cliente: "${pergunta}"` }] }],
    120,
    0,
  );
  const m = txt.match(/\{[\s\S]*\}/);
  if (!m) return { intencao: "A1", conversa_encerrada: false };
  try {
    const o = JSON.parse(m[0]);
    return {
      intencao: String(o.intencao || "A1").toUpperCase().trim(),
      conversa_encerrada: o.conversa_encerrada === true,
    };
  } catch {
    return { intencao: "A1", conversa_encerrada: false };
  }
}

// Cada grupo de intenção manda uma ordem diferente para o modelo. É isto que
// impede o relatório de processo de aparecer em cima de um desabafo.
function instrucaoDaIntencao(cod: string): string {
  const g = cod.charAt(0);
  if (g === "B") {
    return [
      "=== O QUE ESTA MENSAGEM PEDE DE VOCÊ ===",
      "O cliente NÃO perguntou do processo. Ele desabafou, trouxe notícia ou está",
      "ansioso. Responda como gente responde: reconheça o que ele disse, em uma ou",
      "duas frases. É PROIBIDO listar andamento, citar processo, data ou fase aqui.",
      "=== FIM ===",
    ].join("\n");
  }
  if (g === "C") {
    return [
      "=== O QUE ESTA MENSAGEM PEDE DE VOCÊ ===",
      "O cliente está ENTREGANDO alguma coisa — dado que pedimos, documento,",
      "horário, ou uma novidade do caso. Confirme que recebeu, curto, e diga o que",
      "acontece em seguida se souber. Nada de relatório de andamento.",
      "=== FIM ===",
    ].join("\n");
  }
  if (g === "E") {
    return [
      "=== O QUE ESTA MENSAGEM PEDE DE VOCÊ ===",
      "Isto é assunto de pessoa, não seu: reclamação, dinheiro, prazo, ou pedido de",
      "falar com alguém. Escreva uma resposta curta e acolhedora dizendo que já está",
      "acionando a equipe — sem prometer prazo, sem número, sem valor. A equipe foi",
      "avisada e vai assumir.",
      "=== FIM ===",
    ].join("\n");
  }
  return [
    "=== O QUE ESTA MENSAGEM PEDE DE VOCÊ ===",
    "O cliente perguntou algo. Responda o que ele perguntou — e só isso.",
    "Se a pergunta for de andamento, resuma cada processo em 2 ou 3 frases a partir",
    "das últimas movimentações. Se for outra coisa, NÃO puxe o andamento.",
    "=== FIM ===",
  ].join("\n");
}

/**
 * Toda decisão vira linha em dom_decisoes — inclusive o silêncio.
 *
 * Sem isto o piloto não responde a pergunta que importa: "ele está calando
 * demais, ou de menos?". Um atendente que nunca fala parece estar funcionando,
 * e esse é o pior jeito de falhar.
 */
async function registrar(
  supabase: any,
  g: any,
  decisao: "respondeu" | "silencio" | "humano" | "pulou",
  motivo: string,
  extra: { intencao?: string | null; pergunta?: string | null; pendente_id?: string | null } = {},
) {
  const { error } = await supabase.from("dom_decisoes").insert({
    group_jid: g.group_jid,
    group_name: g.group_name ?? null,
    decisao,
    motivo,
    intencao: extra.intencao ?? null,
    pergunta: extra.pergunta ?? null,
    pendente_id: extra.pendente_id ?? null,
  });
  // O registro nunca pode derrubar a rodada.
  if (error) console.error("[dom-rascunho] falha ao registrar decisão", error.message);
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

    // Prompt vem da TABELA, não da view: é lido mesmo com is_active = false.
    const { data: agente } = await supabase
      .from("wjia_command_shortcuts")
      .select("prompt_instructions, base_prompt, temperature, max_tokens, history_limit, model")
      .eq("id", DOM_AGENT_ID)
      .maybeSingle();
    if (!agente) return json({ error: "agente Dom não encontrado" }, 500);

    const { data: equipeRows } = await supabase
      .from("dom_numeros_equipe").select("phone").eq("ativo", true);
    const equipe = new Set((equipeRows ?? []).map((r: any) => so(r.phone)));

    let q = supabase.from("dom_grupos_piloto")
      .select("group_jid, group_name, lead_id, modo").eq("ativo", true);
    if (soEsteGrupo) q = q.eq("group_jid", soEsteGrupo);
    const { data: grupos } = await q.limit(limite);

    const pulados: any[] = [];
    let rascunhos = 0;

    for (const g of grupos ?? []) {
      // Puxa com folga porque a deduplicação corta 2,5 a 5 vezes.
      const { data: brutas } = await supabase
        .from("whatsapp_messages")
        .select("message_text, message_type, contact_name, instance_name, created_at, metadata")
        .eq("phone", g.group_jid)
        .order("created_at", { ascending: false })
        .limit((agente.history_limit || 20) * 5);

      // 1. Deduplica pelo id da mensagem no WhatsApp — a mesma mensagem chega
      //    uma vez por número nosso que está no grupo.
      const vistos = new Set<string>();
      const lista: any[] = [];
      for (const m of brutas ?? []) {
        const msg = (m.metadata as any)?.message ?? {};
        const mid = String(msg.messageid || msg.id || `${m.created_at}|${m.message_text}`);
        if (vistos.has(mid)) continue;
        vistos.add(mid);
        const remetente = so(msg.sender_pn || msg.sender);
        lista.push({
          texto: (m.message_text || "").trim(),
          tipo: m.message_type || "text",
          instancia: m.instance_name,
          criado: m.created_at,
          autor: msg.senderName || m.contact_name || null,
          // 2. fromMe é nosso envio; remetente na lista da equipe também é nosso.
          //    Quem não está na lista é tratado como cliente — errar respondendo
          //    um colega é visível; errar ignorando cliente é silencioso.
          daEquipe: msg.fromMe === true || (remetente !== "" && equipe.has(remetente)),
        });
      }
      lista.reverse();

      if (lista.length === 0) { pulados.push({ grupo: g.group_jid, motivo: "sem mensagens" }); await registrar(supabase, g, "pulou", "sem mensagens"); continue; }

      const ultima = lista[lista.length - 1];
      if (ultima.daEquipe) { pulados.push({ grupo: g.group_jid, motivo: "equipe falou por último" }); await registrar(supabase, g, "pulou", "equipe falou por último"); continue; }

      const pergunta = ultima.texto;
      if (pergunta.length < 3) { pulados.push({ grupo: g.group_jid, motivo: "última mensagem sem texto" }); await registrar(supabase, g, "pulou", "última mensagem sem texto"); continue; }

      const { data: jaTem } = await supabase
        .from("dom_respostas_pendentes").select("id")
        .eq("group_jid", g.group_jid).eq("pergunta", pergunta).limit(1).maybeSingle();
      if (jaTem) { pulados.push({ grupo: g.group_jid, motivo: "já rascunhado" }); continue; }

      // 3. Intenção antes de qualquer coisa cara.
      const ultimasTrocas = lista.slice(-6)
        .map((m) => `${m.daEquipe ? "EQUIPE" : "CLIENTE"}: ${m.texto.slice(0, 160)}`).join("\n");
      let cls: any;
      try {
        cls = await classificar(pergunta, ultimasTrocas);
      } catch (e) {
        pulados.push({ grupo: g.group_jid, motivo: `classificador falhou: ${(e as Error).message}` });
        continue;
      }
      const grupoIntencao = String(cls.intencao).charAt(0);

      // 4. Conversa terminada, ou nada que peça resposta: silêncio. O Dom é
      //    convidado na conversa, não dono dela — não insiste em ter a última
      //    palavra.
      if (cls.conversa_encerrada || grupoIntencao === "D") {
        const motivoSilencio = cls.conversa_encerrada
          ? "conversa encerrada: o cliente só reconheceu, não pediu nada novo"
          : "a intenção não pede resposta";
        pulados.push({ grupo: g.group_jid, motivo: `silêncio (${cls.intencao}${cls.conversa_encerrada ? ", conversa encerrada" : ""})` });
        await registrar(supabase, g, "silencio", motivoSilencio, { pergunta, intencao: cls.intencao });
        continue;
      }

      const ctxResp = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/dom-contexto`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({ group_jid: g.group_jid, pergunta }),
      });
      const domCtx = await ctxResp.json().catch(() => null);
      if (!domCtx || domCtx.error) { pulados.push({ grupo: g.group_jid, motivo: "contexto indisponível" }); await registrar(supabase, g, "pulou", "contexto indisponível", { pergunta, intencao: cls.intencao }); continue; }
      if (domCtx.atende === false) { pulados.push({ grupo: g.group_jid, motivo: domCtx.motivo || "fora do piloto" }); await registrar(supabase, g, "pulou", domCtx.motivo || "fora do piloto", { pergunta, intencao: cls.intencao }); continue; }

      const historico = lista
        .map((m) => {
          const t = m.texto || (m.tipo !== "text" ? `[${m.tipo}]` : "");
          if (!t) return null;
          return { role: m.daEquipe ? "model" : "user", parts: [{ text: t }] };
        })
        .filter(Boolean);

      const systemPrompt = [
        agente.prompt_instructions || agente.base_prompt || "",
        domCtx.blocos || "",
        instrucaoDaIntencao(cls.intencao),
      ].filter(Boolean).join("\n\n");

      let resposta = "";
      try {
        resposta = await gemini(
          "gemini-2.5-flash",
          systemPrompt,
          historico,
          Math.min(Math.max(agente.max_tokens || 1024, 256), 4096),
          (agente.temperature ?? 70) / 100,
        );
      } catch (e) {
        pulados.push({ grupo: g.group_jid, motivo: `modelo falhou: ${(e as Error).message}` });
        continue;
      }
      if (!resposta) { pulados.push({ grupo: g.group_jid, motivo: "resposta vazia" }); await registrar(supabase, g, "pulou", "resposta vazia", { pergunta, intencao: cls.intencao }); continue; }

      let motivo: string | null = null;
      resposta = resposta
        .replace(/\[REVISAR:\s*([^\]]*?)\s*\]/gi, (_m, mot) => {
          motivo = (String(mot) || "").trim() || "sem motivo informado";
          return "";
        })
        .replace(/\n{3,}/g, "\n\n").trim();

      // 5. Intenção do grupo E é de pessoa, não do Dom: sorteia o atendente do
      //    rodízio. O envio do aviso é do dom-avisar-atendente.
      let atendenteId: string | null = null;
      if (grupoIntencao === "E") {
        const { data: pick } = await supabase.rpc("pick_dom_atendente", { p_escopo: "reclamacao" });
        atendenteId = (pick as any) || null;
        motivo = motivo || `intenção ${cls.intencao}: precisa de atendente humano`;
      }

      const { data: linhaFila, error: errFila } = await supabase.from("dom_respostas_pendentes").insert({
        group_jid: g.group_jid,
        group_name: g.group_name || domCtx.contexto?.grupo || null,
        instance_name: ultima.instancia,
        lead_id: g.lead_id || domCtx.contexto?.lead_id || null,
        pergunta,
        pergunta_autor: ultima.autor,
        resposta_sugerida: resposta,
        intencao: cls.intencao,
        atendente_id: atendenteId,
        motivo_revisao: motivo || "modo rascunho: tudo passa por revisão",
        contexto_usado: domCtx.contexto || null,
        status: "pendente",
      }).select("id").maybeSingle();
      if (errFila) {
        pulados.push({ grupo: g.group_jid, motivo: `fila: ${errFila.message}` });
        await registrar(supabase, g, "pulou", `fila: ${errFila.message}`, { pergunta, intencao: cls.intencao });
        continue;
      }

      await registrar(
        supabase, g,
        atendenteId ? "humano" : "respondeu",
        motivo || "rascunho gerado",
        { pergunta, intencao: cls.intencao, pendente_id: (linhaFila as any)?.id ?? null },
      );
      rascunhos++;
      console.log(`[dom-rascunho] grupo=${g.group_jid} intencao=${cls.intencao} humano=${!!atendenteId} (${resposta.length}ch)`);
    }

    return json({ grupos: (grupos ?? []).length, rascunhos, pulados });
  } catch (e) {
    console.error("[dom-rascunho] erro", (e as Error)?.message);
    return json({ error: (e as Error)?.message ?? "erro" }, 500);
  }
});
