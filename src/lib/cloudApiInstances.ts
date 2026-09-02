/**
 * Quais linhas são da WhatsApp Business Cloud API (Meta oficial).
 *
 * Era uma comparação com a string `'cloud_gerencia'` espalhada por ~20 lugares.
 * Isso só funcionava enquanto existia UMA linha Cloud: a segunda linha (e a
 * renomeação da primeira para `abraci`) transformaria cada comparação num bug
 * silencioso — a conversa deixaria de ser reconhecida como Cloud e o envio
 * tentaria sair pela UazAPI.
 *
 * A fonte da verdade é o dado: `whatsapp_instances.instance_token =
 * 'cloud_api_meta'` já marca essas linhas hoje. A semente abaixo garante
 * resposta correta desde o primeiro render, antes de qualquer ida ao banco —
 * carregar do banco só ACRESCENTA, nunca remove.
 */

import { externalSupabase } from '@/integrations/supabase/external-client';

/** Marcador da linha Cloud em `whatsapp_instances.instance_token`. */
export const TOKEN_CLOUD_API = 'cloud_api_meta';

// Nomes conhecidos no momento do deploy. `cloud_gerencia` é o nome histórico e
// fica aqui enquanto existir mensagem antiga com ele.
const NOMES_CLOUD = new Set<string>(['cloud_gerencia', 'abraci', 'prudencio_advogados', 'quitepay']);

const normalizar = (nome?: string | null) => (nome || '').trim().toLowerCase();

export function ehInstanciaCloud(nome?: string | null): boolean {
  const n = normalizar(nome);
  return n ? NOMES_CLOUD.has(n) : false;
}

/** Nomes conhecidos agora — para filtro `in` em query, por exemplo. */
export function nomesInstanciasCloud(): string[] {
  return [...NOMES_CLOUD];
}

let carregando: Promise<void> | null = null;

/**
 * Acrescenta ao conjunto as linhas Cloud cadastradas no banco. Idempotente e
 * seguro para chamar em todo mount: a promessa em curso é reaproveitada.
 * Falha de rede não derruba nada — a semente continua valendo.
 */
export function carregarInstanciasCloud(): Promise<void> {
  if (carregando) return carregando;
  carregando = (async () => {
    try {
      const { data } = await externalSupabase
        .from('whatsapp_instances')
        .select('instance_name')
        .eq('instance_token', TOKEN_CLOUD_API);
      for (const linha of data || []) {
        const n = normalizar((linha as { instance_name?: string }).instance_name);
        if (n) NOMES_CLOUD.add(n);
      }
    } catch {
      // Semente cobre o caso conhecido; linha nova aparece no próximo carregamento.
    }
  })();
  return carregando;
}

/**
 * Nome da linha como a equipe lê: `prudencio_advogados` → "Prudencio Advogados".
 * `whatsapp_instances` não tem coluna de rótulo, então o nome interno é tudo que
 * temos — mas ele não precisa aparecer cru na tela.
 */
export function rotuloDaLinha(nome?: string | null): string {
  const n = (nome || '').trim();
  if (!n) return '';
  return n
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join(' ');
}
