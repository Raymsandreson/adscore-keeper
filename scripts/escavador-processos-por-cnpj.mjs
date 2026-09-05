#!/usr/bin/env node
// =============================================================================
// Processos de uma EMPRESA no Escavador, contados por ano e por matéria
// (acidente de trabalho / doença ocupacional).
//
// POR QUE EXISTE: a busca por CNPJ já existia na edge `search-escavador`
// (action `buscar_por_cpf_cnpj`), mas ela devolve UMA página crua. Para
// responder "quantos processos por ano são de acidente ou doença do trabalho"
// é preciso paginar tudo, ler a CAPA de cada processo (assuntos normalizados,
// classe, data de distribuição) e agregar. Este script faz isso.
//
// NÃO adivinha: processo cuja capa veio sem assunto/classe entra em
// INDETERMINADO e aparece no relatório como tal — nunca é somado como "não é
// acidente". Diluir o que não se sabe num "não" é o mesmo erro que capar valor
// improvável na tela (CLAUDE.md, processo e rigor, item 8).
//
// USO:
//   ESCAVADOR_API_TOKEN=xxx node scripts/escavador-processos-por-cnpj.mjs 01588098000102
//   # sem token local, passando pela edge (usa VITE_SUPABASE_* do .env):
//   node scripts/escavador-processos-por-cnpj.mjs 01588098000102 --via-edge
//
// FLAGS:
//   --via-edge          chama a edge search-escavador em vez da API direta
//   --max-paginas N     trava de custo (default 20)
//   --out DIR           grava processos.json + por-ano.csv em DIR
//
// CUSTO: cada página é consulta paga no Escavador. Com limite default de 20
// páginas o script para sozinho e diz que parou — não gasta em silêncio.
// =============================================================================

const ESCAVADOR_BASE = 'https://api.escavador.com/api/v2';

// ---------------------------------------------------------------------------
// Classificação
// ---------------------------------------------------------------------------

/**
 * Termos de ACIDENTE. "acidente de trabalho" é assunto CNJ próprio e aparece
 * tanto na Justiça do Trabalho (indenização) quanto na Estadual (acidentária
 * do INSS). Trajeto entra porque é acidente de trabalho por equiparação
 * (Lei 8.213/91, art. 21, IV, "d").
 */
const TERMOS_ACIDENTE = [
  'acidente de trabalho',
  'acidente do trabalho',
  'acidente de trajeto',
  'acidente in itinere',
  'acidentaria',
  'acidentario',
];

/**
 * Termos de DOENÇA ocupacional. LER/DORT e PAIR (perda auditiva induzida por
 * ruído) entram por serem as doenças do trabalho mais nomeadas assim na capa,
 * em vez de "doença ocupacional".
 */
const TERMOS_DOENCA = [
  'doenca ocupacional',
  'doenca profissional',
  'doenca do trabalho',
  'molestia profissional',
  'ler/dort',
  'ler-dort',
  'ler dort',
  'perda auditiva induzida',
  'pair ',
];

/** Tira acento e caixa — a capa vem com grafia inconsistente entre tribunais. */
export function normalizar(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Classifica UM processo já mapeado.
 * @returns {'ACIDENTE'|'DOENCA'|'AMBOS'|'OUTRO'|'INDETERMINADO'}
 */
export function classificarProcesso({ assuntos, assunto_principal, classe }) {
  const campos = [
    ...(Array.isArray(assuntos) ? assuntos : []),
    assunto_principal,
    classe,
  ].filter(Boolean);

  // Sem nenhum campo de matéria a capa não permite dizer nada. Chutar "OUTRO"
  // aqui é o que produziria um número bonito e errado.
  if (campos.length === 0) return 'INDETERMINADO';

  const texto = normalizar(campos.join(' | '));
  const temAcidente = TERMOS_ACIDENTE.some((t) => texto.includes(t));
  const temDoenca = TERMOS_DOENCA.some((t) => texto.includes(t));

  if (temAcidente && temDoenca) return 'AMBOS';
  if (temAcidente) return 'ACIDENTE';
  if (temDoenca) return 'DOENCA';
  return 'OUTRO';
}

/** Ano de referência: distribuição > início > ano_inicio. */
export function anoDoProcesso(p) {
  const data = p.data_distribuicao || p.data_inicio || null;
  if (data && /^\d{4}/.test(String(data))) return String(data).slice(0, 4);
  if (p.ano_inicio) return String(p.ano_inicio);
  return 'sem_data';
}

/** Agrega a lista classificada em linhas por ano. */
export function agregarPorAno(processos) {
  const porAno = new Map();
  for (const p of processos) {
    const ano = anoDoProcesso(p);
    if (!porAno.has(ano)) {
      porAno.set(ano, {
        ano, total: 0, acidente: 0, doenca: 0, ambos: 0, outro: 0, indeterminado: 0,
      });
    }
    const linha = porAno.get(ano);
    linha.total += 1;
    if (p.materia === 'ACIDENTE') linha.acidente += 1;
    else if (p.materia === 'DOENCA') linha.doenca += 1;
    else if (p.materia === 'AMBOS') linha.ambos += 1;
    else if (p.materia === 'OUTRO') linha.outro += 1;
    else linha.indeterminado += 1;
  }
  return [...porAno.values()].sort((a, b) => a.ano.localeCompare(b.ano));
}

// ---------------------------------------------------------------------------
// Mapeamento da capa (espelha supabase/functions/_shared/escavadorCapa.ts)
// ---------------------------------------------------------------------------

const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const txt = (v) => {
  const s = typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '';
  return s || null;
};

/** Item da busca → só os campos que este relatório usa. */
export function mapearProcesso(raw) {
  const fontes = Array.isArray(raw?.fontes) ? raw.fontes : [];
  const fonte = obj(fontes[0]);
  const capa = obj(fonte.capa);
  const assuntos = Array.isArray(capa.assuntos_normalizados)
    ? capa.assuntos_normalizados.map((a) => txt(a?.nome)).filter(Boolean)
    : [];

  const p = {
    numero_cnj: txt(raw?.numero_cnj),
    titulo_polo_ativo: txt(raw?.titulo_polo_ativo),
    titulo_polo_passivo: txt(raw?.titulo_polo_passivo),
    classe: txt(capa.classe) ?? txt(obj(fonte.classe).nome),
    area: txt(capa.area) ?? txt(obj(fonte.area).nome),
    assunto_principal: txt(obj(capa.assunto_principal_normalizado).nome) ?? txt(capa.assunto),
    assuntos,
    tribunal_sigla: txt(obj(fonte.tribunal).sigla) ?? txt(fonte.sigla),
    data_distribuicao: txt(capa.data_distribuicao),
    data_inicio: txt(raw?.data_inicio) ?? txt(fonte.data_inicio),
    ano_inicio: raw?.ano_inicio ?? null,
  };
  p.materia = classificarProcesso(p);
  return p;
}

// ---------------------------------------------------------------------------
// Busca paginada
// ---------------------------------------------------------------------------

function itensDa(resposta) {
  const d = resposta?.data ?? resposta;
  if (Array.isArray(d?.items)) return d.items;
  if (Array.isArray(d?.data)) return d.data;
  if (Array.isArray(d)) return d;
  return [];
}

function proximaPagina(resposta) {
  const d = resposta?.data ?? resposta;
  // A v2 devolve a próxima página em links.next (URL inteira). Seguir a URL
  // literal evita ter que reconstruir os parâmetros de cobrança (`li`), que é
  // exatamente onde a ação de OAB já tropeçou (ver search-escavador/index.ts).
  return txt(d?.links?.next) ?? txt(d?.next_page_url) ?? null;
}

async function buscarDireto(cnpjLimpo, maxPaginas, log) {
  const token = process.env.ESCAVADOR_API_TOKEN;
  if (!token) throw new Error('ESCAVADOR_API_TOKEN não definido (ou use --via-edge)');

  let url = `${ESCAVADOR_BASE}/processos/cnpj/${cnpjLimpo}`;
  const itens = [];
  let pagina = 0;

  while (url && pagina < maxPaginas) {
    pagina += 1;
    log(`  página ${pagina}: GET ${url}`);
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    const corpo = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      throw new Error(`Escavador ${resp.status}: ${corpo?.message || corpo?.error || 'erro'}`);
    }
    itens.push(...itensDa(corpo));
    url = proximaPagina(corpo);
  }
  return { itens, truncado: Boolean(url), paginas: pagina };
}

async function buscarViaEdge(cnpjLimpo, maxPaginas, log) {
  const base = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!base || !key) throw new Error('VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY não definidos');

  const itens = [];
  let cursor = null;
  let pagina = 0;
  let proxima = null;

  do {
    pagina += 1;
    log(`  página ${pagina} via edge search-escavador`);
    const resp = await fetch(`${base}/functions/v1/search-escavador`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ action: 'buscar_por_cpf_cnpj', cpf_cnpj: cnpjLimpo, cursor }),
    });
    const corpo = await resp.json().catch(() => ({}));
    if (!corpo?.success) throw new Error(`edge search-escavador: ${corpo?.error || resp.status}`);
    itens.push(...itensDa(corpo));
    proxima = proximaPagina(corpo);
    cursor = proxima;
  } while (proxima && pagina < maxPaginas);

  return { itens, truncado: Boolean(proxima), paginas: pagina };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function tabela(linhas) {
  const cab = ['ano', 'total', 'acidente', 'doenca', 'ambos', 'outro', 'indeterm.'];
  const larg = cab.map((c) => c.length);
  const corpo = linhas.map((l) => [l.ano, l.total, l.acidente, l.doenca, l.ambos, l.outro, l.indeterminado].map(String));
  for (const linha of corpo) linha.forEach((c, i) => { larg[i] = Math.max(larg[i], c.length); });
  const fmt = (cols) => cols.map((c, i) => String(c).padStart(larg[i])).join('  ');
  return [fmt(cab), fmt(larg.map((n) => '-'.repeat(n))), ...corpo.map(fmt)].join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  const cnpj = args.find((a) => !a.startsWith('--'));
  if (!cnpj) {
    console.error('uso: node scripts/escavador-processos-por-cnpj.mjs <CNPJ> [--via-edge] [--max-paginas N] [--out DIR]');
    process.exit(1);
  }
  const viaEdge = args.includes('--via-edge');
  const maxPaginas = Number(args[args.indexOf('--max-paginas') + 1]) || 20;
  const out = args.includes('--out') ? args[args.indexOf('--out') + 1] : null;
  const cnpjLimpo = cnpj.replace(/\D/g, '');
  const log = (m) => console.error(m);

  log(`CNPJ ${cnpjLimpo} — buscando ${viaEdge ? 'via edge' : 'direto na API v2'} (máx. ${maxPaginas} páginas)`);
  const { itens, truncado, paginas } = viaEdge
    ? await buscarViaEdge(cnpjLimpo, maxPaginas, log)
    : await buscarDireto(cnpjLimpo, maxPaginas, log);

  const processos = itens.map(mapearProcesso);
  const linhas = agregarPorAno(processos);

  const soma = (k) => linhas.reduce((s, l) => s + l[k], 0);
  console.log(`\nProcessos encontrados: ${processos.length} (em ${paginas} página(s))`);
  if (truncado) {
    console.log(`ATENÇÃO: parou no limite de ${maxPaginas} páginas — há MAIS processos. Rode com --max-paginas maior.`);
  }
  console.log('\nPor ano (ano = data de distribuição; "sem_data" = capa sem data):\n');
  console.log(tabela(linhas));
  console.log(`\nTotais: acidente=${soma('acidente')} doenca=${soma('doenca')} ambos=${soma('ambos')} outro=${soma('outro')} indeterminado=${soma('indeterminado')}`);
  if (soma('indeterminado') > 0) {
    console.log(`\n${soma('indeterminado')} processo(s) vieram SEM assunto/classe na capa — não dá para dizer se são de acidente/doença sem abrir cada um (GET /processos/numero_cnj/{cnj}). Não foram contados como "outro".`);
  }

  if (out) {
    const { mkdirSync, writeFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'processos.json'), JSON.stringify(processos, null, 2));
    const csv = ['ano,total,acidente,doenca,ambos,outro,indeterminado',
      ...linhas.map((l) => [l.ano, l.total, l.acidente, l.doenca, l.ambos, l.outro, l.indeterminado].join(','))].join('\n');
    writeFileSync(join(out, 'por-ano.csv'), csv + '\n');
    console.log(`\nGravado em ${out}/processos.json e ${out}/por-ano.csv`);
  }
}

// Só roda como CLI; importar o módulo (testes) não dispara consulta paga.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(`ERRO: ${e.message}`); process.exit(1); });
}
