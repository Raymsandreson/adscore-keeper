import { findMunicipality, type MunicipalityIndex } from './municipalities';
import type { Municipality, ReferencePoint } from './types';

/** O que a camada geográfica precisa de um contato para posicioná-lo no mapa. */
export interface PartnerContactRow {
  id: string;
  full_name: string | null;
  city: string | null;
  state: string | null;
}

export interface PartnerReference extends ReferencePoint {
  kind: 'partner';
  contactId: string;
  /**
   * Município que deu a posição. `name` guarda o nome do contato — quem o
   * usuário aciona —, então a cidade precisa de campo próprio.
   */
  city: string;
  /**
   * A UF do cadastro não é a do município encontrado (ex.: "Porto Velho/MT",
   * quando Porto Velho é de RO). Posicionamos pelo município — que só existe
   * num estado — mas a UI avisa, porque o cadastro está errado de um dos lados.
   */
  ufMismatch: boolean;
}

export interface PartnerResolution {
  references: PartnerReference[];
  /**
   * Quantos parceiros ficaram sem posição. Só o número: nome de contato não
   * vira log nem mensagem de erro.
   */
  unresolved: number;
}

/** Chave estável do parceiro — mesmo formato de `capitalKey`, para o cache de rota da Fase 4. */
export const partnerKey = (contactId: string): string => `partner:${contactId}`;

/**
 * Posiciona parceiros no mapa a partir da cidade/UF do contato.
 *
 * `contacts` não tem coordenada — só cidade e UF em texto livre —, então a
 * posição sai do centroide do município do IBGE, o mesmo caminho já usado para
 * o lead sem geocodificação.
 *
 * Aferido em 05/08/2026 contra os 19 contatos classificados como `partner`:
 * 18 casam direto e 1 ("Porto Velho/MT") entra por `uf_mismatch` de candidato
 * único. Nenhum fica de fora.
 */
export function resolvePartnerReferences(
  index: MunicipalityIndex,
  rows: PartnerContactRow[],
): PartnerResolution {
  const references: PartnerReference[] = [];
  let unresolved = 0;

  for (const row of rows) {
    const match = findMunicipality(index, row.city, row.state);

    let municipality: Municipality | null = null;
    let ufMismatch = false;

    switch (match.status) {
      case 'exact':
      case 'alias':
      case 'inferred':
        municipality = match.municipality;
        break;
      case 'uf_mismatch':
        // Um candidato só significa que a cidade existe num estado apenas: dá
        // para posicionar sem adivinhar nada. Com mais de um, seria palpite.
        if (match.candidates.length === 1) {
          municipality = match.candidates[0];
          ufMismatch = true;
        }
        break;
      default:
        break;
    }

    if (!municipality?.center) {
      unresolved += 1;
      continue;
    }

    references.push({
      key: partnerKey(row.id),
      name: (row.full_name || '').trim() || 'Parceiro sem nome',
      uf: municipality.uf,
      kind: 'partner',
      point: municipality.center,
      ibgeCode: municipality.ibgeCode,
      contactId: row.id,
      city: municipality.name,
      ufMismatch,
    });
  }

  return { references, unresolved };
}
