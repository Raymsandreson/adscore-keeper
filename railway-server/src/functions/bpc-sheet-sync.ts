// Sincroniza a planilha Google de Lead Ads de um board com o funil desse board.
// Le as abas por operador, dedup por (phone + board_id) na janela pedida, e cria
// os leads novos na primeira etapa. Idempotente — pode rodar a cada N minutos.
//
// A planilha vem de `kanban_boards.sheet_source_url`, NAO de constante. Ate
// 04/09/2026 o id ficava fixo aqui e o `board_id` recebido so escolhia onde
// gravar: chamar a funcao com o board "Acidente de Trabalho" lia a planilha do
// BPC assim mesmo e criaria centenas de leads no funil errado. Fonte e destino
// agora saem da mesma linha do banco.
import type { RequestHandler } from 'express';
import { supabase as ext } from '../lib/supabase';
import {
  normalizaLeadIdMeta,
  normalizePhone,
  phoneKey,
  isJunkName,
  OPERATOR_KEYWORDS,
} from '../lib/leadAdsSheet';

const GATEWAY = 'https://connector-gateway.lovable.dev/google_sheets/v4';

const SKIP_TABS = new Set(['BASE_UNIFICADA']);

/**
 * Chamada ao Sheets que aguenta o 429.
 *
 * A cota do Sheets e POR MINUTO, e aqui ela e disputada por tres consumidores: o
 * cron de 10 em 10 minutos, a varredura manual e as leituras de diagnostico. Em
 * 09/09/2026 uma sincronizacao de status morreu logo na descoberta das abas com
 * `discoverSheetTabs 429` — nada foi escrito, mas o trabalho todo se perdeu por
 * um limite que passa sozinho em segundos.
 *
 * Espera crescente (2s, 6s, 14s) so no 429. Qualquer outro erro sobe na hora:
 * insistir em 403 ou 404 e desperdicio.
 */
async function buscaComEspera(url: string, init: RequestInit, oQue: string): Promise<Response> {
  const esperas = [2000, 4000, 8000];
  for (let tentativa = 0; ; tentativa++) {
    const resp = await fetch(url, init);
    if (resp.status !== 429 || tentativa >= esperas.length) return resp;
    await new Promise((r) => setTimeout(r, esperas[tentativa]));
    console.warn(`[bpc-sheet-sync] 429 em ${oQue}: aguardando ${esperas[tentativa]}ms`);
  }
}

async function discoverSheetTabs(
  spreadsheetId: string,
): Promise<{ lidas: { tab: string; operator: string }[]; ignoradas: string[] }> {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const gsKey = process.env.GOOGLE_SHEETS_API_KEY;
  if (!lovableKey || !gsKey) throw new Error('Missing connector keys');
  const resp = await buscaComEspera(
    `${GATEWAY}/spreadsheets/${spreadsheetId}?fields=sheets.properties.title`,
    { headers: { Authorization: `Bearer ${lovableKey}`, 'X-Connection-Api-Key': gsKey } },
    'descoberta das abas',
  );
  if (!resp.ok) throw new Error(`discoverSheetTabs ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const json: any = await resp.json();
  const titles: string[] = (json.sheets || []).map((s: any) => s.properties?.title).filter(Boolean);
  const found: { tab: string; operator: string }[] = [];
  // Aba sem palavra-chave conhecida era descartada em silencio: atendente novo na
  // planilha simplesmente nao existia para o sistema, e nada denunciava a perda.
  // Agora volta na resposta para virar decisao (cadastrar a palavra-chave) em vez
  // de sumico.
  const ignoradas: string[] = [];
  for (const title of titles) {
    if (SKIP_TABS.has(title)) continue;
    const lower = String(title).toLowerCase();
    const match = OPERATOR_KEYWORDS.find((k) => lower.includes(k.keyword));
    if (match) found.push({ tab: title, operator: match.operator });
    else ignoradas.push(title);
  }
  return { lidas: found, ignoradas };
}

interface ParsedRow {
  facebook_lead_id: string;
  created_at: string;
  name: string;
  phone: string; // normalizado, só dígitos (com 55 quando aplicável)
  phone_key: string; // últimos 8 dígitos (chave de match)
  operator: string;
  /** O que a EQUIPE escreveu na coluna `status da lead`. */
  status_equipe: string;
  campaign_id: string;
  campaign_name: string;
  adset_id: string;
  adset_name: string;
  ad_name: string;
  form_name: string;
  estado_civil: string;
  renda: string;
  laudo: string;
  possui_advogado: string;
  filho_autista: string;
  tab: string;
}


function rowToObj(headers: string[], r: any[]): Record<string, string> {
  const o: Record<string, string> = {};
  headers.forEach((h, i) => {
    o[h] = String(r[i] ?? '').trim();
  });
  return o;
}

interface AbaLida {
  tab: string;
  headers: string[];
  rows: ParsedRow[];
  /** Linhas cruas da aba, antes de qualquer descarte. */
  brutas: number;
  descartadas_nome: number;
  descartadas_telefone: number;
  /** Quantas linhas descartadas tinham valor em cada indice de coluna. */
  preenchidas_nas_descartadas: Record<string, number>;
  /** Linhas em que nome e telefone vieram trocados de coluna. */
  recuperadas_por_troca: number;
  /** Valores da coluna de status preenchida pela equipe, e quantos tem id da Meta. */
  status_na_planilha: Record<string, number>;
  status_com_id_meta: Record<string, number>;
}

async function fetchTab(spreadsheetId: string, meta: { tab: string; operator: string }): Promise<AbaLida> {
  const lovableKey = process.env.LOVABLE_API_KEY || '';
  const gsKey = process.env.GOOGLE_SHEETS_API_KEY || '';
  if (!lovableKey || !gsKey) throw new Error('Missing connector keys (LOVABLE_API_KEY / GOOGLE_SHEETS_API_KEY)');

  const url = `${GATEWAY}/spreadsheets/${spreadsheetId}/values/'${encodeURIComponent(meta.tab)}'!A1:Z5000`;
  const resp = await buscaComEspera(
    url,
    { headers: { Authorization: `Bearer ${lovableKey}`, 'X-Connection-Api-Key': gsKey } },
    `aba "${meta.tab}"`,
  );
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`sheet "${meta.tab}" ${resp.status}: ${txt.slice(0, 200)}`);
  }
  const json = (await resp.json()) as { values?: any[][] };
  const values: any[][] = json.values || [];
  if (values.length < 2)
    return { tab: meta.tab, headers: values[0] ? values[0].map(String) : [], rows: [], brutas: Math.max(0, values.length - 1), descartadas_nome: 0, descartadas_telefone: 0, preenchidas_nas_descartadas: {}, recuperadas_por_troca: 0, status_na_planilha: {}, status_com_id_meta: {} };
  const headers = values[0].map((h: string) => String(h).toLowerCase().trim());

  const out: ParsedRow[] = [];
  // Contar o descarte, e nao so o aproveitado: aba que le 40 linhas e aproveita
  // 0 e indistinguivel de aba vazia sem isto — e as duas pedem acoes opostas.
  let descNome = 0;
  let descTelefone = 0;
  let brutas = 0;
  const preenchidas: Record<string, number> = {};
  // Distribuicao dos valores das colunas de status QUE A EQUIPE PREENCHE na
  // planilha. Se houver "fechado" marcado ali que o CRM nao conhece, cada um e
  // uma conversao real que nunca foi para a Meta.
  const statusPlanilha: Record<string, number> = {};
  const statusComIdMeta: Record<string, number> = {};
  let trocaDeColuna = 0;
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    if (!r || !r.length) continue;
    brutas += 1;
    const o = rowToObj(headers, r);
    // NOME E TELEFONE TROCADOS DE COLUNA.
    //
    // A mesma aba acumula exportacoes de duas versoes do formulario, com a
    // ordem das colunas invertida entre elas. O cabecalho e o da primeira, e
    // por isso as linhas da segunda traziam o telefone onde se lia `full_name`.
    // Medido em 09/09/2026 na planilha do BPC: **1.851 linhas** descartadas por
    // "nome sem letra nenhuma" — eram telefones. Somadas as duas abas sem
    // cabecalho, a planilha tinha 3.295 linhas e o import lia 379.
    //
    // Conserto sem adivinhacao: o nome e o candidato QUE TEM LETRA, o telefone
    // e o candidato QUE TEM DIGITO SUFICIENTE. Se as duas celulas se
    // desmentirem, a troca e obvia; se nenhuma servir, a linha cai como antes.
    const temLetra = (v: string) => /[a-zà-ú]/i.test(String(v || ''));
    const celulaNome = o['nome_completo'] || o['full_name'] || '';
    const celulaTelefone =
      o['telefone'] || o['phone_number'] || o['número_do_whatsapp'] || o['qual_o_seu_número_de_contato_?'] || '';
    const trocado = !temLetra(celulaNome) && temLetra(celulaTelefone);
    if (trocado) trocaDeColuna += 1;
    const name = trocado ? celulaTelefone : celulaNome;
    const rawPhone = trocado ? celulaNome : celulaTelefone;
    if (isJunkName(name)) {
      descNome += 1;
      // QUAL das regras de isJunkName reprovou. Classificacao pura: nenhum
      // valor de cliente sai daqui, so o motivo e um tamanho.
      const t = String(name || '').trim();
      const motivo = !t
        ? 'celula vazia'
        : t.length < 3
          ? 'menos de 3 caracteres'
          : t.startsWith('<test')
            ? 'placeholder <test'
            : /^\.+$/.test(t)
              ? 'so pontos'
              : 'sem letra latina';
      preenchidas[motivo] = (preenchidas[motivo] || 0) + 1;
      continue;
    }
    const phone = normalizePhone(rawPhone);
    if (phone.length < 10) {
      descTelefone += 1;
      continue;
    }
    // CADA coluna separada. `lead_status` e campo da exportacao da Meta (vale
    // sempre "created"); com `||` ele curto-circuita e a coluna que a EQUIPE
    // preenche nunca era lida — foi o defeito da primeira medicao.
    for (const col of ['lead_status', 'status da lead', 'status', 'observações', 'observacoes']) {
      const v = String(o[col] || '').trim().toLowerCase();
      if (!v) continue;
      const chave = `${col} = ${v.slice(0, 40)}`;
      statusPlanilha[chave] = (statusPlanilha[chave] || 0) + 1;
      if (normalizaLeadIdMeta(o['id'])) statusComIdMeta[chave] = (statusComIdMeta[chave] || 0) + 1;
    }
    out.push({
      status_equipe: String(o['status da lead'] || '').trim().toLowerCase(),
      facebook_lead_id: normalizaLeadIdMeta(o['id']),
      created_at: o['created_time'] || '',
      name: name.trim(),
      phone,
      phone_key: phoneKey(phone),
      operator: meta.operator,
      campaign_id: o['campaign_id'] || '',
      campaign_name: o['campaign_name'] || '',
      adset_id: o['adset_id'] || '',
      adset_name: o['adset_name'] || '',
      ad_name: o['ad_name'] || '',
      form_name: o['form_name'] || '',
      estado_civil: o['estado_civil'] || o['marital_status'] || '',
      renda: o['qual_a_sua_renda_familiar_?'] || '',
      laudo: o['possui_laudo_médico_ou_relatório_escolar_?'] || '',
      possui_advogado: o['possui_advogado_?'] || '',
      filho_autista: o['você_possui_filho_autista_ou_conhece_alguém_autista_?'] || '',
      tab: meta.tab,
    });
  }
  return {
    tab: meta.tab,
    headers,
    rows: out,
    brutas,
    descartadas_nome: descNome,
    descartadas_telefone: descTelefone,
    preenchidas_nas_descartadas: preenchidas,
    recuperadas_por_troca: trocaDeColuna,
    status_na_planilha: statusPlanilha,
    status_com_id_meta: statusComIdMeta,
  };
}

// Garante a definição de um custom field do board (cria se não existir).
async function ensureCustomField(boardId: string, fieldKey: string, displayName: string): Promise<string | null> {
  try {
    const { data: existing } = await ext
      .from('lead_custom_fields')
      .select('id')
      .eq('board_id', boardId)
      .eq('field_name', displayName)
      .maybeSingle();
    if (existing?.id) return existing.id;
    const { data: created, error } = await ext
      .from('lead_custom_fields')
      .insert({ board_id: boardId, field_name: displayName, field_type: 'text', tab: 'info' })
      .select('id')
      .single();
    if (error) return null;
    return created?.id || null;
  } catch {
    return null;
  }
}

interface BoardConfig {
  id: string;
  name: string;
  stages: Array<{ id: string; name: string }> | null;
  sheet_source_url: string | null;
}

function extrairIdDaPlanilha(url: string | null): string | null {
  if (!url) return null;
  const m = String(url).match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : null;
}

interface OpcoesSync {
  /** Escreve no CRM o status que a equipe preencheu na planilha. */
  aplicarStatus?: boolean;
  /** Só sincroniza status: não cria lead nenhum. É assim que o cron horário roda. */
  somenteStatus?: boolean;
  /** Cria os marcados como "fechado" que não existem no CRM, ignorando a janela. */
  criarFechadosAusentes?: boolean;
  spreadsheetIdOverride?: string;
  sinceDays: number;
  dryRun: boolean;
}


/**
 * De-para do que a EQUIPE escreve na planilha para o status do CRM.
 *
 * O vocabulario do CRM (medido em 09/09/2026): no_response 19.251, closed 3.204,
 * inviavel 390, refused 111, in_progress 6, cancelled 5.
 *
 * Tres sao juizo, nao traducao — estao marcados. Se estiverem errados, e trocar
 * a linha aqui e rodar de novo.
 */
const MAPA_STATUS: Record<string, string> = {
  fechado: 'closed',
  cancelado: 'cancelled',
  inviavel: 'inviavel',
  'inviável': 'inviavel',
  'sem resposta': 'no_response',
  'em andamento': 'in_progress',
  'primeiro contato': 'in_progress',
  'aguar. doc': 'in_progress',
  'aguar. assinat': 'in_progress',
  'falar depois': 'in_progress',
  // JUIZO 1: numero errado nao da para trabalhar -> inviavel
  'n° errado': 'inviavel',
  'n errado': 'inviavel',
  'numero errado': 'inviavel',
  // JUIZO 2: "viavel" e lead bom ainda em aberto -> in_progress
  'viável': 'in_progress',
  viavel: 'in_progress',
  // JUIZO 3: bloqueou o atendente -> refused
  bloqueado: 'refused',
};

/** Status que o CRM ja classificou: a planilha nao rebaixa nenhum deles. */
const NAO_REBAIXAR = new Set(['closed', 'cancelled', 'inviavel', 'refused', 'in_progress']);

async function sincronizaBoard(board: BoardConfig, opts: OpcoesSync): Promise<Record<string, unknown>> {
  const boardId = board.id;
  const falha = (error: string) => ({ success: false, board_id: boardId, board: board.name, error });

  const stages = (board.stages as Array<{ id: string; name: string }>) || [];
  if (!stages.length) return falha('board sem etapas');
  const initialStageId = stages[0].id;

  const spreadsheetId = (opts.spreadsheetIdOverride || extrairIdDaPlanilha(board.sheet_source_url) || '').trim();
  if (!spreadsheetId) {
    return falha('board sem planilha: sheet_source_url vazio ou sem id de planilha na URL');
  }
  const sinceMs = Date.now() - opts.sinceDays * 24 * 60 * 60 * 1000;

  // 1) Descoberta dinamica das abas + leitura em paralelo limitado (3 por vez)
  let SHEET_TABS: { tab: string; operator: string }[] = [];
  let abasIgnoradas: string[] = [];
  try {
    const d = await discoverSheetTabs(spreadsheetId);
    SHEET_TABS = d.lidas;
    abasIgnoradas = d.ignoradas;
  } catch (e: any) {
    return falha(`discover tabs: ${e?.message || e}`);
  }
  const sheetRows: ParsedRow[] = [];
  const tabErrors: { tab: string; error: string }[] = [];
  const cabecalhos = new Set<string>();
  const diagPorAba = new Map<
    string,
    { cabecalho: string[]; brutas: number; dn: number; dt: number; preenchidas: Record<string, number>; troca: number; status: Record<string, number>; statusId: Record<string, number> }
  >();
  for (let i = 0; i < SHEET_TABS.length; i += 3) {
    const chunk = SHEET_TABS.slice(i, i + 3);
    const results = await Promise.allSettled(chunk.map((t) => fetchTab(spreadsheetId, t)));
    results.forEach((r, idx) => {
      const meta = chunk[idx];
      if (r.status === 'fulfilled') {
        sheetRows.push(...r.value.rows);
        r.value.headers.forEach((h) => cabecalhos.add(h));
        diagPorAba.set(meta.tab, {
          cabecalho: r.value.headers,
          brutas: r.value.brutas,
          dn: r.value.descartadas_nome,
          dt: r.value.descartadas_telefone,
          preenchidas: r.value.preenchidas_nas_descartadas,
          troca: r.value.recuperadas_por_troca,
          status: r.value.status_na_planilha,
          statusId: r.value.status_com_id_meta,
        });
      } else {
        tabErrors.push({ tab: meta.tab, error: String(r.reason?.message || r.reason).slice(0, 200) });
      }
    });
    if (i + 3 < SHEET_TABS.length) await new Promise((r) => setTimeout(r, 300));
  }

  // 2) Filtra por janela de tempo (apenas leads recentes)
  const recentRows = sheetRows.filter((r) => {
    if (!r.created_at) return false;
    const t = new Date(r.created_at).getTime();
    return !isNaN(t) && t >= sinceMs;
  });

  // Dedup interno na propria planilha (mesmo telefone aparece em varias abas)
  const seenKeys = new Set<string>();
  const uniqueRows: ParsedRow[] = [];
  for (const r of recentRows) {
    if (seenKeys.has(r.phone_key)) continue;
    seenKeys.add(r.phone_key);
    uniqueRows.push(r);
  }

  // 3) Busca leads existentes no board pra dedup contra o banco.
  //
  // PAGINADO de proposito: o PostgREST corta em 1000 linhas por request e o
  // board BPC tem 7.255 leads com telefone. Sem paginar, o dedup so conhecia
  // 14% deles — e quem ficasse de fora seria recriado a cada rodada do cron,
  // de 10 em 10 minutos, sem nunca entrar no conjunto conhecido. O `.order`
  // nao e enfeite: sem ordem estavel a paginacao pula e repete linhas.
  const PAGINA_DEDUP = 1000;
  const existingKeys = new Set<string>();
  // Mesma varredura, dois usos: o Set decide quem criar, o Map permite achar o
  // lead pelo TELEFONE na hora de aplicar status. Casar so por
  // `facebook_lead_id` deixava de fora quem entrou por outro caminho — eram 6
  // fechamentos invisiveis so no BPC.
  const porTelefone = new Map<string, { id: string; lead_status: string }>();
  let lidosDedup = 0;
  for (let inicio = 0; ; inicio += PAGINA_DEDUP) {
    const { data: pagina, error: existErr } = await ext
      .from('leads')
      .select('id, lead_phone, lead_status')
      .eq('board_id', boardId)
      .not('lead_phone', 'is', null)
      .order('id', { ascending: true })
      .range(inicio, inicio + PAGINA_DEDUP - 1);
    if (existErr) return falha(`dedup query: ${existErr.message}`);
    const linhas = pagina || [];
    lidosDedup += linhas.length;
    for (const l of linhas) {
      const k = phoneKey(String(l.lead_phone || '').replace(/\D/g, ''));
      if (k) {
        existingKeys.add(k);
        if (!porTelefone.has(k)) {
          porTelefone.set(k, { id: String((l as any).id), lead_status: String((l as any).lead_status || '') });
        }
      }
    }
    if (linhas.length < PAGINA_DEDUP) break;
    // Trava: board absurdo nao pode virar loop infinito dentro do cron.
    if (inicio >= 200_000) break;
  }

  // 4) Decide quem criar
  // FECHADO NAO TEM JANELA.
  //
  // `recentRows` corta por data do formulario, e fechamento marcado pela equipe
  // pode ser de lead antigo — sao 12 conversoes que ficaram de fora da importacao
  // de 30 dias so por isso. Quando `criarFechadosAusentes` esta ligado, esses
  // entram independente da janela: a conversao vale mais que a idade do lead.
  const candidatosCriacao = opts.criarFechadosAusentes
    ? [
        ...uniqueRows,
        ...sheetRows.filter(
          (r) => r.status_equipe === 'fechado' && !uniqueRows.some((u) => u.phone_key === r.phone_key),
        ),
      ]
    : uniqueRows;
  const toCreate = opts.somenteStatus
    ? []
    : candidatosCriacao.filter((r) => !existingKeys.has(r.phone_key));

  // Contagem por aba. Sem ela, "li 8 abas" e promessa sem prova: uma aba pode
  // voltar vazia (renomeada, range errado, permissao) que o total geral nao
  // denuncia. `recentes` e antes do dedup por telefone; `novos` e depois, e a
  // soma de `novos` fecha com would_create/created.
  const porAba = SHEET_TABS.map((t) => {
    const d = diagPorAba.get(t.tab);
    const linhas = sheetRows.filter((r) => r.tab === t.tab).length;
    const brutas = d?.brutas ?? 0;
    return {
      aba: t.tab,
      operador: t.operator,
      brutas,
      linhas,
      descartadas_sem_nome: d?.dn ?? 0,
      descartadas_sem_telefone: d?.dt ?? 0,
      recentes: recentRows.filter((r) => r.tab === t.tab).length,
      novos: toCreate.filter((r) => r.tab === t.tab).length,
      // Cabecalho da PROPRIA aba. Se vier CPF, nome de gente ou data no lugar de
      // 'full_name'/'telefone', a aba nao tem linha de cabecalho e todo o resto
      // e lido deslocado — a uniao em `colunas_da_planilha` esconde isso.
      cabecalho: d?.cabecalho ?? [],
      preenchidas_nas_descartadas: d?.preenchidas ?? {},
      recuperadas_por_troca: d?.troca ?? 0,
      status_na_planilha: d?.status ?? {},
      status_com_id_meta: d?.statusId ?? {},
      ...(brutas > 0 && linhas === 0
        ? { ALERTA: 'aba leu linhas e aproveitou ZERO — cabecalho ausente ou coluna com outro nome' }
        : {}),
    };
  });

  // FECHADOS MARCADOS NA PLANILHA.
  //
  // A equipe escreve o desfecho na coluna `status da lead`, e o CRM nunca soube
  // disso. Cada "fechado" ali e uma conversao real — e, diferente dos
  // fechamentos que vem por webhook, esta TEM o id da Meta, que e o que casa a
  // conversao com o formulario do anuncio.
  const fechadosNaPlanilha = sheetRows.filter((r) => r.status_equipe === 'fechado');
  let fechadosNoCrm = 0;
  let fechadosAindaAbertos = 0;
  let fechadosSemLeadNoCrm = 0;
  if (fechadosNaPlanilha.length) {
    const ids = fechadosNaPlanilha.map((r) => r.facebook_lead_id).filter(Boolean);
    const achados = new Map<string, string>();
    for (let i = 0; i < ids.length; i += 100) {
      const { data } = await ext
        .from('leads')
        .select('facebook_lead_id, lead_status')
        .in('facebook_lead_id', ids.slice(i, i + 100));
      for (const l of data || []) achados.set(String((l as any).facebook_lead_id), String((l as any).lead_status || ''));
    }
    for (const r of fechadosNaPlanilha) {
      const st = achados.get(r.facebook_lead_id) ?? porTelefone.get(r.phone_key)?.lead_status;
      if (st === undefined) fechadosSemLeadNoCrm += 1;
      else if (st === 'closed') fechadosNoCrm += 1;
      else fechadosAindaAbertos += 1;
    }
  }

  // APLICA O STATUS DA PLANILHA NO CRM.
  //
  // Duas travas:
  //  1. `closed` da planilha sempre vale (e a conversao, o dado mais caro).
  //  2. Para o resto, so escreve se o CRM ainda estiver em `no_response` — o
  //     padrao de quem nunca foi classificado. A planilha nao desfaz trabalho
  //     que ja foi feito no CRM, porque ela pode estar desatualizada.
  const statusAplicado: Record<string, number> = {};
  const statusIgnorado: Record<string, number> = {};
  let statusEscritos = 0;
  if (opts.aplicarStatus) {
    const comStatus = sheetRows.filter((r) => MAPA_STATUS[r.status_equipe]);
    const atual = new Map<string, { id: string; lead_status: string }>();
    const ids = comStatus.map((r) => r.facebook_lead_id).filter(Boolean);
    for (let i = 0; i < ids.length; i += 100) {
      const { data } = await ext
        .from('leads')
        .select('id, facebook_lead_id, lead_status')
        .in('facebook_lead_id', ids.slice(i, i + 100));
      for (const l of data || []) {
        atual.set(String((l as any).facebook_lead_id), {
          id: String((l as any).id),
          lead_status: String((l as any).lead_status || ''),
        });
      }
    }
    const porAlvo: Record<string, string[]> = {};
    for (const r of comStatus) {
      const alvo = MAPA_STATUS[r.status_equipe];
      const atualLead = atual.get(r.facebook_lead_id) || porTelefone.get(r.phone_key);
      if (!atualLead) {
        statusIgnorado['lead nao existe no CRM'] = (statusIgnorado['lead nao existe no CRM'] || 0) + 1;
        continue;
      }
      if (atualLead.lead_status === alvo) {
        statusIgnorado['ja estava assim'] = (statusIgnorado['ja estava assim'] || 0) + 1;
        continue;
      }
      if (alvo !== 'closed' && NAO_REBAIXAR.has(atualLead.lead_status)) {
        statusIgnorado[`CRM ja classificou como ${atualLead.lead_status}`] =
          (statusIgnorado[`CRM ja classificou como ${atualLead.lead_status}`] || 0) + 1;
        continue;
      }
      if (opts.dryRun) {
        statusAplicado[`${r.status_equipe} -> ${alvo}`] = (statusAplicado[`${r.status_equipe} -> ${alvo}`] || 0) + 1;
        continue;
      }
      // Agrupa por status alvo em vez de gravar linha a linha. Uma escrita por
      // lead eram 349 chamadas HTTP em sequencia: a requisicao passava de dez
      // minutos e morria pela metade. Agrupado, sao 4.
      (porAlvo[alvo] ||= []).push(atualLead.id);
      statusAplicado[`${r.status_equipe} -> ${alvo}`] = (statusAplicado[`${r.status_equipe} -> ${alvo}`] || 0) + 1;
    }

    const hojeISO2 = new Date().toISOString().slice(0, 10);
    for (const [alvo, idsAlvo] of Object.entries(porAlvo)) {
      const patch: Record<string, unknown> = { lead_status: alvo };
      // `became_client_date` = HOJE, e nao a data do formulario: a planilha nao
      // guarda quando fechou, e a Meta descarta evento com mais de 7 dias. Com
      // data antiga o Purchase seria recusado e a conversao se perderia.
      if (alvo === 'closed') patch.became_client_date = hojeISO2;
      // Lotes de 200: `in` com 300+ uuids estoura o tamanho da querystring.
      for (let i = 0; i < idsAlvo.length; i += 200) {
        const fatia = idsAlvo.slice(i, i + 200);
        const { error: errUp } = await ext.from('leads').update(patch).in('id', fatia);
        if (errUp) {
          statusIgnorado[`erro: ${errUp.message.slice(0, 60)}`] =
            (statusIgnorado[`erro: ${errUp.message.slice(0, 60)}`] || 0) + (fatia.length as number);
        } else {
          statusEscritos += fatia.length;
        }
      }
    }
  }

  const comum = {
    success: true,
    board_id: boardId,
    board: board.name,
    spreadsheet_id: spreadsheetId,
    since_days: opts.sinceDays,
    total_rows_in_sheet: sheetRows.length,
    recent_rows: recentRows.length,
    unique_recent: uniqueRows.length,
    already_in_board: uniqueRows.length - toCreate.length,
    abas_lidas: SHEET_TABS.map((t) => `${t.tab} -> ${t.operator}`),
    abas_ignoradas: abasIgnoradas,
    linhas_por_aba: porAba,
    tab_errors: tabErrors,
    // Cabecalhos vistos na planilha: e o que permite afirmar de qual coluna veio
    // cada campo, em vez de supor. Mudanca de nome de coluna pela Meta aparece
    // aqui antes de virar coluna vazia no banco.
    colunas_da_planilha: [...cabecalhos].sort(),
    com_facebook_lead_id: toCreate.filter((r) => r.facebook_lead_id).length,
    status_aplicado: statusAplicado,
    status_ignorado: statusIgnorado,
    status_escritos: statusEscritos,
    fechados_marcados_na_planilha: {
      total: fechadosNaPlanilha.length,
      com_id_da_meta: fechadosNaPlanilha.filter((r) => r.facebook_lead_id).length,
      ja_fechados_no_crm: fechadosNoCrm,
      abertos_no_crm: fechadosAindaAbertos,
      sem_lead_no_crm: fechadosSemLeadNoCrm,
    },
    // Quantos telefones o dedup realmente conhecia. Se isto vier redondo em
    // 1000 num board maior que isso, a paginacao quebrou de novo.
    dedup_leads_lidos: lidosDedup,
    dedup_telefones_conhecidos: existingKeys.size,
  };

  if (opts.dryRun) {
    return {
      ...comum,
      dry_run: true,
      would_create: toCreate.length,
      sample: toCreate.slice(0, 5).map((r) => ({
        name: r.name,
        phone: r.phone,
        operator: r.operator,
        created_at: r.created_at,
      })),
    };
  }

  // 5) Garante custom fields (1x so)
  const fieldEstadoCivil = await ensureCustomField(boardId, 'estado_civil', 'Estado Civil');
  const fieldRenda = await ensureCustomField(boardId, 'renda', 'Renda Familiar');
  const fieldAcolhedor = await ensureCustomField(boardId, 'acolhedor', 'Acolhedor (Planilha)');

  // 6) Insere
  const created: string[] = [];
  const errors: { row: string; error: string }[] = [];
  const byOperator: Record<string, number> = {};

  for (const r of toCreate) {
    try {
      const { data: ins, error: insErr } = await ext
        .from('leads')
        .insert({
          lead_name: r.name,
          lead_phone: r.phone,
          board_id: boardId,
          status: initialStageId,
          source: `Planilha Meta Ads — ${r.operator || board.name}`,
          // Atribuicao vai para as COLUNAS, nao so para o texto de `notes`.
          // Ate 04/09/2026 tudo isso era despejado em `notes` e as colunas
          // ficavam nulas: `facebook_lead_id` estava vazio em 19.420 de 19.420
          // leads. Sem esse id a Meta nao consegue casar o fechamento com o lead
          // do formulario, que e o que destrava otimizar por lead qualificado.
          // Campo ausente na planilha fica NULL em vez de string vazia, senao
          // "tem valor" e "e vazio" viram a mesma coisa na hora de medir.
          facebook_lead_id: r.facebook_lead_id || null,
          campaign_id: r.campaign_id || null,
          campaign_name: r.campaign_name || null,
          adset_id: r.adset_id || null,
          adset_name: r.adset_name || null,
          ad_name: r.ad_name || null,
          notes: [
            `Importado da planilha do board — aba ${r.tab}`,
            r.form_name && `Form: ${r.form_name}`,
            r.campaign_name && `Campanha: ${r.campaign_name}`,
            r.ad_name && `Ad: ${r.ad_name}`,
            r.facebook_lead_id && `facebook_lead_id: ${r.facebook_lead_id}`,
          ]
            .filter(Boolean)
            .join('\n'),
          created_at: r.created_at || new Date().toISOString(),
          // Ja nasce fechado quando a planilha diz que fechou — senao o lead
          // entra aberto e a conversao so sairia na proxima sincronizacao.
          ...(r.status_equipe === 'fechado'
            ? { lead_status: 'closed', became_client_date: new Date().toISOString().slice(0, 10) }
            : {}),
        })
        .select('id')
        .single();
      if (insErr) {
        errors.push({ row: `${r.name} (${r.phone})`, error: insErr.message });
        continue;
      }
      created.push(ins.id);
      byOperator[r.operator] = (byOperator[r.operator] || 0) + 1;

      // Custom field values (best-effort, sem falhar lead se der erro)
      const cfInserts: Array<{ lead_id: string; field_id: string; value_text: string }> = [];
      if (fieldEstadoCivil && r.estado_civil) cfInserts.push({ lead_id: ins.id, field_id: fieldEstadoCivil, value_text: r.estado_civil.slice(0, 500) });
      if (fieldRenda && r.renda) cfInserts.push({ lead_id: ins.id, field_id: fieldRenda, value_text: r.renda.slice(0, 500) });
      if (fieldAcolhedor && r.operator) cfInserts.push({ lead_id: ins.id, field_id: fieldAcolhedor, value_text: r.operator });
      if (cfInserts.length) {
        await ext.from('lead_custom_field_values').insert(cfInserts);
      }
    } catch (e) {
      errors.push({ row: `${r.name} (${r.phone})`, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return {
    ...comum,
    created: created.length,
    errors_count: errors.length,
    by_operator: byOperator,
    errors: errors.slice(0, 20),
  };
}

export const handler: RequestHandler = async (req, res) => {
  const ok = (b: Record<string, unknown>) => res.status(200).json(b);
  try {
    const {
      board_id,
      spreadsheet_id,
      since_days,
      dry_run,
    } = (req.body || {}) as {
      board_id?: string;
      spreadsheet_id?: string;
      since_days?: number;
      dry_run?: boolean;
      aplicar_status?: boolean;
      somente_status?: boolean;
      criar_fechados_ausentes?: boolean;
    };

    const sinceDays = Math.max(1, Math.min(365, Number(since_days) || 7));
    const dryRun = !!dry_run;
    // Fora do cron de proposito: o cron so cria lead, nunca reescreve status.
    const aplicarStatus = !!(req.body as any)?.aplicar_status;
    const somenteStatus = !!(req.body as any)?.somente_status;
    const criarFechadosAusentes = !!(req.body as any)?.criar_fechados_ausentes;
    const COLUNAS = 'id, name, stages, sheet_source_url';

    // Um board: o formato da resposta e o de sempre, pra nao quebrar quem ja chama.
    if (board_id) {
      const { data, error } = await ext.from('kanban_boards').select(COLUNAS).eq('id', board_id).maybeSingle();
      if (error) return ok({ success: false, error: `board: ${error.message}` });
      if (!data) return ok({ success: false, error: 'board nao encontrado' });
      const r = await sincronizaBoard(data as unknown as BoardConfig, {
        spreadsheetIdOverride: spreadsheet_id,
        sinceDays,
        dryRun,
        aplicarStatus,
        somenteStatus,
        criarFechadosAusentes,
      });
      return ok(r);
    }

    // Sem board: varre todo board com a planilha ligada. E assim que o cron chama.
    if (spreadsheet_id) {
      return ok({
        success: false,
        error: 'spreadsheet_id so vale junto com board_id — na varredura cada board usa a planilha dele',
      });
    }
    const { data, error } = await ext.from('kanban_boards').select(COLUNAS).eq('sheet_enabled', true);
    if (error) return ok({ success: false, error: `boards: ${error.message}` });
    const boards = (data || []) as unknown as BoardConfig[];

    const resultados: Record<string, unknown>[] = [];
    for (const b of boards) {
      resultados.push(await sincronizaBoard(b, { sinceDays, dryRun, aplicarStatus, somenteStatus, criarFechadosAusentes }));
      // A API do Sheets tem cota por minuto e ja devolveu 429 numa leitura
      // dupla: espacar os boards custa segundos e evita perder a varredura.
      if (boards.indexOf(b) < boards.length - 1) await new Promise((r) => setTimeout(r, 5000));
    }
    return ok({
      success: true,
      dry_run: dryRun,
      boards_com_planilha: boards.length,
      criados: resultados.reduce((n, r) => n + (Number(r.created) || 0), 0),
      resultados,
    });
  } catch (err) {
    console.error('[bpc-sheet-sync] fatal:', err);
    return ok({ success: false, error: err instanceof Error ? err.message : 'unknown error' });
  }
};
