#!/usr/bin/env node
/**
 * Importa os ZIPs de CAT do dados abertos INSS/Dataprev para public.cat_acidentes.
 *
 * Uso:
 *   SUPABASE_URL=https://<ref>.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=<key> \
 *   node scripts/importar-cat-dataprev.mjs /caminho/para/pasta-com-zips [--dry-run] [--so=202601]
 *
 * Características:
 *   - Idempotente: recarregar a mesma competência não duplica (unique em hash_linha).
 *   - Retomável: cat_import_runs registra o que já entrou; competência 'ok' é pulada.
 *   - Streaming: usa `unzip -p` e processa linha a linha, sem carregar o CSV em memória.
 *     Os arquivos maiores passam de 90 MB descompactados — ler inteiro estouraria a RAM.
 *   - Sem dependência nova: só @supabase/supabase-js, que já está no package.json.
 *
 * Requer o binário `unzip` no PATH.
 */

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const LOTE = 2000; // linhas por insert

// preenchidos em main(); ficam no escopo do módulo para não passar por 6 funções
let pasta = null;
let dryRun = false;
let soCompetencia = null;
let db = null;

/** '{ñ class}', 'Ignorado', 'Zerado' e vazio significam "não classificado" na origem. */
const NAO_CLASSIFICADO = new Set(['', '{ñ class}', '{n class}', 'Ignorado', 'Zerado']);

function txt(v) {
  const s = (v ?? '').trim();
  return NAO_CLASSIFICADO.has(s) ? null : s;
}

/** dd/mm/aaaa -> Date ISO. '00/00/0000' e datas inválidas viram null. */
function data(v) {
  const s = (v ?? '').trim();
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (!m) return null;
  const [, d, mes, ano] = m;
  if (d === '00' || mes === '00' || ano === '0000') return null;
  const iso = `${ano}-${mes}-${d}`;
  const dt = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(dt.getTime()) || dt.getUTCDate() !== Number(d)) return null;
  return iso;
}

function booleano(v) {
  const s = (v ?? '').trim().toLowerCase();
  if (s.startsWith('sim')) return true;
  if (s.startsWith('n')) return false; // "Não"
  return null;
}

/** '353080-Moji-Mirim' -> { codigo: '353080', nome: 'Moji-Mirim' } */
function municipio(v) {
  const s = (v ?? '').trim();
  const i = s.indexOf('-');
  if (i < 0) return { codigo: null, nome: txt(s) };
  return { codigo: txt(s.slice(0, i)), nome: txt(s.slice(i + 1)) };
}

function digitos(v) {
  const s = (v ?? '').replace(/\D/g, '');
  return s === '' ? null : s;
}

export function mapear(linha, competencia, arquivo) {
  const c = linha.split(';');
  if (c.length < 27) return null;

  const mun = municipio(c[12]);
  return {
    competencia,
    arquivo_origem: arquivo,
    agente_causador: txt(c[0]),
    cbo_codigo: txt(c[2]),
    cbo_descricao: txt(c[3]),
    cid10_codigo: txt(c[4]),
    cid10_descricao: txt(c[5]),
    cnae_codigo: txt(c[6]),
    cnae_descricao: txt(c[7]),
    emitente_cat: txt(c[8]),
    especie_beneficio: txt(c[9]),
    filiacao_segurado: txt(c[10]),
    indica_obito: booleano(c[11]),
    municipio_empregador_codigo: mun.codigo,
    municipio_empregador_nome: mun.nome,
    natureza_lesao: txt(c[13]),
    origem_cadastramento: txt(c[14]),
    parte_corpo_atingida: txt(c[15]),
    sexo: txt(c[16]),
    tipo_acidente: txt(c[17]),
    uf_municipio_acidente: txt(c[18]),
    uf_municipio_empregador: txt(c[19]),
    data_afastamento: data(c[20]),
    data_despacho_beneficio: data(c[21]),
    data_acidente: data(c[1]) ?? data(c[22]), // col 1 e col 22 são a mesma data na origem
    data_nascimento: data(c[23]),
    data_emissao_cat: data(c[24]),
    tipo_empregador: txt(c[25]),
    cnpj_cei_empregador: digitos(c[26]),
    hash_linha: createHash('md5').update(`${competencia}|${linha}`).digest('hex'),
  };
}

async function gravar(lote) {
  if (dryRun || lote.length === 0) return lote.length;
  const { error } = await db
    .from('cat_acidentes')
    .upsert(lote, { onConflict: 'hash_linha', ignoreDuplicates: true });
  if (error) throw new Error(`insert falhou: ${error.message}`);
  return lote.length;
}

async function marcar(competencia, campos) {
  if (dryRun) return;
  const { error } = await db
    .from('cat_import_runs')
    .upsert({ competencia, ...campos, updated_at: new Date().toISOString() }, { onConflict: 'competencia' });
  if (error) console.warn(`  aviso: não consegui atualizar cat_import_runs: ${error.message}`);
}

async function jaImportadas() {
  if (dryRun) return new Set();
  const { data: linhas, error } = await db
    .from('cat_import_runs')
    .select('competencia')
    .eq('status', 'ok');
  if (error) throw new Error(`não consegui ler cat_import_runs: ${error.message}`);
  return new Set((linhas ?? []).map((l) => l.competencia));
}

async function processarZip(zipPath, competencia) {
  const arquivo = path.basename(zipPath).replace(/\.zip$/i, '.csv');
  // -p escreve na stdout; o glob pega só o CSV (o ZIP traz também .json e .xml do mesmo dado)
  const proc = spawn('unzip', ['-p', zipPath, '*.csv'], { stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout.setEncoding('latin1'); // origem NÃO é UTF-8

  let erroProc = '';
  proc.stderr.on('data', (d) => { erroProc += d.toString(); });

  const rl = createInterface({ input: proc.stdout, crlfDelay: Infinity });

  let lote = [];
  let lidas = 0;
  let inseridas = 0;
  let ignoradas = 0;
  let primeira = true;

  for await (const linha of rl) {
    if (primeira) { primeira = false; continue; } // cabeçalho
    if (linha.trim() === '') continue;
    lidas++;

    const row = mapear(linha, competencia, arquivo);
    if (!row) { ignoradas++; continue; }

    lote.push(row);
    if (lote.length >= LOTE) {
      inseridas += await gravar(lote);
      lote = [];
      process.stdout.write(`\r  ${arquivo}: ${lidas} linhas lidas...`);
    }
  }
  inseridas += await gravar(lote);

  const code = await new Promise((res) => proc.on('close', res));
  if (code !== 0) throw new Error(`unzip saiu com código ${code}: ${erroProc.trim()}`);

  process.stdout.write('\r');
  return { lidas, inseridas, ignoradas };
}

async function main() {
  const args = process.argv.slice(2);
  pasta = args.find((a) => !a.startsWith('--'));
  dryRun = args.includes('--dry-run');
  soCompetencia = args.find((a) => a.startsWith('--so='))?.slice(5) ?? null;

  if (!pasta) {
    console.error('Falta o caminho da pasta com os ZIPs.');
    process.exit(1);
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!dryRun && (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY)) {
    console.error('Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY (ou rode com --dry-run).');
    process.exit(1);
  }
  if (!dryRun) {
    // import dinâmico: --dry-run e os testes de mapeamento não precisam do SDK
    const { createClient } = await import('@supabase/supabase-js');
    db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  }

  const zips = readdirSync(pasta)
    .filter((f) => /\.zip$/i.test(f) && /CAT\.(\d{6})/i.test(f))
    .sort();

  if (zips.length === 0) {
    console.error(`Nenhum ZIP de CAT encontrado em ${pasta}`);
    process.exit(1);
  }

  const prontas = await jaImportadas();
  console.log(`${zips.length} arquivos encontrados. ${prontas.size} competências já importadas.`);
  if (dryRun) console.log('MODO DRY-RUN: nada será gravado.\n');

  let totalLidas = 0;
  let totalInseridas = 0;

  for (const nome of zips) {
    const aaaamm = /CAT\.(\d{6})/i.exec(nome)[1];
    if (soCompetencia && aaaamm !== soCompetencia) continue;

    const competencia = `${aaaamm.slice(0, 4)}-${aaaamm.slice(4)}-01`;
    if (prontas.has(competencia)) {
      console.log(`- ${nome}: já importado, pulando.`);
      continue;
    }

    const arquivo = nome.replace(/\.zip$/i, '.csv');
    await marcar(competencia, { arquivo_origem: arquivo, status: 'processando', iniciado_em: new Date().toISOString(), erro: null });

    try {
      const r = await processarZip(path.join(pasta, nome), competencia);
      totalLidas += r.lidas;
      totalInseridas += r.inseridas;
      await marcar(competencia, {
        arquivo_origem: arquivo,
        status: 'ok',
        linhas_arquivo: r.lidas,
        linhas_inseridas: r.inseridas,
        concluido_em: new Date().toISOString(),
      });
      console.log(`+ ${nome}: ${r.lidas} linhas, ${r.inseridas} gravadas${r.ignoradas ? `, ${r.ignoradas} malformadas` : ''}.`);
    } catch (e) {
      await marcar(competencia, { arquivo_origem: arquivo, status: 'erro', erro: String(e.message ?? e) });
      console.error(`! ${nome}: ${e.message ?? e}`);
    }
  }

  console.log(`\nTotal: ${totalLidas} linhas lidas, ${totalInseridas} gravadas.`);
  if (!dryRun) {
    console.log('\nAgora atualize a view materializada:');
    console.log('  refresh materialized view concurrently public.mv_cat_padrao_empresa;');
  }
}

// só executa quando chamado direto — permite importar mapear() em testes
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
