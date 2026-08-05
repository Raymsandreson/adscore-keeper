import { createMunicipalityIndex, type MunicipalityRow } from '../municipalities';

/**
 * Recorte do dataset real do IBGE (`src/lib/geo/data/municipios.json`).
 * Coordenadas copiadas de lá, nunca inventadas — testar contra número chutado
 * só provaria que o chute e o código concordam.
 */
export const SAMPLE_ROWS: MunicipalityRow[] = [
  [2211001, 'Teresina', 'PI', -5.1027, -42.7406],
  [2208007, 'Picos', 'PI', -7.0589, -41.5223],
  [2201903, 'Bom Jesus', 'PI', -9.2457, -44.5402],
  [4302303, 'Bom Jesus', 'RS', -28.5982, -50.4233],
  [3304557, 'Rio de Janeiro', 'RJ', -22.9255, -43.458],
  [3301009, 'Campos dos Goytacazes', 'RJ', -21.7477, -41.4041],
  [3550308, 'São Paulo', 'SP', -23.6501, -46.6481],
  [1501402, 'Belém', 'PA', -1.2407, -48.4599],
  [1506708, 'Santana do Araguaia', 'PA', -9.3641, -50.6113],
  [1721000, 'Palmas', 'TO', -10.2202, -48.1521],
  [5300108, 'Brasília', 'DF', -15.7812, -47.7969],
  [3106200, 'Belo Horizonte', 'MG', -19.9027, -43.96],
  [5103205, 'Colíder', 'MT', -10.631, -55.4686],
  // Município novo: o IBGE ainda não publica malha nem centroide (API devolve 500).
  [5101837, 'Boa Esperança do Norte', 'MT', null, null],
];

export const sampleIndex = () => createMunicipalityIndex(SAMPLE_ROWS);
