// Gera src/lib/geo/data/uf-malhas.json — a silhueta das 27 UFs, para desenhar
// mapa sem tile e sem rede.
//
// Rodar: node scripts/build-geo-malhas.mjs
//
// Fonte: /api/v3/malhas/estados/{uf}?qualidade=minima (GeoJSON, pública, sem chave).
//
// Por que embarcar no repo em vez de buscar em runtime: o kanban renderiza 100+
// cards e cada um desenha a silhueta do estado do lead. Buscar por card seriam
// 100+ requests ao IBGE a cada rolagem. Embarcado, tudo resolve em memória.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAIDA = path.join(RAIZ, 'src/lib/geo/data/uf-malhas.json');
const BASE = 'https://servicodados.ibge.gov.br/api';

/** 3 casas ≈ 110 m: invisível numa miniatura e economiza ~40% do arquivo. */
const CASAS = 3;

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

const arredondar = (n) => Number(n.toFixed(CASAS));

/** Remove pontos consecutivos que colapsam no mesmo lugar depois do arredondamento. */
function limparAnel(ring) {
  const saida = [];
  for (const [lng, lat] of ring) {
    const ponto = [arredondar(lng), arredondar(lat)];
    const ultimo = saida[saida.length - 1];
    if (!ultimo || ultimo[0] !== ponto[0] || ultimo[1] !== ponto[1]) saida.push(ponto);
  }
  return saida;
}

/** Só os anéis externos: é silhueta, não mapa temático — buraco interno não muda o contorno. */
function extrairAneis(geometry) {
  if (geometry.type === 'Polygon') return [geometry.coordinates[0]];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.map((p) => p[0]);
  throw new Error(`geometria inesperada: ${geometry.type}`);
}

async function main() {
  const estados = await buscar(`${BASE}/v1/localidades/estados`);
  console.log(`Baixando malha de ${estados.length} UFs...`);

  const saida = {};
  for (const uf of estados.sort((a, b) => a.sigla.localeCompare(b.sigla))) {
    const geo = await buscar(
      `${BASE}/v3/malhas/estados/${uf.id}?formato=application/vnd.geo+json&qualidade=minima`,
    );

    const aneis = geo.features
      .flatMap((f) => extrairAneis(f.geometry))
      .map(limparAnel)
      // Ilhotas com 3 pontos viram ruído visual numa miniatura de 48 px.
      .filter((r) => r.length >= 4);

    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
    for (const anel of aneis) {
      for (const [lng, lat] of anel) {
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
    }

    saida[uf.sigla] = {
      bbox: [minLng, minLat, maxLng, maxLat],
      rings: aneis,
    };

    const pontos = aneis.reduce((s, r) => s + r.length, 0);
    process.stdout.write(`  ${uf.sigla}: ${aneis.length} anéis, ${pontos} pontos\n`);
  }

  fs.mkdirSync(path.dirname(SAIDA), { recursive: true });
  fs.writeFileSync(SAIDA, JSON.stringify(saida), 'utf8');

  const kb = (fs.statSync(SAIDA).size / 1024).toFixed(0);
  console.log(`\nGravado ${SAIDA} — ${Object.keys(saida).length} UFs, ${kb} KB`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
