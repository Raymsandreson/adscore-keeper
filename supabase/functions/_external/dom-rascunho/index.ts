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
//   POST { regerar_audio: <id>, velocidade?, estabilidade?, estilo?, pausa_ms? }
//                          → refaz o áudio de um rascunho que já existe,
//                            falando o texto EDITADO se alguém editou.
//                            Todo ajuste que vier também vira o padrão
//                            DA VOZ — é isso que os torna configuração e
//                            não um teste que se perde no próximo áudio.
//   →     { grupos, rascunhos, pulados: [{ grupo, motivo }] }
//
// SEGURANÇA: nada de texto de cliente nos logs. Só JID, intenção e contagem.
// =============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const DOM_AGENT_ID = "d6ad8eee-d6a3-452c-b852-b94ef8dd54bf";

// A JANELA ENTRE ESCREVER E FALAR — E POR QUE ELA ENCOLHE
//
// É essa janela que faz o papel da revisão: silêncio aprova. Mas ela não é a
// mesma o tempo todo, porque gente não é.
//
// Quem chega numa conversa parada demora: estava em outra coisa, precisa ler,
// lembrar do caso. Quem JÁ ESTÁ na conversa responde rápido — o celular está na
// mão. Um atraso fixo é relógio: cinco minutos exatos na primeira e na quinta
// mensagem é a assinatura de uma máquina, não de uma pessoa ocupada.
//
// Daí dois números, e não um: a primeira resposta da conversa espera mais, as
// seguintes espera menos. A conversa deixa de ser "a mesma" quando passa a
// janela sem o agente falar nada ali — aí a próxima volta ao atraso de chegada.
//
// Os três vêm de `wjia_command_shortcuts`, editáveis na tela de configuração do
// agente. O que está aqui é só o piso para quando a coluna vier nula.
//
// ATENÇÃO AO CRON. Estes minutos só valem se o `dom_rascunho_tick` for mais
// rápido que eles: o rascunho nasce na rodada do cron, então um cron de 5 em 5
// minutos soma de 0 a 5 minutos ANTES de o atraso começar a contar, e a
// diferença entre 3 e 2 desaparece no ruído. Por isso o tick foi para 2 em 2
// (migration `20260908180000`).
const ATRASO_PRIMEIRA_PADRAO = 3;
const ATRASO_SEGUINTE_PADRAO = 2;
const JANELA_CONVERSA_PADRAO_MIN = 180;

// VELOCIDADE DE FALA
//
// Até 07/09/2026 isto era `speed: 1.1` escrito à mão aqui dentro, igual para
// toda voz. É errado na raiz: cada voz clonada carrega o ritmo da pessoa que a
// gravou. A Keilane a 1,1x soa apressada; outra voz na mesma 1,1x pode soar
// natural. Velocidade é propriedade DA VOZ — agora mora em
// `custom_voices.velocidade_fala`, e isto aqui é só o padrão de quem não
// escolheu nada (o comportamento antigo, para nada mudar sozinho).
const VELOCIDADE_PADRAO = 1.1;

// A API REST da ElevenLabs aceita 0.25 a 4.0. A faixa aqui é apertada de
// propósito: fora dela não é ajuste de naturalidade, é voz de desenho animado
// ou de câmera lenta. Mesmos números do CHECK no banco — se um mudar, o outro
// tem que mudar junto.
const VELOCIDADE_MIN = 0.5;
const VELOCIDADE_MAX = 1.5;

// TOM DA FALA — e por que ele são DOIS números, não um
//
// "Deixa o tom mais grave" é o pedido natural e é impossível: a API da
// ElevenLabs não tem `pitch`. Os campos de `voice_settings` são exatamente
// cinco — stability, similarity_boost, style, speed, use_speaker_boost (fonte:
// elevenlabs/skills, text-to-speech/references/voice-settings.md, a mesma
// citada na migration da velocidade). A altura da voz vem da GRAVAÇÃO que
// clonou ela e só muda regravando.
//
// O que dá para mudar é a EXPRESSIVIDADE, e ela mora em dois campos que puxam
// para lados diferentes:
//   stability alto  → fala firme, pouca variação  (sério, formal)
//   stability baixo → mais variação emocional     (caloroso, expressivo)
//   style           → exagera o jeito próprio da voz
//
// CUIDADO, e custou uma nota de voz gaguejada para aprender: os dois empurram
// para o MESMO lado. A doc diz que stability baixa "can sound erratic" e style
// alto "can reduce stability" — baixar um e subir o outro ao mesmo tempo é
// apertar o acelerador e soltar o freio na mesma curva. Em 08/09/2026 o preset
// de 0,45/0,45 saiu gaguejando no Caso 182, e a faixa da tela foi encolhida
// para nunca descer abaixo destes padrões.
//
// Por isso a tela oferece TOM como preset nomeado (um clique) mas o banco
// guarda os dois números: preset é rótulo e pode ser renomeado; o que a API
// recebeu tem que ficar registrado como número, senão renomear um preset
// amanhã reescreve o passado de todas as vozes.
//
// Os padrões abaixo são os valores que estavam escritos à mão no corpo da
// chamada até 08/09/2026 — e são também o único piso que rodou dias em
// produção sem ninguém reclamar.
const ESTABILIDADE_PADRAO = 0.6;
const ESTILO_PADRAO = 0.3;
const FRACAO_MIN = 0;
const FRACAO_MAX = 1;

// PAUSA — a única das três que NÃO é parâmetro da API
//
// Não existe campo de pausa em `voice_settings`. Pausa se faz com a tag
// `<break time="0.6s" />` dentro do próprio texto, com teto documentado de 3s.
//
// AVISO, escrito aqui porque é o jeito de isto dar errado: esta parte veio de
// FONTE SECUNDÁRIA. A doc oficial (elevenlabs.io, help.elevenlabs.io) estava
// bloqueada por egress no ambiente onde isto foi escrito, e o repositório
// oficial de skills não cobre pausas. Se o modelo NÃO interpretar a tag, ele a
// lê em voz alta e o cliente ouve "break time zero vírgula seis s".
//
// Duas travas contra isso, e é por elas que dá para subir mesmo sem a doc:
//   1. O padrão é 0 = nenhuma tag é inserida, o texto sai idêntico ao de hoje.
//      Nada muda para voz nenhuma sem alguém escolher na tela.
//   2. Isto é rascunho. O áudio toca no painel e só sai com aprovação humana —
//      a primeira escuta com pausa ligada confirma ou derruba a hipótese.
const PAUSA_PADRAO_MS = 0;
const PAUSA_MIN_MS = 0;
const PAUSA_MAX_MS = 3000;

// DATA FALADA NÃO É DATA ESCRITA
//
// "28/08/2026" no papel é compacto e claro. Na boca de uma voz vira "vinte e
// oito barra zero oito barra dois mil e vinte e seis" — que ninguém fala e
// ninguém entende de primeira, ainda mais quem está ansioso pelo processo.
//
// A conversão acontece SÓ no áudio, junto da limpeza de asterisco e link: a
// mensagem escrita continua com a data em números, e as duas ficam
// consistentes cada uma no seu meio.
const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/**
 * 28/08/2026 → "28 de agosto de 2026"; 31/08 → "31 de agosto".
 *
 * A forma sem ano exige DOIS dígitos em cada lado de propósito: "1/2" é uma
 * fração e viraria "1 de fevereiro". Mês fora de 1..12 fica como está — melhor
 * uma barra lida em voz alta do que uma data inventada.
 */
function datasPorExtenso(texto: string): string {
  return texto
    .replace(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g, (todo, d, m, a) => {
      const mes = MESES[Number(m) - 1];
      return mes ? `${Number(d)} de ${mes} de ${a}` : todo;
    })
    .replace(/\b(\d{2})\/(\d{2})\b(?!\/)/g, (todo, d, m) => {
      const mes = MESES[Number(m) - 1];
      return mes && Number(d) >= 1 && Number(d) <= 31 ? `${Number(d)} de ${mes}` : todo;
    });
}

// DINHEIRO FALADO NÃO É DINHEIRO ESCRITO — a mesma lição da data
//
// "R$ 2.000.000,00" no papel é claro. Na boca da voz é uma travada: o modelo
// tropeça no cifrão seguido de pontos e vírgula, e foi exatamente isso que
// apareceu na nota de voz do Caso 182 em 08/09/2026.
//
// E tem um segundo estrago, pior que o primeiro. O Dom escreve o valor DUAS
// vezes, em dígito e em palavra:
//
//     "R$ 2.000.000,00 (dois milhões de reais)"
//
// No escrito isso é bom — confere. Falado, o cliente ouve o valor duas vezes
// seguidas, e é aí que a mensagem passa de informação para enrolação.
//
// A conversão acontece SÓ no áudio, junto da data e da limpeza de asterisco: a
// mensagem escrita continua com o valor em números.
const UNIDADES = [
  "zero", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito",
  "nove", "dez", "onze", "doze", "treze", "quatorze", "quinze", "dezesseis",
  "dezessete", "dezoito", "dezenove",
];
const DEZENAS = ["", "", "vinte", "trinta", "quarenta", "cinquenta",
                 "sessenta", "setenta", "oitenta", "noventa"];
const CENTENAS = ["", "cento", "duzentos", "trezentos", "quatrocentos",
                  "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos"];

/** 0..999. "cem" sozinho, "cento e um" acompanhado — não são a mesma palavra. */
function ate999(n: number): string {
  if (n === 0) return "";
  if (n === 100) return "cem";
  const c = Math.floor(n / 100), r = n % 100;
  const p: string[] = [];
  if (c) p.push(CENTENAS[c]);
  if (r > 0 && r < 20) p.push(UNIDADES[r]);
  else if (r >= 20) {
    const d = Math.floor(r / 10), u = r % 10;
    p.push(u ? `${DEZENAS[d]} e ${UNIDADES[u]}` : DEZENAS[d]);
  }
  return p.join(" e ");
}

/**
 * Inteiro por extenso, até bilhões.
 *
 * O "e" entre grupos é a parte que erra fácil, e a regra é: ele entra antes do
 * ÚLTIMO grupo quando esse grupo é redondo (múltiplo de 100) ou menor que 100.
 * É o que separa "um milhão E quinhentos mil" de "novecentos e noventa e nove
 * mil novecentos e noventa e nove" — sem isso o primeiro sai emendado.
 */
function inteiroPorExtenso(n: number): string {
  if (n === 0) return "zero";
  const escala = [
    { v: 1e9, s: "bilhão", p: "bilhões" },
    { v: 1e6, s: "milhão", p: "milhões" },
    { v: 1e3, s: "mil", p: "mil" },
  ];
  const partes: { txt: string; val: number }[] = [];
  let resto = n;
  for (const g of escala) {
    const q = Math.floor(resto / g.v);
    if (q) {
      partes.push({
        txt: g.v === 1e3 ? (q === 1 ? "mil" : `${ate999(q)} mil`)
                         : `${ate999(q)} ${q === 1 ? g.s : g.p}`,
        val: q * g.v,
      });
      resto %= g.v;
    }
  }
  if (resto) partes.push({ txt: ate999(resto), val: resto });
  if (partes.length === 1) return partes[0].txt;
  const ult = partes[partes.length - 1];
  const ligacao = (ult.val < 100 || ult.val % 100 === 0) ? " e " : " ";
  return partes.slice(0, -1).map((x) => x.txt).join(" ") + ligacao + ult.txt;
}

/**
 * "2.000.000,00" → "dois milhões de reais". Nulo quando não dá para converter
 * — e nulo aqui quer dizer "deixa o texto como estava", nunca "inventa".
 *
 * O "de" antes de "reais" só entra em milhão/bilhão EXATO: "dois milhões de
 * reais", mas "dois milhões e quinhentos mil reais" (sem "de"). Acima de um
 * trilhão devolve nulo em vez de arriscar uma escala que ninguém revisou.
 *
 * VERIFICADO caso a caso em 08/09/2026:
 *   2.000.000,00 → dois milhões de reais
 *     882.000,00 → oitocentos e oitenta e dois mil reais
 *   1.500.000,00 → um milhão e quinhentos mil reais
 *       1.234,56 → mil duzentos e trinta e quatro reais e cinquenta e seis centavos
 *       1.100,00 → mil e cem reais
 *         101,00 → cento e um reais
 *         100,00 → cem reais
 *           1,00 → um real
 *           0,50 → cinquenta centavos
 */
function valorPorExtenso(bruto: string): string | null {
  const limpo = String(bruto).replace(/\./g, "");
  const [i, c] = limpo.split(",");
  const inteiro = Number(i || 0);
  const centavos = Number((c || "0").padEnd(2, "0").slice(0, 2));
  if (!Number.isFinite(inteiro) || !Number.isFinite(centavos) || inteiro >= 1e12) return null;
  const p: string[] = [];
  if (inteiro > 0) {
    const redondo = inteiro >= 1e6 && inteiro % 1e6 === 0;
    p.push(`${inteiroPorExtenso(inteiro)}${redondo ? " de" : ""} ${inteiro === 1 ? "real" : "reais"}`);
  }
  if (centavos > 0) {
    p.push(`${inteiroPorExtenso(centavos)} ${centavos === 1 ? "centavo" : "centavos"}`);
  }
  return p.length ? p.join(" e ") : "zero reais";
}

/**
 * Tira o cifrão do caminho da voz.
 *
 * A ORDEM DAS DUAS TROCAS IMPORTA. O caso com parêntese vem primeiro porque é
 * o que o Dom escreve na prática, e ele resolve os dois problemas de uma vez:
 * some o token difícil E some a repetição. Se a troca do valor solto viesse
 * antes, "R$ 2.000.000,00 (dois milhões de reais)" viraria "dois milhões de
 * reais (dois milhões de reais)" — o dobro do defeito original.
 */
function dinheiroPorExtenso(texto: string): string {
  return texto
    .replace(/R\$\s*[\d.]+(?:,\d{2})?\s*\(\s*([^)]*(?:reais|centavos)[^)]*)\)/gi, "$1")
    .replace(/R\$\s*([\d.]+(?:,\d{2})?)/g, (todo, n) => valorPorExtenso(n) ?? todo);
}

/**
 * Nunca deixa um valor torto do banco virar `speed: NaN` na chamada da API.
 *
 * Genérico porque são quatro ajustes e não um: repetir a mesma guarda quatro
 * vezes é como quatro chaves diferentes para a mesma porta — na hora de trocar
 * a fechadura alguém esquece uma.
 *
 * AUSENTE VEM ANTES DE INVÁLIDO, e a ordem destas duas linhas é o conserto de
 * 08/09/2026. Antes só existia a checagem de `Number.isFinite`, e ela NÃO pega
 * o caso mais comum de todos:
 *
 *     Number(null)      === 0    ← e 0 é finito
 *     Number(undefined) === NaN
 *     Number("")        === 0    ← idem
 *
 * Então `null` (o que o banco devolve em coluna não preenchida) passava pela
 * guarda como se fosse o número zero e caía no `Math.max(0, min)` — grampeado
 * no PISO da faixa, não no padrão. É um termostato que, sem leitura do sensor,
 * em vez de ir para o ajuste de fábrica vai para o fundo da escala.
 *
 * O estrago, medido em produção: todo áudio do cron entre 12:50 e 19:20 de
 * 08/09/2026 saiu com `stability: 0` — o extremo "máxima variação emocional" da
 * ElevenLabs — em vez de 0,60. É a gagueira que apareceu nas notas de voz. E a
 * mesma falha estava aqui desde 07/09/2026 na velocidade: voz sem
 * `velocidade_fala` gravado falava a 0,5x, METADE do ritmo, em vez de 1,1x.
 * Ficou escondida porque a Keilane tinha 0,95 gravado, que sobrescrevia o 0,5.
 *
 * Por isso ausência é testada por IDENTIDADE, antes de qualquer conversão.
 */
const numeroValido = (v: unknown, padrao: number, min: number, max: number): number => {
  if (v === null || v === undefined || v === "") return padrao;
  const n = Number(v);
  if (!Number.isFinite(n)) return padrao;
  return Math.min(Math.max(n, min), max);
};

const velocidadeValida = (v: unknown, padrao: number): number =>
  numeroValido(v, padrao, VELOCIDADE_MIN, VELOCIDADE_MAX);

const fracaoValida = (v: unknown, padrao: number): number =>
  numeroValido(v, padrao, FRACAO_MIN, FRACAO_MAX);

const pausaValida = (v: unknown, padrao: number): number =>
  Math.round(numeroValido(v, padrao, PAUSA_MIN_MS, PAUSA_MAX_MS));

/**
 * Põe um respiro em cada quebra de linha da resposta.
 *
 * ONDE, e por quê exatamente aí: na quebra de linha que quem escreveu já
 * colocou. Não é a máquina adivinhando prosódia — é ela respeitando a pontuação
 * de quem redigiu. Adivinhar onde uma frase "pede" pausa seria inventar ritmo
 * em cima de um texto sobre o processo de alguém; a quebra de linha é intenção
 * declarada, e já está lá.
 *
 * O que NÃO leva pausa: o fim do texto (silêncio depois do último ponto já é o
 * fim do arquivo — a tag ali só faria o cliente esperar por nada) e sequências
 * de quebras, que viram UMA pausa só e não duas empilhadas.
 *
 * `ms <= 0` devolve o texto intocado, byte por byte. É essa igualdade que
 * garante que ninguém que não escolheu pausa tenha o texto mexido.
 */
function pausasNasQuebras(texto: string, ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return texto;
  // A tag é documentada em segundos. 600ms → "0.6s"; 1000ms → "1s".
  const segundos = String(Number((ms / 1000).toFixed(2)));
  // As quebras das PONTAS saem antes da troca. Sem isto, um texto terminado em
  // "\n" ganhava uma tag pendurada no fim e o áudio acabava com um silêncio
  // esperando por nada — medido, não suposto. `trim()` sozinho não resolve:
  // depois da troca a tag já não é espaço em branco.
  return texto.replace(/^\n+|\n+$/g, "").replace(/\n+/g, ` <break time="${segundos}s" /> `).trim();
}

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

// As intenções levantadas sobre mensagem real dos grupos do piloto. O
// agrupamento é o que decide a ação, não o rótulo:
//   A responde | B acolhe sem falar de processo | C confirma curto
//   D silêncio | E humano
//
// 20 a 23 entraram depois, sobre o que os 19 primeiros engoliam calado:
// desistência caía em B5 (o Dom acolhia sozinho e NINGUÉM era avisado de que o
// cliente falou em largar o caso), pedido de dinheiro adiantado ia junto com
// "quando cai meu dinheiro" na E17, indicação de cliente novo caía em D14 e
// virava silêncio, e elogio morria na D13. Medido em 04/09/2026: o Caso 341
// mandou "eu já tô desistindo, já não tô aguentando mais" e o único rascunho
// vivo do grupo era C9, sobre uma foto.
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
E16 reclamação ou insatisfação com o atendimento, com a demora ou com a equipe
E17 pergunta sobre dinheiro ou prazo DO PRÓPRIO CASO (quanto sai, quando cai)
E18 quer falar com uma pessoa específica
E19 assunto jurídico novo, fora deste processo
E20 fala em desistir, largar, cancelar ou encerrar o caso, revogar a procuração, ou em sair do grupo
E21 pede dinheiro adiantado, empréstimo, antecipação de valor ou ajuda financeira
E22 indica cliente novo, oferece o caso de outra pessoa, passa contato de conhecido
B23 elogio ou reconhecimento do trabalho ("vocês são ótimos", "Deus abençoe vocês")
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
    "QUANDO A MENSAGEM TEM MAIS DE UMA COISA, vale a mais grave, nesta ordem:",
    "  E20 > E16 > E21 > E22 > E17 > E18 > E19 > A > C > B > D",
    "Isto não é sugestão. Os erros que esta regra conserta são reais:",
    "  · desabafo que fala em DESISTIR, largar, cancelar, revogar ou sair é E20,",
    "    NUNCA B5 — mesmo quando vem embrulhado em bom-dia e pergunta de",
    "    andamento (\"bom dia, como tá o processo? eu já tô desistindo\" = E20);",
    "  · pedir dinheiro ADIANTADO, empréstimo ou antecipação é E21, não E17.",
    "    E17 é ele perguntando do dinheiro DELE no caso; E21 é ele pedindo",
    "    dinheiro agora, que é assunto de pessoa e não do processo;",
    "  · indicar conhecido, oferecer caso de terceiro ou mandar contato é E22,",
    "    não D14 nem E19 — D14 vira silêncio e a indicação se perde;",
    "  · elogio é B23, não D13. D13 é fechamento de conversa (\"ok\", \"obrigada\");",
    "    B23 é ele reconhecendo o trabalho, e isso merece resposta.",
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

// ---------------------------------------------------------------------------
// VALOR QUE NÃO É NOSSO NÃO SAI DAQUI
//
// Em 08/09/2026, no grupo da Bianca, o Dom escreveu que o INSS descontou
// IMPOSTO DE RENDA do benefício dela e que o escritório cobra 30% "conforme o
// contrato que a gente assinou". Nada disso existia: o contexto daquele
// rascunho veio com `processos: []` e `requerimentos_inss: []`, nenhuma peça
// lida, e as 513 mensagens do grupo não têm a palavra "imposto" uma única vez.
// O modelo completou a lacuna com o que COSTUMA ser verdade sobre INSS. O 30%
// foi pior: ele pegou uma PERGUNTA que a própria cliente tinha feito em 26/08
// ("Todo mês e trinta por cento??") e devolveu como confirmação nossa.
//
// A instrução já proibia. O bloco da família E diz "sem número, sem valor" e é
// o ÚLTIMO do system prompt, a posição mais forte. O modelo passou por cima
// assim mesmo, em 3 dos 4 rascunhos daquela tarde. Por isso a trava está aqui,
// em código: prompt é pedido, isto é impedimento.
//
// O QUE ELA NÃO FAZ: proibir o agente de falar de dinheiro. Valor que está na
// peça lida ou na nossa base é fato, e o cliente tem direito de ouvir. A trava
// separa o que foi LIDO do que foi DEDUZIDO — só o segundo cai.
//
// Isto NÃO é filtro de tela. O número não é escondido de ninguém: o texto do
// modelo é descartado ANTES de virar rascunho, o motivo da fila diz o que foi
// barrado, e o caso segue pela esteira que já existe — pendência com dono e
// prazo, a equipe confere o valor na peça e responde com o número certo.
// ---------------------------------------------------------------------------

/** "1.621" e "1 621" viram "1621" — só o ponto/espaço que separa milhar. */
function juntaMilhar(s: string): string {
  return s.replace(/(\d)[.\u00a0 ](?=\d{3}(?!\d))/g, "$1");
}

/** Chave de comparação de um valor: a parte inteira, sem separador nem centavo.
 *  "R$ 1.621,00", "1.621" e "1621" devolvem todos "1621". */
function chaveDoValor(v: string): string {
  const m = juntaMilhar(v).match(/\d+/);
  return m ? String(Number(m[0])) : "";
}

/** Dinheiro e porcentagem citados num texto. Porcentagem POR EXTENSO entra com
 *  chave vazia de propósito: "trinta por cento" não tem dígito para conferir,
 *  então nunca casa com o contexto e sempre cai como não conferida. */
function valoresCitados(texto: string): { texto: string; chave: string }[] {
  const achados: { texto: string; chave: string }[] = [];
  const guarda = (bruto: string, chave: string) => {
    // Tira a pontuação da frase que a captura levou junto: "R$ 1.443." vira
    // "R$ 1.443". Só afeta o que a pessoa lê no motivo — a chave já foi tirada
    // do primeiro número, sem depender disto.
    const limpo = bruto.trim().replace(/[.,;:]+$/, "");
    if (limpo && !achados.some((a) => a.texto === limpo)) achados.push({ texto: limpo, chave });
  };
  for (const m of texto.matchAll(/R\$\s*\d[\d.,]*/gi)) guarda(m[0], chaveDoValor(m[0]));
  for (const m of texto.matchAll(/\d[\d.,]*\s*rea(?:l|is)\b/gi)) guarda(m[0], chaveDoValor(m[0]));
  for (const m of texto.matchAll(/\d[\d.,]*\s*%/g)) guarda(m[0], chaveDoValor(m[0]));
  for (const m of texto.matchAll(/\S+\s+por\s+cento\b/gi)) guarda(m[0], "");
  return achados;
}

/** Os valores da resposta que NÃO têm lastro: os que não aparecem no bloco de
 *  contexto, que é o que veio da nossa base e das peças já lidas. Devolve vazio
 *  quando está tudo conferido.
 *
 *  A REGRA NÃO É "NÃO FALE DE DINHEIRO" (Raym, 09/09/2026). Valor que está na
 *  peça é fato, e esconder fato do cliente é o outro erro. A primeira versão
 *  desta função barrava QUALQUER valor quando a pergunta era de dinheiro, e
 *  isso engessava o agente: ele não podia nem repetir o que a carta de
 *  concessão dizia.
 *
 *  O que ele não pode é INVENTAR ou DEDUZIR. No caso que originou a trava, o
 *  benefício era de R$ 1.660 e a resposta afirmou que o cliente receberia 880 e
 *  pouco "por causa do desconto de Imposto de Renda" — num benefício isento. O
 *  1.660 estava na peça e podia ser dito; o 880 não existia em lugar nenhum.
 *  É esse segundo que esta função pega. */
function valoresSemLastro(resposta: string, blocos: string): string[] {
  const citados = valoresCitados(resposta);
  if (citados.length === 0) return [];

  const contexto = juntaMilhar(blocos);
  return citados
    .filter((c) => !c.chave || !new RegExp(`(?<!\\d)${c.chave}(?!\\d)`).test(contexto))
    .map((c) => c.texto);
}

/** O que vai para o cliente quando o valor foi barrado. Não pede desculpa e não
 *  promete prazo: diz que a conta certa vem de gente olhando a peça. */
const RESPOSTA_SEM_VALOR = "A gente entende a sua dúvida sobre os valores, e essa é uma " +
  "pergunta que merece o número certo, não um mais ou menos. Já estou acionando a equipe " +
  "pra conferir isso na sua documentação e te responder aqui no grupo.";

// Cada grupo de intenção manda uma ordem diferente para o modelo. É isto que
// impede o relatório de processo de aparecer em cima de um desabafo.
function instrucaoDaIntencao(cod: string, panorama = false): string {
  const g = cod.charAt(0);

  // Estes quatro são da família E (vão para humano de qualquer jeito), mas a
  // frase que o Dom escreve enquanto o humano não chega é diferente em cada um
  // — e no E17, no E20 e no E21 a frase errada custa caro. Por isso vêm ANTES
  // do bloco genérico de E, que fala em "reclamação, dinheiro, prazo".
  if (cod === "E17") {
    return [
      "=== O QUE ESTA MENSAGEM PEDE DE VOCÊ ===",
      "O cliente perguntou de DINHEIRO ou PRAZO do caso dele: quanto vai receber,",
      "quanto já é dele, quanto o escritório fica, quando cai.",
      "Responda em duas ou três frases, reconhecendo a dúvida pelo nome que ele deu.",
      "",
      "VALOR QUE ESTÁ NO BLOCO DE ANDAMENTO VOCÊ PODE DIZER. Ele foi lido de uma",
      "peça ou veio da nossa base, é fato, e esconder fato de quem está esperando",
      "dinheiro é o outro jeito de errar. Diga o valor e diga de onde ele saiu",
      "(\"na carta de concessão está R$ ...\").",
      "",
      "O QUE É PROIBIDO, sem exceção:",
      "  · INVENTAR ou DEDUZIR valor. Nada de calcular o líquido a partir do bruto,",
      "    estimar quanto sobra, ou dizer quanto ele vai receber por mês. Se a conta",
      "    não está escrita no bloco de andamento, ela não existe;",
      "  · explicar de onde viria um desconto, o que é bruto e o que é líquido, ou",
      "    citar Imposto de Renda, contribuição ou qualquer tributo. Você não leu o",
      "    contracheque dele, e há benefício que é ISENTO — o que \"geralmente",
      "    acontece\" no INSS não é o que aconteceu com ele;",
      "  · repetir como FATO um número que o próprio cliente disse. O que ele mandou",
      "    é o que ele entendeu, e ele está perguntando porque não tem certeza;",
      "  · dizer o que está no contrato ou na procuração dele, incluindo a",
      "    porcentagem do escritório. Você não leu esses documentos.",
      "",
      "Quando o número que ele quer não está no bloco, a resposta é dizer que a",
      "equipe vai conferir — não é preencher com o que costuma ser verdade.",
      "=== FIM ===",
    ].join("\n");
  }
  if (cod === "E20") {
    return [
      "=== O QUE ESTA MENSAGEM PEDE DE VOCÊ ===",
      "O cliente falou em DESISTIR, largar, cancelar o caso ou sair. Isto é o",
      "assunto mais sério que chega aqui, e não é seu para resolver.",
      "Responda em duas ou três frases: reconheça o cansaço dele pelo nome que ele",
      "deu (demora, falta de resposta, dificuldade), diga que alguém da equipe vai",
      "falar com ele, e nada além disso.",
      "É PROIBIDO tentar convencer, argumentar que vale a pena, citar prazo, valor,",
      "fase do processo, ou explicar consequência de desistir. Quem faz isso é",
      "advogado, falando com ele.",
      "=== FIM ===",
    ].join("\n");
  }
  if (cod === "E21") {
    return [
      "=== O QUE ESTA MENSAGEM PEDE DE VOCÊ ===",
      "O cliente está pedindo DINHEIRO ADIANTADO — empréstimo, antecipação, ajuda.",
      "Não é pergunta sobre o caso dele: é pedido de dinheiro agora.",
      "Responda curto e sem constranger: diga que entendeu o pedido e que a equipe",
      "vai falar com ele sobre isso.",
      "É PROIBIDO dizer sim, dizer não, citar valor, citar prazo de pagamento, ou",
      "explicar como funcionaria. Prometer dinheiro que não é seu para prometer é",
      "o pior erro possível nesta conversa.",
      "=== FIM ===",
    ].join("\n");
  }
  if (cod === "E22") {
    return [
      "=== O QUE ESTA MENSAGEM PEDE DE VOCÊ ===",
      "O cliente está INDICANDO alguém — um conhecido com um caso, um contato.",
      "Agradeça em uma ou duas frases, com a confiança que isso significa, e diga",
      "que alguém da equipe entra em contato para ouvir o caso.",
      "É PROIBIDO pedir CPF, documento ou detalhe do caso do terceiro aqui: este",
      "grupo é do caso do cliente, e dado de outra pessoa não entra nele.",
      "Nada de andamento de processo nesta resposta.",
      "=== FIM ===",
    ].join("\n");
  }
  if (cod === "B23") {
    return [
      "=== O QUE ESTA MENSAGEM PEDE DE VOCÊ ===",
      "O cliente ELOGIOU o trabalho. Agradeça em uma ou duas frases, simples e sem",
      "cerimônia, e devolva o crédito para a equipe que cuida do caso dele.",
      "É PROIBIDO emendar andamento, prazo, cobrança ou pedido de qualquer tipo —",
      "responder elogio com relatório transforma o agrado em atendimento.",
      "=== FIM ===",
    ].join("\n");
  }

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
      // "e há quantos dias" estava SÓ na função no ar (v16), editada direto no
      // dashboard e nunca devolvida ao git. Voltou para cá em 08/09/2026, antes
      // do deploy seguinte — que teria apagado a frase sem ninguém perceber.
      // Data sozinha obriga o cliente a fazer a conta; o que ele quer saber é
      // se está parado há uma semana ou há quatro meses.
      "caso, como está hoje e o que mudou por último — com a data e há quantos dias.",
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
 *
 * `forcado` é para os botões de regerar: a pessoa está experimentando um ritmo,
 * um tom ou uma pausa e quer ouvir AGORA. Campo nulo = usa o que a voz tem
 * guardado; voz sem nada guardado = o padrão do sistema. Essa cascata de três
 * degraus é a mesma para os quatro ajustes, de propósito — um ajuste que se
 * resolvesse diferente dos outros seria uma exceção para alguém tropeçar.
 */
type AjustesDeFala = {
  velocidade?: number | null;
  estabilidade?: number | null;
  estilo?: number | null;
  pausaMs?: number | null;
};

type FalaGerada = {
  url: string | null;
  voz: string | null;
  erro: string | null;
  velocidade: number;
  estabilidade: number;
  estilo: number;
  pausaMs: number;
};

async function gerarAudioDoRascunho(
  supabase: any,
  texto: string,
  vozConfigurada: string | null,
  instanceName: string | null,
  maxChars: number,
  forcado: AjustesDeFala = {},
): Promise<FalaGerada> {
  const vel = forcado.velocidade ?? null;
  const est = forcado.estabilidade ?? null;
  const sty = forcado.estilo ?? null;
  const pau = forcado.pausaMs ?? null;

  let velocidade = velocidadeValida(vel, VELOCIDADE_PADRAO);
  let estabilidade = fracaoValida(est, ESTABILIDADE_PADRAO);
  let estilo = fracaoValida(sty, ESTILO_PADRAO);
  let pausaMs = pausaValida(pau, PAUSA_PADRAO_MS);
  try {
    const chave = Deno.env.get("ELEVENLABS_API_KEY");
    if (!chave) return { url: null, voz: null, erro: "ELEVENLABS_API_KEY não configurada", velocidade, estabilidade, estilo, pausaMs };

    // O que se fala é diferente do que se escreve: asterisco de negrito virava
    // "asterisco" na boca da voz, link lido em voz alta é ruído puro, data em
    // número vira uma sequência de "barra" que ninguém entende falada, e cifrão
    // com ponto e vírgula trava a fala.
    const limpo = dinheiroPorExtenso(datasPorExtenso(
      texto
        .replace(/\*([^*]+)\*/g, "$1")
        .replace(/_([^_]+)_/g, "$1")
        .replace(/https?:\/\/\S+/g, "")
        .replace(/\n{3,}/g, "\n\n"),
    )).trim();
    if (limpo.length < 5) return { url: null, voz: null, erro: "texto curto demais para virar áudio", velocidade, estabilidade, estilo, pausaMs };

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
        .select("name, elevenlabs_voice_id, velocidade_fala, estabilidade_fala, estilo_fala, pausa_fala_ms")
        .eq("id", voiceId).eq("status", "ready").maybeSingle();
      nomeDaVoz = vozCustom?.name ?? null;
      voiceId = vozCustom?.elevenlabs_voice_id || "FGY2WhTYpPnrIDTdsKH5";
      // O ajuste da voz só vale se ninguém pediu um na mão. Ordem, igual para
      // os quatro: o que a pessoa está experimentando > o que a voz tem
      // guardado > o padrão do sistema.
      const daVoz = <T,>(forcado: unknown, guardado: unknown, atual: T, valida: (v: unknown, p: T) => T): T =>
        forcado === null && guardado !== null && guardado !== undefined ? valida(guardado, atual) : atual;

      velocidade = daVoz(vel, vozCustom?.velocidade_fala, velocidade, velocidadeValida);
      estabilidade = daVoz(est, vozCustom?.estabilidade_fala, estabilidade, fracaoValida);
      estilo = daVoz(sty, vozCustom?.estilo_fala, estilo, fracaoValida);
      pausaMs = daVoz(pau, vozCustom?.pausa_fala_ms, pausaMs, pausaValida);
    }

    // CORTE, QUANDO PRECISA, NO FIM DE UMA FRASE — e nunca em silêncio.
    //
    // Até 07/09/2026 isto era `limpo.slice(0, maxChars)` com teto de 500: corte
    // seco no caractere. No Caso 341 a resposta tinha 1.205 caracteres e o
    // áudio parou em "ajuizamento", no meio — o cliente ouviria sobre UM
    // processo e nunca saberia do segundo, nem da audiência marcada. Áudio que
    // omite metade da resposta é pior que áudio nenhum: soa completo.
    //
    // O `eleven_multilingual_v2` aceita 10.000 caracteres por chamada, então os
    // 500 nunca foram limite da API — eram limite nosso, 20x menor que o
    // necessário. Agora o teto é de verdade e, quando ele for atingido, o corte
    // cai no fim da última frase inteira e o motivo fica gravado em
    // `audio_erro` para aparecer na tela ao lado do áudio.
    let trecho = limpo;
    let avisoCorte: string | null = null;
    if (limpo.length > maxChars) {
      const bruto = limpo.slice(0, maxChars);
      // Última pontuação de fim de frase; se não houver nenhuma, o último
      // espaço — palavra partida ao meio é o pior dos mundos.
      const fim = Math.max(bruto.lastIndexOf("."), bruto.lastIndexOf("!"),
                           bruto.lastIndexOf("?"), bruto.lastIndexOf("\n"));
      // A METADE DO TETO É PISO, e vale para os dois candidatos. Sem isso, um
      // texto cuja única pontuação está no começo ("Curta. xxxxx…") cortava no
      // primeiro espaço: medido, 6 caracteres de 4.007. Melhor um corte seco no
      // teto do que um áudio de meia palavra.
      const meio = maxChars * 0.5;
      const espaco = bruto.lastIndexOf(" ");
      const corte = fim > meio ? fim + 1 : (espaco > meio ? espaco : maxChars);
      trecho = bruto.slice(0, corte).trim();
      avisoCorte =
        `áudio cortado: a resposta tem ${limpo.length} caracteres e o teto de fala é ${maxChars}. ` +
        `Foram falados ${trecho.length}. O final NÃO está no áudio — confira antes de mandar.`;
    }
    // A PAUSA ENTRA DEPOIS DO CORTE, e a ordem importa.
    //
    // `maxChars` é o teto de RESPOSTA falada, e é isso que a tela diz quando
    // avisa "a resposta tem N caracteres e o teto de fala é M". Se as tags de
    // pausa entrassem antes, elas comeriam esse orçamento: uma resposta com 10
    // quebras de linha perderia ~220 caracteres de conteúdo para marcação
    // invisível, e o aviso de corte passaria a mentir sobre o motivo.
    //
    // Cortar primeiro e marcar depois mantém o teto significando o que ele
    // sempre significou. As tags ainda vão para a API (que cobra por caractere
    // e tem limite de 10.000 no eleven_multilingual_v2), mas 3.000 de texto
    // mais algumas dezenas de tags fica longe do limite.
    const falado = pausasNasQuebras(trecho, pausaMs);

    const resp = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_22050_32`,
      {
        method: "POST",
        headers: { "xi-api-key": chave, "Content-Type": "application/json" },
        body: JSON.stringify({
          text: falado,
          model_id: "eleven_multilingual_v2",
          voice_settings: {
            stability: estabilidade,
            similarity_boost: 0.75,
            style: estilo,
            speed: velocidade,
          },
        }),
      },
    );
    if (!resp.ok) {
      // O corpo do erro diz QUAL parâmetro a API recusou — sem isso, uma
      // velocidade fora do que ela aceita vira um "HTTP 422" mudo na tela.
      const detalhe = await resp.text().catch(() => "");
      return {
        url: null, voz: nomeDaVoz, velocidade, estabilidade, estilo, pausaMs,
        // Os quatro ajustes vão junto no motivo. Com só a velocidade ali, um
        // 422 causado pelo tom ou pela pausa apontaria para o parâmetro errado
        // — e quem lê a tela iria mexer justo no que não era o problema.
        erro: `ElevenLabs HTTP ${resp.status}${detalhe ? `: ${detalhe.slice(0, 200)}` : ""}`
            + ` (velocidade ${velocidade}, estabilidade ${estabilidade}, estilo ${estilo}, pausa ${pausaMs}ms)`,
      };
    }

    const audio = await resp.arrayBuffer();
    const arquivo = `tts/dom-rascunho-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp3`;
    const { error: errUp } = await supabase.storage.from("whatsapp-media")
      .upload(arquivo, new Uint8Array(audio), { contentType: "audio/mpeg", upsert: false });
    if (errUp) return { url: null, voz: nomeDaVoz, erro: `storage: ${errUp.message}`, velocidade, estabilidade, estilo, pausaMs };

    const { data: pub } = supabase.storage.from("whatsapp-media").getPublicUrl(arquivo);
    // `erro` carrega o aviso de corte mesmo com o áudio pronto: a tela mostra os
    // dois. Áudio que existe e está incompleto precisa dizer isso.
    return { url: pub?.publicUrl ?? null, voz: nomeDaVoz, erro: avisoCorte, velocidade, estabilidade, estilo, pausaMs };
  } catch (e) {
    return { url: null, voz: null, erro: (e as Error)?.message ?? "erro", velocidade, estabilidade, estilo, pausaMs };
  }
}

/**
 * Pendência achada pelo atendente vira ATIVIDADE na esteira da equipe.
 *
 * O painel do Dom já mostrava a pendência, e mostrar não é encaminhar: quem
 * não abrisse aquela tela não ficava sabendo. A atividade entra onde a equipe
 * já trabalha todo dia, com dono e com prazo — que é a diferença entre
 * registrar um problema e fazer alguém resolvê-lo.
 *
 * TRÊS CUIDADOS, cada um por um jeito de isto dar errado:
 *
 *  1. SÓ COM PENDÊNCIA DE VERDADE. Nasce do [REVISAR] que o próprio modelo
 *     emitiu, ou da intenção que exige gente. Em modo rascunho TODA resposta
 *     passa por revisão, e criar atividade para cada uma encheria a esteira de
 *     ruído até ninguém mais olhar.
 *
 *  2. NÃO REPETE. Sem esta trava, o mesmo processo parado geraria uma
 *     atividade por rodada do cron — a cada cinco minutos, para sempre. Só
 *     cria se não houver outra igual, aberta, nos últimos 7 dias.
 *
 *  3. FALHAR AQUI NÃO DERRUBA O RASCUNHO. A resposta ao cliente é a entrega;
 *     a atividade é consequência. Se o insert falhar, o motivo vai para o log
 *     e a rodada segue.
 */
async function registrarPendencia(
  supabase: any,
  dados: {
    leadId: string | null;
    grupo: string | null;
    motivo: string;
    pergunta: string;
    atendenteId: string | null;
  },
): Promise<string | null> {
  try {
    if (!dados.leadId) return null;

    const titulo = `Pendência do atendente virtual: ${dados.motivo}`.slice(0, 200);

    const seteDiasAtras = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const { data: jaExiste } = await supabase
      .from("lead_activities")
      .select("id")
      .eq("lead_id", dados.leadId)
      .eq("title", titulo)
      .is("completed_at", null)
      .is("deleted_at", null)
      .gte("created_at", seteDiasAtras)
      .limit(1).maybeSingle();
    if (jaExiste) return (jaExiste as any).id ?? null;

    // Quem cuida: o mesmo rodízio que já atende reclamação. `pick_dom_atendente`
    // devolve o id em dom_atendentes; o dono da atividade é o USUÁRIO por trás
    // dele, senão a linha nasce sem ninguém que a enxergue na própria tela.
    let atendenteId = dados.atendenteId;
    if (!atendenteId) {
      const { data: pick } = await supabase.rpc("pick_dom_atendente", { p_escopo: "reclamacao" });
      atendenteId = (pick as any) || null;
    }
    let userId: string | null = null;
    let userNome: string | null = null;
    if (atendenteId) {
      const { data: at } = await supabase.from("dom_atendentes")
        .select("user_id, nome").eq("id", atendenteId).maybeSingle();
      userId = (at as any)?.user_id ?? null;
      userNome = (at as any)?.nome ?? null;
    }

    // Três dias: perto o bastante para não virar prateleira, longe o bastante
    // para caber num dia cheio.
    const prazo = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);

    const { data: nova, error } = await supabase.from("lead_activities").insert({
      lead_id: dados.leadId,
      title: titulo,
      description:
        `Aberta automaticamente pelo atendente virtual.\n\n` +
        `Motivo: ${dados.motivo}\n` +
        `Grupo: ${dados.grupo ?? "(sem nome)"}\n\n` +
        `O que o cliente escreveu:\n${dados.pergunta.slice(0, 500)}`,
      activity_type: "acompanhamento",
      status: "pendente",
      deadline: prazo,
      assigned_to: userId,
      assigned_to_name: userNome,
      created_by_ai: true,
      action_source: "dom-rascunho",
      action_source_detail: dados.motivo.slice(0, 200),
    }).select("id").maybeSingle();

    if (error) {
      console.error("[dom-rascunho] não consegui abrir a atividade da pendência", error.message);
      return null;
    }
    return (nova as any)?.id ?? null;
  } catch (e) {
    console.error("[dom-rascunho] pendência falhou", (e as Error)?.message);
    return null;
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
      .select("prompt_instructions, base_prompt, temperature, max_tokens, history_limit, model, reply_with_audio, reply_voice_id, max_tts_chars, genero_voz, auto_delay_first_minutes, auto_delay_next_minutes, auto_conversation_window_minutes")
      .eq("id", DOM_AGENT_ID)
      .maybeSingle();
    if (!agente) return json({ error: "agente Dom não encontrado" }, 500);

    // REGERAR O ÁUDIO DE UM RASCUNHO QUE JÁ EXISTE
    //
    // Duas coisas que só se resolvem ouvindo: o ritmo certo de uma voz, e um
    // áudio que ficou ruim. Sem isto, a única forma de ouvir uma velocidade
    // diferente era esperar o próximo cliente mandar um áudio — o que faz o
    // ajuste depender de acaso.
    //
    // Não passa pela fila de grupos e não gera rascunho nenhum: entra, refaz o
    // áudio daquela linha, e sai.
    if (corpo?.regerar_audio) {
      const idPendente = String(corpo.regerar_audio);

      const { data: linha } = await supabase
        .from("dom_respostas_pendentes")
        .select("id, resposta_sugerida, resposta_final, instance_name")
        .eq("id", idPendente).maybeSingle();
      if (!linha) return json({ error: "rascunho não encontrado" }, 404);

      // Fala o que VAI ser mandado, não o que a máquina escreveu primeiro. Se
      // alguém editou a resposta, o áudio antigo já era mentira; regerar ele
      // com o texto velho seria repetir a mentira com voz nova.
      const texto = String((linha as any).resposta_final || (linha as any).resposta_sugerida || "").trim();
      if (!texto) return json({ error: "esta linha não tem texto para falar" }, 400);

      // O AJUSTE QUE VIER FICA GUARDADO NA VOZ
      //
      // É isso que separa configuração de teste: sem gravar, cada clique seria
      // um experimento que morre no próximo áudio, e ninguém conseguiria
      // "acertar o jeito da Keilane falar" — só acertar UM áudio de cada vez.
      //
      // A recusa é dura de propósito (400, e nada é gerado): um valor fora da
      // faixa aceito com um "arredondei para você" produziria um áudio que não
      // é o que a pessoa pediu, e ela escutaria achando que era.
      //
      // `undefined` = a tela não mandou este ajuste, então ele não muda. Só
      // sobe para o banco o que veio no corpo — é por isso que dá para mexer no
      // tom sem reescrever a velocidade que já estava boa.
      const ajustes: AjustesDeFala = {};
      const naVoz: Record<string, unknown> = {};

      /** Estabilidade e estilo são o mesmo tipo de número (0 a 1) e a mesma
       *  guarda. Devolve a mensagem de erro, ou nulo quando está tudo certo. */
      const lerFracao = (campo: "estabilidade" | "estilo", coluna: string): string | null => {
        if (corpo?.[campo] === undefined || corpo?.[campo] === null) return null;
        const n = Number(corpo[campo]);
        if (!Number.isFinite(n) || n < FRACAO_MIN || n > FRACAO_MAX) {
          return `${campo} precisa ser um número entre ${FRACAO_MIN} e ${FRACAO_MAX}`;
        }
        const arredondado = Math.round(n * 100) / 100;
        ajustes[campo] = arredondado;
        naVoz[coluna] = arredondado;
        return null;
      };

      if (corpo?.velocidade !== undefined && corpo?.velocidade !== null) {
        const v = Number(corpo.velocidade);
        if (!Number.isFinite(v) || v < VELOCIDADE_MIN || v > VELOCIDADE_MAX) {
          return json({ error: `velocidade precisa ser um número entre ${VELOCIDADE_MIN} e ${VELOCIDADE_MAX}` }, 400);
        }
        ajustes.velocidade = Math.round(v * 100) / 100;
        naVoz.velocidade_fala = ajustes.velocidade;
      }

      const erroEstabilidade = lerFracao("estabilidade", "estabilidade_fala");
      if (erroEstabilidade) return json({ error: erroEstabilidade }, 400);
      const erroEstilo = lerFracao("estilo", "estilo_fala");
      if (erroEstilo) return json({ error: erroEstilo }, 400);

      if (corpo?.pausa_ms !== undefined && corpo?.pausa_ms !== null) {
        const p = Number(corpo.pausa_ms);
        if (!Number.isFinite(p) || p < PAUSA_MIN_MS || p > PAUSA_MAX_MS) {
          return json({ error: `pausa_ms precisa ser um número entre ${PAUSA_MIN_MS} e ${PAUSA_MAX_MS}` }, 400);
        }
        ajustes.pausaMs = Math.round(p);
        naVoz.pausa_fala_ms = ajustes.pausaMs;
      }

      if (Object.keys(naVoz).length > 0) {
        const vozId = String(agente.reply_voice_id || "");
        // Só voz clonada tem onde guardar. Voz embutida da ElevenLabs não é
        // nossa para configurar — nesse caso o ajuste vale só desta geração e
        // some depois, o que é honesto: não existe lugar para ele morar.
        if (vozId.length === 36 && vozId.includes("-")) {
          const { error: errVoz } = await supabase.from("custom_voices")
            .update({ ...naVoz, updated_at: new Date().toISOString() })
            .eq("id", vozId);
          if (errVoz) return json({ error: `não consegui salvar o ajuste na voz: ${errVoz.message}` }, 500);
        }
      }

      // Usa a voz que o agente tem HOJE, não a que gerou o áudio antigo: quem
      // clica em regerar quer ouvir a configuração atual.
      const som = await gerarAudioDoRascunho(
        supabase,
        texto,
        agente.reply_voice_id ?? null,
        (linha as any).instance_name,
        Math.min(Math.max(agente.max_tts_chars || 3000, 100), 5000),
        ajustes,
      );

      const { error: errGrava } = await supabase.from("dom_respostas_pendentes")
        .update({
          audio_url: som.url, audio_voz: som.voz, audio_erro: som.erro,
          audio_velocidade: som.velocidade, audio_estabilidade: som.estabilidade,
          audio_estilo: som.estilo, audio_pausa_ms: som.pausaMs,
        })
        .eq("id", idPendente);
      if (errGrava) return json({ error: `áudio gerado mas não consegui gravar: ${errGrava.message}` }, 500);

      console.log(
        `[dom-rascunho] regerou áudio pendente=${idPendente} velocidade=${som.velocidade} ` +
        `estabilidade=${som.estabilidade} estilo=${som.estilo} pausa=${som.pausaMs}ms ok=${!!som.url}`,
      );
      return json({
        regerado: true,
        id: idPendente,
        audio_url: som.url,
        audio_voz: som.voz,
        audio_erro: som.erro,
        velocidade: som.velocidade,
        estabilidade: som.estabilidade,
        estilo: som.estilo,
        pausa_ms: som.pausaMs,
        caracteres: texto.length,
      });
    }

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
      // `escopo_status` também aqui, e não só na RPC: este caminho é a porta de
      // serviço. Em 06/09/2026 o grupo PESSOAL "Familia gold1p.x" tinha três
      // rascunhos prontos porque tinha entrado no piloto por uma carga em lote
      // que casou a palavra FAMILIA em qualquer posição do nome. Fechar só o
      // cron e deixar esta aberta seria trancar a porta da frente e esquecer a
      // dos fundos — inclusive no modo `teste`, que não grava nada mas LÊ a
      // conversa inteira e a manda para o modelo. Grupo fora do escopo não é
      // lido, ponto.
      const { data } = await supabase.from("dom_grupos_piloto")
        .select("group_jid, group_name, lead_id, modo")
        .eq("ativo", true).eq("escopo_status", "operacional")
        .eq("group_jid", soEsteGrupo).limit(1);
      grupos = data ?? [];
      if (grupos.length === 0) {
        // Diz POR QUE recusou. "0 grupos" mandaria quem está depurando procurar
        // defeito no prompt quando o problema é o grupo estar em quarentena.
        const { data: fora } = await supabase.from("dom_grupos_piloto")
          .select("group_name, escopo_status, ativo")
          .eq("group_jid", soEsteGrupo).maybeSingle();
        if (fora) {
          return json({
            error: "grupo fora do escopo operacional",
            group_jid: soEsteGrupo,
            group_name: fora.group_name,
            escopo_status: fora.escopo_status,
            ativo: fora.ativo,
          }, 200);
        }
      }
    } else {
      const { data, error } = await supabase.rpc("dom_grupos_para_olhar", { p_limite: limite });
      if (error) return json({ error: `fila de grupos: ${error.message}` }, 500);
      grupos = data ?? [];
    }

    // OS TRÊS NÚMEROS DO RITMO, com piso e teto.
    //
    // Teto de 60 min porque atraso maior que isso não é "parecer ocupado", é
    // abandono — e a janela de revisão vira longa demais para o `pular_se_
    // responder` proteger de alguma coisa. Piso de 1 porque zero seria o agente
    // respondendo no mesmo segundo, que é o defeito que estes números existem
    // para consertar.
    const nosLimites = (v: unknown, padrao: number) =>
      Math.min(Math.max(Number(v) > 0 ? Number(v) : padrao, 1), 60);
    const atrasoPrimeira = nosLimites(agente.auto_delay_first_minutes, ATRASO_PRIMEIRA_PADRAO);
    const atrasoSeguinte = nosLimites(agente.auto_delay_next_minutes, ATRASO_SEGUINTE_PADRAO);
    const janelaConversaMin = Math.min(
      Math.max(Number(agente.auto_conversation_window_minutes) > 0
        ? Number(agente.auto_conversation_window_minutes)
        : JANELA_CONVERSA_PADRAO_MIN, 1),
      60 * 24 * 7,
    );

    // QUAIS CONVERSAS AINDA ESTÃO QUENTES — uma consulta só, antes do laço.
    //
    // Perguntar grupo a grupo dentro do laço seria N+1: uma ida ao banco por
    // grupo só para descobrir um booleano. Aqui é um `in` com os jids que
    // interessam, coberto por `idx_wa_agendadas_conversa (phone, ...)`.
    //
    // A pergunta é "o agente falou aqui dentro da janela?", e não "alguém falou
    // aqui?": mensagem do cliente não engatilha nada — o que faz a conversa
    // estar em andamento é o agente já ter entrado nela. Mensagem de humano
    // também não, porque quando um colega responde vale a pausa de
    // `human_reply_pause_minutes`, que é outra regra.
    const jidsAuto = (grupos ?? [])
      .filter((g: any) => g.modo === "automatico")
      .map((g: any) => g.group_jid);
    const conversaQuente = new Set<string>();
    if (jidsAuto.length) {
      const desde = new Date(Date.now() - janelaConversaMin * 60 * 1000).toISOString();
      const { data: falas } = await supabase
        .from("whatsapp_mensagens_agendadas")
        .select("phone")
        .in("phone", jidsAuto)
        // Pega o automático ("Atendente virtual") e o aprovado no painel
        // ("Atendente virtual (aprovado à mão)"): os dois são o agente falando.
        .like("criado_por_nome", "Atendente virtual%")
        .gte("ultimo_envio_at", desde);
      for (const f of falas ?? []) conversaQuente.add(String((f as any).phone));
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
      const vistos = new Map<string, any>();
      const lista: any[] = [];
      for (const m of brutas ?? []) {
        const msg = (m.metadata as any)?.message ?? {};
        const mid = String(msg.messageid || msg.id || `${m.created_at}|${m.message_text}`);
        const texto = (m.message_text || "").trim();
        const tipo = m.message_type || "text";

        // As cópias da mesma mensagem NÃO são iguais, e ficar com a primeira
        // (a mais recente, porque a busca vem em ordem decrescente) é sorteio.
        // A instância que transcreveu o áudio traz o texto; a que não
        // transcreveu traz vazio. A que recebeu `mediaType` vazio da UazAPI
        // traz o tipo errado. Medido em 08/09/2026: dos áudios que tinham uma
        // cópia boa e uma pobre em 7 dias, o sorteio deu a pobre em 4 de 4 —
        // um deles o áudio do seu Manoel que virou "[o cliente enviou um
        // documento]". Agora a cópia que tem conteúdo ganha da que chegou por
        // último.
        const jaVista = vistos.get(mid);
        if (jaVista) {
          if (!jaVista.texto && texto) {
            jaVista.texto = texto;
            jaVista.tipo = tipo;
          } else if (!jaVista.texto && jaVista.tipo === "document" && tipo !== "document") {
            // Sem texto de nenhum lado, vale o tipo mais específico: `document`
            // é para onde o webhook joga o que não reconheceu.
            jaVista.tipo = tipo;
          }
          continue;
        }
        const remetente = so(msg.sender_pn || msg.sender);
        const linha = {
          texto,
          tipo,
          instancia: m.instance_name,
          criado: m.created_at,
          autor: msg.senderName || m.contact_name || null,
          // 2. fromMe é nosso envio; remetente na lista da equipe também é nosso.
          //    Quem não está na lista é tratado como cliente — errar respondendo
          //    um colega é visível; errar ignorando cliente é silencioso.
          daEquipe: msg.fromMe === true || (remetente !== "" && equipe.has(remetente)),
        };
        vistos.set(mid, linha);
        lista.push(linha);
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

      // A TRAVA DO VALOR — vem ANTES do modo teste de propósito: quem está
      // ajustando o prompt precisa ver o que a trava faria de verdade, senão
      // testa um texto que nunca sairia assim.
      const semLastro = valoresSemLastro(resposta, String(domCtx.blocos || ""));
      if (semLastro.length > 0) {
        // O texto inteiro cai, não só o número. Tirar "R$ 1.621,00" da frase
        // "o valor de R$ 1.621,00 é o valor bruto" deixaria de pé a afirmação
        // sobre bruto e desconto, que é a mesma invenção sem o número.
        console.log(
          `[dom-rascunho] valor sem lastro grupo=${g.group_jid} intencao=${cls.intencao} ` +
          `barrados=${semLastro.length}`,
        );
        resposta = RESPOSTA_SEM_VALOR;
        motivo = `valor sem lastro no processo (${semLastro.join(", ")}) — texto do modelo descartado`;
      }

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
          valores_barrados: semLastro,
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
        // O motivo é o que a pessoa lê na fila antes de abrir. "precisa de
        // atendente humano" serve para E17 ou E18; para quem falou em desistir,
        // ele esconde a única informação que faz alguém largar o que está
        // fazendo e ir olhar.
        const MOTIVO_POR_INTENCAO: Record<string, string> = {
          E20: "falou em DESISTIR do caso — falar com ele hoje",
          E21: "pediu dinheiro adiantado — só a equipe responde isso",
          E22: "indicou um cliente novo — alguém precisa ligar",
        };
        motivo = motivo
          || MOTIVO_POR_INTENCAO[cls.intencao]
          || `intenção ${cls.intencao}: precisa de atendente humano`;
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

      // 6. Pendência vira atividade com dono e prazo. Depois da fila de
      //    propósito: se o rascunho não entrou, não há o que encaminhar.
      if (motivo) {
        const atvId = await registrarPendencia(supabase, {
          leadId: g.lead_id || domCtx.contexto?.lead_id || null,
          grupo: g.group_name ?? null,
          motivo,
          pergunta,
          atendenteId,
        });
        // Log sem texto de cliente: só o que dá para auditar.
        console.log(`[dom-rascunho] pendência grupo=${g.group_jid} atividade=${atvId ?? "nenhuma"}`);
      }

      // 7. O cliente falou por áudio? Então a resposta nasce falada também — e,
      //    desde 08/09/2026, ela SAI falada: a fila de agendamento passou a
      //    carregar mídia (migration 20260908013000). Antes disso o áudio era
      //    gerado, tocava no painel e morria ali; quem mandou três áudios
      //    recebia parágrafo (Caso 09, 07/09/2026).
      const clientePorAudio = ["audio", "ptt", "voice"].includes(String(ultima.tipo || "").toLowerCase());
      /** A fala pronta deste rascunho. Nula = a resposta sai escrita. */
      let falaDaResposta: string | null = null;
      if (clientePorAudio && agente.reply_with_audio === true && (linhaFila as any)?.id) {
        const som = await gerarAudioDoRascunho(
          supabase,
          resposta,
          agente.reply_voice_id ?? null,
          ultima.instancia,
          // Teto de fala. Era 500 por padrão e 1.000 no limite — e o
          // eleven_multilingual_v2 aceita 10.000. Os 500 cortavam a resposta
          // média pela metade. Agora o padrão é 3.000 (cobre com folga a maior
          // resposta já gerada, de 1.205) e o limite duro é 5.000, que é o teto
          // do modelo mais restrito da casa, caso alguém troque de modelo.
          // Custo: a ElevenLabs cobra por caractere, então resposta longa passa
          // a custar mais. A média é de 333 caracteres — a maioria não muda.
          Math.min(Math.max(agente.max_tts_chars || 3000, 100), 5000),
        );
        await supabase.from("dom_respostas_pendentes")
          .update({
            audio_url: som.url, audio_voz: som.voz, audio_erro: som.erro,
            audio_velocidade: som.velocidade, audio_estabilidade: som.estabilidade,
            audio_estilo: som.estilo, audio_pausa_ms: som.pausaMs,
          })
          .eq("id", (linhaFila as any).id);
        if (som.erro) console.warn(`[dom-rascunho] áudio falhou grupo=${g.group_jid}: ${som.erro}`);
        // ÁUDIO CORTADO NÃO FALA. `erro` com url preenchida quer dizer que a
        // fala terminou antes da resposta — e áudio pela metade soa completo,
        // que é pior que texto. Nesse caso o texto sai, e a fala fica no painel
        // para alguém decidir.
        falaDaResposta = som.erro ? null : som.url;
      }

      // 8. Modo automático: o rascunho entra na MESMA fila de agendamento que a
      //    equipe já usa. É de lá que sai a bolha tracejada com o cronômetro na
      //    conversa, o "tirar da fila" e o "enviar agora" — nada disso precisou
      //    ser escrito de novo.
      //
      //    A janela É a revisão: silêncio aprova. E `pular_se_responder` garante
      //    o resto — se o cliente OU um colega escrever no grupo dentro da
      //    janela, a resposta não sai. Rascunho velho não fala, e o tique
      //    seguinte redesenha em cima do que foi dito.
      //
      //    A janela encolhe quando a conversa já está em andamento (ver o bloco
      //    dos três números lá em cima). Encolher é seguro: o que protege é o
      //    `pular_se_responder`, não o tamanho da espera — e numa conversa
      //    quente a chance de alguém escrever por cima é maior, não menor.
      //
      //    Fica de fora, de propósito: grupo de reclamação (já foi para uma
      //    pessoa) e resposta que o próprio modelo marcou com [REVISAR] — nesses
      //    dois o silêncio não pode valer como aprovação.
      const pendenteId = (linhaFila as any)?.id ?? null;
      let agendadoPara: string | null = null;
      if (g.modo === "automatico" && !atendenteId && !motivo) {
        const atrasoMin = conversaQuente.has(g.group_jid) ? atrasoSeguinte : atrasoPrimeira;
        const quando = new Date(Date.now() + atrasoMin * 60 * 1000).toISOString();
        const { data: ag, error: errAg } = await supabase
          .from("whatsapp_mensagens_agendadas").insert({
            phone: g.group_jid,
            instance_name: ultima.instancia,
            lead_id: g.lead_id || domCtx.contexto?.lead_id || null,
            contact_name: g.group_name || null,
            mensagem: resposta,
            mensagem_original: resposta,
            // Só a nota de voz chega ao cliente; `mensagem` continua sendo o
            // registro do que foi dito, e é o que a bolha da conversa mostra.
            media_url: falaDaResposta,
            media_type: falaDaResposta ? "audio/mpeg" : null,
            media_ptt: !!falaDaResposta,
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
              motivo_revisao: `sai sozinho em ${atrasoMin} min — some se alguém escrever antes`,
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
