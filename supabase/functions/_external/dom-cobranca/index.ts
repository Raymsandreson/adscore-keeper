// =============================================================================
// dom-cobranca — o atendente virtual deixa de ser só reativo.
//
// Roda no Supabase EXTERNO (kmedldlepwiityjsdahz).
//
// O dom-rascunho responde quando o cliente fala. Esta função é o contrário:
// ela fala quando o cliente PAROU de falar. O que o cliente ficou de fazer já
// está gravado em `lead_client_commitments` — a mesma barra "Cliente ficou de"
// que aparece no topo da conversa. O que faltava era alguém cobrar.
//
// O QUE OS DADOS OBRIGARAM (levantamento de 04/09/2026, 21 pendências abertas
// nos 8 grupos do piloto, nenhuma jamais cobrada):
//
//   1. TEM DUPLICATA. "Mandar o processo que está com outra equipe de advogados
//      em São Luís" está gravado QUATRO vezes, com redações diferentes; o RG do
//      Andrés, duas; a folha do CadÚnico, duas. Cobrar item por item mandaria
//      quatro mensagens sobre a mesma coisa e o cliente concluiria, com razão,
//      que ninguém está lendo.
//
//   2. COMPARECIMENTO VENCIDO NÃO SE COBRA. "Comparecer à perícia dia 13 de
//      agosto" está aberta hoje, 4 de setembro. A perícia aconteceu (ou não) —
//      pedir para comparecer numa data que já passou é absurdo e estraga a
//      confiança. Isso não é cobrança, é pergunta, e pergunta é de gente.
//
// QUEM DECIDE: A IA, NÃO UM `if`
// A primeira versão desta função resolvia os dois casos acima com regra de
// código: `kind === 'comparecimento' && due_date < hoje`. Está errado, e o
// motivo é simples: `kind` é um RÓTULO QUE OUTRA IA ESCREVEU. Perícia gravada
// como 'documento' escapa da regra, e o cliente recebe "compareça dia 13 de
// agosto" em setembro. Regra de palavra-chave sobre dado que outra máquina
// classificou é fé cega numa máquina, não verificação.
//
// Então o código não separa mais nada. Ele entrega ao modelo TODAS as
// pendências abertas, com datas, a data de hoje e as últimas mensagens do
// grupo, e recebe de volta a decisão item a item: o que cobrar, o que deixar
// para uma pessoa, e por quê. Com a conversa na frente, ele também enxerga o
// que o código nunca enxergaria — que o cliente já mandou o documento ontem e
// ninguém deu baixa.
//
// O que continua no código são as travas MECÂNICAS, que não são interpretação:
// quantas mensagens, com que espaçamento, e não empilhar em cima de outra.
//
// TRAVAS
//   · uma cobrança por grupo a cada COOLDOWN_DIAS dias;
//   · não cobra se já existe mensagem na fila de envio daquele grupo — cobrança
//     empilhada em cima de resposta vira enxurrada;
//   · não cobra se existe rascunho pendente de revisão do grupo;
//   · grupo em modo `rascunho` gera rascunho, não envio. A chave "responde
//     sozinho" manda aqui igual manda no dom-rascunho.
//
// CONTRATO
//   POST { dry_run?: boolean = true, group_jid?: string, limite?: number = 8 }
//   →    { grupos, cobrancas, pulados: [{ grupo, motivo }] }
//
// SEGURANÇA: nada de texto de cliente nos logs. Só JID e contagem.
// =============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const DOM_AGENT_ID = "d6ad8eee-d6a3-452c-b852-b94ef8dd54bf";

/** Uma cobrança por grupo a cada tantos dias. */
const COOLDOWN_DIAS = 7;
/** A mesma janela do dom-rascunho: dá tempo de tirar da fila. */
const ATRASO_MIN = 5;

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

const dias = (iso: string | null): number | null => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.floor((Date.now() - t) / 86400000);
};

async function gemini(systemPrompt: string, pedido: string, maxTokens: number, temperatura: number) {
  const key = Deno.env.get("GOOGLE_AI_API_KEY");
  if (!key) throw new Error("GOOGLE_AI_API_KEY não configurada");

  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(key)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: pedido }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: {
          maxOutputTokens: maxTokens,
          temperature: temperatura,
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    },
  );
  if (!resp.ok) throw new Error(`Gemini HTTP ${resp.status}`);
  const data = await resp.json();
  return (data?.candidates?.[0]?.content?.parts ?? [])
    .map((p: any) => p?.text ?? "").join("").trim();
}

/**
 * O modelo faz as duas coisas de uma vez: decide o que dá para cobrar e
 * escreve a mensagem. Uma chamada só, e a decisão nasce olhando a mesma coisa
 * que a redação — separar em dois passos faria o redator cobrar item que o
 * triador já tinha entendido como perdido.
 *
 * Volta JSON. Se não voltar JSON legível, o grupo é pulado: uma cobrança que
 * ninguém sabe explicar não sai.
 */
function promptDeCobranca(itens: any[], conversa: string): string {
  const hoje = new Date().toLocaleDateString("pt-BR");
  const lista = itens.map((c) => {
    const partes = [
      `id: ${c.id}`,
      `pendência: ${c.title}`,
      c.kind ? `tipo anotado: ${c.kind}` : null,
      c.due_date ? `data combinada: ${new Date(`${c.due_date}T12:00:00`).toLocaleDateString("pt-BR")}` : "sem data combinada",
      c.promised_at ? `prometido há ${dias(c.promised_at) ?? "?"} dias` : null,
      c.reminder_count ? `já lembrado ${c.reminder_count}x` : "nunca lembrado",
    ].filter(Boolean);
    return `- { ${partes.join(" | ")} }`;
  });

  return [
    "=== SUA TAREFA AGORA ===",
    `Hoje é ${hoje}. Ninguém perguntou nada: VOCÊ está decidindo se vale puxar a`,
    "conversa para lembrar este cliente do que ele ficou de mandar ou fazer.",
    "",
    "PENDÊNCIAS ANOTADAS NESTE GRUPO:",
    ...lista,
    "",
    "ÚLTIMAS MENSAGENS DO GRUPO (o mais recente por último):",
    conversa || "(sem histórico disponível)",
    "",
    "PASSO 1 — DECIDA, ITEM A ITEM, o que entra na cobrança.",
    "Use julgamento, não a etiqueta. O campo 'tipo anotado' foi escrito por outro",
    "programa e pode estar errado — leia o texto da pendência.",
    "Deixe DE FORA (e diga o motivo) quando:",
    "  · a data já passou e a pendência era comparecer/ir a algum lugar. A coisa",
    "    já aconteceu ou já se perdeu; pedir para comparecer numa data vencida",
    "    destrói a confiança. Isso é pergunta de gente, não cobrança.",
    "  · a conversa mostra que o cliente já entregou aquilo, ou já explicou por que",
    "    não consegue, ou a equipe disse que não precisa mais.",
    "  · ainda é cedo: o cliente prometeu há pouco, ou a data combinada ainda não",
    "    chegou. Cobrar antes da hora é atropelar.",
    "  · a mesma coisa aparece em vários itens — escolha UM e descarte os outros",
    "    como repetição.",
    "",
    "PASSO 2 — Se sobrou algo, escreva UMA mensagem para o grupo:",
    "  · junte tudo numa conversa só, no máximo três assuntos;",
    "  · tom de quem lembra, não de quem cobra dívida: aquele documento destrava",
    "    o caso DELE;",
    "  · uma frase dizendo por que aquilo importa, em palavra simples;",
    "  · nada de termo jurídico, número de processo, prazo processual ou valor;",
    "  · termine perguntando se está difícil conseguir e oferecendo ajuda —",
    "    pendência parada quase sempre é falta de acesso, não de vontade;",
    "  · no máximo quatro linhas, e não se apresente.",
    "",
    "RESPONDA APENAS ESTE JSON, sem cercas de código:",
    '{"cobrar":[{"id":"<id>"}],"fora":[{"id":"<id>","motivo":"<curto>"}],"mensagem":"<texto ou vazio>"}',
    "",
    "Se nada dever ser cobrado agora, devolva cobrar vazio e mensagem vazia.",
    "=== FIM ===",
  ].join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  try {
    const corpo = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    // Ausente = ensaio. Função que fala com cliente sem ninguém ter perguntado
    // não pode disparar por acidente.
    const ensaio = corpo?.dry_run !== false;
    const soEsteGrupo = corpo?.group_jid ? String(corpo.group_jid).split("@")[0] : null;
    const limite = Math.min(Math.max(Number(corpo?.limite) || 8, 1), 20);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: agente } = await supabase
      .from("wjia_command_shortcuts")
      .select("prompt_instructions, base_prompt, temperature, max_tokens")
      .eq("id", DOM_AGENT_ID)
      .maybeSingle();
    if (!agente) return json({ error: "agente Dom não encontrado" }, 500);

    let q = supabase.from("dom_grupos_piloto")
      .select("group_jid, group_name, lead_id, modo").eq("ativo", true);
    if (soEsteGrupo) q = q.eq("group_jid", soEsteGrupo);
    const { data: grupos } = await q.limit(limite);

    const pulados: any[] = [];
    const cobrancas: any[] = [];

    for (const g of grupos ?? []) {
      // 1. Já tem coisa na fila deste grupo? Cobrança em cima de resposta
      //    pendente vira enxurrada, e a pessoa some do grupo.
      const { data: naFila } = await supabase
        .from("whatsapp_mensagens_agendadas").select("id")
        .eq("phone", g.group_jid).eq("ativo", true).limit(1).maybeSingle();
      if (naFila) { pulados.push({ grupo: g.group_jid, motivo: "já tem mensagem na fila" }); continue; }

      const { data: rascunhoAberto } = await supabase
        .from("dom_respostas_pendentes").select("id")
        .eq("group_jid", g.group_jid).eq("status", "pendente").limit(1).maybeSingle();
      if (rascunhoAberto) { pulados.push({ grupo: g.group_jid, motivo: "tem rascunho esperando revisão" }); continue; }

      // 2. Pendências em aberto do grupo.
      const { data: todas } = await supabase
        .from("lead_client_commitments")
        .select("id, title, kind, status, due_date, promised_at, last_reminded_at, reminder_count, instance_name")
        .eq("phone", g.group_jid)
        // 'cobrado' continua em aberto (ver OPEN_COMMITMENT_STATUSES no front):
        // é pendência que já foi lembrada uma vez e ainda não veio. Ela pode
        // voltar a ser cobrada depois do cooldown.
        .in("status", ["combinado", "cobrado"])
        .limit(50);

      const abertas = todas ?? [];
      if (abertas.length === 0) { pulados.push({ grupo: g.group_jid, motivo: "nenhuma pendência aberta" }); continue; }

      // 3. Cooldown — trava MECÂNICA, não interpretação: se o grupo foi
      //    lembrado há pouco, ele espera, por melhor que seja o argumento.
      const cobradoRecente = abertas.some((c: any) => {
        const d = dias(c.last_reminded_at);
        return d !== null && d < COOLDOWN_DIAS;
      });
      if (cobradoRecente) { pulados.push({ grupo: g.group_jid, motivo: `cobrado há menos de ${COOLDOWN_DIAS} dias` }); continue; }

      // 4. A conversa vai junto: é ela que mostra que o cliente já mandou o
      //    documento ontem, ou já explicou que não consegue. Sem isso a IA
      //    decide no escuro e cobra o que já chegou.
      const { data: brutas } = await supabase
        .from("whatsapp_messages")
        .select("message_text, contact_name, created_at, metadata")
        .eq("phone", g.group_jid)
        .order("created_at", { ascending: false })
        .limit(60);
      const vistos = new Set<string>();
      const conversa: string[] = [];
      for (const m of brutas ?? []) {
        const msg = (m.metadata as any)?.message ?? {};
        const mid = String(msg.messageid || msg.id || `${m.created_at}|${m.message_text}`);
        if (vistos.has(mid)) continue;
        vistos.add(mid);
        const t = (m.message_text || "").trim();
        if (!t) continue;
        conversa.push(`${msg.fromMe === true ? "NÓS" : (msg.senderName || m.contact_name || "CLIENTE")}: ${t.slice(0, 200)}`);
        if (conversa.length >= 15) break;
      }
      conversa.reverse();

      // 5. Uma chamada: o modelo tria e escreve.
      const systemPrompt = [
        agente.prompt_instructions || agente.base_prompt || "",
        promptDeCobranca(abertas, conversa.join("\n")),
      ].filter(Boolean).join("\n\n");

      let cru = "";
      try {
        cru = await gemini(
          systemPrompt,
          "Decida e escreva agora.",
          Math.min(Math.max(agente.max_tokens || 1024, 512), 2048),
          (agente.temperature ?? 70) / 100,
        );
      } catch (e) {
        pulados.push({ grupo: g.group_jid, motivo: `modelo falhou: ${(e as Error).message}` });
        continue;
      }

      // JSON ilegível = ninguém sabe explicar a cobrança = ela não sai.
      let decisao: any = null;
      const bloco = cru.match(/\{[\s\S]*\}/);
      if (bloco) { try { decisao = JSON.parse(bloco[0]); } catch { decisao = null; } }
      if (!decisao) { pulados.push({ grupo: g.group_jid, motivo: "modelo não devolveu decisão legível" }); continue; }

      const escolhidos = new Set(
        (Array.isArray(decisao.cobrar) ? decisao.cobrar : [])
          .map((x: any) => String(x?.id ?? x)),
      );
      const cobraveis = abertas.filter((c: any) => escolhidos.has(String(c.id)));
      let texto = String(decisao.mensagem || "").trim();

      if (cobraveis.length === 0 || !texto) {
        const fora = (Array.isArray(decisao.fora) ? decisao.fora : [])
          .map((f: any) => f?.motivo).filter(Boolean).slice(0, 3).join("; ");
        pulados.push({ grupo: g.group_jid, motivo: `a IA não cobrou nada${fora ? `: ${fora}` : ""}` });
        continue;
      }

      let motivo: string | null = null;
      texto = texto
        .replace(/\[REVISAR:\s*([^\]]*?)\s*\]/gi, (_m, mot) => {
          motivo = (String(mot) || "").trim() || "sem motivo informado";
          return "";
        })
        .replace(/\n{3,}/g, "\n\n").trim();

      if (!texto) { pulados.push({ grupo: g.group_jid, motivo: "resposta vazia" }); continue; }

      const instancia = cobraveis.find((c: any) => c.instance_name)?.instance_name ?? null;
      const resumo = cobraveis.map((c: any) => c.title).join(" · ");

      // O que ficou DE FORA é a parte que se precisa auditar: é ali que se vê
      // se ele está deixando de cobrar o que deveria.
      const fora = (Array.isArray(decisao.fora) ? decisao.fora : []).map((f: any) => {
        const item = abertas.find((c: any) => String(c.id) === String(f?.id));
        return { pendencia: item?.title ?? f?.id, motivo: f?.motivo ?? null };
      });

      if (ensaio) {
        cobrancas.push({
          grupo: g.group_jid, grupo_nome: g.group_name,
          cobrando: cobraveis.map((c: any) => c.title), fora, texto, ensaio: true,
        });
        continue;
      }

      // 5. O rascunho da cobrança entra na fila do painel igual ao do
      //    dom-rascunho — é o mesmo lugar de olhar o que ele fez.
      const { data: linhaFila } = await supabase.from("dom_respostas_pendentes").insert({
        group_jid: g.group_jid,
        group_name: g.group_name,
        instance_name: instancia,
        lead_id: g.lead_id,
        pergunta: `[cobrança] ${resumo}`.slice(0, 500),
        pergunta_autor: "Atendente virtual (ninguém perguntou)",
        resposta_sugerida: texto,
        intencao: "COBRANCA",
        motivo_revisao: motivo || (g.modo === "automatico"
          ? `cobrança de ${cobraveis.length} pendência(s) — sai sozinha em ${ATRASO_MIN} min`
          : `cobrança de ${cobraveis.length} pendência(s) — modo rascunho, não sai`),
        status: "pendente",
      }).select("id").maybeSingle();

      let agendado = false;
      if (g.modo === "automatico" && !motivo) {
        const quando = new Date(Date.now() + ATRASO_MIN * 60 * 1000).toISOString();
        const { data: ag, error: errAg } = await supabase
          .from("whatsapp_mensagens_agendadas").insert({
            phone: g.group_jid,
            instance_name: instancia,
            lead_id: g.lead_id,
            contact_name: g.group_name,
            mensagem: texto,
            mensagem_original: texto,
            proximo_envio_at: quando,
            repeticao: "nenhuma",
            intervalo: 1,
            unidade: "dias",
            // Se o cliente escrever antes da hora, a cobrança some: ele já
            // voltou a falar, e cobrar por cima seria não estar escutando.
            pular_se_responder: true,
            criado_por_nome: "Atendente virtual",
          }).select("id").maybeSingle();

        if (!errAg && linhaFila) {
          agendado = true;
          await supabase.from("dom_respostas_pendentes")
            .update({ agendamento_id: (ag as any).id })
            .eq("id", (linhaFila as any).id);
        }
      }

      // 6. Marca as pendências como cobradas SÓ quando a cobrança de fato
      //    entrou na fila. Marcar antes esconderia para sempre uma pendência
      //    que ninguém nunca cobrou.
      if (agendado) {
        const ids = cobraveis.map((c: any) => c.id);
        const agora = new Date().toISOString();
        for (const c of cobraveis) {
          await supabase.from("lead_client_commitments")
            .update({
              // 'cobrado' é o estado que a tabela já previa e ninguém usava:
              // continua aberta, mas agora a tela mostra que foi lembrada.
              status: "cobrado",
              last_reminded_at: agora,
              reminder_count: (c.reminder_count || 0) + 1,
            })
            .eq("id", c.id);
        }
        await supabase.from("lead_client_commitment_reminders").insert(
          ids.map((id: string) => ({
            commitment_id: id,
            reminded_by_name: "Atendente virtual",
            channel: "whatsapp",
            message_text: texto,
          })),
        );
      }

      await supabase.from("dom_decisoes").insert({
        group_jid: g.group_jid,
        group_name: g.group_name,
        decisao: agendado ? "respondeu" : "pulou",
        motivo: agendado
          ? `cobrança agendada (${cobraveis.length} pendências)`
          : motivo || "cobrança só rascunhada",
        intencao: "COBRANCA",
        pergunta: `[cobrança] ${resumo}`.slice(0, 500),
        pendente_id: (linhaFila as any)?.id ?? null,
      });

      cobrancas.push({ grupo: g.group_jid, grupo_nome: g.group_name, itens: cobraveis.length, fora: fora.length, agendado });
      console.log(`[dom-cobranca] grupo=${g.group_jid} itens=${cobraveis.length} agendado=${agendado}`);
    }

    return json({ grupos: (grupos ?? []).length, cobrancas: cobrancas.length, ensaio, detalhe: cobrancas, pulados });
  } catch (e) {
    console.error("[dom-cobranca] erro", (e as Error)?.message);
    return json({ error: (e as Error)?.message ?? "erro" }, 500);
  }
});
