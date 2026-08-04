import { describe, expect, it } from 'vitest';
import { findMunicipality } from '../municipalities';
import { sampleIndex } from './fixtures';

const index = sampleIndex();

describe('findMunicipality', () => {
  it('casa cidade + UF, ignorando acento e caixa', () => {
    const match = findMunicipality(index, 'teresina', 'PI');
    expect(match.status).toBe('exact');
    expect(match).toMatchObject({ municipality: { ibgeCode: 2211001, uf: 'PI' } });

    expect(findMunicipality(index, 'COLIDER', 'MT').status).toBe('exact');
    expect(findMunicipality(index, 'São Paulo', 'sp').status).toBe('exact');
  });

  it('resolve pelo estado por extenso', () => {
    const match = findMunicipality(index, 'São Paulo', 'São Paulo');
    expect(match.status).toBe('exact');
    expect(match).toMatchObject({ municipality: { uf: 'SP' } });
  });

  // 47 leads em 04/08/2026: a cidade existe, mas em outra UF.
  it('acusa UF incoerente em vez de escolher sozinho', () => {
    const match = findMunicipality(index, 'Colíder', 'MA');
    expect(match.status).toBe('uf_mismatch');
    expect(match).toMatchObject({ informedUf: 'MA' });
    if (match.status === 'uf_mismatch') {
      expect(match.candidates.map((c) => c.uf)).toEqual(['MT']);
    }
  });

  it('infere a UF quando o nome é único no país', () => {
    const match = findMunicipality(index, 'Teresina', null);
    expect(match.status).toBe('inferred');
    expect(match).toMatchObject({ municipality: { uf: 'PI' } });
  });

  it('não escolhe entre homônimos sem UF', () => {
    const match = findMunicipality(index, 'Bom Jesus', '');
    expect(match.status).toBe('ambiguous');
    if (match.status === 'ambiguous') {
      expect(match.candidates.map((c) => c.uf).sort()).toEqual(['PI', 'RS']);
    }
  });

  it('trata bairro e lixo como cidade desconhecida', () => {
    expect(findMunicipality(index, 'Botafogo', 'RJ').status).toBe('unknown');
    expect(findMunicipality(index, 'BR-163', 'SC').status).toBe('unknown');
    expect(findMunicipality(index, '', 'PI').status).toBe('unknown');
    expect(findMunicipality(index, null, 'PI').status).toBe('unknown');
  });

  describe('apelidos', () => {
    it('resolve os que aparecem no cadastro em volume', () => {
      expect(findMunicipality(index, 'Rio', 'RJ')).toMatchObject({
        status: 'alias',
        municipality: { ibgeCode: 3304557 },
      });
      expect(findMunicipality(index, 'BH', 'MG')).toMatchObject({
        status: 'alias',
        municipality: { ibgeCode: 3106200 },
      });
      expect(findMunicipality(index, 'Campos', 'RJ')).toMatchObject({
        status: 'alias',
        municipality: { ibgeCode: 3301009 },
      });
    });

    it('vale também sem UF cadastrada', () => {
      expect(findMunicipality(index, 'Rio', null)).toMatchObject({
        status: 'alias',
        municipality: { ibgeCode: 3304557 },
      });
    });
  });

  // O IBGE tem só Brasília no DF; o resto são regiões administrativas.
  describe('Distrito Federal', () => {
    it('manda qualquer região administrativa para Brasília', () => {
      for (const ra of ['Taguatinga', 'Ceilândia', 'Itapoã', 'Planaltina', 'Gama']) {
        expect(findMunicipality(index, ra, 'DF')).toMatchObject({
          status: 'alias',
          municipality: { ibgeCode: 5300108 },
        });
      }
    });

    it('não afeta as cidades homônimas de outras UFs', () => {
      // Planaltina existe em GO e Taguatinga em TO — fora do DF a regra não vale.
      expect(findMunicipality(index, 'Taguatinga', 'TO').status).not.toBe('alias');
    });
  });

  it('reconhece município sem centroide publicado', () => {
    const match = findMunicipality(index, 'Boa Esperança do Norte', 'MT');
    expect(match.status).toBe('exact');
    expect(match).toMatchObject({ municipality: { center: null } });
  });
});
