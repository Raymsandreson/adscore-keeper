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

/** Campo do formulário por nome exato, senão por pedaço do nome. */
function pegaCampo(campos: Record<string, string>, exatos: string[], pedacos: string[]): string {
  for (const e of exatos) if (campos[e]) return campos[e];
  for (const [k, v] of Object.entries(campos)) {
    if (!v) continue;
    const lk = k.toLowerCase();
    if (pedacos.some((p) => lk.includes(p))) return v;
  }
  return '';
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
  respostas: Record<string, string>;
}

async function telefonesDoBoard(boardId: string): Promise<Set<string>> {
  const chaves = new Set<string>();
  for (let inicio = 0; ; inicio += PAGINA_DEDUP) {
    const { data, error } = await supabase
      .from('leads')
      .select('lead_phone')
      .eq('board_id', boardId)
      .not('lead_phone', 'is', null)
      .order('id', { ascending: true })
      .range(inicio, inicio + PAGINA_DEDUP - 1);
    if (error) throw new Error(`dedup do board ${boardId}: ${error.message}`);
    const linhas = data || [];
    for (const l of linhas) {
      const k = phoneKey(String((l as any).lead_phone || '').replace(/\D/g, ''));
      if (k) chaves.add(k);
    }
    if (linhas.length < PAGINA_DEDUP) break;
    if (inicio >= 200_000) break;
  }
  return chaves;
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
      const telefone = normalizePhone(
        pegaCampo(campos, ['phone_number'], ['telefone', 'contato', 'whats', 'phone', 'celular']),
      );
      const nome = pegaCampo(campos, ['full_name'], ['nome completo', 'seu nome']) || '';
      out.push({
        meta_lead_id: normalizaLeadIdMeta(l.id),
        criado_em: l.created_time,
        nome,
        telefone,
        email: pegaCampo(campos, ['email'], ['e-mail', 'email']),
        cidade: pegaCampo(campos, ['city'], ['cidade']),
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
      porFormulario.push({
        formulario: f.nome,
        board: rota.rotulo,
        operador: casaOperador(f.nome),
        lidos: leads.length,
        validos: validos.length,
        descartados_sem_telefone_ou_nome: leads.length - validos.length,
        paginas,
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

      const conhecidos = await telefonesDoBoard(boardId);
      const vistosAgora = new Set<string>();
      const aCriar: LeadDaMeta[] = [];
      for (const l of lista) {
        const k = phoneKey(l.telefone);
        if (!k || conhecidos.has(k) || vistosAgora.has(k)) continue;
        vistosAgora.add(k);
        aCriar.push(l);
      }

      const erros: Array<Record<string, unknown>> = [];
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
            // As respostas de qualificação são o que a planilha jogava fora.
            details: { meta_form: { formulario: l.formulario, respostas: l.respostas } },
            notes: [
              `Lido direto da Meta — formulário ${l.formulario}`,
              l.cidade && `Cidade: ${l.cidade}`,
              l.campaign_name && `Campanha: ${l.campaign_name}`,
              l.ad_name && `Ad: ${l.ad_name}`,
              `facebook_lead_id: ${l.meta_lead_id}`,
            ]
              .filter(Boolean)
              .join('\n'),
            // Data real do preenchimento, não a do import: é o que faz o lead
            // cair no dia certo do gráfico e o que a CAPI usa como event_time.
            created_at: l.criado_em || new Date().toISOString(),
          } as any);
          if (error) {
            if (erros.length < 5) erros.push({ formulario: l.formulario, erro: error.message });
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
        dedup_telefones_conhecidos: conhecidos.size,
        erros: erros.length,
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
      por_formulario: porFormulario,
      resultados,
      criados: criadosTotal,
    });
  } catch (err) {
    console.error('[meta-leads-sync]', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : 'erro desconhecido' });
  }
};
