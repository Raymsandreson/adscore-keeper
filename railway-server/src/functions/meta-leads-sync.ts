// Lead do formulário da Meta direto para o funil — sem a planilha no meio.
//
// POR QUE EXISTE (medido em 09/09/2026). A planilha do Google era o único
// caminho entre o anúncio e o CRM, e ela é ponto único de falha silenciosa:
//
//   Meta, últimos 30 dias .... 3.269 leads (R$ 27.641 gastos)
//   Planilha ................... 574 linhas
//   CRM ........................ 509 leads pagos
//
// A campanha do BPC não tinha parado, como parecia: os 5 formulários estão
// ACTIVE e somam 2.641 leads, com lead entrando no mesmo dia da medição. Quem
// parou foi a integração Meta → Planilha, em agosto, e ninguém soube — a
// planilha simplesmente deixou de crescer.
//
// Ler da fonte remove esse intermediário. De quebra a API traz o que a planilha
// não trazia: as respostas de qualificação do formulário (renda, CadÚnico,
// laudo médico), que ficam em `details.meta_form`.
//
// DEDUP: por telefone dentro do board, com a MESMA `phoneKey` da planilha
// (`lib/leadAdsSheet`). Se cada caminho normalizasse do seu jeito, um não
// enxergaria o outro e a mesma pessoa entraria duas vezes.
import type { RequestHandler } from 'express';
import { supabase } from '../lib/supabase';
import { GRAPH_VERSION } from '../lib/metaCapi';
import { tokensDePagina } from './meta-capi-dispatch';
import {
  normalizePhone,
  phoneKey,
  isJunkName,
  casaOperador,
  normalizaLeadIdMeta,
} from '../lib/leadAdsSheet';

/**
 * Formulário → board, por palavra-chave no nome do formulário.
 *
 * UUID explícito, e não busca por nome, porque nome de board é ambíguo aqui:
 * existem DOIS "Auxílio Acidente" e quatro boards com "BPC" no nome. Errar o
 * board joga lead pago num funil que ninguém atende.
 *
 * Formulário que não casa com nenhuma rota NÃO é adivinhado: volta em
 * `formularios_ignorados` para virar decisão. É o caso de
 * "[REPRESENTANTE COMERCIAL-SP]" e "[CAPTAÇÃO][CORRETOR]", que são recrutamento,
 * não cliente.
 */
const ROTAS: { palavras: string[]; board_id: string; rotulo: string }[] = [
  { palavras: ['bpc'], board_id: 'c8e8c466-c441-43a9-88d2-8197324c47a4', rotulo: 'BPC - Autismo' },
  {
    palavras: ['auxílio - acidente', 'auxilio - acidente', 'auxílio-acidente', 'auxilio-acidente'],
    board_id: '7db8f799-3b18-4a89-a4c3-03ed244d0e39',
    rotulo: 'Auxílio Acidente',
  },
];

const PAGINA_DEDUP = 1000;
const TETO_PAGINAS_LEADS = 40; // 40 x 100 = 4.000 leads por formulário, por rodada

function rotaDoFormulario(nome: string) {
  const lower = String(nome || '').toLowerCase();
  return ROTAS.find((r) => r.palavras.some((p) => lower.includes(p))) || null;
}

/**
 * Campo do formulário por nome exato, senão por pedaço — com exclusões.
 *
 * A Meta nomeia os campos com UNDERSCORE (`nome_completo`, `phone_number`), e o
 * mesmo formulário existe em duas línguas: os formulários do Israel usam
 * `nome_completo`/`telefone`/`cidade`, os do Mateus usam
 * `full_name`/`phone_number`/`city`. Procurar por "nome completo" com espaço
 * não casava nenhum dos dois — foi o que descartou 817 leads no primeiro teste.
 *
 * `proibidos` existe porque casar frouxo é pior que não casar: o formulário do
 * BPC tem `qual_o_nome_da_criança_?`, e um match por "nome" traria a criança no
 * lugar do responsável — dado errado, no campo certo, sem nenhum erro.
 */
function pegaCampo(
  campos: Record<string, string>,
  exatos: string[],
  pedacos: string[],
  proibidos: string[] = [],
): string {
  for (const e of exatos) if (campos[e]) return campos[e];
  for (const [k, v] of Object.entries(campos)) {
    if (!v) continue;
    const lk = k.toLowerCase();
    if (proibidos.some((p) => lk.includes(p))) continue;
    if (pedacos.some((p) => lk.includes(p))) return v;
  }
  return '';
}

const NAO_E_O_TITULAR = ['criança', 'crianca', 'filho', 'filha', 'dependente', 'menor'];

/** Campos ja mapeados para coluna propria — nao repetir no texto da ficha. */
const JA_TEM_COLUNA = new Set([
  'full_name', 'nome_completo', 'nome',
  'phone_number', 'telefone', 'celular',
  'email', 'e-mail',
  'city', 'cidade',
]);

/**
 * Respostas do formulario em texto legivel na ficha.
 *
 * E o que a planilha jogava fora: renda, CadUnico, laudo medico, se ja tem
 * advogado. Chega antes do primeiro contato e muda a conversa.
 */
function formataRespostas(respostas: Record<string, string>): string {
  const linhas = Object.entries(respostas)
    .filter(([k, v]) => v && !JA_TEM_COLUNA.has(k.toLowerCase()))
    .map(([k, v]) => {
      const pergunta = k.replace(/_/g, ' ').replace(/\s*\?\s*$/, '').trim();
      return `• ${pergunta}: ${v}`;
    });
  return linhas.length ? `\nRespostas do formulário:\n${linhas.join('\n')}` : '';
}

interface LeadDaMeta {
  meta_lead_id: string;
  criado_em: string;
  nome: string;
  telefone: string;
  email: string;
  cidade: string;
  campaign_id?: string;
  campaign_name?: string;
  adset_id?: string;
  adset_name?: string;
  ad_id?: string;
  ad_name?: string;
  formulario: string;
  operador: string | null;
  telefone_divergente: boolean;
  respostas: Record<string, string>;
}

/**
 * O que ja existe no board, pelas DUAS identidades.
 *
 * So o telefone nao basta, e a limpeza de 11/09/2026 mostrou por que: 289 leads
 * existiam em duplicata, cada par com o mesmo `facebook_lead_id` e telefones
 * diferentes — o formulario traz um numero pre-preenchido pelo perfil e outro
 * digitado na resposta, e eles discordam em ~9% dos casos. Ao consolidar, o
 * sobrevivente ficou com UM dos dois numeros; o outro saiu de `lead_phone`.
 *
 * Sem o id aqui, esta rotina veria o telefone que sobrou, nao reconheceria o
 * lead e recriaria os 255 duplicados na rodada seguinte.
 *
 * Hoje isso nao acontece por um acaso: a varredura nao filtra `deleted_at`,
 * entao o telefone da linha removida ainda conta como conhecido. E seguranca
 * acidental — no dia em que alguem acrescentar o filtro, o que parece uma
 * correcao obvia, as duplicatas voltam em 30 minutos.
 */
async function existentesDoBoard(boardId: string): Promise<{ fones: Set<string>; ids: Set<string> }> {
  const chaves = new Set<string>();
  const ids = new Set<string>();
  for (let inicio = 0; ; inicio += PAGINA_DEDUP) {
    const { data, error } = await supabase
      .from('leads')
      .select('lead_phone, facebook_lead_id')
      .eq('board_id', boardId)
      .order('id', { ascending: true })
      .range(inicio, inicio + PAGINA_DEDUP - 1);
    if (error) throw new Error(`dedup do board ${boardId}: ${error.message}`);
    const linhas = data || [];
    for (const l of linhas) {
      const k = phoneKey(String((l as any).lead_phone || '').replace(/\D/g, ''));
      if (k) chaves.add(k);
      const idMeta = String((l as any).facebook_lead_id || '').trim();
      if (idMeta) ids.add(idMeta);
    }
    if (linhas.length < PAGINA_DEDUP) break;
    if (inicio >= 200_000) break;
  }
  return { fones: chaves, ids };
}

async function leadsDoFormulario(
  formId: string,
  formNome: string,
  tokenPagina: string,
  desdeUnix: number,
): Promise<{ leads: LeadDaMeta[]; paginas: number; erro?: string }> {
  const campos =
    'id,created_time,field_data,campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name';
  const filtro = encodeURIComponent(
    JSON.stringify([{ field: 'time_created', operator: 'GREATER_THAN', value: desdeUnix }]),
  );
  let url =
    `https://graph.facebook.com/${GRAPH_VERSION}/${formId}/leads` +
    `?fields=${campos}&filtering=${filtro}&limit=100&access_token=${encodeURIComponent(tokenPagina)}`;

  const out: LeadDaMeta[] = [];
  let paginas = 0;
  const operador = casaOperador(formNome);

  while (url && paginas < TETO_PAGINAS_LEADS) {
    const r = await fetch(url);
    const j: any = await r.json();
    if (j?.error) return { leads: out, paginas, erro: j.error.message };
    for (const l of j?.data ?? []) {
      const campos: Record<string, string> = {};
      for (const f of l.field_data ?? []) {
        campos[String(f.name)] = String((f.values ?? [])[0] ?? '');
      }
      // Prefilled da Meta primeiro (ela valida o formato), pergunta aberta depois.
      const telPrefill = normalizePhone(pegaCampo(campos, ['phone_number', 'telefone', 'celular'], []));
      const telPergunta = normalizePhone(
        pegaCampo(campos, [], ['contato', 'whats', 'telefone', 'phone', 'celular'], NAO_E_O_TITULAR),
      );
      const telefone = telPrefill || telPergunta;
      // Os dois campos existem no mesmo formulário. Quando divergem, a planilha
      // pode ter gravado um e a API o outro — e aí a mesma pessoa entra duas
      // vezes, porque a chave de dedup são os 8 últimos dígitos.
      const telefoneDivergente = Boolean(
        telPrefill && telPergunta && phoneKey(telPrefill) !== phoneKey(telPergunta),
      );
      const nome =
        pegaCampo(
          campos,
          ['full_name', 'nome_completo', 'nome'],
          ['nome_completo', 'seu_nome', 'nome_do_respons'],
          NAO_E_O_TITULAR,
        ) || '';
      out.push({
        meta_lead_id: normalizaLeadIdMeta(l.id),
        criado_em: l.created_time,
        nome,
        telefone,
        email: pegaCampo(campos, ['email'], ['e-mail', 'email']),
        cidade: pegaCampo(campos, ['city', 'cidade'], ['cidade', 'municipio', 'município']),
        telefone_divergente: telefoneDivergente,
        campaign_id: l.campaign_id,
        campaign_name: l.campaign_name,
        adset_id: l.adset_id,
        adset_name: l.adset_name,
        ad_id: l.ad_id,
        ad_name: l.ad_name,
        formulario: formNome,
        operador,
        respostas: campos,
      });
    }
    paginas += 1;
    url = j?.paging?.next || '';
  }
  return { leads: out, paginas };
}

export const handler: RequestHandler = async (req, res) => {
  try {
    const body = (req.body || {}) as { since_days?: number; dry_run?: boolean; board_id?: string };
    const sinceDays = Math.min(Math.max(Number(body.since_days) || 7, 1), 90);
    const dryRun = body.dry_run !== false; // seco por padrão: criar lead é ação real
    const desdeUnix = Math.floor((Date.now() - sinceDays * 86_400_000) / 1000);

    const tokens = await tokensDePagina();
    if (tokens.size === 0) {
      return res.status(200).json({ error: 'o token nao alcanca pagina nenhuma (me/accounts vazio)' });
    }

    // 1) Formulários de cada página alcançada
    const formularios: Array<{ page_id: string; id: string; nome: string; leads_count: number }> = [];
    const errosDePagina: Array<Record<string, unknown>> = [];
    for (const [pageId, tokenPagina] of tokens) {
      const r = await fetch(
        `https://graph.facebook.com/${GRAPH_VERSION}/${pageId}/leadgen_forms` +
          `?fields=id,name,status,leads_count&limit=100&access_token=${encodeURIComponent(tokenPagina)}`,
      );
      const j: any = await r.json();
      if (j?.error) {
        errosDePagina.push({ page_id: pageId, erro: j.error.message, codigo: j.error.code });
        continue;
      }
      for (const f of j?.data ?? []) {
        formularios.push({
          page_id: pageId,
          id: String(f.id),
          nome: String(f.name || ''),
          leads_count: Number(f.leads_count || 0),
        });
      }
    }

    // 2) Roteia. O que não casa vira lista, não palpite.
    const comRota: Array<{ f: (typeof formularios)[number]; rota: (typeof ROTAS)[number] }> = [];
    const ignorados: Array<{ formulario: string; leads_count: number }> = [];
    for (const f of formularios) {
      const rota = rotaDoFormulario(f.nome);
      if (!rota) {
        ignorados.push({ formulario: f.nome, leads_count: f.leads_count });
        continue;
      }
      if (body.board_id && rota.board_id !== body.board_id) continue;
      comRota.push({ f, rota });
    }

    // 3) Lê os leads
    const porFormulario: Array<Record<string, unknown>> = [];
    const porBoard = new Map<string, LeadDaMeta[]>();
    for (const { f, rota } of comRota) {
      const tokenPagina = tokens.get(f.page_id)!;
      const { leads, paginas, erro } = await leadsDoFormulario(f.id, f.nome, tokenPagina, desdeUnix);
      const validos = leads.filter((l) => l.telefone.length >= 10 && !isJunkName(l.nome));
      // Formulario que le linha e aproveita ZERO nao e "sem lead novo": e
      // mapeamento de campo quebrado. Foi assim que os dois formularios do
      // Israel (817 leads) quase entraram como perda silenciosa. Devolve os
      // nomes de campo junto, que e o que permite consertar sem adivinhar.
      const campoQuebrado = leads.length > 0 && validos.length === 0;
      const camposVistos = Array.from(new Set(leads.flatMap((l) => Object.keys(l.respostas))));
      porFormulario.push({
        formulario: f.nome,
        board: rota.rotulo,
        operador: casaOperador(f.nome),
        lidos: leads.length,
        validos: validos.length,
        descartados_sem_telefone_ou_nome: leads.length - validos.length,
        telefone_divergente: validos.filter((l) => l.telefone_divergente).length,
        paginas,
        ...(campoQuebrado
          ? {
              ALERTA: 'formulario leu linhas e aproveitou ZERO — mapeamento de campo quebrado',
              campos_do_formulario: camposVistos,
            }
          : {}),
        ...(erro ? { erro } : {}),
        ...(paginas >= TETO_PAGINAS_LEADS ? { aviso: 'teto de paginas atingido: rode de novo' } : {}),
      });
      const lista = porBoard.get(rota.board_id) ?? [];
      lista.push(...validos);
      porBoard.set(rota.board_id, lista);
    }

    // 4) Dedup e criação, board a board
    const resultados: Array<Record<string, unknown>> = [];
    let criadosTotal = 0;
    for (const [boardId, lista] of porBoard) {
      const { data: board } = await supabase
        .from('kanban_boards')
        .select('id, name, stages')
        .eq('id', boardId)
        .maybeSingle();
      if (!board) {
        resultados.push({ board_id: boardId, erro: 'board nao encontrado' });
        continue;
      }
      const stages = ((board as any).stages || []) as Array<{ id: string }>;
      if (!stages.length) {
        resultados.push({ board_id: boardId, board: (board as any).name, erro: 'board sem etapas' });
        continue;
      }
      const etapaInicial = stages[0].id;

      const conhecidos = await existentesDoBoard(boardId);
      const vistosAgora = new Set<string>();
      let barradosPeloId = 0;
      const aCriar: LeadDaMeta[] = [];
      for (const l of lista) {
        // O id do lead na Meta vem antes do telefone: e a identidade exata do
        // registro, e sobrevive a divergencia entre o numero pre-preenchido e o
        // digitado na resposta. Ver o comentario de `existentesDoBoard`.
        const idMeta = String(l.meta_lead_id || '').trim();
        if (idMeta && conhecidos.ids.has(idMeta)) {
          barradosPeloId += 1;
          continue;
        }
        const k = phoneKey(l.telefone);
        if (!k || conhecidos.fones.has(k) || vistosAgora.has(k)) continue;
        vistosAgora.add(k);
        aCriar.push(l);
      }

      const erros: Array<Record<string, unknown>> = [];
      const porErro: Record<string, number> = {};
      let totalErros = 0;
      let criados = 0;
      if (!dryRun) {
        for (const l of aCriar) {
          const { error } = await supabase.from('leads').insert({
            lead_name: l.nome,
            lead_phone: l.telefone,
            lead_email: l.email || null,
            board_id: boardId,
            status: etapaInicial,
            source: `Meta Lead Ads — ${l.operador || (board as any).name}`,
            facebook_lead_id: l.meta_lead_id || null,
            campaign_id: l.campaign_id || null,
            campaign_name: l.campaign_name || null,
            adset_id: l.adset_id || null,
            adset_name: l.adset_name || null,
            ad_name: l.ad_name || null,
            // As respostas de qualificação vão para `notes`, e não para uma
            // coluna jsonb: `leads` não tem `details` (eu copiei essa suposição
            // do zapsign-webhook, que grava `details` E `closed_at` — as duas
            // inexistentes, e por isso aquele caminho nunca criou um lead).
            // Em `notes` o atendente lê renda, CadÚnico e laudo na própria
            // ficha, que é onde a informação serve para alguma coisa.
            notes: [
              `Lido direto da Meta — formulário ${l.formulario}`,
              l.cidade && `Cidade: ${l.cidade}`,
              l.campaign_name && `Campanha: ${l.campaign_name}`,
              l.ad_name && `Ad: ${l.ad_name}`,
              `facebook_lead_id: ${l.meta_lead_id}`,
              formataRespostas(l.respostas),
            ]
              .filter(Boolean)
              .join('\n'),
            // Data real do preenchimento, não a do import: é o que faz o lead
            // cair no dia certo do gráfico e o que a CAPI usa como event_time.
            created_at: l.criado_em || new Date().toISOString(),
          } as any);
          if (error) {
            // Contar TUDO, amostrar 5. Antes o contador parava em 5 junto com a
            // amostra: 195 falhas apareciam como "erros=5", que e um numero que
            // mente na direcao confortavel.
            totalErros += 1;
            const msg = String(error.message || '');
            const classe = msg.includes('idx_leads_phone_normalized_unique')
              ? 'telefone ja existe em outro board (indice unico global)'
              : msg.slice(0, 90);
            porErro[classe] = (porErro[classe] || 0) + 1;
            if (erros.length < 5) erros.push({ formulario: l.formulario, erro: msg });
          } else {
            criados += 1;
          }
        }
      }
      criadosTotal += criados;
      resultados.push({
        board: (board as any).name,
        board_id: boardId,
        candidatos: lista.length,
        ja_no_board: lista.length - aCriar.length,
        a_criar: aCriar.length,
        criados,
        dedup_telefones_conhecidos: conhecidos.fones.size,
        dedup_ids_da_meta_conhecidos: conhecidos.ids.size,
        // Quantos so o id salvou de virar duplicata nesta rodada.
        barrados_pelo_id_da_meta: barradosPeloId,
        erros: totalErros,
        erros_por_motivo: porErro,
        amostra_erros: erros,
      });
    }

    return res.status(200).json({
      ok: true,
      dry_run: dryRun,
      since_days: sinceDays,
      paginas_alcancadas: tokens.size,
      formularios_encontrados: formularios.length,
      formularios_roteados: comRota.length,
      // Formulário sem rota é dinheiro entrando em lugar nenhum OU recrutamento:
      // precisa ser lido por gente, não adivinhado por palavra-chave.
      formularios_ignorados: ignorados,
      erros_de_pagina: errosDePagina,
      // Se isto vier > 0, NAO rodar pra valer: tem formulario perdendo tudo.
      formularios_com_alerta: porFormulario.filter((f: any) => f.ALERTA).length,
      por_formulario: porFormulario,
      resultados,
      criados: criadosTotal,
    });
  } catch (err) {
    console.error('[meta-leads-sync]', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : 'erro desconhecido' });
  }
};
