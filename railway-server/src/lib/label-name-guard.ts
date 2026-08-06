// Guarda contra ID de etiqueta reciclado.
//
// PROBLEMA: o vínculo etiqueta→agente/etapa/resultado casa por label_id
// numérico ("558681595991:29"). Quando alguém apaga uma etiqueta no celular,
// o WhatsApp libera aquele número e a PRÓXIMA etiqueta criada o herda —
// junto com o vínculo antigo. Incidente 05/08/2026: a etiqueta "Parceiros SP"
// herdou o ID 29 da "🤖 Raym_assistente" apagada e passou a ativar a IA
// sozinha em quem recebesse a etiqueta nova.
//
// SOLUÇÃO: antes de agir sobre um mapeamento, conferir na UazAPI se o nome
// atual daquele ID ainda é o nome gravado no banco. Divergiu → o número foi
// reaproveitado, o mapeamento está podre, não age.
//
// POLÍTICA DE FALHA: fail-open. Em 06/08/2026, 18 das 26 instâncias estavam
// desconectadas do WhatsApp (GET /labels devolve "no session"). Fechar o
// portão quando não dá pra verificar mataria o fluxo de etiquetas inteiro em
// qualquer oscilação. Mesma escolha já feita em verify-agent-label.ts.

import { supabase } from './supabase';
import { uazapiListLabels } from './uazapi-labels';

const TTL_OK_MS = 60_000;   // lista boa: revalida a cada 1 min
const TTL_FAIL_MS = 30_000; // instância fora do ar: não martela a UazAPI

interface CacheEntry {
  expires: number;
  names: Map<string, string> | null;
}

const cache = new Map<string, CacheEntry>();

/** "558681595991:29" → "29". IDs já vêm nus em alguns payloads. */
export function labelIdSuffix(labelId: unknown): string {
  const s = String(labelId ?? '');
  return s.split(':').pop() || s;
}

/**
 * Normaliza pra comparar. As 20 divergências reais medidas em produção
 * (06/08/2026) eram todas grosseiras — nome completamente diferente, não
 * variação de espaço. Então normalização leve basta: o objetivo é só não
 * bloquear por causa de marca invisível que o WhatsApp injeta em etiqueta
 * pré-definida ("‎Importante", "‎Acompanhar").
 */
export function normalizeLabelName(name: unknown): string {
  return String(name ?? '')
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060\uFEFF\u00A0\uFE0E\uFE0F]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * Nomes atuais das etiquetas da instância, indexados pelo sufixo do ID.
 * `null` = não deu pra saber (sem token, desconectada, timeout).
 */
export async function loadCurrentLabelNames(instanceName: string): Promise<Map<string, string> | null> {
  const key = String(instanceName || '').toLowerCase();
  if (!key) return null;

  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.names;

  let names: Map<string, string> | null = null;
  try {
    const { data: inst } = await supabase
      .from('whatsapp_instances')
      .select('instance_token, base_url')
      .ilike('instance_name', instanceName)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    const token = (inst as any)?.instance_token;
    if (token) {
      const baseUrl = (inst as any)?.base_url || 'https://abraci.uazapi.com';
      const labels = await uazapiListLabels(baseUrl, token);
      if (labels) {
        names = new Map(labels.map((l) => [labelIdSuffix(l.id), l.name]));
      }
    }
  } catch (e: any) {
    console.warn('[label-guard] lookup falhou (fail-open):', e?.message);
    names = null;
  }

  cache.set(key, { expires: Date.now() + (names ? TTL_OK_MS : TTL_FAIL_MS), names });
  return names;
}

export type LabelNameVerdict =
  | 'match'    // nome bate — mapeamento confiável
  | 'stale'    // ID reaproveitado por outra etiqueta — NÃO agir
  | 'unknown'; // não deu pra verificar — fail-open, agir como antes

/**
 * O ID `labelId` desta instância ainda se chama `expectedName`?
 * `currentNames` vem de loadCurrentLabelNames (pode ser null).
 */
export function checkLabelName(
  currentNames: Map<string, string> | null,
  labelId: unknown,
  expectedName: unknown,
): LabelNameVerdict {
  if (!currentNames) return 'unknown';
  // Mapeamento sem nome gravado (linha antiga): nada pra comparar.
  const expected = normalizeLabelName(expectedName);
  if (!expected) return 'unknown';

  const actual = currentNames.get(labelIdSuffix(labelId));
  // ID não está na lista da UazAPI: cache dessincronizado, não é prova de
  // reaproveitamento. Fail-open.
  if (actual === undefined) return 'unknown';

  return normalizeLabelName(actual) === expected ? 'match' : 'stale';
}

/**
 * Filtra mapeamentos já casados por ID, descartando os que apontam para uma
 * etiqueta que mudou de nome. `enforce: false` só registra no log e deixa
 * passar — usado onde o efeito colateral é interno e reversível (mover card,
 * mudar status do lead), pra medir antes de bloquear.
 */
export function filterByLabelName<T extends { label_id?: unknown; label_name?: unknown }>(
  mappings: T[],
  currentNames: Map<string, string> | null,
  opts: { enforce: boolean; scope: string; instanceName: string },
): T[] {
  if (!mappings.length) return mappings;
  const kept: T[] = [];
  for (const m of mappings) {
    const verdict = checkLabelName(currentNames, m.label_id, m.label_name);
    if (verdict === 'stale') {
      const atual = currentNames?.get(labelIdSuffix(m.label_id));
      console.warn(
        `[label-guard][${opts.scope}] ID reaproveitado — ${opts.enforce ? 'IGNORADO' : 'passaria (modo log)'}`,
        {
          instance: opts.instanceName,
          label_id: m.label_id,
          nome_no_banco: m.label_name,
          nome_na_uazapi: atual,
        },
      );
      if (opts.enforce) continue;
    }
    kept.push(m);
  }
  return kept;
}
