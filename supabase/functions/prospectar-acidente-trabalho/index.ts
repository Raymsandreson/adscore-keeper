// =============================================================================
// Varredura de prospecção: acha processos de ACIDENTE DE TRABALHO com valor da
// causa acima de um piso e resolve os advogados do polo ativo.
//
// Roda no Supabase EXTERNO (kmedldlepwiityjsdahz), onde vive ESCAVADOR_API_TOKEN
// e onde estão as tabelas prospect_* (migrations-external/20260820120000).
//
// POR QUE ESTA FUNÇÃO EXISTE COM ESTE DESENHO:
// a API v2 do Escavador não tem busca global por assunto nem filtro por valor
// da causa — toda rota de busca exige uma chave (CNJ, nome, CPF, CNPJ ou OAB).
// Então não existe "traz todos os processos de acidente de trabalho acima de
// 500k". O que existe é partir de uma SEMENTE e filtrar a capa no cliente.
// Detalhes e evidência: docs/sistema/prospeccao-acidente-trabalho.md
//
// CUSTO — leia antes de aumentar max_consultas:
// a consulta por OAB cobre até 200 itens; blocos de 200 além disso são cobrados
// à parte, e `resolver_advogados` gasta 1 consulta POR PROCESSO. Uma varredura
// distraída queima cota rápido. Por isso: `dry_run` é o PADRÃO (nada é gravado
// e nada é cobrado além da leitura), e `max_consultas` tem teto rígido.
//
// AÇÕES
//   varrer_oab          — semente = OAB. Lista processos do advogado e filtra.
//   varrer_cnpj         — semente = CNPJ da empresa ré. Exato.
//   varrer_nome         — semente = NOME da empresa ré. Impreciso (casa por
//                         similaridade); usar só sem CNPJ em mãos.
//   resolver_advogados  — para processos JÁ gravados, busca os envolvidos e
//                         vincula os advogados do polo ativo. 1 consulta/CNJ.
// =============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  filtrarCandidatos,
  extrairAdvogadosPoloAtivo,
  itensDeResposta,
  proximaPaginaSegura,
  type ProcessoEscavador,
  type CandidatoProspeccao,
  type EnvolvidoProcesso,
} from "../_shared/prospeccaoAcidenteTrabalho.ts";

/** Linha de prospect_processos lida de volta do banco. */
interface ProcessoGravado {
  id: string;
  numero_cnj: string;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-request-id, x-prospeccao-secret',
};

const ESCAVADOR_BASE = 'https://api.escavador.com/api/v2';

/** Teto rígido de páginas pagas por invocação. Não afrouxar sem medir custo. */
const MAX_CONSULTAS_TETO = 10;
/** Teto de CNJs resolvidos por invocação — cada um é 1 consulta paga. */
const MAX_RESOLVER_TETO = 50;
/** Respiro entre chamadas (rate limit da conta), igual ao backfill de marcos. */
const PAUSA_MS = 250;
/** Piso de valor da causa quando o chamador não manda. */
const VALOR_MINIMO_PADRAO = 500000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Autenticação por segredo compartilhado.
 *
 * POR QUE NÃO É requireAdmin: o cliente External do frontend entra com
 * signInAnonymously() (src/integrations/supabase/external-client.ts), então o
 * JWT que chega aqui é ANÔNIMO. requireAdmin validaria o token, procuraria o
 * uuid anônimo em user_roles, não acharia admin e devolveria 403 em toda
 * chamada. Ele só funciona nas funções que rodam no Cloud, onde o JWT é do
 * mesmo projeto que emitiu.
 *
 * Esta é ferramenta de back-office que GASTA COTA PAGA do Escavador — quem
 * invoca é operador (curl/cron), não navegador. Segredo compartilhado é a
 * autenticação adequada, e é a "validação manual compensatória" que o
 * CLAUDE.md exige quando verify_jwt está desligado.
 *
 * FALHA FECHADA: sem PROSPECCAO_ADMIN_SECRET configurado, NADA é aceito.
 * Nunca cair para "aberto" quando falta configuração.
 */
function segredoConfere(req: Request): boolean {
  const esperado = Deno.env.get('PROSPECCAO_ADMIN_SECRET') ?? '';
  if (esperado.length < 16) return false; // não configurado, ou fraco demais
  const recebido = req.headers.get('x-prospeccao-secret') ?? '';
  if (recebido.length !== esperado.length) return false;
  // Comparação de tempo constante: sair no primeiro byte diferente permitiria
  // descobrir o segredo byte a byte medindo a latência.
  let diff = 0;
  for (let i = 0; i < esperado.length; i++) {
    diff |= esperado.charCodeAt(i) ^ recebido.charCodeAt(i);
  }
  return diff === 0;
}

interface Corpo {
  action?: string;
  oab_numero?: string;
  oab_estado?: string;
  cnpj?: string;
  /** Nome da empresa ré, para varrer_nome. */
  nome?: string;
  valor_minimo?: number;
  max_consultas?: number;
  limit?: number;
  /** PADRÃO true. Só grava quando vier explicitamente false. */
  dry_run?: boolean;
}

function clienteExterno() {
  const url = (Deno.env.get('EXTERNAL_SUPABASE_URL') || '').trim();
  const key = (Deno.env.get('EXTERNAL_SUPABASE_SERVICE_ROLE_KEY') || '').trim();
  if (!url || !key) throw new Error('EXTERNAL_SUPABASE_URL/SERVICE_ROLE_KEY ausentes');
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function escavador(url: string, token: string): Promise<unknown> {
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const e = data as { message?: string; error?: string } | null;
    throw new Error(
      `Escavador ${resp.status}: ${e?.message || e?.error || 'erro'}`,
    );
  }
  return data;
}

/**
 * Percorre páginas da busca, respeitando o teto de consultas.
 *
 * A paginação do /advogado/processos carrega DOIS parâmetros no links.next
 * (cursor + `li`, o id da consulta usado na cobrança). Repassar só o cursor dá
 * 422 — por isso segue-se o links.next INTEIRO, validado contra a base da API
 * para não virar SSRF com URL arbitrária vinda da resposta.
 */
async function paginar(
  urlInicial: string,
  token: string,
  maxConsultas: number,
): Promise<{ processos: ProcessoEscavador[]; consultas: number; truncado: boolean }> {
  const processos: ProcessoEscavador[] = [];
  let url: string | null = urlInicial;
  let consultas = 0;

  while (url && consultas < maxConsultas) {
    const data = await escavador(url, token);
    consultas++;
    processos.push(...(itensDeResposta(data) as ProcessoEscavador[]));

    // Só segue link que aponta para a própria API. Ver proximaPaginaSegura:
    // o link vem de dentro da resposta e o fetch leva o Authorization junto.
    url = proximaPaginaSegura(data, ESCAVADOR_BASE);
    if (url) await dormir(PAUSA_MS);
  }

  return { processos, consultas, truncado: Boolean(url) };
}

/** Grava candidatos e devolve o mapa numero_cnj -> id. */
async function gravarCandidatos(
  db: ReturnType<typeof clienteExterno>,
  candidatos: CandidatoProspeccao[],
  origem: string,
  semente: string,
): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  if (!candidatos.length) return mapa;

  const linhas = candidatos.map((c) => ({
    numero_cnj: c.numero_cnj,
    valor_causa: c.valor_causa,
    assuntos: c.assuntos,
    polo_passivo: c.polo_passivo,
    tribunal: c.tribunal,
    uf: c.uf,
    data_inicio: c.data_inicio,
    origem,
    semente,
  }));

  const { data, error } = await db
    .from('prospect_processos')
    .upsert(linhas, { onConflict: 'numero_cnj' })
    .select('id, numero_cnj');
  if (error) throw new Error(`upsert prospect_processos: ${error.message}`);

  for (const r of data ?? []) mapa.set(r.numero_cnj, r.id);
  return mapa;
}

async function varrer(corpo: Corpo, token: string) {
  const { action } = corpo;
  const valorMinimo = Number(corpo.valor_minimo ?? VALOR_MINIMO_PADRAO);
  const maxConsultas = Math.min(
    Math.max(1, Number(corpo.max_consultas ?? 2)),
    MAX_CONSULTAS_TETO,
  );
  const dryRun = corpo.dry_run !== false;

  let urlInicial: string;
  let origem: string;
  let semente: string;

  if (action === 'varrer_oab') {
    if (!corpo.oab_numero || !corpo.oab_estado) {
      throw new Error('oab_numero e oab_estado são obrigatórios');
    }
    semente = `${corpo.oab_numero}/${corpo.oab_estado.toUpperCase()}`;
    origem = 'escavador_oab';
    urlInicial = `${ESCAVADOR_BASE}/advogado/processos`
      + `?oab_numero=${encodeURIComponent(corpo.oab_numero)}`
      + `&oab_estado=${encodeURIComponent(corpo.oab_estado.toUpperCase())}`
      + `&limit=100`;
  } else if (action === 'varrer_nome') {
    // Busca por nome de empresa ré. Menos precisa que CNPJ — casa por
    // similaridade e pode trazer homônimo de outro ramo. É o caminho quando
    // não se tem o CNPJ; havendo CNPJ, preferir varrer_cnpj.
    const nome = (corpo.nome || '').trim();
    if (nome.length < 4) throw new Error('nome muito curto (mínimo 4 caracteres)');
    semente = nome;
    origem = 'escavador_nome';
    urlInicial = `${ESCAVADOR_BASE}/processos/buscar?nome=${encodeURIComponent(nome)}`;
  } else {
    const limpo = (corpo.cnpj || '').replace(/\D/g, '');
    if (limpo.length !== 14) throw new Error('cnpj inválido (esperado 14 dígitos)');
    semente = limpo;
    origem = 'escavador_cnpj';
    urlInicial = `${ESCAVADOR_BASE}/processos/cnpj/${limpo}`;
  }

  const { processos, consultas, truncado } = await paginar(urlInicial, token, maxConsultas);
  const { candidatos, semValor, foraDoAssunto } = filtrarCandidatos(processos, { valorMinimo });

  let gravados = 0;
  if (!dryRun && candidatos.length) {
    const db = clienteExterno();
    const mapa = await gravarCandidatos(db, candidatos, origem, semente);
    gravados = mapa.size;
  }

  return {
    action,
    semente,
    dry_run: dryRun,
    consultas_pagas: consultas,
    // truncado=true significa que SOBROU processo não lido: o teto de consultas
    // cortou antes do fim. Não é "varreu tudo" — chamar de novo com
    // max_consultas maior se quiser o resto.
    truncado_pelo_teto: truncado,
    processos_lidos: processos.length,
    candidatos: candidatos.length,
    descartados: { sem_valor_de_causa: semValor, fora_do_assunto: foraDoAssunto },
    gravados,
    // `polo_ativo` sai da amostra de propósito: é o nome do trabalhador
    // acidentado. O schema já não guarda esse campo (ver a nota de minimização
    // na migration); devolvê-lo aqui só o jogaria no log de quem invoca, com a
    // mesma finalidade nenhuma. Quem decide a semente precisa de CNJ, valor,
    // assunto e ré — não do nome da vítima.
    amostra: candidatos.slice(0, 5).map(({ polo_ativo: _ignorado, ...resto }) => resto),
  };
}

async function resolverAdvogados(corpo: Corpo, token: string) {
  const limite = Math.min(Math.max(1, Number(corpo.limit ?? 10)), MAX_RESOLVER_TETO);
  const dryRun = corpo.dry_run !== false;
  const db = clienteExterno();

  // Processos gravados que ainda não têm advogado vinculado.
  const { data: jaVinculados, error: e1 } = await db
    .from('prospect_processo_advogado')
    .select('processo_id');
  if (e1) throw new Error(`leitura de vínculos: ${e1.message}`);
  const vinculados = new Set(
    (jaVinculados ?? []).map((r: { processo_id: string }) => r.processo_id),
  );

  const { data: processos, error: e2 } = await db
    .from('prospect_processos')
    .select('id, numero_cnj')
    .order('valor_causa', { ascending: false })
    .limit(500);
  if (e2) throw new Error(`leitura de processos: ${e2.message}`);

  const todos = (processos ?? []) as ProcessoGravado[];
  const naoVinculados = todos.filter((p) => !vinculados.has(p.id));
  const pendentes = naoVinculados.slice(0, limite);

  const resultado: Array<Record<string, unknown>> = [];
  let consultas = 0;

  for (const p of pendentes) {
    const url = `${ESCAVADOR_BASE}/processos/numero_cnj/${encodeURIComponent(p.numero_cnj)}/envolvidos`;
    let advs: ReturnType<typeof extrairAdvogadosPoloAtivo> = [];
    try {
      const data = await escavador(url, token);
      consultas++;
      advs = extrairAdvogadosPoloAtivo(itensDeResposta<EnvolvidoProcesso>(data));
    } catch (err) {
      resultado.push({
        numero_cnj: p.numero_cnj,
        erro: err instanceof Error ? err.message : String(err),
      });
      await dormir(PAUSA_MS);
      continue;
    }

    if (!dryRun && advs.length) {
      for (const a of advs) {
        // Upsert por OAB. Sem OAB não dá para deduplicar com segurança, então
        // grava assim mesmo — o índice único é parcial justamente por isso.
        const { data: adv, error: eAdv } = await db
          .from('prospect_advogados')
          .upsert(
            { nome: a.nome, oab_numero: a.oab_numero, oab_uf: a.oab_uf },
            { onConflict: 'oab_numero,oab_uf', ignoreDuplicates: false },
          )
          .select('id')
          .maybeSingle();
        if (eAdv || !adv) continue;

        await db
          .from('prospect_processo_advogado')
          .upsert({ processo_id: p.id, advogado_id: adv.id });
      }
    }

    resultado.push({
      numero_cnj: p.numero_cnj,
      advogados_polo_ativo: advs.length,
      // Contato NUNCA vem daqui: o Escavador não devolve e-mail nem telefone.
      // Fica nulo até um enriquecimento explícito, e o disparo pula quem é nulo.
      advogados: advs,
    });
    await dormir(PAUSA_MS);
  }

  return {
    action: 'resolver_advogados',
    dry_run: dryRun,
    consultas_pagas: consultas,
    processos_pendentes_restantes: Math.max(
      0,
      naoVinculados.length - pendentes.length,
    ),
    resolvidos: resultado.length,
    resultado,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    // Esta função GASTA cota paga do Escavador. Só quem tem o segredo dispara.
    if (!segredoConfere(req)) {
      return json({ success: false, error: 'forbidden' }, 403);
    }

    const token = Deno.env.get('ESCAVADOR_API_TOKEN');
    if (!token) return json({ success: false, error: 'ESCAVADOR_API_TOKEN não configurado' });

    const corpo: Corpo = await req.json().catch(() => ({}));

    switch (corpo.action) {
      case 'varrer_oab':
      case 'varrer_cnpj':
      case 'varrer_nome':
        return json({ success: true, data: await varrer(corpo, token) });
      case 'resolver_advogados':
        return json({ success: true, data: await resolverAdvogados(corpo, token) });
      default:
        return json({
          success: false,
          error: 'Ação inválida. Use: varrer_oab, varrer_cnpj, varrer_nome, resolver_advogados',
        });
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('prospectar-acidente-trabalho:', msg);
    return json({ success: false, error: msg });
  }
});
