#!/usr/bin/env node --experimental-strip-types
// =============================================================================
// Radar de empresa pela linha de comando — processos de um CNPJ (ou de toda a
// raiz) no Escavador, por ano e por matéria (acidente / doença do trabalho).
//
// É a MESMA regra da tela (/processual/jurimetria-empresa): classificação,
// agregação e cálculo de dígito verificador vêm de src/lib/processosDaEmpresa.ts.
// Este arquivo só cuida de rede, argumentos e impressão — se a regra mudar,
// muda nos dois ao mesmo tempo.
//
// USO (Node 22.6+ precisa da flag; Node 23+ não):
//   ESCAVADOR_API_TOKEN=xxx node --experimental-strip-types \
//     scripts/escavador-processos-por-cnpj.mjs 01588098000102
//   npm run radar:empresa -- 01588098000102 --raiz --ate-ordem 80 --out /tmp/atlantica
//
// FLAGS:
//   --raiz              varre a raiz do CNPJ (matriz + filiais)
//   --ate-ordem N       última filial da varredura (default 20)
//   --max-paginas N     trava de custo por CNPJ (default 20)
//   --via-edge          usa a edge search-escavador em vez do token local
//   --out DIR           grava processos.json, processos.csv e por-ano.csv
//
// CUSTO: cada página é consulta paga. O script diz quantos CNPJs vai consultar
// antes de começar e avisa quando parou numa trava — nunca trunca calado.
// =============================================================================
import {
  agregarPorAno, cnpjValido, cnpjsDaRaiz, csvPorAno, csvProcessos, formatarCnpj,
  itensDaResposta, limparCnpj, mapearProcessoDaEmpresa, percentualAcidentarios,
  proximaPagina, raizDoCnpj, totalizar, unificarPorProcesso,
} from '../src/lib/processosDaEmpresa.ts';

const ESCAVADOR_BASE = 'https://api.escavador.com/api/v2';
const log = (m) => console.error(m);

/** Uma página, direto na API v2. */
async function pagirDireto(url, token) {
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  const corpo = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(`Escavador ${resp.status}: ${corpo?.message || corpo?.error || 'erro'}`);
  return corpo;
}

/** Uma página, pela edge (o token fica no servidor). */
async function pagirViaEdge(cnpj, cursor) {
  const base = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!base || !key) throw new Error('VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY não definidos');
  const resp = await fetch(`${base}/functions/v1/search-escavador`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ action: 'buscar_por_cpf_cnpj', cpf_cnpj: cnpj, cursor }),
  });
  const corpo = await resp.json().catch(() => ({}));
  if (!corpo?.success) throw new Error(`edge search-escavador: ${corpo?.error || resp.status}`);
  return corpo;
}

async function buscarCnpj(cnpj, { viaEdge, token, maxPaginas }) {
  const processos = [];
  const avisos = [];
  let url = `${ESCAVADOR_BASE}/processos/cnpj/${cnpj}`;
  let cursor = null;
  let pagina = 0;
  // Se a mesma página voltar, é a edge antiga (sem repasse de cursor)
  // devolvendo sempre a primeira — sem esta trava o laço a releria N vezes.
  const jaVistos = new Set();

  while (pagina < maxPaginas) {
    pagina += 1;
    const corpo = viaEdge ? await pagirViaEdge(cnpj, cursor) : await pagirDireto(url, token);
    const itens = itensDaResposta(corpo);
    processos.push(...itens.map((it) => mapearProcessoDaEmpresa(it, cnpj)));
    const proxima = proximaPagina(corpo);
    if (!proxima) return { processos, avisos };
    if (jaVistos.has(proxima)) {
      avisos.push(`${formatarCnpj(cnpj)}: a busca repetiu a mesma página — edge sem repasse de cursor (falta deploy). Só a 1ª página entrou.`);
      return { processos, avisos };
    }
    jaVistos.add(proxima);
    url = proxima;
    cursor = proxima;
  }
  avisos.push(`${formatarCnpj(cnpj)}: parou em ${maxPaginas} página(s) e ainda havia mais — total incompleto`);
  return { processos, avisos };
}

function tabela(linhas) {
  const cab = ['ano', 'total', 'acidente', 'doenca', 'ambos', 'acident.', 'outro', 'sem assunto'];
  const corpo = linhas.map((l) =>
    [l.ano, l.total, l.acidente, l.doenca, l.ambos, l.acidentarios, l.outro, l.indeterminado].map(String));
  const larg = cab.map((c, i) => Math.max(c.length, ...corpo.map((l) => l[i].length)));
  const fmt = (cols) => cols.map((c, i) => String(c).padStart(larg[i])).join('  ');
  return [fmt(cab), fmt(larg.map((n) => '-'.repeat(n))), ...corpo.map(fmt)].join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  const documento = args.find((a) => !a.startsWith('--'));
  if (!documento) {
    console.error('uso: node --experimental-strip-types scripts/escavador-processos-por-cnpj.mjs <CNPJ> [--raiz] [--ate-ordem N] [--max-paginas N] [--via-edge] [--out DIR]');
    process.exit(1);
  }
  const num = (flag, padrao) => {
    const i = args.indexOf(flag);
    return i >= 0 ? Number(args[i + 1]) || padrao : padrao;
  };
  const modoRaiz = args.includes('--raiz');
  const viaEdge = args.includes('--via-edge');
  const maxPaginas = num('--max-paginas', 20);
  const ateOrdem = num('--ate-ordem', 20);
  const out = args.includes('--out') ? args[args.indexOf('--out') + 1] : null;

  const digitos = limparCnpj(documento);
  const raiz = raizDoCnpj(digitos);
  const token = process.env.ESCAVADOR_API_TOKEN;
  if (!viaEdge && !token) throw new Error('ESCAVADOR_API_TOKEN não definido (ou use --via-edge)');

  let alvos;
  if (modoRaiz) {
    if (raiz.length !== 8) throw new Error('informe ao menos os 8 dígitos da raiz');
    alvos = cnpjsDaRaiz(raiz, ateOrdem);
    log(`Raiz ${raiz}: varrendo filiais 0001..${String(ateOrdem).padStart(4, '0')} (${alvos.length} CNPJs).`);
    log('Os CNPJs são gerados pelo dígito verificador — filial que nunca existiu só não devolve processo.');
  } else {
    if (!cnpjValido(digitos)) throw new Error(`CNPJ inválido (dígito verificador não fecha): ${documento}`);
    alvos = [digitos];
  }
  log(`Consultando ${alvos.length} CNPJ(s), até ${maxPaginas} página(s) cada — cada página é consulta paga.\n`);

  const processos = [];
  const avisos = [];
  for (let i = 0; i < alvos.length; i++) {
    const cnpj = alvos[i];
    process.stderr.write(`  [${i + 1}/${alvos.length}] ${formatarCnpj(cnpj)} … `);
    try {
      const r = await buscarCnpj(cnpj, { viaEdge, token, maxPaginas });
      processos.push(...r.processos);
      avisos.push(...r.avisos);
      log(`${r.processos.length} processo(s)`);
    } catch (e) {
      // Falha de um CNPJ não derruba a varredura — vira aviso e a fila segue.
      avisos.push(`${formatarCnpj(cnpj)}: ${e.message}`);
      log(`ERRO (${e.message})`);
    }
  }

  const { processos: unicos, duplicados } = unificarPorProcesso(processos);
  if (duplicados > 0) {
    avisos.push(`${duplicados} processo(s) apareceram por mais de um CNPJ da raiz e foram contados uma vez só.`);
  }
  const linhas = agregarPorAno(unicos);
  const totais = totalizar(linhas);
  const pct = percentualAcidentarios(totais);

  console.log(`\nProcessos encontrados: ${totais.total}`);
  console.log(`\nPor ano (ano = distribuição; "sem_data" = capa sem data):\n`);
  console.log(tabela(linhas));
  console.log(`\nAcidente/doença: ${totais.acidentarios} de ${totais.total - totais.indeterminado} classificados` +
    (pct == null ? '' : ` (${pct.toFixed(1)}%)`) +
    ` · média ${totais.mediaAcidentariosPorAno.toFixed(1)}/ano em ${totais.anos} ano(s)`);
  if (totais.indeterminado > 0) {
    console.log(`${totais.indeterminado} processo(s) vieram SEM assunto/classe na capa — não entram em nenhum dos dois lados.`);
  }
  for (const a of avisos) console.log(`AVISO: ${a}`);

  if (out) {
    const { mkdirSync, writeFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'processos.json'), JSON.stringify(unicos, null, 2));
    writeFileSync(join(out, 'processos.csv'), csvProcessos(unicos));
    writeFileSync(join(out, 'por-ano.csv'), csvPorAno(linhas));
    console.log(`\nGravado em ${out}/ (processos.json, processos.csv, por-ano.csv)`);
  }
}

main().catch((e) => { console.error(`ERRO: ${e.message}`); process.exit(1); });
