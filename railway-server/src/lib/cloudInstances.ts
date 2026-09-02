/**
 * Nomes das linhas da WhatsApp Business Cloud API.
 *
 * Espelha `src/lib/cloudApiInstances.ts` do front. Era uma comparação com
 * `'cloud_gerencia'`; com mais de um número, cada comparação dessas vira um bug
 * silencioso — a mensagem deixa de ser reconhecida como Cloud.
 *
 * `cloud_gerencia` fica na lista enquanto existir mensagem antiga com esse nome.
 */

const NOMES_CLOUD = new Set<string>(['cloud_gerencia', 'abraci', 'prudencio_advogados']);

export function ehInstanciaCloud(nome?: string | null): boolean {
  const n = (nome || '').trim().toLowerCase();
  return n ? NOMES_CLOUD.has(n) : false;
}
