import type { LatLng, Uf } from './types';

export interface UfShape {
  /** [minLng, minLat, maxLng, maxLat] */
  bbox: [number, number, number, number];
  /** Anéis externos, em [lng, lat]. */
  rings: [number, number][][];
}

export type UfShapes = Record<string, UfShape>;

export interface ProjectedShapes {
  /** Um `d` de <path> por UF, na ordem pedida. */
  paths: { uf: Uf; d: string }[];
  /** Converte coordenada geográfica no mesmo espaço dos paths. */
  project: (point: LatLng) => { x: number; y: number };
  width: number;
  height: number;
}

const DEG_TO_RAD = Math.PI / 180;

/**
 * Projeta uma ou mais UFs num quadro de `size` × `size`, preservando a proporção.
 *
 * Usa equirretangular com correção pelo cosseno da latitude média: sem ela, um
 * grau de longitude e um de latitude teriam a mesma largura na tela e os estados
 * sairiam esticados no sentido leste-oeste (no Brasil, entre 5% e 30%, conforme
 * a latitude). Mercator seria exagero para uma silhueta deste tamanho.
 */
export function projectUfs(ufs: Uf[], shapes: UfShapes, size: number, padding = 2): ProjectedShapes {
  const present = ufs.filter((uf) => shapes[uf]);

  if (present.length === 0) {
    return { paths: [], project: () => ({ x: 0, y: 0 }), width: size, height: size };
  }

  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const uf of present) {
    const [a, b, c, d] = shapes[uf].bbox;
    if (a < minLng) minLng = a;
    if (b < minLat) minLat = b;
    if (c > maxLng) maxLng = c;
    if (d > maxLat) maxLat = d;
  }

  const lngScale = Math.cos(((minLat + maxLat) / 2) * DEG_TO_RAD);
  const spanX = Math.max((maxLng - minLng) * lngScale, 1e-9);
  const spanY = Math.max(maxLat - minLat, 1e-9);

  const usable = size - padding * 2;
  const scale = Math.min(usable / spanX, usable / spanY);
  // Sobra dividida em dois: o desenho fica centrado no quadro.
  const offsetX = padding + (usable - spanX * scale) / 2;
  const offsetY = padding + (usable - spanY * scale) / 2;

  const project = ({ lat, lng }: LatLng) => ({
    x: offsetX + (lng - minLng) * lngScale * scale,
    // Latitude cresce para o norte; y do SVG cresce para baixo.
    y: offsetY + (maxLat - lat) * scale,
  });

  const round = (n: number) => Math.round(n * 10) / 10;

  const paths = present.map((uf) => {
    const d = shapes[uf].rings
      .map((ring) => {
        const points = ring.map(([lng, lat]) => {
          const { x, y } = project({ lat, lng });
          return `${round(x)} ${round(y)}`;
        });
        return `M${points.join('L')}Z`;
      })
      .join('');
    return { uf, d };
  });

  return { paths, project, width: size, height: size };
}

/**
 * Mesmo resultado de `projectUfs`, guardado por (UFs + tamanho).
 *
 * O kanban desenha a silhueta em cada card: sem cache, um board com 100 cards
 * do mesmo estado projetaria o mesmo polígono 100 vezes por render.
 */
const cache = new Map<string, ProjectedShapes>();

export function projectUfsCached(ufs: Uf[], shapes: UfShapes, size: number, padding = 2): ProjectedShapes {
  const key = `${ufs.join('+')}|${size}|${padding}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const projected = projectUfs(ufs, shapes, size, padding);
  cache.set(key, projected);
  return projected;
}

/** Só para os testes: o cache é global e sobreviveria entre casos. */
export function clearShapeCache(): void {
  cache.clear();
}
