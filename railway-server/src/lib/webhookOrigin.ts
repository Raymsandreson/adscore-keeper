// Observação de origem do webhook da UazAPI.
//
// O `/functions/whatsapp-webhook` é a porta por onde entram TODAS as mensagens
// de WhatsApp da firma (~22 chamadas/min medidas em produção em 11/08/2026) e
// hoje ela não verifica remetente nenhum: qualquer um que saiba a URL forja uma
// mensagem, e o handler grava sob service role. O CLAUDE.md exige verificação de
// origem em webhook — mas ligar a verificação no chute derrubaria a ingestão
// inteira, que é pior que o buraco.
//
// A boa notícia é que o material para verificar já chega no payload: a UazAPI
// manda `token` (o instance_token, que só ela e nós conhecemos) e o handler já
// o usa para canonizar a instância (whatsapp-webhook.ts:1733-1742). Só que ele
// aceita o fallback por NOME quando o token não casa — ou seja, não gateia nada.
//
// Aqui só MEDIMOS, sem bloquear: quantos eventos chegam com token que casa com
// instância ativa, quantos com token desconhecido, quantos sem token nenhum, e
// quais tipos de evento ficam de fora. Se `sem_token` e `token_desconhecido`
// ficarem zerados ao longo de um dia, exigir o token vira uma mudança segura.
// Sem esse número, exigir o token é palpite.
import { supabase as ext } from './supabase';

type Verdict = 'token_ok' | 'token_desconhecido' | 'sem_token';

const stats = {
  total: 0,
  token_ok: 0,
  token_desconhecido: 0,
  sem_token: 0,
};
// Que tipo de evento chega sem token válido — é a lista que precisa ficar vazia
// antes de transformar o token em exigência.
const semTokenPorEvento = new Map<string, number>();
const EVENT_CAP = 30;

// O conjunto de tokens ativos muda raramente (dezenas de instâncias), e uma
// consulta por mensagem colocaria o banco no caminho quente da ingestão.
const TOKEN_TTL_MS = 5 * 60_000;
let tokenCache: { tokens: Set<string>; expiresAt: number } | null = null;
let inFlight: Promise<Set<string>> | null = null;

async function activeInstanceTokens(): Promise<Set<string>> {
  const now = Date.now();
  if (tokenCache && now < tokenCache.expiresAt) return tokenCache.tokens;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const { data, error } = await ext
      .from('whatsapp_instances')
      .select('instance_token')
      .eq('is_active', true)
      .not('instance_token', 'is', null);
    if (error) {
      // Falha de leitura não pode virar veredito: mantém o cache velho (ou um
      // conjunto vazio de vida curta) e tenta de novo no próximo evento.
      const fallback = tokenCache?.tokens ?? new Set<string>();
      tokenCache = { tokens: fallback, expiresAt: Date.now() + 30_000 };
      return fallback;
    }
    const tokens = new Set<string>(
      (data ?? []).map((r: any) => String(r.instance_token || '')).filter(Boolean),
    );
    tokenCache = { tokens, expiresAt: Date.now() + TOKEN_TTL_MS };
    return tokens;
  })().finally(() => {
    inFlight = null;
  });

  return inFlight;
}

function eventLabel(body: any): string {
  const raw =
    body?.EventType ?? body?.event ?? body?.type ?? body?.eventType ?? 'desconhecido';
  return String(typeof raw === 'object' ? 'objeto' : raw).slice(0, 40) || 'vazio';
}

/**
 * Classifica a origem de um evento da UazAPI e contabiliza. NÃO bloqueia nada:
 * é chamada em fire-and-forget para não somar latência à entrada de mensagem.
 */
export async function observeUazapiOrigin(body: any): Promise<Verdict> {
  const token = String(body?.token || body?.chat?.token || '').trim();
  stats.total += 1;

  let verdict: Verdict;
  if (!token) {
    verdict = 'sem_token';
  } else {
    const tokens = await activeInstanceTokens();
    verdict = tokens.has(token) ? 'token_ok' : 'token_desconhecido';
  }

  stats[verdict] += 1;
  if (verdict !== 'token_ok') {
    const key = `${verdict}:${eventLabel(body)}`;
    if (semTokenPorEvento.has(key)) semTokenPorEvento.set(key, semTokenPorEvento.get(key)! + 1);
    else if (semTokenPorEvento.size < EVENT_CAP) semTokenPorEvento.set(key, 1);
  }
  return verdict;
}

/** Versão fire-and-forget: erro aqui nunca pode derrubar a ingestão. */
export function observeUazapiOriginAsync(body: any): void {
  void observeUazapiOrigin(body).catch(() => {});
}

export function uazapiOriginStats() {
  return {
    ...stats,
    // Enquanto isto não estiver vazio, exigir o token derrubaria esses eventos.
    sem_token_por_evento: Object.fromEntries(
      [...semTokenPorEvento.entries()].sort((a, b) => b[1] - a[1]),
    ),
  };
}
