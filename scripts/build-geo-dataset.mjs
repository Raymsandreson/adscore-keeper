// Gera src/lib/geo/data/municipios.json a partir das APIs públicas do IBGE.
//
// Rodar: node scripts/build-geo-dataset.mjs
//
// Fontes (ambas oficiais, sem chave e sem custo):
//   - /api/v1/localidades/municipios                       -> código, nome e UF dos 5.571 municípios
//   - /api/v3/malhas/estados/{uf}/metadados?intrarregiao=municipio
//                                                          -> centroide oficial de cada município (27 requests)
//
// O resultado é commitado no repo. Só precisa rodar de novo quando o IBGE mudar
// a malha municipal (criação/fusão de município), o que acontece a cada poucos anos.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAIDA = path.join(RAIZ, 'src/lib/geo/data/municipios.json');
const BASE = 'https://servicodados.ibge.gov.br/api';

async function buscar(url, tentativas = 3) {
  for (let i = 1; i <= tentativas; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      if (i === tentativas) throw new Error(`${url} falhou: ${e.message}`);
      await new Promise((r) => setTimeout(r, 1000 * i));
    }
  }
}

const ufDe = (m) =>
  m.microrregiao?.mesorregiao?.UF ?? m.regiaoImediata?.regiaoIntermediaria?.UF ?? m['regiao-imediata']?.['regiao-intermediaria']?.UF;

async function main() {
  console.log('Baixando lista de municípios...');
  const municipios = await buscar(`${BASE}/v1/localidades/municipios`);
  console.log(`  ${municipios.length} municípios`);

  const estados = await buscar(`${BASE}/v1/localidades/estados`);
  console.log(`Baixando centroides de ${estados.length} UFs...`);

  const centroides = new Map();
  for (const uf of estados) {
    const meta = await buscar(`${BASE}/v3/malhas/estados/${uf.id}/metadados?intrarregiao=municipio`);
    for (const m of meta) {
      if (m.centroide) centroides.set(String(m.id), m.centroide);
    }
    process.stdout.write(`  ${uf.sigla} (${meta.length})\n`);
  }

  const linhas = [];
  const semCentroide = [];
  for (const m of municipios) {
    const uf = ufDe(m);
    if (!uf) continue;
    const c = centroides.get(String(m.id));
    if (!c) {
      // Município novo demais para ter malha no IBGE (a API devolve 500). Entra no
      // índice mesmo assim, com coordenada nula: o nome precisa ser reconhecido como
      // município válido, senão a lib o classifica como "cidade inexistente" — que é
      // um diagnóstico errado. Sem ponto, a resolução cai no nível de UF.
      semCentroide.push(`${m.id} ${m.nome}/${uf.sigla}`);
      linhas.push([m.id, m.nome, uf.sigla, null, null]);
      continue;
    }
    // [código IBGE, nome, sigla da UF, lat, lng] — 4 casas decimais ≈ 11 m, de sobra
    linhas.push([m.id, m.nome, uf.sigla, Number(c.latitude.toFixed(4)), Number(c.longitude.toFixed(4))]);
  }

  linhas.sort((a, b) => a[0] - b[0]);

  fs.mkdirSync(path.dirname(SAIDA), { recursive: true });
  // Uma linha por município: diff legível no git sem inflar o arquivo.
  const corpo = linhas.map((l) => '  ' + JSON.stringify(l)).join(',\n');
  fs.writeFileSync(SAIDA, `[\n${corpo}\n]\n`, 'utf8');

  const kb = (fs.statSync(SAIDA).size / 1024).toFixed(0);
  console.log(`\nGravado ${SAIDA}`);
  console.log(`  ${linhas.length} municípios, ${kb} KB`);
  if (semCentroide.length) {
    console.log(`  AVISO: ${semCentroide.length} sem centroide: ${semCentroide.slice(0, 10).join(', ')}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
