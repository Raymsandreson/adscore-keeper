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
//   5. (v6) `pergunta.length < 3` cortava "Ok" como "sem texto" e gravava
//      `pulou`, que NÃO bloqueia — o mesmo "Ok" voltava a cada 5 minutos, para
//      sempre: 36 linhas de decisão em 3 horas num grupo só. O mesmo corte
//      comia foto e documento, e cliente mandando o RG fotografado é justo a
//      hora de dizer "recebi".
//
// Daí esta versão: deduplica por messageid, separa equipe de cliente pelo
// remetente, e classifica a INTENÇÃO antes de decidir se escreve.
//
// CONTRATO
//   POST {}                → varre todos os grupos ativos do piloto
//   POST { group_jid }     → só aquele grupo
//   POST { group_jid, teste: true, pergunta? }
//                          → gera e DEVOLVE o texto sem gravar, sem
//                            áudio e sem agendar. Ignora as travas do
//                            cron (equipe falou por último, já
//                            rascunhado, já decidido, silêncio).
//   POST { limite }        → teto de grupos por rodada (padrão 8)
//   →     { grupos, rascunhos, pulados: [{ grupo, motivo }] }
//
// SEGURANÇA: nada de texto de cliente nos logs. Só JID, intenção e contagem.
// =============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const DOM_AGENT_ID = "d6ad8eee-d6a3-452c-b852-b94ef8dd54bf";

/** A janela entre escrever e falar. É ela que faz o papel da revisão. */
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

const so = (v: unknown) => String(v ?? "").replace(/\D/g, "");

/**
 * O que dizer ao classificador quando a mensagem não tem texto.
 *
 * Cortar mensagem sem texto parecia inofensivo e não era: cliente mandando a
 * foto do RG é EXATAMENTE a hora de dizer "recebi, obrigado" (intenção C9), e
 * o corte deixava ele falando sozinho. Aqui a mídia vira uma frase que o
 * classificador consegue ler, e a decisão volta a ser dele.
 */
function descricaoDeMidia(tipo: string): string {
  if (tipo === "image") return "[o cliente enviou uma foto]";
  if (tipo === "document") return "[o cliente enviou um documento]";
  if (tipo === "audio" || tipo === "ptt") return "[o cliente mandou um áudio que não deu para transcrever]";
  if (tipo === "video") return "[o cliente enviou um vídeo]";
  if (tipo === "location") return "[o cliente enviou a localização]";
  return "";
}

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
    '{"intencao":"<código>","conversa_encerrada":<true|false>,"quer_panorama":<true|false>}',
    "",
    "Códigos possíveis:",
    INTENCOES,
    "",
    "conversa_encerrada = true quando a última mensagem do cliente só reconhece o",
    "que já foi dito (obrigada, ok, tá bom, 👍) e não pede nada novo. Nesse caso a",
    "conversa acabou e ninguém precisa responder de volta.",
    "",
    "quer_panorama = true quando o cliente quer saber de TODOS os casos dele de",
    "uma vez, não de um caso específico. É a diferença entre perguntar do",
    "processo e perguntar da carteira. Julgue pelo SENTIDO do que ele escreveu,",
    "não por palavras soltas — a mesma palavra muda de sentido no contexto.",
    "",
    "  true  → ele pede a visão geral, um apanhado, quer ser atualizado de tudo,",
    "          pergunta pelos outros casos além do que já se falava, ou cobra um",
    "          resumo do que está pendente com o escritório.",
    "  false → ele fala de UM caso (mesmo sem nomear, se é o assunto das últimas",
    "          mensagens), cumprimenta, agradece, manda documento, ou faz uma",
    "          pergunta geral e vaga que não pede a carteira inteira.",
    "",
    "Na dúvida, false: perguntar de qual caso ele quer custa uma frase; despejar",
    "dez processos em cima de quem queria um custa a conversa.",
  ].join("\n");

  const txt = await gemini(
    "gemini-2.5-flash-lite",
    sys,
    [{ role: "user", parts: [{ text: `Últimas trocas:\n${ultimasTrocas}\n\nÚltima mensagem do cliente: "${pergunta}"` }] }],
    120,
    0,
  );
  const m = txt.match(/\{[\s\S]*\}/);
  if (!m) return { intencao: "A1", conversa_encerrada: false, quer_panorama: false };
  try {
    const o = JSON.parse(m[0]);
    return {
      intencao: String(o.intencao || "A1").toUpperCase().trim(),
      conversa_encerrada: o.conversa_encerrada === true,
      quer_panorama: o.quer_panorama === true,
    };
  } catch {
    return { intencao: "A1", conversa_encerrada: false, quer_panorama: false };
  }
}

// Cada grupo de intenção manda uma ordem diferente para o modelo. É isto que
// impede o relatório de processo de aparecer em cima de um desabafo.
function instrucaoDaIntencao(cod: string, panorama = false): string {
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
  // Este bloco é o ÚLTIMO do system prompt, a posição mais forte. Ele NUNCA
  // pode dizer um tamanho diferente do que o dom-contexto já disse: foi assim
  // que o agente listou quatro de sete, rachando a diferença entre duas ordens
  // opostas. Então ele só APONTA para a regra que está lá — e a regra que está
  // lá depende de o cliente ter pedido o panorama ou não.
  if (panorama) {
    return [
      "=== O QUE ESTA MENSAGEM PEDE DE VOCÊ ===",
      "O cliente pediu o PANORAMA: ele quer saber de todos os casos dele, não de",
      "um. Siga a regra O CLIENTE PEDIU O PANORAMA, acima, à risca.",
      "Um parágrafo curto para CADA processo, sem pular nenhum, com o nome do",
      "caso, como está hoje e o que mudou por último — com a data.",
      "Processo sem movimentação nova também entra: diga que não teve novidade.",
      "Deixar um de fora é o erro aqui.",
      "=== FIM ===",
    ].join("\n");
  }

  return [
    "=== O QUE ESTA MENSAGEM PEDE DE VOCÊ ===",
    "O cliente perguntou algo. Responda o que ele perguntou — e só isso.",
    "Se NÃO for pergunta de andamento, não puxe o andamento.",
    "",
    // Aqui morava "resuma cada processo em 2 ou 3 frases". Este bloco é o
    // ÚLTIMO do system prompt, a posição mais forte — e a ordem contradizia a
    // regra dos três degraus do dom-contexto. Testado em 05/09/2026 no grupo
    // Caso 217 (sete processos): o modelo, com as duas ordens na frente,
    // rachou a diferença e listou quatro. Quem manda no tamanho é a regra, e
    // ela é dita uma vez só.
    "Se FOR de andamento, quem manda é a regra QUANDO O CLIENTE TEM MAIS DE UM",
    "PROCESSO, acima. Ela não é sugestão e não tem exceção aqui:",
    "  · um processo        → resuma esse;",
    "  · dois ou três       → um parágrafo curto para cada;",
    "  · QUATRO OU MAIS     → é PROIBIDO listar. Diga quantos são, conte o que",
    "                         mexeu de mais recente em UM deles, e pergunte de",
    "                         qual ele quer saber.",
    "Listar quatro em vez de sete continua sendo listar.",
    "=== FIM ===",
  ].join("\n");
}

/**
 * Gera o áudio do rascunho — e SÓ isso. Não envia nada.
 *
 * O cliente manda áudio e recebe texto: quebra o combinado e quebra o ritmo,
 * porque quem fala espera ouvir. Mas áudio erra diferente de texto. Uma frase
 * torta escrita a pessoa relê e entende; uma voz dizendo algo errado sobre o
 * processo dela soa como o escritório falando, e não tem como desdizer.
 *
 * Por isso aqui é rascunho de verdade: grava, guarda a URL, e o áudio fica no
 * painel para alguém escutar. Nem em grupo `automatico` ele sai — o texto sai
 * como sempre, e o áudio espera liberação humana.
 *
 * Falha de áudio NUNCA derruba o rascunho de texto: devolve o motivo e segue.
 */
async function gerarAudioDoRascunho(
  supabase: any,
  texto: string,
  vozConfigurada: string | null,
  instanceName: string | null,
  maxChars: number,
): Promise<{ url: string | null; voz: string | null; erro: string | null }> {
  try {
    const chave = Deno.env.get("ELEVENLABS_API_KEY");
    if (!chave) return { url: null, voz: null, erro: "ELEVENLABS_API_KEY não configurada" };

    // O que se fala é diferente do que se escreve: asterisco de negrito virava
    // "asterisco" na boca da voz, e link lido em voz alta é ruído puro.
    const limpo = texto
      .replace(/\*([^*]+)\*/g, "$1")
      .replace(/_([^_]+)_/g, "$1")
      .replace(/https?:\/\/\S+/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (limpo.length < 5) return { url: null, voz: null, erro: "texto curto demais para virar áudio" };

    // Mesma cascata de resolução do whatsapp-ai-agent-reply, para a voz do
    // atendente virtual ser a MESMA em qualquer caminho.
    let voiceId = vozConfigurada || "FGY2WhTYpPnrIDTdsKH5";
    let nomeDaVoz: string | null = null;
    if (voiceId === "instance_owner") {
      const { data: inst } = await supabase.from("whatsapp_instances")
        .select("voice_id").eq("instance_name", instanceName).maybeSingle();
      voiceId = inst?.voice_id || "FGY2WhTYpPnrIDTdsKH5";
    }
    if (voiceId.length === 36 && voiceId.includes("-")) {
      const { data: vozCustom } = await supabase.from("custom_voices")
        .select("name, elevenlabs_voice_id").eq("id", voiceId).eq("status", "ready").maybeSingle();
      nomeDaVoz = vozCustom?.name ?? null;
      voiceId = vozCustom?.elevenlabs_voice_id || "FGY2WhTYpPnrIDTdsKH5";
    }

    const trecho = limpo.length > maxChars ? limpo.slice(0, maxChars) : limpo;
    const resp = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_22050_32`,
      {
        method: "POST",
        headers: { "xi-api-key": chave, "Content-Type": "application/json" },
        body: JSON.stringify({
          text: trecho,
          model_id: "eleven_multilingual_v2",
          voice_settings: { stability: 0.6, similarity_boost: 0.75, style: 0.3, speed: 1.1 },
        }),
      },
    );
    if (!resp.ok) return { url: null, voz: nomeDaVoz, erro: `ElevenLabs HTTP ${resp.status}` };

    const audio = await resp.arrayBuffer();
    const arquivo = `tts/dom-rascunho-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp3`;
    const { error: errUp } = await supabase.storage.from("whatsapp-media")
      .upload(arquivo, new Uint8Array(audio), { contentType: "audio/mpeg", upsert: false });
    if (errUp) return { url: null, voz: nomeDaVoz, erro: `storage: ${errUp.message}` };

    const { data: pub } = supabase.storage.from("whatsapp-media").getPublicUrl(arquivo);
    return { url: pub?.publicUrl ?? null, voz: nomeDaVoz, erro: null };
  } catch (e) {
    return { url: null, voz: null, erro: (e as Error)?.message ?? "erro" };
  }
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

    // MODO TESTE — só com group_jid explícito.
    // As travas deste arquivo existem para o CRON: não falar por cima da
    // equipe, não rascunhar duas vezes a mesma pergunta, não reclassificar o
    // que já foi decidido. Nenhuma delas diz respeito à QUALIDADE do texto, e
    // todas juntas tornam impossível ver o efeito de uma mudança de prompt num
    // grupo escolhido a dedo — que é justamente onde o defeito aparece.
    // Então `teste: true` ignora as travas e, em troca, não grava rascunho,
    // não gera áudio e não agenda envio: devolve o texto que sairia e para.
    // O cliente não vê nada.
    const teste = corpo?.teste === true && !!soEsteGrupo;
    const perguntaTeste = teste && corpo?.pergunta ? String(corpo.pergunta).trim() : null;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // Prompt vem da TABELA, não da view: é lido mesmo com is_active = false.
    const { data: agente } = await supabase
      .from("wjia_command_shortcuts")
      .select("prompt_instructions, base_prompt, temperature, max_tokens, history_limit, model, reply_with_audio, reply_voice_id, max_tts_chars, genero_voz")
      .eq("id", DOM_AGENT_ID)
      .maybeSingle();
    if (!agente) return json({ error: "agente Dom não encontrado" }, 500);

    const { data: equipeRows } = await supabase
      .from("dom_numeros_equipe").select("phone").eq("ativo", true);
    const equipe = new Set((equipeRows ?? []).map((r: any) => so(r.phone)));

    // QUEM OLHAR
    // Com 8 grupos dava para varrer todos. Com mais de mil, `select ... limit 8`
    // sem ordenação olharia sempre os mesmos oito e os outros nunca — o piloto
    // pareceria funcionar e a maior parte dos clientes ficaria sem resposta,
    // calada. A conta vira do avesso: `dom_grupos_para_olhar` parte das
    // MENSAGENS e devolve só grupo onde o cliente falou DEPOIS da última
    // decisão, o mais recente primeiro. Grupo parado não custa nada.
    let grupos: any[] = [];
    if (soEsteGrupo) {
      const { data } = await supabase.from("dom_grupos_piloto")
        .select("group_jid, group_name, lead_id, modo")
        .eq("ativo", true).eq("group_jid", soEsteGrupo).limit(1);
      grupos = data ?? [];
    } else {
      const { data, error } = await supabase.rpc("dom_grupos_para_olhar", { p_limite: limite });
      if (error) return json({ error: `fila de grupos: ${error.message}` }, 500);
      grupos = data ?? [];
    }

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
      if (ultima.daEquipe && !teste) { pulados.push({ grupo: g.group_jid, motivo: "equipe falou por último" }); await registrar(supabase, g, "pulou", "equipe falou por último"); continue; }

      // Texto curto NÃO é motivo para pular. "Ok" tem dois caracteres e é uma
      // conversa se encerrando — quem tem que dizer isso é o classificador, que
      // devolve D13 e grava SILÊNCIO. O corte antigo (`length < 3`) gravava
      // `pulou`, que não bloqueia: o mesmo "Ok" era reclassificado a cada cinco
      // minutos, para sempre. Um grupo sozinho gerou 36 linhas em 3 horas.
      const pergunta = perguntaTeste || ultima.texto || descricaoDeMidia(ultima.tipo);
      if (!pergunta) {
        // Aqui sim não há o que ler. Registra SILÊNCIO (decisão final, que
        // bloqueia) em vez de `pulou`, para não repetir a conta eternamente.
        pulados.push({ grupo: g.group_jid, motivo: "mensagem sem nada que dê para ler" });
        await registrar(supabase, g, "silencio", "mensagem sem nada que dê para ler", {
          // A pergunta vai junto para o bloqueio funcionar: `jaDecidiu` casa por
          // (grupo, pergunta), e silêncio sem pergunta não impede nada.
          pergunta: `[${ultima.tipo} sem conteúdo em ${ultima.criado}]`,
        });
        continue;
      }

      const { data: jaTem } = await supabase
        .from("dom_respostas_pendentes").select("id")
        .eq("group_jid", g.group_jid).eq("pergunta", pergunta).limit(1).maybeSingle();
      if (jaTem && !teste) { pulados.push({ grupo: g.group_jid, motivo: "já rascunhado" }); continue; }

      // Rascunho gerado deixa rastro na fila; SILÊNCIO não deixa. Sem esta
      // segunda checagem, um grupo parado num "obrigada" seria reclassificado a
      // cada rodada do cron, para sempre: uma chamada de modelo a cada cinco
      // minutos para reconfirmar a mesma decisão, e dom_decisoes inchando com a
      // mesma linha repetida.
      //
      // Só decisão FINAL bloqueia. 'pulou' fica de fora de propósito: ela cobre
      // tropeço passageiro (contexto indisponível, modelo fora do ar), e isso
      // merece nova tentativa na rodada seguinte.
      const { data: jaDecidiu } = await supabase
        .from("dom_decisoes").select("id, decisao")
        .eq("group_jid", g.group_jid).eq("pergunta", pergunta)
        .in("decisao", ["silencio", "respondeu", "humano"])
        .limit(1).maybeSingle();
      if (jaDecidiu && !teste) {
        pulados.push({ grupo: g.group_jid, motivo: `já decidido antes (${(jaDecidiu as any).decisao})` });
        continue;
      }

      // 3. Intenção antes de qualquer coisa cara.
      const ultimasTrocas = lista.slice(-6)
        .map((m) => `${m.daEquipe ? "EQUIPE" : "CLIENTE"}: ${(m.texto || descricaoDeMidia(m.tipo)).slice(0, 160)}`).join("\n");
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
      if ((cls.conversa_encerrada || grupoIntencao === "D") && !teste) {
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
        body: JSON.stringify({ group_jid: g.group_jid, pergunta, panorama: cls.quer_panorama === true }),
      });
      const domCtx = await ctxResp.json().catch(() => null);
      if (!domCtx || domCtx.error) { pulados.push({ grupo: g.group_jid, motivo: "contexto indisponível" }); await registrar(supabase, g, "pulou", "contexto indisponível", { pergunta, intencao: cls.intencao }); continue; }
      if (domCtx.atende === false) { pulados.push({ grupo: g.group_jid, motivo: domCtx.motivo || "fora do piloto" }); await registrar(supabase, g, "pulou", domCtx.motivo || "fora do piloto", { pergunta, intencao: cls.intencao }); continue; }

      const historico = lista
        .map((m) => {
          const t = m.texto || descricaoDeMidia(m.tipo) || (m.tipo !== "text" ? `[${m.tipo}]` : "");
          if (!t) return null;
          return { role: m.daEquipe ? "model" : "user", parts: [{ text: t }] };
        })
        .filter(Boolean);

      // Sem isto o modelo receberia a conversa terminando na fala da EQUIPE e
      // não teria pergunta nenhuma para responder.
      if (teste && perguntaTeste) {
        historico.push({ role: "user", parts: [{ text: perguntaTeste }] } as any);
      }

      // O gênero morava no banco e não chegava ao modelo. Em texto ninguém
      // nota; falado por uma voz de mulher, "obrigado" soa errado na hora — e o
      // primeiro áudio gerado saiu exatamente assim, feminino na boca de uma voz
      // masculina.
      const generoVoz = String(agente.genero_voz || "").toLowerCase();
      const blocoDeGenero = generoVoz === "feminina" || generoVoz === "masculina"
        ? [
            "=== COMO VOCÊ SE REFERE A SI MESMO ===",
            generoVoz === "feminina"
              ? 'Você é uma mulher. Escreva sempre no feminino ao falar de si: "obrigada", "eu mesma", "fico à disposição".'
              : 'Você é um homem. Escreva sempre no masculino ao falar de si: "obrigado", "eu mesmo", "fico à disposição".',
            "Isto vale mesmo quando a resposta virar áudio — a voz e o texto têm que",
            "combinar. Não muda nada sobre o cliente: trate-o como ele se apresenta.",
            "=== FIM ===",
          ].join("\n")
        : "";

      const systemPrompt = [
        agente.prompt_instructions || agente.base_prompt || "",
        domCtx.blocos || "",
        blocoDeGenero,
        instrucaoDaIntencao(cls.intencao, cls.quer_panorama === true),
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

      // Fim do modo teste: nada entra na fila, nada é agendado, nada é falado.
      if (teste) {
        const c: any = domCtx.contexto ?? {};
        return json({
          teste: true,
          grupo: g.group_name ?? g.group_jid,
          casos: (c.processos ?? []).length + (c.requerimentos_inss ?? []).length,
          pergunta,
          intencao: cls.intencao,
          conversa_encerrada: cls.conversa_encerrada ?? null,
          panorama: cls.quer_panorama === true,
          precisa_revisao: motivo,
          resposta,
          gravou: false,
        });
      }

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
        motivo_revisao: motivo || (g.modo === "automatico"
          ? "modo automático: entra na fila de envio"
          : "modo rascunho: tudo passa por revisão"),
        contexto_usado: domCtx.contexto || null,
        status: "pendente",
      }).select("id").maybeSingle();
      if (errFila) {
        pulados.push({ grupo: g.group_jid, motivo: `fila: ${errFila.message}` });
        await registrar(supabase, g, "pulou", `fila: ${errFila.message}`, { pergunta, intencao: cls.intencao });
        continue;
      }

      // 6. O cliente falou por áudio? Então a resposta nasce falada também —
      //    mas SÓ como rascunho. Ver gerarAudioDoRascunho: nem em grupo
      //    automático o áudio sai; quem sai é o texto, como sempre.
      const clientePorAudio = ["audio", "ptt", "voice"].includes(String(ultima.tipo || "").toLowerCase());
      if (clientePorAudio && agente.reply_with_audio === true && (linhaFila as any)?.id) {
        const som = await gerarAudioDoRascunho(
          supabase,
          resposta,
          agente.reply_voice_id ?? null,
          ultima.instancia,
          Math.min(Math.max(agente.max_tts_chars || 500, 100), 1000),
        );
        await supabase.from("dom_respostas_pendentes")
          .update({ audio_url: som.url, audio_voz: som.voz, audio_erro: som.erro })
          .eq("id", (linhaFila as any).id);
        if (som.erro) console.warn(`[dom-rascunho] áudio falhou grupo=${g.group_jid}: ${som.erro}`);
      }

      // 7. Modo automático: o rascunho entra na MESMA fila de agendamento que a
      //    equipe já usa. É de lá que sai a bolha tracejada com o cronômetro na
      //    conversa, o "tirar da fila" e o "enviar agora" — nada disso precisou
      //    ser escrito de novo.
      //
      //    A janela de 5 minutos É a revisão: silêncio aprova. E `pular_se_
      //    responder` garante o resto — se o cliente OU um colega escrever no
      //    grupo dentro da janela, a resposta não sai. Rascunho velho não fala,
      //    e o tique seguinte redesenha em cima do que foi dito.
      //
      //    Fica de fora, de propósito: grupo de reclamação (já foi para uma
      //    pessoa) e resposta que o próprio modelo marcou com [REVISAR] — nesses
      //    dois o silêncio não pode valer como aprovação.
      const pendenteId = (linhaFila as any)?.id ?? null;
      let agendadoPara: string | null = null;
      if (g.modo === "automatico" && !atendenteId && !motivo) {
        const quando = new Date(Date.now() + ATRASO_MIN * 60 * 1000).toISOString();
        const { data: ag, error: errAg } = await supabase
          .from("whatsapp_mensagens_agendadas").insert({
            phone: g.group_jid,
            instance_name: ultima.instancia,
            lead_id: g.lead_id || domCtx.contexto?.lead_id || null,
            contact_name: g.group_name || null,
            mensagem: resposta,
            mensagem_original: resposta,
            proximo_envio_at: quando,
            repeticao: "nenhuma",
            intervalo: 1,
            unidade: "dias",
            pular_se_responder: true,
            criado_por_nome: "Atendente virtual",
          }).select("id").maybeSingle();

        if (errAg) {
          // Falhar aqui não pode perder o rascunho: ele continua na fila para
          // revisão humana, que é o comportamento antigo e seguro.
          pulados.push({ grupo: g.group_jid, motivo: `agendamento: ${errAg.message}` });
        } else if (pendenteId) {
          agendadoPara = quando;
          await supabase.from("dom_respostas_pendentes")
            .update({
              agendamento_id: (ag as any).id,
              motivo_revisao: `sai sozinho em ${ATRASO_MIN} min — some se alguém escrever antes`,
            })
            .eq("id", pendenteId);
        }
      }

      await registrar(
        supabase, g,
        atendenteId ? "humano" : "respondeu",
        motivo || (agendadoPara ? `agendado para ${agendadoPara}` : "rascunho gerado"),
        { pergunta, intencao: cls.intencao, pendente_id: pendenteId },
      );
      rascunhos++;
      console.log(`[dom-rascunho] grupo=${g.group_jid} intencao=${cls.intencao} panorama=${cls.quer_panorama === true} humano=${!!atendenteId} agendado=${!!agendadoPara} (${resposta.length}ch)`);
    }

    return json({ grupos: (grupos ?? []).length, rascunhos, pulados });
  } catch (e) {
    console.error("[dom-rascunho] erro", (e as Error)?.message);
    return json({ error: (e as Error)?.message ?? "erro" }, 500);
  }
});
