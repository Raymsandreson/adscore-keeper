// A leitura feita no CELULAR apagando o badge do app — e o retroativo dela.
//
// O problema: toda mensagem que passa pela instância já cai em
// `whatsapp_messages` (o webhook grava `fromMe` como outbound desde sempre),
// mas o ESTADO DE LEITURA nunca atravessou. Quem abre a conversa no aparelho
// zera o contador no WhatsApp e no app o badge continua aceso; quem abre no app
// grava `read_at` e o aparelho continua com a bolinha verde. Duas verdades para
// a mesma pergunta — "isso já foi respondido?".
//
// Este arquivo é o lado do BANCO dessa sincronia, e é um só de propósito: o
// evento `chats` do webhook (tempo real) e a reconciliação retroativa
// (`whatsapp-sync-leitura`) marcam pela MESMA função. Se a regra de quais
// mensagens contam divergir entre os dois, o retroativo desfaz o que o tempo
// real fez, e ninguém descobre — o erro aqui é sempre silencioso.
//
// O que NÃO está aqui: a volta (app → celular), que é uma chamada a
// `/chat/read` da UazAPI e muda o que o CLIENTE vê (manda confirmação de
// leitura). Isso é decisão de escritório, não consequência técnica desta.
//
// De onde o resto vem de graça: `trg_whatsapp_messages_update_read`
// (migration 20260417181351) reage a `UPDATE OF read_at` e decrementa
// `conversations.unread_count`. Ou seja, carimbar `read_at` aqui é tudo —
// o badge do app cai sozinho, pelo Realtime, sem uma linha de UI nova.
import type { SupabaseClient } from '@supabase/supabase-js';

export const UAZAPI_TIMEOUT_MS = 20000;

/**
 * GATE do tempo real. Sai DESLIGADO de propósito.
 *
 * A razão não é medo de deploy: é que `wa_unreadCount` da UazAPI não foi
 * observado em produção ainda, e o modo de falha se ele vier sempre zero é o
 * pior possível — o badge de não lida da equipe inteira apaga para sempre, e
 * some com a fila de quem precisa responder. Desligado, o handler continua
 * rodando e LOGA exatamente o que teria marcado; uma linha de log do Railway
 * decide se liga.
 *
 * Ligar: `WHATSAPP_READ_SYNC=on` no painel do Railway. Desligar: tirar a var.
 *
 * Lida a cada chamada, e não uma vez na importação, para o teste poder ligar e
 * desligar o gate sem recarregar módulo — é o comportamento que mais precisa
 * ficar preso, porque o modo errado dele é irreversível.
 */
export function leituraSyncLigada(): boolean {
  return /^(1|true|on|yes)$/i.test(process.env.WHATSAPP_READ_SYNC || '');
}

/**
 * Dígitos — é assim que o webhook grava `whatsapp_messages.phone`
 * (`whatsapp-webhook.ts`: tira o sufixo do JID e depois todo não-dígito).
 * Replicado aqui com o MESMO resultado para `@s.whatsapp.net`, `@g.us` e `@lid`:
 * uma normalização diferente não dá erro, dá conversa que não casa com nada.
 */
export function telefoneDoChat(waChatid: string | null | undefined): string {
  if (!waChatid) return '';
  return String(waChatid).replace(/@[^@]+$/, '').replace(/\D/g, '').replace(/^0+/, '');
}

/** Grupo pelo sufixo, ou pelo comprimento quando ele já foi tirado (17+ dígitos). */
export function ehGrupoChat(waChatid: string | null | undefined, flag?: boolean): boolean {
  if (flag === true) return true;
  const bruto = String(waChatid || '');
  if (bruto.includes('@g.us')) return true;
  return telefoneDoChat(bruto).length >= 17;
}

/** As grafias sob as quais o chat pode estar gravado na coluna `phone`. */
export function variantesDeTelefone(digitos: string): string[] {
  if (!digitos) return [];
  return Array.from(new Set([digitos, `${digitos}@g.us`, `${digitos}@s.whatsapp.net`]));
}

/** O webhook grava "CRIS" onde o cadastro diz "Cris", e o filtro é case-sensitive. */
export function variantesDeInstancia(nome: string): string[] {
  return Array.from(new Set([nome, nome.toUpperCase(), nome.toLowerCase()].filter(Boolean)));
}

export interface LoteDeLeitura {
  /** Nome canônico da instância. Ignorado quando `grupo` é true. */
  instancia: string;
  /** Telefones em dígitos. Todos do mesmo tipo (pessoa OU grupo). */
  telefones: string[];
  /**
   * Grupo NÃO filtra instância — cada instância nossa que participa grava a sua
   * cópia da mesma mensagem, e deixar as cópias sem `read_at` mantém o badge
   * aceso para o próximo colega. É a mesma regra do `marcarComoLidas` do app.
   */
  grupo: boolean;
  /**
   * Nada depois deste instante é marcado. O corte é tirado ANTES de perguntar
   * à UazAPI: a mensagem que chegar durante a varredura não foi lida por
   * ninguém, e marcá-la seria apagar uma pendência que acabou de nascer.
   */
  corteISO: string;
}

function aplicarFiltro(query: any, lote: LoteDeLeitura) {
  const telefones = lote.telefones.flatMap(variantesDeTelefone);
  let q = query
    .in('phone', telefones)
    .eq('direction', 'inbound')
    .is('read_at', null)
    .lte('created_at', lote.corteISO);
  if (!lote.grupo) q = q.in('instance_name', variantesDeInstancia(lote.instancia));
  return q;
}

/** Quantas seriam marcadas. É o dry-run — e o guarda antes de escrever. */
export async function contarNaoLidas(ext: SupabaseClient<any>, lote: LoteDeLeitura): Promise<number> {
  if (!lote.telefones.length) return 0;
  // `count=exact` em whatsapp_messages SEM filtro de telefone derruba a consulta
  // (8s, 57014 — medido em 20/08/2026). Aqui sempre há filtro de telefone.
  const { count, error } = await aplicarFiltro(
    ext.from('whatsapp_messages').select('id', { count: 'exact', head: true }),
    lote,
  );
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** Carimba `read_at`. Devolve quantas linhas casaram. */
export async function marcarLidas(ext: SupabaseClient<any>, lote: LoteDeLeitura): Promise<number> {
  if (!lote.telefones.length) return 0;
  const { count, error } = await aplicarFiltro(
    ext.from('whatsapp_messages').update({ read_at: new Date().toISOString() }, { count: 'exact' }),
    lote,
  );
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export interface InstanciaCanonica {
  instance_name: string;
  instance_token: string | null;
  base_url: string | null;
  is_paused: boolean | null;
}

/**
 * O nome canônico da instância, pelo token e — se ele não casar — pelo nome sem
 * caixa. Mesma ordem que o caminho de mensagem do webhook usa; um nome fora do
 * cadastro faria o UPDATE casar zero linhas e "dar certo".
 */
export async function canonicalizarInstancia(
  ext: SupabaseClient<any>,
  nome: string | null,
  token: string | null,
): Promise<InstanciaCanonica | null> {
  const colunas = 'instance_name, instance_token, base_url, is_paused';
  if (token) {
    const { data } = await ext
      .from('whatsapp_instances').select(colunas)
      .eq('instance_token', token).eq('is_active', true).limit(1).maybeSingle();
    if (data) return data as InstanciaCanonica;
  }
  if (nome) {
    const { data } = await ext
      .from('whatsapp_instances').select(colunas)
      .ilike('instance_name', nome).eq('is_active', true).limit(1).maybeSingle();
    if (data) return data as InstanciaCanonica;
  }
  return null;
}

export interface ResultadoDoEvento {
  aplicado: boolean;
  motivo?: string;
  instancia?: string;
  telefone?: string;
  grupo?: boolean;
  nao_lidas?: number;
  marcadas?: number;
}

/**
 * O evento `chats` da UazAPI: a conversa foi aberta (ou marcada como lida) no
 * aparelho, e o contador dela zerou.
 *
 * Só o ZERO é sinal. `wa_unreadCount > 0` NÃO desmarca nada: o app tem a sua
 * própria leitura (quem abriu a conversa aqui já respondeu), e deixar o celular
 * reacender o badge faria as duas pontas brigarem para sempre pela mesma linha.
 * A sincronia é de uma direção só, e apagar é idempotente.
 */
export async function sincronizarLeituraDoChat(
  ext: SupabaseClient<any>,
  body: any,
  instanciaDaUrl: string | null,
): Promise<ResultadoDoEvento> {
  const chat = (body?.chat && typeof body.chat === 'object' ? body.chat : null)
    || (body?.data?.chat && typeof body.data.chat === 'object' ? body.data.chat : null)
    || (body?.data && typeof body.data === 'object' ? body.data : null)
    || {};

  const waChatid = String(chat.wa_chatid || chat.id || chat.chatid || body?.chatid || '');
  const bruto = chat.wa_unreadCount ?? chat.unreadCount ?? chat.wa_unread_count;

  if (!waChatid || bruto === undefined || bruto === null) {
    // O payload do evento `chats` não estava documentado quando isto foi
    // escrito. Se ele chegar com outro formato, esta linha é o que diz qual —
    // sem ela, o recurso morre calado e ninguém sabe se o evento chegou.
    console.log('[leitura-sync] evento chats sem wa_unreadCount:', JSON.stringify(body || {}).slice(0, 1200));
    return { aplicado: false, motivo: 'payload_sem_unread_count' };
  }

  const naoLidasNoCelular = Number(bruto);
  if (!Number.isFinite(naoLidasNoCelular) || naoLidasNoCelular > 0) {
    return { aplicado: false, motivo: 'chat_ainda_nao_lido' };
  }

  const instancia = await canonicalizarInstancia(
    ext,
    body?.instanceName || body?.InstanceName || chat.instanceName || instanciaDaUrl || null,
    body?.token || chat.token || null,
  );
  if (!instancia) return { aplicado: false, motivo: 'instancia_desconhecida' };
  if (instancia.is_paused) return { aplicado: false, motivo: 'instancia_pausada' };

  const telefone = telefoneDoChat(waChatid);
  if (!telefone) return { aplicado: false, motivo: 'chat_sem_telefone' };

  const lote: LoteDeLeitura = {
    instancia: instancia.instance_name,
    telefones: [telefone],
    grupo: ehGrupoChat(waChatid, chat.wa_isGroup === true),
    corteISO: new Date().toISOString(),
  };

  const naoLidas = await contarNaoLidas(ext, lote);
  if (naoLidas === 0) return { aplicado: false, motivo: 'nada_a_marcar', instancia: lote.instancia, telefone };

  if (!leituraSyncLigada()) {
    console.log('[leitura-sync][observando] marcaria como lidas', {
      instancia: lote.instancia, telefone, grupo: lote.grupo, nao_lidas: naoLidas,
      ligar_com: 'WHATSAPP_READ_SYNC=on',
    });
    return { aplicado: false, motivo: 'gate_desligado', instancia: lote.instancia, telefone, grupo: lote.grupo, nao_lidas: naoLidas };
  }

  const marcadas = await marcarLidas(ext, lote);
  console.log('[leitura-sync] lido no celular', { instancia: lote.instancia, telefone, grupo: lote.grupo, marcadas });
  return { aplicado: true, instancia: lote.instancia, telefone, grupo: lote.grupo, nao_lidas: naoLidas, marcadas };
}

export interface ChatDaUazapi {
  wa_chatid: string;
  wa_unreadCount: number;
  wa_isGroup: boolean;
}

/**
 * Uma página de `/chat/find`. A rota aceita filtro em vários campos, mas NÃO em
 * `wa_unreadCount` (conferido no OpenAPI da UazAPI em 11/09/2026) — então a
 * leitura é paginada e o filtro acontece aqui.
 */
export async function paginaDeChats(
  baseUrl: string,
  token: string,
  offset: number,
  limite: number,
): Promise<{ chats: ChatDaUazapi[]; total: number | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UAZAPI_TIMEOUT_MS);
  let resposta: Response;
  try {
    resposta = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/find`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', token },
      body: JSON.stringify({ limit: limite, offset, sort: '-wa_lastMsgTimestamp' }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  const texto = await resposta.text();
  if (!resposta.ok) {
    if (/no session/i.test(texto) || resposta.status === 401) {
      throw new Error(`INSTANCE_DISCONNECTED: ${resposta.status}`);
    }
    throw new Error(`UazAPI ${resposta.status}: ${texto.slice(0, 200)}`);
  }

  let dados: any = null;
  try { dados = JSON.parse(texto); } catch { throw new Error(`UazAPI devolveu não-JSON: ${texto.slice(0, 200)}`); }

  const lista: any[] = Array.isArray(dados) ? dados : (dados?.chats || []);
  return {
    chats: lista.map((c: any) => ({
      wa_chatid: String(c?.wa_chatid || c?.id || ''),
      wa_unreadCount: Number(c?.wa_unreadCount ?? c?.unreadCount ?? -1),
      wa_isGroup: c?.wa_isGroup === true,
    })).filter((c) => c.wa_chatid),
    total: Number.isFinite(Number(dados?.pagination?.totalRecords)) ? Number(dados.pagination.totalRecords) : null,
  };
}

export interface Pendencia {
  /** Dígitos, como a coluna `phone` guarda. */
  telefone: string;
  /** Quantas inbound sem `read_at` — é o peso do chat no lote. */
  naoLidas: number;
  grupo: boolean;
}

/**
 * Quebra o retroativo em lotes com teto DUPLO: quantos chats (tamanho da URL do
 * PostgREST, que vai por query string) e quantas linhas (tempo da transação,
 * contra o statement_timeout de 8s medido nesta tabela).
 *
 * Um chat maior que o teto de linhas vai sozinho em vez de ser descartado —
 * some da varredura é justamente o grupo antigo que mais tem badge aceso.
 */
export function emLotes(itens: Pendencia[], maxChats: number, maxLinhas: number): Pendencia[][] {
  const lotes: Pendencia[][] = [];
  let atual: Pendencia[] = [];
  let linhas = 0;
  for (const item of itens) {
    if (atual.length && (atual.length >= maxChats || linhas + item.naoLidas > maxLinhas)) {
      lotes.push(atual);
      atual = [];
      linhas = 0;
    }
    atual.push(item);
    linhas += item.naoLidas;
  }
  if (atual.length) lotes.push(atual);
  return lotes;
}
