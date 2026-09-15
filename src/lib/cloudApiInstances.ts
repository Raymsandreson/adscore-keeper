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

// Último recurso: só vale na primeiríssima visita de um navegador, antes de
// qualquer ida ao banco. `cloud_gerencia` é o nome histórico e fica enquanto
// existir mensagem antiga com ele. NÃO precisa ser editada ao criar linha nova
// — o cache abaixo assume esse papel a partir do segundo carregamento.
const SEMENTE = ['cloud_gerencia', 'abraci'];
const CHAVE_CACHE = 'wa:linhas-cloud';

const NOMES_CLOUD = new Set<string>(SEMENTE);

// Cache do último carregamento bem-sucedido. Existe para que uma linha criada
// pelo painel seja reconhecida já no primeiro render da próxima visita, sem
// passar por deploy de código. É reescrito inteiro a cada carga, então linha
// removida some sozinha no carregamento seguinte.
try {
  const bruto = localStorage.getItem(CHAVE_CACHE);
  if (bruto) for (const n of JSON.parse(bruto) as string[]) if (n) NOMES_CLOUD.add(n);
} catch {
  // localStorage indisponível (aba privada, storage bloqueado): semente basta.
}

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
      const doBanco: string[] = [];
      for (const linha of data || []) {
        const n = normalizar((linha as { instance_name?: string }).instance_name);
        if (n) { NOMES_CLOUD.add(n); doBanco.push(n); }
      }
      if (doBanco.length) {
        try {
          localStorage.setItem(CHAVE_CACHE, JSON.stringify([...new Set([...SEMENTE, ...doBanco])]));
        } catch {
          // Sem cache a próxima visita só perde o primeiro render — não é erro.
        }
      }
    } catch {
      // Semente cobre o caso conhecido; linha nova aparece no próximo carregamento.
    }
  })();
  return carregando;
}

/**
 * Qual linha Cloud a caixa travada no canal (menu WhatsApp API) abre por padrão.
 *
 * `nomeAlvo` é o marcador de canal passado em `lockInstanceName` — hoje `abraci`,
 * a linha com 87% do movimento. Abrir em "Todas as linhas" jogava Abraci,
 * Prudencio Advogados e Quitepay na mesma lista.
 *
 * Devolve `'all'` quando a linha do nome não está entre as disponíveis (foi
 * renomeada, desativada ou o usuário não tem acesso): é o fallback que mostra o
 * que existe em vez de uma caixa vazia sem explicação.
 */
export function linhaCloudPadrao<T extends { id: string; instance_name?: string | null }>(
  instancias: T[],
  nomeAlvo?: string | null,
): string {
  const cloud = instancias.filter((i) => ehInstanciaCloud(i.instance_name));
  const alvo = normalizar(nomeAlvo);
  const preferida = alvo ? cloud.find((i) => normalizar(i.instance_name) === alvo) : undefined;
  if (preferida) return preferida.id;
  return cloud.length === 1 ? cloud[0].id : 'all';
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

// ---------------------------------------------------------------------------
// Acesso padrão ao canal Cloud
// ---------------------------------------------------------------------------
// Decisão do usuário (15/09/2026): entre as linhas da WhatsApp API, a Abraci é
// a única que vale como padrão. Prudencio Advogados e Quitepay só com
// marcação explícita na matriz (Equipe › WhatsApp).
//
// O nome mora aqui, e não espalhado pelas telas de acesso, pelo mesmo motivo do
// resto do arquivo: trocar a linha padrão é editar uma constante, não caçar
// string em quatro componentes.
/** Linha Cloud liberada por padrão a quem entra no sistema. */
export const LINHA_CLOUD_PADRAO = 'abraci';

/** É a linha Cloud padrão? (tolera caixa e espaço, como o resto do módulo) */
export function ehLinhaCloudPadrao(nome?: string | null): boolean {
  return normalizar(nome) === LINHA_CLOUD_PADRAO;
}

/** Uma linha de `whatsapp_instances` como as telas leem: id + nome (+ token, quando vem). */
export type InstanciaRegistro = {
  id: string;
  instance_name?: string | null;
  instance_token?: string | null;
};

/**
 * É linha da WhatsApp API? O token é o dado — o nome só entra quando a consulta
 * não trouxe o token (várias telas selecionam `id, instance_name` apenas), e aí
 * vale o reconhecimento por nome, que depende da semente/cache deste módulo.
 */
export function ehRegistroCloud(instancia?: InstanciaRegistro | null): boolean {
  if (!instancia) return false;
  return instancia.instance_token === TOKEN_CLOUD_API || ehInstanciaCloud(instancia.instance_name);
}

/** Id da linha padrão dentro de uma lista de instâncias — `null` se não estiver lá. */
export function idDaLinhaCloudPadrao<T extends InstanciaRegistro>(
  instancias: T[],
): string | null {
  return instancias.find((i) => ehLinhaCloudPadrao(i.instance_name))?.id || null;
}

/**
 * Regra do padrão, em um lugar só: uma escolha que não inclui NENHUMA linha
 * Cloud recebe a Abraci. Escolha que já tem linha Cloud (qualquer uma) passa
 * intacta — quem marcou sabia o que estava fazendo.
 *
 * Existe porque o acesso do usuário novo nasce em dois lugares (perfil aplicado
 * na criação e perfil trocado na ficha do membro); sem isto, o padrão valeria
 * só no caminho que alguém lembrou de ajustar.
 */
export function comAcessoCloudPadrao<T extends InstanciaRegistro>(
  idsEscolhidos: string[],
  instancias: T[],
): string[] {
  const ids = Array.from(new Set((idsEscolhidos || []).filter(Boolean)));
  const jaTemCloud = ids.some((id) => ehRegistroCloud(instancias.find((i) => i.id === id)));
  if (jaTemCloud) return ids;
  const padrao = idDaLinhaCloudPadrao(instancias);
  return padrao ? [...ids, padrao] : ids;
}

/** Um vínculo pessoa↔instância, como vive em `whatsapp_instance_users`. */
export type VinculoDeAcesso = { user_id: string; instance_id: string };
/** Um membro da equipe, do ponto de vista do acesso. */
export type MembroDeAcesso = { user_id: string; role?: string | null };

/** Quem ainda não tem a linha padrão — é o que muda quando o padrão é aplicado. */
export function membrosSemLinhaPadrao<T extends MembroDeAcesso>(
  membros: T[],
  linhasApi: InstanciaRegistro[],
  vinculos: VinculoDeAcesso[],
): T[] {
  const idPadrao = idDaLinhaCloudPadrao(linhasApi);
  if (!idPadrao) return [];
  return membros
    .filter((m) => m.role !== 'admin')
    .filter((m) => !vinculos.some((v) => v.user_id === m.user_id && v.instance_id === idPadrao));
}

/**
 * As operações que põem a equipe no padrão do canal: cada membro ganha a linha
 * padrão e perde as OUTRAS linhas da API. Instância UazAPI nunca entra — o
 * padrão é do canal Cloud, e mexer no resto seria tirar a inbox de trabalho de
 * alguém sem ninguém ter pedido.
 *
 * Admin fica de fora: enxerga todas as linhas pelo papel, então conceder ou
 * revogar não mudaria nada e ainda mentiria na matriz.
 *
 * A concessão vai para TODO membro, inclusive quem já tem o vínculo: o edge faz
 * upsert nos dois bancos (Externo + espelho do Cloud), então reaplicar é como o
 * espelho se acerta depois de uma escrita feita fora do app.
 */
export function operacoesDoPadraoApi(
  membros: MembroDeAcesso[],
  linhasApi: InstanciaRegistro[],
  vinculos: VinculoDeAcesso[],
): Array<{ user_id: string; instance_id: string; grant: boolean }> {
  const idPadrao = idDaLinhaCloudPadrao(linhasApi);
  if (!idPadrao) return [];
  const ops: Array<{ user_id: string; instance_id: string; grant: boolean }> = [];
  membros
    .filter((m) => m.role !== 'admin')
    .forEach((m) => {
      ops.push({ user_id: m.user_id, instance_id: idPadrao, grant: true });
      linhasApi.forEach((linha) => {
        if (linha.id === idPadrao) return;
        if (vinculos.some((v) => v.user_id === m.user_id && v.instance_id === linha.id)) {
          ops.push({ user_id: m.user_id, instance_id: linha.id, grant: false });
        }
      });
    });
  return ops;
}
