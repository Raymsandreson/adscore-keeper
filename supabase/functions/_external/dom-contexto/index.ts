// =============================================================================
// dom-contexto — monta o contexto do Dom (Assessor Jurídico Virtual). Roda no
// projeto EXTERNO (kmedldlepwiityjsdahz), NÃO no cloud. Deploy:
// supabase functions deploy dom-contexto --project-ref kmedldlepwiityjsdahz
//
// POR QUE ISTO EXISTE
// O agente "DOM-Atendente Processual" tem no base_prompt a instrução "Extraia do
// histórico todos os dados do(s) processo(s)" e "Nunca peça o número do
// processo". Ou seja: hoje ele tenta deduzir o andamento lendo conversa antiga.
// É a razão de ele estar desligado. Esta função entrega o andamento pronto, dos
// dados reais, e as respostas que a EQUIPE já deu para perguntas parecidas.
//
// Fica separada de whatsapp-ai-agent-reply (44 mil chars, v42, em produção)
// justamente para não mexer no que já funciona: lá entra só a chamada.
//
// CONTRATO
//   POST { group_jid, pergunta?, limite_exemplos? }
//   →    { atende, modo, tem_vinculo, blocos, contexto, exemplos_usados }
//
//   atende=false  → o grupo não está em dom_grupos_piloto. O chamador deve
//                   ficar calado. Fora do piloto o Dom não responde.
//   blocos        → texto pronto para concatenar no system prompt.
// =============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

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

// Datas do banco chegam em ISO ou em texto solto (lead_processes.data_* é text).
// O modelo lida muito melhor com dd/mm/aaaa, então normalizamos o que der.
function dataBR(v: unknown): string {
  if (!v) return "";
  const s = String(v);
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  return s.slice(0, 40);
}

// O `despacho` do INSS chega com entidades HTML cruas — medido em 21/08/2026:
// "Certid&atilde;o de nascimento", "&oacute;bito". Sem decodificar, o Dom
// repete isso literalmente para o cliente.
const ENTIDADES: Record<string, string> = {
  aacute: "á", agrave: "à", atilde: "ã", acirc: "â",
  eacute: "é", ecirc: "ê", iacute: "í",
  oacute: "ó", otilde: "õ", ocirc: "ô",
  uacute: "ú", uuml: "ü", ccedil: "ç",
  Aacute: "Á", Atilde: "Ã", Acirc: "Â",
  Eacute: "É", Ecirc: "Ê", Iacute: "Í",
  Oacute: "Ó", Otilde: "Õ", Ocirc: "Ô",
  Uacute: "Ú", Ccedil: "Ç",
  amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " ",
};

function decodeHtml(s: string): string {
  return s
    .replace(/&([A-Za-z]+);/g, (m, nome) => ENTIDADES[nome] ?? m)
    .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)))
    .replace(/<[^>]+>/g, " ");
}

function diasDesde(v: unknown): number | null {
  if (!v) return null;
  const t = Date.parse(String(v));
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86_400_000);
}

// ---------------------------------------------------------------------------
// Bloco 1 — o andamento real
// ---------------------------------------------------------------------------
/**
 * O que a EQUIPE registrou por último sobre este caso.
 *
 * Faltava, e a falta aparecia: o agente respondia a partir do que o tribunal
 * publicou, ignorando o que o assessor tinha acabado de anotar e de combinar
 * com o cliente. Duas vozes contando histórias diferentes no mesmo grupo.
 *
 * A anotação é interna e escrita em telegrama ("jv 22/06: a reclamada
 * protocolou novo ED"). Serve para o agente NÃO CONTRADIZER a equipe — não
 * para ser repetida ao cliente.
 */
function blocoAtividade(atv: any): string {
  if (!atv?.titulo && !atv?.como_esta) return "";

  const linhas = ["=== O QUE A EQUIPE JÁ FEZ E COMBINOU (anotação interna) ==="];
  if (atv.titulo) linhas.push(`Atividade: ${atv.titulo}`);
  if (atv.assunto) linhas.push(`Assunto: ${atv.assunto}`);
  if (atv.status) linhas.push(`Situação da atividade: ${atv.status}`);
  if (atv.quando) linhas.push(`Anotado em: ${dataBR(atv.quando)}`);
  if (atv.como_esta) {
    linhas.push("Como o caso está, segundo a equipe:");
    linhas.push(String(atv.como_esta).split("\n").map((l: string) => `  ${l}`).join("\n"));
  }
  if (atv.proximo_passo) {
    linhas.push(`Próximo passo definido pela equipe: ${atv.proximo_passo}`);
  }
  linhas.push("");
  linhas.push("COMO USAR: isto é recado interno, em telegrama e com abreviação. NUNCA");
  linhas.push("copie. Serve para você não dizer o contrário do que a equipe já disse ao");
  linhas.push("cliente, e para saber o que ela combinou de fazer em seguida.");
  linhas.push("=== FIM ===");
  return linhas.join("\n");
}

function blocoProcessual(ctx: any): string {
  const procs: any[] = ctx?.processos ?? [];
  const reqs: any[] = ctx?.requerimentos_inss ?? [];

  if (!ctx?.tem_vinculo || (procs.length === 0 && reqs.length === 0)) {
    // Importante ser explícito: sem isso o modelo preenche o vazio com
    // invenção, que é exatamente o risco que estamos tentando eliminar.
    return [
      "=== ANDAMENTO PROCESSUAL ===",
      "Este grupo NÃO está vinculado a nenhum processo na nossa base.",
      "Você NÃO tem informação de andamento aqui. Se perguntarem sobre o processo,",
      "NÃO invente, NÃO estime prazo e NÃO diga que vai verificar no sistema.",
      "Diga que vai acionar a equipe e emita o marcador [REVISAR: grupo sem processo vinculado].",
      "=== FIM ANDAMENTO PROCESSUAL ===",
    ].join("\n");
  }

  const linhas: string[] = [
    "=== ANDAMENTO PROCESSUAL (fonte: nossa base, sincronizada do Escavador/DataJud) ===",
    "Estes são os ÚNICOS dados de processo que você tem. Nunca vá além deles.",
    "",
    "ATENÇÃO AO TRADUZIR: os resumos abaixo foram escritos para a EQUIPE INTERNA,",
    'não para o cliente. Eles contêm frases como "a equipe deve acompanhar",',
    '"anotar na pauta", "sem necessidade de providência". NUNCA repita isso para o',
    "cliente — é recado interno e soa como se ninguém estivesse cuidando do caso.",
    "Extraia o FATO (o que aconteceu, em que data, o que vem a seguir) e conte com",
    "as suas palavras, como quem explica para alguém sem formação jurídica.",
    "",
  ];

  // --- Lado administrativo (INSS) ---
  // Vem primeiro de propósito: é o que tem prazo curto correndo contra o
  // cliente. Exigência não cumprida em 30 dias derruba o requerimento.
  for (const r of reqs) {
    linhas.push(`REQUERIMENTO INSS ${r.numero ?? "(sem número)"} — administrativo`);
    if (r.beneficio) linhas.push(`  Benefício: ${r.beneficio}`);
    if (r.servico) linhas.push(`  Serviço: ${r.servico}`);
    if (r.status) linhas.push(`  Situação: ${r.status}`);
    if (r.protocolado_em) linhas.push(`  Protocolado em: ${dataBR(r.protocolado_em)}`);
    if (r.numero_beneficio) linhas.push(`  Número do benefício: ${r.numero_beneficio}`);
    if (r.resultado) linhas.push(`  Resultado: ${r.resultado}`);

    if (r.despacho) {
      const d = decodeHtml(String(r.despacho)).replace(/\s+/g, " ").trim();
      linhas.push(`  Despacho do INSS (texto oficial): ${d}`);
    }

    if (String(r.status ?? "").toLowerCase().includes("exig")) {
      const dias = diasDesde(r.em_exigencia_desde);
      linhas.push(
        "  PRIORIDADE: este requerimento está EM EXIGÊNCIA" +
          (dias !== null ? ` há ${dias} dias` : "") +
          ". O INSS pediu uma providência e há prazo correndo — normalmente 30" +
          " dias, contados do despacho. Se o cliente tocar no assunto, explique" +
          " em palavras simples o que o INSS está pedindo e a urgência, sem" +
          " assustar. Se ele já disse que resolveu, não fique repetindo a cobrança.",
      );
    }
    linhas.push("");
  }

  // --- Lado judicial ---
  for (const p of procs) {
    linhas.push(`PROCESSO ${p.numero} — ${p.esfera}`);

    // A FASE vem PRIMEIRO porque é a resposta curta a "como está meu
    // processo?". Sem ela o modelo pegava o andamento mais recente e o
    // descrevia como se fosse o estado do caso — foi assim que uma
    // "confirmação de intimação eletrônica (evento 195)", que o próprio
    // resumo chamava de rotina do sistema, virou "seu processo está na fase de
    // intimação eletrônica" na boca dele.
    if (p.fase_atual?.fase) {
      const d = diasDesde(p.fase_atual.desde);
      linhas.push(
        `  >>> FASE ATUAL: ${p.fase_atual.fase}` +
          (p.fase_atual.desde ? ` — desde ${dataBR(p.fase_atual.desde)}` : "") +
          (d !== null && d >= 0 ? ` (há ${d} dias nesta fase)` : ""),
      );
      linhas.push("      É ISTO que responde \"como está meu processo?\". Movimentação de");
      linhas.push("      rotina não é fase.");
    }

    const marcos: any[] = p.marcos ?? [];
    if (marcos.length > 1) {
      linhas.push(`  Caminho até aqui: ${marcos.slice().reverse()
        .map((m: any) => `${m.fase} (${dataBR(m.desde)})`).join(" → ")}`);
    }

    if (p.titulo) linhas.push(`  Caso: ${p.titulo}`);
    if (p.status) linhas.push(`  Situação: ${p.status}`);
    if (p.tribunal) linhas.push(`  Tribunal: ${p.tribunal}${p.grau ? ` (${p.grau})` : ""}`);
    if (p.orgao) linhas.push(`  Vara/Órgão: ${p.orgao}`);
    if (p.assunto) linhas.push(`  Assunto: ${p.assunto}`);
    if (p.distribuido_em) linhas.push(`  Distribuído em: ${dataBR(p.distribuido_em)}`);

    if (p.arquivado) linhas.push("  ATENÇÃO: processo consta ARQUIVADO.");
    if (p.segredo_justica) {
      linhas.push("  ATENÇÃO: corre em SEGREDO DE JUSTIÇA — não detalhe conteúdo no grupo.");
    }

    const dias = diasDesde(p.ultima_movimentacao);
    if (p.ultima_movimentacao) {
      if (dias !== null && dias < 0) {
        // Medido em 04/09/2026: 16 processos com data_ultima_movimentacao no
        // FUTURO, o mais distante em 03/12/2026. Provavelmente data de prazo ou
        // audiência gravada como movimentação. Esconder a linha só trocaria um
        // número errado por um silêncio errado — e o processo continuaria torto.
        // Então ela aparece, marcada, e a resposta vai para a esteira de
        // conserto em vez de virar promessa ao cliente.
        linhas.push(
          `  Última movimentação: ${dataBR(p.ultima_movimentacao)} — DATA INCONSISTENTE,` +
            ` está no futuro. NÃO diga esta data ao cliente e NÃO afirme que o processo` +
            ` andou nela. Responda sobre o resto e emita [REVISAR: data de movimentação` +
            ` no futuro neste processo].`,
        );
      } else {
        linhas.push(
          `  Última movimentação: ${dataBR(p.ultima_movimentacao)}` +
            (dias !== null ? ` (há ${dias} dias)` : ""),
        );
      }
    }

    if (p.resultado?.situacao) {
      linhas.push(
        `  Resultado registrado: ${p.resultado.situacao}` +
          (p.resultado.tipo ? ` — ${p.resultado.tipo}` : "") +
          (p.resultado.data ? ` em ${dataBR(p.resultado.data)}` : ""),
      );
    }

    const decisoes: any[] = p.decisoes ?? [];
    if (decisoes.length) {
      linhas.push("  Decisões:");
      for (const d of decisoes) {
        linhas.push(
          `    - ${dataBR(d.data)} | ${d.tipo ?? "decisão"}` +
            (d.instancia ? ` (${d.instancia})` : "") +
            (d.titulo ? ` — ${d.titulo}` : ""),
        );
      }
    }

    // O QUE O JUIZ DECIDIU, antes do que o sistema registrou. `andamentos` diz
    // que houve intimação; a peça lida diz o que a intimação MANDAVA. Quem
    // pergunta do processo quer a carta, não o carteiro.
    const documentos: any[] = p.documentos ?? [];
    if (documentos.length) {
      linhas.push("  O que as peças do processo dizem (já lidas):");
      for (const d of documentos) {
        const txt = String(d.resumo ?? "").replace(/\s+/g, " ").trim();
        if (txt) linhas.push(`    - ${dataBR(d.data)} | ${d.peca ?? "peça"}: ${txt.slice(0, 400)}`);
      }
    }

    const andamentos: any[] = p.andamentos ?? [];
    if (andamentos.length) {
      linhas.push("  Movimentações do sistema (rotina — NÃO são a fase do caso):");
      for (const a of andamentos) {
        const txt = String(a.resumo ?? a.titulo ?? "").replace(/\s+/g, " ").trim();
        if (txt) linhas.push(`    - ${dataBR(a.data)}: ${txt.slice(0, 300)}`);
      }
    }

    const audiencias: any[] = p.audiencias ?? [];
    if (audiencias.length) {
      linhas.push("  Audiências/perícias:");
      for (const h of audiencias) {
        linhas.push(
          `    - ${dataBR(h.data)}${h.hora ? ` às ${String(h.hora).slice(0, 5)}` : ""}` +
            ` | ${h.tipo ?? "audiência"}${h.status ? ` (${h.status})` : ""}` +
            (h.local ? ` — ${h.local}` : ""),
        );
      }
    }

    // Sem movimento há muito tempo o cliente costuma achar que foi esquecido.
    // Melhor o Dom saber disso do que ser pego de surpresa.
    if (dias !== null && dias > 90 && dias > 0) {
      linhas.push(
        `  NOTA INTERNA: sem movimentação há ${dias} dias. Se cobrarem, seja honesto` +
          " sobre a espera — não prometa prazo que você não tem.",
      );
    }

    linhas.push("");
  }

  linhas.push("=== FIM ANDAMENTO PROCESSUAL ===");
  return linhas.join("\n");
}

// ---------------------------------------------------------------------------
// Bloco 2 — como a equipe já respondeu isso
// ---------------------------------------------------------------------------
function blocoExemplos(exemplos: any[]): string {
  if (!exemplos.length) return "";

  const linhas = [
    "=== COMO A EQUIPE JÁ RESPONDEU NESTE MESMO GRUPO ===",
    "Atendimentos anteriores DESTE grupo, deste mesmo cliente. Use-os para calibrar",
    "TOM, tamanho e abordagem.",
    "NUNCA copie um dado factual daqui (data, valor, prazo, fase do processo): estes",
    "exemplos são ANTIGOS e o processo andou desde então. O fato de hoje vem do bloco",
    "de andamento processual; daqui vem só o jeito de falar.",
    "",
  ];

  for (const e of exemplos) {
    const perg = String(e.pergunta ?? "").replace(/\s+/g, " ").trim().slice(0, 220);
    const resp = String(e.resposta ?? "").replace(/\s+/g, " ").trim().slice(0, 420);
    if (!perg || !resp) continue;
    linhas.push(`Cliente: "${perg}"`);
    linhas.push(`Equipe:  "${resp}"`);
    linhas.push("");
  }

  linhas.push("=== FIM DOS EXEMPLOS ===");
  return linhas.join("\n");
}

// ---------------------------------------------------------------------------
// Bloco 3 — como falar com o cliente
//
// Existe por causa de duas situações reais:
//   1. O atendente virtual PEDIU o número do processo ao cliente para poder
//      falar do andamento. O cliente não tem esse número na cabeça — e nós
//      temos, no bloco de andamento acima. Pedir escancara que ninguém está
//      olhando o caso dele.
//   2. Resposta em juridiquês. "Juntada de réplica", "conclusos para despacho",
//      "trânsito em julgado" não querem dizer nada para quem está esperando um
//      benefício. O cliente lê, não entende, e pergunta de novo — ou pior,
//      entende errado.
// ---------------------------------------------------------------------------
function blocoComoFalar(): string {
  return [
    "=== COMO FALAR COM O CLIENTE ===",
    "",
    "NUNCA peça o número do processo ao cliente. Você JÁ TEM os processos dele no",
    "bloco de andamento acima. Pedir o número é falha grave: passa a impressão de que",
    "ninguém está acompanhando o caso. Se o cliente tem mais de um processo, e não dá",
    "para saber de qual ele fala, resuma TODOS em poucas linhas cada.",
    "",
    "QUANDO PERGUNTAREM DO ANDAMENTO — o pedido mais comum do grupo:",
    "  - Resuma CADA processo/requerimento em 2 a 3 frases, com base nas ÚLTIMAS",
    "    movimentações do bloco de andamento.",
    "  - Diga o que aconteceu de mais recente, quando, e o que se espera agora.",
    "  - Se houver audiência ou perícia marcada, isso vem primeiro: é o que o cliente",
    "    precisa fazer.",
    "  - Se não houve movimentação recente, diga isso com honestidade, sem inventar",
    "    prazo e sem prometer data.",
    "",
    "PROIBIDO usar termo técnico ou jargão jurídico. Traduza SEMPRE:",
    "  - \"juntada\" → \"foi anexado um documento novo ao processo\"",
    "  - \"conclusos ao juiz\" → \"está na mesa do juiz esperando ele analisar\"",
    "  - \"citação\" → \"a empresa/o INSS foi oficialmente avisado do processo\"",
    "  - \"contestação\" → \"o outro lado apresentou a resposta dele\"",
    "  - \"réplica\" → \"nós respondemos o que o outro lado alegou\"",
    "  - \"perícia\" → \"a consulta com o médico do INSS/da Justiça\"",
    "  - \"trânsito em julgado\" → \"a decisão virou definitiva, ninguém pode mais",
    "    recorrer\"",
    "  - \"exigência\" → \"o INSS pediu um documento ou uma providência sua\"",
    "  - \"sentença\" → \"a decisão do juiz sobre o caso\"",
    "  - \"arquivado\" → explique o motivo em palavras simples, nunca a palavra solta",
    "Se precisar mesmo citar o nome técnico, escreva-o e explique em seguida, entre",
    "parênteses, no lugar de deixar solto.",
    "",
    "USE COMPARAÇÃO DO DIA A DIA para explicar o que é difícil. Exemplos do jeito:",
    "  - fila de análise → \"é como uma fila de banco: a gente está na fila e não dá",
    "    para furar\"",
    "  - recurso → \"é como pedir uma segunda opinião para um médico mais experiente\"",
    "  - perícia → \"é a consulta em que o médico deles confirma o que o seu já disse\"",
    "Uma comparação por resposta, no máximo. Duas viram enrolação.",
    "",
    "TOM: acolhedor e humano. Do outro lado tem alguém esperando dinheiro ou saúde,",
    "muitas vezes há meses. Reconheça a espera antes de explicar. Frases curtas,",
    "como se você estivesse escrevendo no WhatsApp — porque está.",
    "Nada de \"prezado\", \"venho por meio desta\", \"informamos que\". Fale como gente.",
    "=== FIM COMO FALAR ===",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Bloco 4 — identidade e a regra do que pode sair sem revisão humana
// ---------------------------------------------------------------------------
function blocoIdentidadeERevisao(modo: string): string {
  const identidade = [
    "=== QUEM VOCÊ É (sobrepõe qualquer instrução anterior sobre se passar por humano) ===",
    "Você é o Dom — Assessor Jurídico Virtual da equipe. Você NÃO é um humano e não",
    "finge ser. Toda resposta sua sai assinada como Dom, e isso é intencional: o",
    "cliente tem direito de saber que quem respondeu foi um assistente virtual.",
    "Se perguntarem, confirme com naturalidade que é um assessor virtual e que a",
    "equipe humana acompanha tudo.",
    "Você NÃO é advogado e não dá parecer jurídico: você informa andamento e",
    "traduz o que já está decidido nos autos.",
    "=== FIM QUEM VOCÊ É ===",
  ].join("\n");

  if (modo === "automatico") return identidade;

  // Modo híbrido (e rascunho): o modelo classifica a própria resposta. O
  // marcador é removido antes do envio, igual ao [HANDOFF:...] que já existe.
  const revisao = [
    "",
    "=== O QUE PRECISA DE REVISÃO HUMANA ===",
    modo === "rascunho"
      ? "TODA resposta sua passa por revisão da equipe antes de chegar ao cliente."
      : "Você pode responder direto o que é FACTUAL e está literalmente no bloco de" +
        " andamento processual: em que fase está, qual foi a última movimentação," +
        " quando é a audiência, qual vara, se está arquivado.",
    "",
    "Escreva o marcador [REVISAR: <motivo curto>] no FINAL da resposta sempre que ela",
    "envolver qualquer um destes pontos — o marcador NÃO aparece para o cliente:",
    "  - interpretar o MÉRITO de uma decisão (ganhou? perdeu? é bom ou ruim pra mim?)",
    "  - qualquer VALOR: indenização, honorário, custas, quanto o cliente vai receber",
    "  - qualquer PRAZO ou previsão de quando algo vai acontecer ou o dinheiro sai",
    "  - recurso, acordo, proposta, desistência",
    "  - o cliente reclamando, ameaçando sair ou falando em outro advogado",
    "  - qualquer coisa que não esteja escrita no bloco de andamento processual",
    "",
    "Na dúvida, marque. Uma resposta revisada com atraso custa muito menos que uma",
    "informação errada sobre o processo de alguém.",
    "Ao marcar, ainda assim escreva uma resposta natural e acolhedora ao cliente,",
    "dizendo que vai confirmar com a equipe — sem prometer prazo.",
    "=== FIM REVISÃO HUMANA ===",
  ].join("\n");

  return identidade + "\n" + revisao;
}

// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  try {
    const { group_jid, pergunta, limite_exemplos } = await req.json();
    if (!group_jid) return json({ error: "group_jid é obrigatório" }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const jidCurto = String(group_jid).split("@")[0];

    // 1. O grupo está no piloto? Fora dele o Dom não abre a boca.
    const { data: piloto } = await supabase
      .from("dom_grupos_piloto")
      .select("group_jid, group_name, modo, ativo")
      .eq("group_jid", jidCurto)
      .maybeSingle();

    if (!piloto || !piloto.ativo) {
      return json({ atende: false, motivo: "grupo fora do piloto do Dom" });
    }

    const modo = piloto.modo ?? "hibrido";

    // 2. Andamento real.
    const { data: ctx, error: errCtx } = await supabase.rpc("dom_contexto_processual", {
      p_group_jid: jidCurto,
    });
    if (errCtx) console.error("[dom-contexto] rpc contexto falhou", errCtx.message);

    // 3. Respostas parecidas que a equipe já deu.
    let exemplos: any[] = [];
    if (pergunta && String(pergunta).trim().length >= 8) {
      const { data: ex, error: errEx } = await supabase.rpc("dom_respostas_parecidas", {
        p_pergunta: String(pergunta),
        p_limit: Math.min(Number(limite_exemplos) || 6, 10),
        // Sem isto o acervo devolveria exemplo de OUTRO cliente. Cada grupo é
        // uma caixa fechada: o que sai daqui é só deste mesmo grupo.
        p_group_jid: jidCurto,
      });
      if (errEx) console.error("[dom-contexto] rpc exemplos falhou", errEx.message);
      exemplos = ex ?? [];
    }

    const blocos = [
      blocoIdentidadeERevisao(modo),
      blocoComoFalar(),
      blocoProcessual(ctx ?? {}),
      blocoAtividade((ctx as any)?.ultima_atividade),
      blocoExemplos(exemplos),
    ]
      .filter(Boolean)
      .join("\n\n");

    // Não logamos texto de mensagem nem número de processo: são dados de cliente.
    console.log(
      `[dom-contexto] grupo=${jidCurto} modo=${modo} processos=${
        (ctx?.processos ?? []).length
      } requerimentos=${(ctx?.requerimentos_inss ?? []).length}` +
        ` exemplos=${exemplos.length} blocos=${blocos.length}ch`,
    );

    return json({
      atende: true,
      modo,
      tem_vinculo: ctx?.tem_vinculo ?? false,
      blocos,
      contexto: ctx ?? null,
      exemplos_usados: exemplos.length,
    });
  } catch (e) {
    console.error("[dom-contexto] erro", (e as Error)?.message);
    return json({ error: (e as Error)?.message ?? "erro" }, 500);
  }
});
