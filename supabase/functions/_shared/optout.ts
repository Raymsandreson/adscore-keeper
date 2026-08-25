/**
 * Opt-out de WhatsApp: reconhecer o pedido de parada e canonicalizar telefone.
 *
 * Mora em `_shared` porque é a parte que NÃO pode errar — falso positivo aqui
 * fecha o lead de alguém que ainda queria atendimento — e porque assim dá para
 * testar de verdade (src/lib/__tests__/whatsappOptout.test.ts). Nada aqui usa
 * API de Deno nem de rede de propósito: são funções puras.
 *
 * ATENÇÃO À DUPLICAÇÃO CONSCIENTE: `optoutKey` está copiada nas edges
 * `_external/send-whatsapp` e `_external/whatsapp-optout`, que são deployadas
 * no projeto Externo isoladamente e por isso não importam de `_shared`. E a
 * mesma regra existe uma terceira vez em SQL, como `public.wa_optout_key(text)`
 * (migration 20260824140000). Mudar a regra exige mudar nos quatro lugares.
 */

/**
 * Chave canônica do telefone: 55 + DDD + 8 últimos dígitos.
 *
 * Existe porque o mesmo número aparece nas duas formas em `whatsapp_messages`:
 * medido no Externo em 24/08/2026, 1.372 números com 12 dígitos (sem o 9º) e
 * 729 com 13 (com o 9º) nos últimos 30 dias. Sem normalizar, o opt-out
 * registrado numa forma não bloquearia a outra — que é o mesmo aparelho.
 */
export function optoutKey(raw: unknown): string | null {
  let v = String(raw ?? "").replace(/@.*$/, "").replace(/\D/g, "");
  if (!v) return null;
  if (v.length >= 10 && v.length <= 11) v = "55" + v;
  if (v.startsWith("55") && v.length === 13 && v[4] === "9") {
    v = v.slice(0, 4) + v.slice(5);
  }
  return v || null;
}

/**
 * Só a mensagem INTEIRA vale como comando de saída. "Vou sair do trabalho
 * agora" e "pode parar na esquina" não podem fechar um atendimento.
 */
const OPTOUT_MENSAGEM_EXATA =
  /^(sair|parar|pare|para|stop|cancelar|descadastrar|remover|sai fora)[.!]?$/i;

const OPTOUT_FRASES = [
  // Como a recusa realmente aparece nesta base — os quatro primeiros padrões
  // saíram de ler 90 dias de mensagens recebidas (66.253 inbound curtas), não
  // de imaginar como alguém escreveria. "sair"/"pare"/"stop" sozinhos: ZERO
  // ocorrências no período. "não tenho interesse": 16. "não quero" no fim da
  // frase: 7. "não quero prosseguir/dar continuidade": 6.
  /n[ãa]o\s+tenho\s+(mais\s+)?interesse/i,
  /n[ãa]o\s+quero\s*(mais)?\s*[.!]?$/i,
  /n[ãa]o\s+quero\s+(mais\s+|ma[si]\s+)?(dar\s+continuidade|prosseguir|continuar|seguir)\b/i,
  /^\s*sem\s+interesse/i,
  /n[ãa]o\s+(quero|desejo)\s+(mais\s+)?(receber|nada|ser\s+contatad)/i,
  /n[ãa]o\s+(me\s+)?(mand[ea]|envie|manda)\s+mais/i,
  /par[ea]\s+de\s+(me\s+)?(mandar|enviar|encher|perturbar)/i,
  /me\s+(tir[ea]|remov[ae]|exclu[ai])\s+(dess[ae]|d[ao])\s+(lista|grupo|cadastro)/i,
  /(remov|exclu|apagu?)[a-z]*\s+meu\s+(n[úu]mero|contato|cadastro)/i,
  /me\s+dei?x[ea]\s+em\s+paz/i,
  /vou\s+denunciar/i,
];

/**
 * Deliberadamente ESTREITO. Deixar passar um pedido custa uma mensagem a mais
 * (e a equipe ainda pode marcar à mão); marcar errado apaga um lead vivo do
 * funil. Na dúvida, não é pedido de parada.
 */
export function pediuParaParar(texto: string | null | undefined): boolean {
  const t = String(texto ?? "").trim();
  if (!t || t.length > 160) return false; // desabafo longo não é comando de saída
  if (OPTOUT_MENSAGEM_EXATA.test(t)) return true;
  return OPTOUT_FRASES.some((re) => re.test(t));
}

/**
 * Ack de entrega. UazAPI/Baileys mandam ora número (1=sent, 2=delivered,
 * 3=read, 4=played), ora string. Não consegui confirmar o formato exato na doc
 * (o proxy desta rede bloqueia docs.uazapi.com), então aceita os dois e devolve
 * null no que não reconhecer — quem chama registra amostra e segue.
 */
const ACK_RANK: Record<string, number> = { sent: 1, delivered: 2, read: 3, played: 4 };
const ACK_NUMERICO: Record<number, string> = { 1: "sent", 2: "delivered", 3: "read", 4: "played" };

export function normalizeAckStatus(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return ACK_NUMERICO[raw] || null;
  const s = String(raw).trim().toLowerCase();
  if (!s) return null;
  if (/^\d+$/.test(s)) return ACK_NUMERICO[Number(s)] || null;
  if (s.includes("play")) return "played";
  if (s.includes("read") || s.includes("viewed")) return "read";
  if (s.includes("deliv")) return "delivered";
  if (s === "sent" || s.includes("server_ack")) return "sent";
  return null;
}

/**
 * Status que este ack pode sobrescrever. Ack chega fora de ordem: 'read' não
 * pode regredir para 'delivered'. Lista vazia = nada a fazer.
 */
export function statusAbaixoDe(novo: string): string[] {
  const r = ACK_RANK[novo] ?? 0;
  return Object.keys(ACK_RANK).filter((k) => ACK_RANK[k] < r);
}
