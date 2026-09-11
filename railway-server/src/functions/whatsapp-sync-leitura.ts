// O retroativo da leitura: conversa que o celular já deu por lida e o app ainda
// mostra com badge aceso.
//
// Por que existe: o evento `chats` do webhook (ver `lib/whatsapp-leitura.ts`)
// só resolve do dia em que entrar em diante. O passivo é de meses — há ~27 mil
// conversas com `unread_count > 0` acumulado no Externo, e a maior parte já foi
// respondida no aparelho. Sem esta função a lista do app nasce mentindo, e uma
// lista que mente em 27 mil linhas ninguém volta a olhar.
//
// A direção da varredura importa. O caminho óbvio — pedir todos os chats à
// UazAPI e comparar com o banco — faz a conta ao contrário. Aqui parte-se de
// QUEM NÓS achamos não lido (`conversations.unread_count > 0`, uma consulta
// indexada por instância) e só então pergunta-se ao WhatsApp o que ele acha
// daqueles chats. Instância sem pendência nenhuma não gera UMA chamada de rede.
//
// Três ações:
//   { acao: 'reconciliar' }  (padrão)  — o retroativo. `dry_run: true` por padrão.
//   { acao: 'webhook' }                — mostra se o evento `chats` está ligado
//                                        em cada instância; `aplicar: true` liga.
//
// O dry-run não é cerimônia: ele é o número que diz se `wa_unreadCount` da
// UazAPI é um campo vivo. Se a varredura devolver "0 chats lidos no celular"
// nas 26 instâncias enquanto temos 27 mil conversas pendentes, o campo não
// serve — e aí NÃO se liga o `WHATSAPP_READ_SYNC`, porque o tempo real estaria
// apagando badge com base num zero que quer dizer "não sei".
//
// Marcar como lido é irreversível na prática: depois de carimbado, não há como
// saber quais estavam pendentes de verdade. Daí `dry_run` começar ligado.
import type { RequestHandler } from 'express';
import { supabase as ext } from '../lib/supabase';
import {
  contarNaoLidas,
  ehGrupoChat,
  emLotes,
  marcarLidas,
  paginaDeChats,
  telefoneDoChat,
  variantesDeInstancia,
  type LoteDeLeitura,
  type Pendencia,
} from '../lib/whatsapp-leitura';

const PAGINA_UAZAPI_PADRAO = 200;
const MAX_PAGINAS_PADRAO = 100;
// Um UPDATE por conversa seria uma ida ao banco por chat (27 mil idas). Um
// UPDATE só seria uma transação que estoura o statement_timeout de 8s medido
// nesta tabela. O lote é o meio-termo, com teto pelos dois lados: número de
// chats (tamanho da URL do PostgREST) e número de linhas (tempo da transação).
const CHATS_POR_LOTE_PADRAO = 25;
const NAO_LIDAS_POR_LOTE_PADRAO = 2000;

/** O que NÓS achamos não lido nesta instância, por telefone. */
async function pendenciasDaInstancia(nome: string): Promise<Map<string, Pendencia>> {
  const mapa = new Map<string, Pendencia>();
  const passo = 1000;
  for (let inicio = 0; ; inicio += passo) {
    const { data, error } = await ext
      .from('conversations')
      .select('phone, unread_count')
      .in('instance_name', variantesDeInstancia(nome))
      .gt('unread_count', 0)
      // A ordem não é estética: `range` sem `order` deixa a janela da página a
      // cargo do plano do Postgres, e duas páginas seguidas podem repetir uma
      // linha e PULAR outra. Repetida o Map absorve; pulada é conversa que fica
      // com o badge aceso para sempre e ninguém descobre por quê.
      .order('phone', { ascending: true })
      .range(inicio, inicio + passo - 1);
    if (error) throw new Error(`conversations: ${error.message}`);
    const linhas = data || [];
    for (const linha of linhas) {
      const telefone = telefoneDoChat(String(linha.phone || ''));
      if (!telefone) continue;
      const anterior = mapa.get(telefone);
      const naoLidas = Number(linha.unread_count) || 0;
      // Mesmo grupo pode vir em duas grafias de instância; soma para o lote não
      // subestimar o tamanho da transação.
      mapa.set(telefone, {
        telefone,
        naoLidas: (anterior?.naoLidas || 0) + naoLidas,
        grupo: ehGrupoChat(telefone),
      });
    }
    if (linhas.length < passo) break;
  }
  return mapa;
}

async function aplicarLote(lote: LoteDeLeitura, dryRun: boolean): Promise<number> {
  return dryRun ? contarNaoLidas(ext, lote) : marcarLidas(ext, lote);
}

/**
 * Um lote que falha (statement timeout num grupo com anos de histórico) vira
 * chat a chat, em vez de derrubar a instância inteira. O que falhar sozinho é
 * relatado — ficar calado aqui esconderia justamente o caso grande.
 */
async function aplicarComRecuo(
  base: Omit<LoteDeLeitura, 'telefones'>,
  pendencias: Pendencia[],
  dryRun: boolean,
  erros: string[],
): Promise<number> {
  try {
    return await aplicarLote({ ...base, telefones: pendencias.map((p) => p.telefone) }, dryRun);
  } catch (e: any) {
    console.warn('[sync-leitura] lote falhou, recuando para chat a chat:', e?.message);
    let total = 0;
    for (const p of pendencias) {
      try {
        total += await aplicarLote({ ...base, telefones: [p.telefone] }, dryRun);
      } catch (e2: any) {
        erros.push(`${p.telefone}: ${e2?.message}`);
      }
    }
    return total;
  }
}

interface RelatorioDaInstancia {
  instancia: string;
  conversas_pendentes: number;
  chats_lidos_no_celular: number;
  mensagens: number;
  paginas_lidas: number;
  erro?: string;
  erros_por_chat?: string[];
}

async function reconciliar(req: any) {
  const dryRun = req.body?.dry_run !== false;
  const soInstancia: string | null = req.body?.instancia || req.body?.instance_name || null;
  const limiteChats = Number(req.body?.limite_chats) || 0;
  const chatsPorLote = Number(req.body?.chats_por_lote) || CHATS_POR_LOTE_PADRAO;
  const linhasPorLote = Number(req.body?.nao_lidas_por_lote) || NAO_LIDAS_POR_LOTE_PADRAO;
  const paginaUazapi = Number(req.body?.pagina_uazapi) || PAGINA_UAZAPI_PADRAO;
  const maxPaginas = Number(req.body?.max_paginas) || MAX_PAGINAS_PADRAO;

  // O corte sai ANTES da primeira ida à rede: mensagem que chegar durante a
  // varredura não foi lida por ninguém.
  const corteISO = new Date().toISOString();

  let consulta = ext
    .from('whatsapp_instances')
    .select('instance_name, instance_token, base_url')
    .eq('is_active', true)
    .not('instance_token', 'is', null)
    // A linha da API oficial da Meta mora na mesma tabela com um token de
    // mentira (`cloud_api_meta`) e não tem UazAPI atrás. Perguntar a ela é 404.
    .neq('instance_token', 'cloud_api_meta');
  if (soInstancia) consulta = consulta.ilike('instance_name', soInstancia);

  const { data: instancias, error } = await consulta;
  if (error) return { success: false, error: `whatsapp_instances: ${error.message}` };
  if (!instancias?.length) return { success: false, error: 'nenhuma instância UazAPI ativa encontrada' };

  const relatorios: RelatorioDaInstancia[] = [];
  // Grupo lido numa instância vale para todas as cópias espelhadas — e o UPDATE
  // de grupo não filtra instância. Sem este conjunto, o mesmo grupo entraria de
  // novo na varredura da instância seguinte e gastaria uma transação à toa.
  const gruposFeitos = new Set<string>();
  let chatsGastos = 0;

  for (const inst of instancias) {
    const nome = inst.instance_name as string;
    const relatorio: RelatorioDaInstancia = {
      instancia: nome, conversas_pendentes: 0, chats_lidos_no_celular: 0, mensagens: 0, paginas_lidas: 0,
    };
    relatorios.push(relatorio);

    try {
      const pendencias = await pendenciasDaInstancia(nome);
      relatorio.conversas_pendentes = pendencias.size;
      if (!pendencias.size) continue;

      const baseUrl = (inst.base_url || 'https://abraci.uazapi.com') as string;
      const token = inst.instance_token as string;

      const pessoais: Pendencia[] = [];
      const grupos: Pendencia[] = [];
      // Uma pendência nossa que já apareceu na varredura, lida ou não. Serve
      // para não contar o mesmo chat duas vezes quando a paginação da UazAPI se
      // desloca entre páginas, e para saber quando parar de pedir páginas.
      const casados = new Set<string>();

      for (let pagina = 0; pagina < maxPaginas; pagina++) {
        const { chats } = await paginaDeChats(baseUrl, token, pagina * paginaUazapi, paginaUazapi);
        relatorio.paginas_lidas++;
        for (const chat of chats) {
          const telefone = telefoneDoChat(chat.wa_chatid);
          const pendencia = pendencias.get(telefone);
          if (!pendencia || casados.has(telefone)) continue;
          casados.add(telefone);
          // -1 é "a UazAPI não mandou o campo". Tratar ausência como zero seria
          // apagar badge com base em silêncio.
          if (chat.wa_unreadCount !== 0) continue;
          if (ehGrupoChat(chat.wa_chatid, chat.wa_isGroup) || pendencia.grupo) {
            // Grupo que outra instância desta mesma rodada já limpou não volta:
            // o UPDATE de grupo não filtra instância, então seria transação à toa.
            if (gruposFeitos.has(telefone)) continue;
            grupos.push({ ...pendencia, grupo: true });
          } else {
            pessoais.push(pendencia);
          }
        }
        // Todas as nossas pendências já apareceram, ou a página veio curta:
        // continuar é pedir páginas de chat que não nos interessam.
        if (chats.length < paginaUazapi || casados.size >= pendencias.size) break;
      }

      let alvos = [...pessoais, ...grupos];
      if (limiteChats > 0) {
        const resta = Math.max(0, limiteChats - chatsGastos);
        alvos = alvos.slice(0, resta);
      }
      // Só depois do corte pelo limite: grupo marcado como feito mas deixado de
      // fora pelo teto sumiria da varredura das instâncias seguintes.
      for (const alvo of alvos) if (alvo.grupo) gruposFeitos.add(alvo.telefone);
      relatorio.chats_lidos_no_celular = alvos.length;
      chatsGastos += alvos.length;

      const errosPorChat: string[] = [];
      // O peso de um grupo aqui é o desta instância, mas o UPDATE dele cruza
      // todas (grupo não filtra instância): o teto de linhas subestima, e quem
      // segura o caso grande é o recuo chat-a-chat do `aplicarComRecuo`.
      for (const grupo of [false, true]) {
        const doTipo = alvos.filter((a) => a.grupo === grupo);
        for (const lote of emLotes(doTipo, chatsPorLote, linhasPorLote)) {
          relatorio.mensagens += await aplicarComRecuo(
            { instancia: nome, grupo, corteISO }, lote, dryRun, errosPorChat,
          );
        }
      }
      if (errosPorChat.length) relatorio.erros_por_chat = errosPorChat.slice(0, 20);

      if (limiteChats > 0 && chatsGastos >= limiteChats) break;
    } catch (e: any) {
      relatorio.erro = e?.message || 'falhou';
      console.error(`[sync-leitura] ${nome}:`, e?.message);
    }
  }

  const chats = relatorios.reduce((s, r) => s + r.chats_lidos_no_celular, 0);
  const mensagens = relatorios.reduce((s, r) => s + r.mensagens, 0);
  const pendentes = relatorios.reduce((s, r) => s + r.conversas_pendentes, 0);

  return {
    success: true,
    dry_run: dryRun,
    corte: corteISO,
    resumo: {
      instancias: relatorios.length,
      conversas_pendentes: pendentes,
      chats_lidos_no_celular: chats,
      mensagens: dryRun ? `${mensagens} seriam marcadas` : `${mensagens} marcadas`,
    },
    // Um dry-run que volta com zero chats em TODAS as instâncias não quer dizer
    // "está tudo em dia": quer dizer que `wa_unreadCount` não é confiável nesta
    // versão da UazAPI, e que o tempo real não deve ser ligado.
    veredito: chats === 0 && pendentes > 0
      ? 'NENHUM chat lido no celular apesar de haver pendência nossa — suspeitar do wa_unreadCount antes de ligar o WHATSAPP_READ_SYNC'
      : 'ok',
    instancias: relatorios,
    ...(dryRun ? { para_valer: 'repita com { "dry_run": false }' } : {}),
  };
}

/** Mostra (e opcionalmente liga) o evento `chats` no webhook de cada instância. */
async function webhookDasInstancias(req: any) {
  const aplicar = req.body?.aplicar === true;
  const soInstancia: string | null = req.body?.instancia || req.body?.instance_name || null;

  let consulta = ext
    .from('whatsapp_instances')
    .select('instance_name, instance_token, base_url')
    .eq('is_active', true)
    .not('instance_token', 'is', null)
    .neq('instance_token', 'cloud_api_meta');
  if (soInstancia) consulta = consulta.ilike('instance_name', soInstancia);

  const { data: instancias, error } = await consulta;
  if (error) return { success: false, error: `whatsapp_instances: ${error.message}` };

  const saida: any[] = [];
  for (const inst of instancias || []) {
    const nome = inst.instance_name as string;
    const baseUrl = ((inst.base_url || 'https://abraci.uazapi.com') as string).replace(/\/$/, '');
    const token = inst.instance_token as string;
    try {
      const r = await fetch(`${baseUrl}/webhook`, { headers: { token } });
      const texto = await r.text();
      if (!r.ok) { saida.push({ instancia: nome, erro: `UazAPI ${r.status}: ${texto.slice(0, 120)}` }); continue; }
      const dados = JSON.parse(texto);
      const lista: any[] = Array.isArray(dados) ? dados : [dados];

      for (const hook of lista) {
        const url = String(hook?.url || '');
        const nosso = url.includes('/webhooks/uazapi') || url.includes('whatsapp-webhook');
        const eventos: string[] = Array.isArray(hook?.events) ? hook.events.map(String) : [];
        const temChats = eventos.includes('chats');
        // `excludeMessages` entra no relatório porque é o filtro que decide se a
        // mensagem digitada NO CELULAR chega até nós: uma instância com
        // `fromMeYes` aqui não espelha o que o assessor responde pelo aparelho,
        // e nenhuma sincronia de leitura conserta o que nunca chegou.
        const registro: any = {
          instancia: nome, url, nosso, enabled: hook?.enabled !== false, eventos, tem_chats: temChats,
          exclui: Array.isArray(hook?.excludeMessages) ? hook.excludeMessages : [],
        };

        // Lista VAZIA não se toca. Em várias versões da UazAPI ela significa
        // "manda tudo"; escrever uma lista ali passaria a RESTRINGIR os eventos
        // e poderia cortar a entrada de mensagens da firma por um recurso de
        // badge. Quem quiser mexer, mexe olhando o painel.
        if (aplicar && nosso && !temChats && eventos.length > 0 && hook?.id) {
          const corpo = {
            action: 'update',
            id: hook.id,
            enabled: hook?.enabled !== false,
            url,
            events: [...eventos, 'chats'],
            excludeMessages: Array.isArray(hook?.excludeMessages) ? hook.excludeMessages : [],
            addUrlEvents: hook?.addUrlEvents === true,
            addUrlTypesMessages: hook?.addUrlTypesMessages === true,
          };
          const w = await fetch(`${baseUrl}/webhook`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', token },
            body: JSON.stringify(corpo),
          });
          registro.aplicado = w.ok;
          if (!w.ok) registro.erro_ao_aplicar = (await w.text()).slice(0, 200);
        } else if (aplicar && nosso && !temChats && eventos.length === 0) {
          registro.aviso = 'lista de eventos vazia — não foi tocada (vazio costuma valer por "todos")';
        } else if (aplicar && nosso && !temChats && !hook?.id) {
          // Webhook em "modo simples" não tem id, e `action: 'update'` exige um.
          // Dizer isso é melhor que devolver sucesso sem ter mexido em nada.
          registro.aviso = 'webhook sem id (modo simples) — ligue o evento `chats` pelo painel da UazAPI';
        }
        saida.push(registro);
      }
    } catch (e: any) {
      saida.push({ instancia: nome, erro: e?.message || 'falhou' });
    }
  }

  return { success: true, aplicar, webhooks: saida, ...(aplicar ? {} : { para_ligar: 'repita com { "acao": "webhook", "aplicar": true }' }) };
}

export const handler: RequestHandler = async (req, res) => {
  try {
    const acao = String(req.body?.acao || 'reconciliar');
    if (acao === 'webhook') return res.json(await webhookDasInstancias(req));
    if (acao === 'reconciliar') return res.json(await reconciliar(req));
    return res.json({ success: false, error: `ação desconhecida: ${acao} (use 'reconciliar' ou 'webhook')` });
  } catch (err: any) {
    console.error('[whatsapp-sync-leitura] error:', err);
    return res.json({ success: false, error: err?.message || 'unknown error' });
  }
};
