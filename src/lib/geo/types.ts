/**
 * Tipos da camada geográfica de leads.
 *
 * Escopo: docs/escopo-mapa-regiao-leads.md
 * Esta camada é pura — não faz I/O, não toca em Supabase e não conhece React.
 */

export type Uf =
  | 'AC' | 'AL' | 'AP' | 'AM' | 'BA' | 'CE' | 'DF' | 'ES' | 'GO'
  | 'MA' | 'MT' | 'MS' | 'MG' | 'PA' | 'PB' | 'PR' | 'PE' | 'PI'
  | 'RJ' | 'RN' | 'RS' | 'RO' | 'RR' | 'SC' | 'SP' | 'SE' | 'TO';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Municipality {
  ibgeCode: number;
  name: string;
  uf: Uf;
  /** Centroide oficial do IBGE. `null` em município novo demais para ter malha publicada. */
  center: LatLng | null;
}

/**
 * De onde saiu a posição usada no cálculo — a UI mostra isso para que ninguém
 * confunda "centro do município" com "endereço do cliente".
 */
export type LocationConfidence =
  /** `lead_lat`/`lead_lng` do lead (geocodificado). Mais preciso. */
  | 'coordinate'
  /** Centroide do município, casado por cidade + UF. */
  | 'municipality'
  /** Centroide do município, casado só pelo nome da cidade (sem UF no cadastro). */
  | 'inferred'
  /** Só a UF é conhecida — não há ponto para calcular distância. */
  | 'uf'
  /** Nada aproveitável no cadastro. */
  | 'none';

/** Qual campo do lead originou a resolução. */
export type LocationSource = 'lead_coords' | 'city' | 'visit_city' | 'state' | 'none';

export type LocationWarning =
  /** Nem cidade nem UF no cadastro. */
  | { type: 'no_data' }
  /** A cidade existe no IBGE, mas em outra UF — cadastro inconsistente, não escolhemos por conta própria. */
  | { type: 'uf_mismatch'; city: string; informedUf: Uf; possibleUfs: Uf[] }
  /** Cidade sem UF e o nome existe em mais de um estado. */
  | { type: 'ambiguous_city'; city: string; possibleUfs: Uf[] }
  /** O texto não corresponde a município nenhum (bairro, sigla, lixo). */
  | { type: 'unknown_city'; city: string }
  /** Município reconhecido, mas o IBGE ainda não publicou malha/centroide. */
  | { type: 'municipality_without_center'; city: string; uf: Uf }
  /** `city` e `visit_city` divergem — a resolução usou `city`. */
  | { type: 'city_visit_divergence'; city: string; visitCity: string };

export interface LeadLocation {
  uf: Uf | null;
  municipality: Municipality | null;
  /** Posição usada nos cálculos. `null` quando só se conhece a UF. */
  point: LatLng | null;
  confidence: LocationConfidence;
  source: LocationSource;
  warnings: LocationWarning[];
}

export type ReferenceKind = 'capital' | 'office' | 'base' | 'partner';

/** Alvo de comparação: uma das 27 capitais ou uma base nossa. */
export interface ReferencePoint {
  /** Estável e único: `capital:PI` ou `ref:<uuid>`. Vira chave do cache de rota. */
  key: string;
  name: string;
  uf: Uf;
  kind: ReferenceKind;
  point: LatLng;
  ibgeCode?: number;
}

export interface ReferenceDistance {
  reference: ReferencePoint;
  /** Distância em linha reta, em quilômetros. */
  km: number;
}

/**
 * Como a pré-visualização deve ser enquadrada. A regra de negócio que motiva
 * tudo isto: um estado quando a referência mais próxima é do próprio estado,
 * dois quando é de outro.
 */
export type FramingMode =
  /** Sem UF: não há o que desenhar. */
  | 'NO_DATA'
  /** UF conhecida, sem ponto: desenha o estado, sem linha nem distância. */
  | 'STATE_ONLY'
  /** O lead está na própria referência (dentro do raio): sem linha nem distância. */
  | 'AT_REFERENCE'
  /** A referência mais próxima é do mesmo estado: desenha um estado. */
  | 'ONE_STATE'
  /** A referência mais próxima é de outro estado: desenha dois. */
  | 'TWO_STATES';

export interface Framing {
  mode: FramingMode;
  /** UFs a desenhar, na ordem: a do lead primeiro. Vazio em NO_DATA. */
  ufs: Uf[];
  /** Referência vencedora. `null` em NO_DATA e STATE_ONLY. */
  target: ReferenceDistance | null;
  /** Vencedora + próximas, para a UI mostrar o critério em vez de um número mágico. */
  alternatives: ReferenceDistance[];
  /**
   * Referência mais próxima dentro da UF do lead. Em TWO_STATES é o que sustenta
   * o rótulo comparativo ("Palmas a 238 km; Belém, a capital do estado, a 900 km").
   * `null` quando a UF do lead não tem nenhuma referência.
   */
  sameStateTarget: ReferenceDistance | null;
  /** A segunda colocada está dentro da margem de empate. */
  tie: boolean;
}
