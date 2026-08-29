// "Relacionamento Conosco" identificado por IA.
//
// A base tem 36 mil contatos e 91% deles sem relacionamento preenchido (medido
// em 25/08/2026). O papel da pessoa mora em três lugares, nessa ordem de
// riqueza:
//   1. o nome — "... parceiro Ibirarema/SP". O front resolve sozinho em
//      `detectClassificationFromName`, sem gastar IA. Cobre 894 contatos.
//   2. a ficha — observação, profissão, casos ligados. Cobre 13.096.
//   3. a CONVERSA do WhatsApp — 8.215 contatos que não têm mais nada além do
//      nome têm conversa com 3+ mensagens. É a maior fonte que sobrou, e é
//      onde está escrito de verdade quem é a pessoa para o escritório.
//
// Esta função lê 2 e 3. Também serve para CONTESTAR: recebendo `current`, ela
// diz se o que está cadastrado bate com o que a conversa mostra.
//
// A lista de status vem do cliente (contact_classifications daquele workspace) —
// a função nunca inventa status novo nem devolve slug fora da lista.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { geminiChat } from "../_shared/gemini.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-request-id, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const VAZIO = { suggested: [] as string[], confidence: "baixa", reason: "", mismatch: false };

/** Corta texto longo — observação de contato às vezes é um romance. */
const trecho = (v: unknown, max: number): string =>
  typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";

/** Últimas mensagens em texto corrido, do mais antigo para o mais novo. */
function transcrever(messages: unknown): string {
  if (!Array.isArray(messages)) return "";
  return messages
    .slice(-40)
    .map((m: any) => {
      const texto = trecho(m?.text, 300);
      if (!texto) return null;
      // "in" = o contato falando; "out" = o escritório. A direção é o que separa
      // "preciso de advogado" (prospect) de "somos um escritório" (disparo).
      const quem = m?.direction === "out" ? "ESCRITÓRIO" : "CONTATO";
      const quando = trecho(m?.at, 10);
      return `${quem}${quando ? ` (${quando})` : ""}: ${texto}`;
    })
    .filter(Boolean)
    .join("\n");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { contact, allowed, messages, current } = await req.json();

    const options: { name: string; label?: string }[] = Array.isArray(allowed)
      ? allowed.filter((o: any) => o && typeof o.name === "string" && o.name.trim())
      : [];
    const allowedNames = new Set(options.map((o) => o.name));
    if (allowedNames.size === 0) return json(VAZIO);

    const c = contact || {};
    const nome = trecho(c.name, 200);
    if (nome.length < 3) return json(VAZIO);

    const jaCadastrado: string[] = Array.isArray(current)
      ? current.filter((s: unknown) => typeof s === "string" && allowedNames.has(s))
      : [];

    const grupos: string[] = Array.isArray(c.groups)
      ? c.groups.map((g: unknown) => trecho(g, 80)).filter(Boolean).slice(0, 5)
      : [];
    const negocios: string[] = Array.isArray(c.leads)
      ? c.leads.map((l: unknown) => trecho(l, 80)).filter(Boolean).slice(0, 5)
      : [];
    const conversa = transcrever(messages);

    const ficha = [
      `Nome: ${nome}`,
      trecho(c.profession, 80) ? `Profissão: ${trecho(c.profession, 80)}` : null,
      trecho(c.city, 60) || trecho(c.state, 4)
        ? `Local: ${[trecho(c.city, 60), trecho(c.state, 4)].filter(Boolean).join("/")}`
        : null,
      trecho(c.notes, 600) ? `Observações: ${trecho(c.notes, 600)}` : null,
      grupos.length ? `Grupos de WhatsApp: ${grupos.join("; ")}` : null,
      negocios.length ? `Casos/negócios ligados a ele: ${negocios.join("; ")}` : null,
      jaCadastrado.length
        ? `Cadastrado hoje como: ${jaCadastrado.map((s) => options.find((o) => o.name === s)?.label || s).join(", ")}`
        : "Cadastrado hoje como: (nada)",
    ].filter(Boolean).join("\n");

    const userContent = conversa
      ? `${ficha}\n\n--- ÚLTIMAS MENSAGENS DA CONVERSA ---\n${conversa}`
      : ficha;

    const listaStatus = options
      .map((o) => `- "${o.name}" = ${o.label || o.name}`)
      .join("\n");

    const result = await geminiChat({
      model: "google/gemini-2.5-flash-lite",
      messages: [
        {
          role: "system",
          content: `Você classifica o relacionamento entre um escritório de advocacia e um contato da agenda dele.

Status disponíveis:
${listaStatus}

Como decidir:
- "partner" (parceiro) é quem INDICA casos para o escritório sem ser cliente — motorista de app, dono de oficina, agente de saúde, líder comunitário, corretor. Na conversa aparece falando de OUTRA pessoa ("tenho um amigo que sofreu acidente", "mandei seu contato pra ela"). É o caso mais comum na base.
- "client" é quem tem (ou teve) caso PRÓPRIO patrocinado pelo escritório. Na conversa fala do processo dele, manda documento pessoal, pergunta do dinheiro dele, assina procuração.
- "prospect" procurou (ou foi procurado), perguntou preço/direito e ainda não fechou.
- "supplier"/"prestador_servico" VENDE para o escritório (gráfica, contador, TI) — na conversa manda orçamento ou cobra pagamento.
- Advogado: "advogado_interno" é da equipe, "advogado_externo" é correspondente/parceiro de outro escritório, "advogado_adverso" é o do outro lado do processo.
- "parte_contraria" é a pessoa/empresa do outro lado.

Sobre a conversa:
- "CONTATO:" é a pessoa falando; "ESCRITÓRIO:" é a equipe. Só o que o CONTATO diz revela o papel dele.
- Disparo em massa sem resposta (só linhas "ESCRITÓRIO:") NÃO diz nada. Nesses casos devolva lista vazia e confiança "baixa".
- Conversa só de saudação, bom dia, corrente de mensagem ou figurinha também não diz nada.

Regras:
- Só escolha um status se o texto sustentar. Palavra solta como "advogado", "motorista" ou "empresa" NÃO diz o relacionamento sozinha.
- Pode devolver mais de um status quando o contato acumula papéis (ex.: cliente que também indica).
- Quando o campo "Cadastrado hoje como" já traz um status e a conversa não contradiz, repita o mesmo status. Só diga coisa diferente com evidência clara na conversa — e aí explique qual.
- Na dúvida, devolva lista vazia e confiança "baixa". Status errado em massa é pior que campo vazio.
- "reason" cita o trecho que sustenta a escolha, em no máximo 14 palavras.`,
        },
        { role: "user", content: userContent },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "classificar_relacionamento",
            description: "Devolve o relacionamento do contato com o escritório",
            parameters: {
              type: "object",
              properties: {
                status: {
                  type: "array",
                  description: "Slugs dos status escolhidos; vazio quando não dá para saber",
                  items: { type: "string", enum: options.map((o) => o.name) },
                },
                confidence: {
                  type: "string",
                  description: "Confiança na escolha",
                  enum: ["alta", "media", "baixa"],
                },
                reason: {
                  type: "string",
                  description: "O trecho que sustenta a escolha, em até 14 palavras",
                },
              },
              required: ["status", "confidence", "reason"],
            },
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "classificar_relacionamento" } },
    });

    const toolCall = result.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall?.function?.arguments) return json(VAZIO);

    let args: any = {};
    try {
      args = JSON.parse(toolCall.function.arguments);
    } catch {
      return json(VAZIO);
    }

    // Blindagem: nunca devolver slug fora da lista do workspace, nem repetido.
    const suggested: string[] = Array.isArray(args.status)
      ? ([...new Set(args.status.filter((s: unknown) => typeof s === "string" && allowedNames.has(s)))] as string[])
      : [];
    const confidence = ["alta", "media", "baixa"].includes(args.confidence) ? args.confidence : "baixa";

    // Contestação: só existe quando há algo cadastrado, a IA aponta outra coisa
    // e o que está hoje NÃO aparece na resposta dela. Sugerir "Cliente" para
    // quem já é "Cliente + Parceiro" não é divergência, é ruído.
    const mismatch =
      jaCadastrado.length > 0 &&
      suggested.length > 0 &&
      !jaCadastrado.some((s) => suggested.includes(s));

    return json({ suggested, confidence, reason: trecho(args.reason, 160), mismatch });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("suggest-contact-classification error:", e);
    // Degrada em silêncio: a tela só deixa de sugerir, ninguém vê erro.
    const isUpstream = /\b(429|500|502|503|504)\b/.test(msg) || /unavailable|overload|rate/i.test(msg);
    return json({ ...VAZIO, error: msg, fallback: isUpstream });
  }
});
