/**
 * Local da visita quando não se sabe onde a pessoa mora.
 *
 * A extração de notícia separa, de propósito, o LOCAL DO ACIDENTE
 * (`accident_address`) do LOCAL DA FAMÍLIA (`visit_city`/`visit_state`) — o
 * prompt de `extract-accident-data` só preenche o segundo quando a matéria
 * diz onde a família mora, será o velório etc. Em notícia de acidente isso
 * quase nunca aparece, e a aba "Local" do lead ficava vazia mesmo com o
 * endereço do acidente extraído.
 *
 * Aqui o endereço do acidente vira o local da visita — endereço inteiro, mais
 * cidade/UF/região quando dá para lê-las com segurança. Nada disso sobrescreve
 * dado existente: só preenche o que está vazio, e a revisão da extração mostra
 * cada campo com selo de origem para quem cadastra desmarcar.
 */

import { normalizeName, normalizeUf } from '@/lib/geo/uf';
import type { Uf } from '@/lib/geo/types';

/**
 * O que a IA devolve quando não achou o dado. O schema do Gemini declara todos
 * os campos como `string` (sem `nullable`), então o modelo obedece o "coloque
 * null" do prompt escrevendo a *palavra* null — que passava direto pelo teste
 * de vazio e chegava no formulário como texto "null".
 */
const PLACEHOLDERS = new Set([
  'null', 'undefined', 'nan', 'none', 'n a', 'na', 'nulo', 'vazio',
  'nao informado', 'nao informada', 'nao informados', 'nao informadas',
  'nao identificado', 'nao identificada', 'nao especificado', 'nao especificada',
  'nao mencionado', 'nao mencionada', 'nao consta', 'nao disponivel',
  'desconhecido', 'desconhecida', 'indefinido', 'indefinida',
  'sem informacao', 'sem informacoes', 'ignorado', 'ignorada',
]);

/** Devolve `null` para o que a IA usa como "não achei". */
export function sanitizeExtractedText(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (!trimmed) return null;
  const normalized = normalizeName(trimmed);
  if (!normalized || PLACEHOLDERS.has(normalized)) return null;
  return trimmed;
}

/** Aplica {@link sanitizeExtractedText} em todo campo de texto do objeto. */
export function sanitizeExtractedRecord<T extends object>(data: T): T {
  const out: Record<string, unknown> = { ...(data as Record<string, unknown>) };
  for (const [key, value] of Object.entries(out)) {
    if (typeof value === 'string') out[key] = sanitizeExtractedText(value);
  }
  return out as T;
}

const UF_TO_REGION: Record<Uf, string> = {
  AC: 'Norte', AP: 'Norte', AM: 'Norte', PA: 'Norte', RO: 'Norte', RR: 'Norte', TO: 'Norte',
  AL: 'Nordeste', BA: 'Nordeste', CE: 'Nordeste', MA: 'Nordeste', PB: 'Nordeste',
  PE: 'Nordeste', PI: 'Nordeste', RN: 'Nordeste', SE: 'Nordeste',
  DF: 'Centro-Oeste', GO: 'Centro-Oeste', MT: 'Centro-Oeste', MS: 'Centro-Oeste',
  ES: 'Sudeste', MG: 'Sudeste', RJ: 'Sudeste', SP: 'Sudeste',
  PR: 'Sul', RS: 'Sul', SC: 'Sul',
};

/** Região do IBGE da UF — aceita sigla ou nome por extenso. */
export function regionForUf(raw: string | null | undefined): string {
  const uf = normalizeUf(raw);
  return uf ? UF_TO_REGION[uf] : '';
}

/**
 * Começo de segmento que descreve o *lugar dentro* da cidade: "Aterro
 * Sanitário de Samambaia" → a cidade é Samambaia. Só entram palavras em que o
 * nome próprio vem depois do conector.
 */
const PLACE_DESCRIPTORS = new Set([
  'aterro', 'canteiro', 'complexo', 'condominio', 'distrito', 'fabrica', 'fazenda',
  'frigorifico', 'galpao', 'garimpo', 'hospital', 'industria', 'mina', 'obra', 'obras',
  'parque', 'patio', 'planta', 'porto', 'refinaria', 'siderurgica', 'sitio',
  'subestacao', 'terminal', 'unidade', 'usina', 'zona',
]);

/** Segmento que é endereço, não cidade — descarta em vez de chutar. */
const STREET_PREFIXES = new Set([
  'rua', 'r', 'avenida', 'av', 'alameda', 'travessa', 'tv', 'estrada', 'rodovia',
  'br', 'praca', 'largo', 'quadra', 'qd', 'setor', 'lote', 'km', 'cep', 'apto',
  'bloco', 'andar', 'sala', 'via', 'anel', 'linha', 'ramal',
]);

const CONNECTORS = /\s(?:de|do|da|dos|das|em|no|na)\s/i;

/** Tira o descritor do lugar e recusa o que claramente não é nome de cidade. */
function cleanCitySegment(segment: string): string | null {
  let city = segment.replace(/\s+/g, ' ').trim();
  if (!city) return null;

  const words = normalizeName(city).split(' ').filter(Boolean);
  if (!words.length) return null;
  if (STREET_PREFIXES.has(words[0])) return null;

  if (PLACE_DESCRIPTORS.has(words[0]) && CONNECTORS.test(city)) {
    const parts = city.split(CONNECTORS);
    city = parts[parts.length - 1].trim();
  }

  // Número de porta, CEP, km: é endereço, não cidade.
  if (/\d/.test(city)) return null;

  const normalized = normalizeName(city);
  if (normalized.length < 3) return null;
  // "Trabalhadores da limpeza urbana morreram" — texto, não topônimo.
  if (normalized.split(' ').length > 4) return null;

  return city;
}

export interface CityState {
  city: string | null;
  state: Uf | null;
}

/**
 * Lê cidade e UF de um endereço escrito por humano.
 *
 * Só devolve cidade quando a UF aparece — sem UF não há como validar o palpite,
 * e o formulário carrega a lista de cidades a partir do estado. Exemplos reais
 * do CRM: "Aterro Sanitário de Samambaia, DF", "Mina de Carajás, Parauapebas,
 * PA", "Recife/PE", "Sinop - MT".
 */
export function parseCityStateFromAddress(raw: string | null | undefined): CityState {
  const address = sanitizeExtractedText(raw);
  if (!address) return { city: null, state: null };

  const segments = address
    .split(/[,;/]|\s[-–—]\s/)
    .map((s) => s.trim())
    .filter(Boolean);

  let state: Uf | null = null;
  let cityIndex = -1;

  for (let i = segments.length - 1; i >= 0; i--) {
    const uf = normalizeUf(segments[i]);
    if (uf) {
      state = uf;
      cityIndex = i - 1;
      break;
    }
    // "Belo Horizonte-MG", "Sinop MT": UF colada no fim do mesmo segmento.
    const glued = segments[i].match(/^(.+?)[\s-]([A-Za-z]{2})$/);
    const gluedUf = glued ? normalizeUf(glued[2]) : null;
    if (glued && gluedUf) {
      state = gluedUf;
      segments[i] = glued[1].trim();
      cityIndex = i;
      break;
    }
  }

  if (!state || cityIndex < 0) return { city: null, state };

  return { city: cleanCitySegment(segments[cityIndex]), state };
}

export interface VisitFallbackInput {
  accident_address?: string | null;
  visit_city?: string | null;
  visit_state?: string | null;
  visit_region?: string | null;
  visit_address?: string | null;
}

export interface VisitFallbackPatch {
  visit_city?: string;
  visit_state?: string;
  visit_region?: string;
  visit_address?: string;
}

export interface VisitFallback {
  /** Só os campos que estavam vazios e o acidente conseguiu preencher. */
  patch: VisitFallbackPatch;
  /** Chaves preenchidas a partir do acidente — para marcar a origem na revisão. */
  derivedKeys: (keyof VisitFallbackPatch)[];
}

/**
 * Sem endereço da pessoa, o local da visita é o local do acidente.
 * Nunca sobrescreve campo já preenchido.
 */
export function deriveVisitFromAccident(input: VisitFallbackInput): VisitFallback {
  const accidentAddress = sanitizeExtractedText(input.accident_address);
  const patch: VisitFallbackPatch = {};
  const derivedKeys: (keyof VisitFallbackPatch)[] = [];
  if (!accidentAddress) return { patch, derivedKeys };

  const currentCity = sanitizeExtractedText(input.visit_city);
  const currentState = sanitizeExtractedText(input.visit_state);
  const currentAddress = sanitizeExtractedText(input.visit_address);
  const currentRegion = sanitizeExtractedText(input.visit_region);

  const { city, state } = parseCityStateFromAddress(accidentAddress);

  if (!currentCity && city) {
    patch.visit_city = city;
    derivedKeys.push('visit_city');
  }
  if (!currentState && state) {
    patch.visit_state = state;
    derivedKeys.push('visit_state');
  }

  const finalState = currentState || patch.visit_state;
  if (!currentRegion && finalState) {
    const region = regionForUf(finalState);
    if (region) {
      patch.visit_region = region;
      derivedKeys.push('visit_region');
    }
  }

  if (!currentAddress) {
    patch.visit_address = accidentAddress;
    derivedKeys.push('visit_address');
  }

  return { patch, derivedKeys };
}
