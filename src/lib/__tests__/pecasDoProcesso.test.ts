import { describe, it, expect } from 'vitest';
import {
  pecasParaData, melhorPeca, tituloBateCom, distanciaEmDias, rotuloDaPeca,
  type PecaDoProcesso,
} from '../pecasDoProcesso';

/**
 * Peças REAIS do caso 88 (0011351-63.2022.5.15.0031), colhidas do TRT15 em
 * 24/08/2026 com certificado: 140 peças, 118 restritas. Os títulos abaixo são
 * os que o tribunal devolveu — não um vocabulário inventado.
 */
const AUTOS: PecaDoProcesso[] = [
  { id: 15851, titulo: 'Certidão de Trânsito em Julgado', tipo: 'RESTRITO', dataDocumento: '2024-03-12', storagePath: 'x/15851.pdf', paginas: 1 },
  { id: 1323, titulo: 'Sentença de Liquidação', tipo: 'PUBLICO', dataDocumento: '2024-04-02', storagePath: 'x/1323.pdf', paginas: 3 },
  { id: 15961, titulo: 'Planilha de Cálculos', tipo: 'RESTRITO', dataDocumento: '2024-04-02', storagePath: 'x/15961.pdf', paginas: 4 },
  { id: 15911, titulo: 'Intimação', tipo: 'RESTRITO', dataDocumento: '2024-04-02', storagePath: 'x/15911.pdf', paginas: 3 },
  { id: 15890, titulo: 'Documento Diverso', tipo: 'RESTRITO', dataDocumento: '2024-04-08', storagePath: 'x/15890.pdf', paginas: 6 },
  { id: 15936, titulo: 'Manifestação', tipo: 'RESTRITO', dataDocumento: '2024-04-08', storagePath: 'x/15936.pdf', paginas: 1 },
  { id: 1344, titulo: 'Decisão', tipo: 'PUBLICO', dataDocumento: '2024-04-10', storagePath: 'x/1344.pdf', paginas: 2 },
  { id: 15912, titulo: 'Intimação', tipo: 'RESTRITO', dataDocumento: '2024-04-10', storagePath: 'x/15912.pdf', paginas: 2 },
];

describe('a decisão que sustenta o valor', () => {
  it('a homologação de 10/04/2024 abre a Decisão, não a Intimação do mesmo dia', () => {
    const p = melhorPeca(AUTOS, '2024-04-10', { assunto: 'DECISAO' });
    expect(p?.id).toBe(1344);
    expect(p?.titulo).toBe('Decisão');
    expect(p?.exata).toBe(true);
  });

  it('a sentença de liquidação ganha da planilha e da intimação do mesmo dia', () => {
    expect(melhorPeca(AUTOS, '2024-04-02', { assunto: 'DECISAO' })?.id).toBe(1323);
  });

  it('peça pública e restrita entram na mesma lista — o que importa é abrir', () => {
    const r = pecasParaData(AUTOS, '2024-04-02', { assunto: 'DECISAO' });
    expect(r.map(p => p.tipo)).toContain('PUBLICO');
    expect(r.map(p => p.tipo)).toContain('RESTRITO');
  });
});

describe('data exata é o padrão', () => {
  it('sem janela, peça de outro dia não aparece', () => {
    expect(pecasParaData(AUTOS, '2024-04-09', { assunto: 'DECISAO' })).toEqual([]);
  });

  it('com janela, a peça posterior aparece marcada como não exata', () => {
    const r = pecasParaData(AUTOS, '2024-04-08', { assunto: 'PAGAMENTO', janelaDias: 2 });
    expect(r.some(p => p.id === 1344 && p.distanciaDias === 2 && !p.exata)).toBe(true);
  });

  it('peça ANTERIOR nunca comprova o fato, nem com janela larga', () => {
    const r = pecasParaData(AUTOS, '2024-04-10', { assunto: 'PAGAMENTO', janelaDias: 30 });
    expect(r.every(p => p.distanciaDias >= 0)).toBe(true);
    expect(r.map(p => p.id)).not.toContain(1323);
  });

  it('o mesmo dia vem antes de qualquer peça posterior', () => {
    const r = pecasParaData(AUTOS, '2024-04-08', { assunto: 'MARCO', janelaDias: 5 });
    expect(r[0].exata).toBe(true);
  });
});

describe('desempate', () => {
  it('empatados em data e título, a peça com mais páginas vem primeiro', () => {
    const r = pecasParaData(AUTOS, '2024-04-08', { assunto: 'PAGAMENTO' });
    expect(r[0].id).toBe(15890); // Documento Diverso, 6 páginas
  });

  it('só entra peça baixada — sem storage_path não há o que abrir', () => {
    const semArquivo: PecaDoProcesso[] = [
      { id: 99, titulo: 'Sentença', tipo: 'PUBLICO', dataDocumento: '2024-04-10', storagePath: null, paginas: 9 },
    ];
    expect(pecasParaData(semArquivo, '2024-04-10', { assunto: 'DECISAO' })).toEqual([]);
  });
});

describe('tituloBateCom', () => {
  it('acha por radical, sem acento', () => {
    expect(tituloBateCom('Certidão de Trânsito em Julgado', 'MARCO')).toBe(true);
    expect(tituloBateCom('Planilha de Atualização de Cálculos', 'PAGAMENTO')).toBe(true);
    expect(tituloBateCom('Acórdão', 'DECISAO')).toBe(true);
  });

  it('não força vínculo em peça de outra natureza', () => {
    expect(tituloBateCom('Documento Diverso', 'DECISAO')).toBe(false);
    expect(tituloBateCom(null, 'DECISAO')).toBe(false);
  });
});

describe('sem data não há vínculo', () => {
  it('valor sem data não puxa peça nenhuma', () => {
    expect(pecasParaData(AUTOS, null, { assunto: 'DECISAO' })).toEqual([]);
  });

  it('peça sem data fica de fora', () => {
    const r = pecasParaData(
      [{ id: 1, titulo: 'Decisão', tipo: 'PUBLICO', dataDocumento: null, storagePath: 'x/1.pdf', paginas: 2 }],
      '2024-04-10', { assunto: 'DECISAO' },
    );
    expect(r).toEqual([]);
  });

  it('distanciaEmDias devolve null em vez de zero quando falta data', () => {
    expect(distanciaEmDias(null, '2024-04-10')).toBeNull();
    expect(distanciaEmDias('2024-04-10', 'não é data')).toBeNull();
  });
});

describe('o rótulo não deixa palpite passar por certeza', () => {
  it('peça do mesmo dia usa o título puro', () => {
    const p = melhorPeca(AUTOS, '2024-04-10', { assunto: 'DECISAO' })!;
    expect(rotuloDaPeca(p)).toBe('Decisão');
  });

  it('peça posterior diz quantos dias depois foi juntada', () => {
    const p = pecasParaData(AUTOS, '2024-04-09', { assunto: 'MARCO', janelaDias: 3 })
      .find(x => x.id === 1344)!;
    expect(rotuloDaPeca(p)).toBe('Decisão — juntada 1 dia depois');
  });
});
