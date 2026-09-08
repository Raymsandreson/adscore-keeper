/**
 * O que esta bateria protege: o clique na peça NUNCA abrir a peça errada.
 *
 * Os números que motivam o teste são do banco externo em 08/09/2026 — 251
 * chaves (cnj, título, data) repetidas, até 17 documentos na mesma chave. Se
 * alguém "simplificar" o desempate para pegar o primeiro candidato, o caso
 * `duas peças com o mesmo título e a mesma data` quebra aqui, e não na frente
 * do revisor com um documento de outro cliente na tela.
 */
import { describe, it, expect } from 'vitest';
import { acharPecaDoContexto, type CandidataDosAutos } from '../pecaDoContexto';

const peca = (id: number, titulo: string, data: string | null, path: string | null): CandidataDosAutos =>
  ({ id, titulo, dataDocumento: data, storagePath: path });

describe('acharPecaDoContexto', () => {
  it('usa o arquivo do contexto sem consultar nada', () => {
    const r = acharPecaDoContexto({ arquivo: 'cnj/autos/x.pdf', id: 7 }, []);
    expect(r).toEqual({ ok: true, storagePath: 'cnj/autos/x.pdf', id: 7 });
  });

  it('com id, pega a peça daquele id mesmo havendo homônimas', () => {
    const r = acharPecaDoContexto(
      { id: 2, peca: 'Certidão', data: '2026-08-07' },
      [peca(1, 'Certidão', '2026-08-07', 'a.pdf'), peca(2, 'Certidão', '2026-08-07', 'b.pdf')],
    );
    expect(r).toEqual({ ok: true, storagePath: 'b.pdf', id: 2 });
  });

  it('id que sumiu do acervo não vira busca por título', () => {
    const r = acharPecaDoContexto(
      { id: 9, peca: 'Certidão', data: '2026-08-07' },
      [peca(1, 'Certidão', '2026-08-07', 'a.pdf')],
    );
    expect(r.ok).toBe(false);
  });

  it('sem id, abre quando o casamento por título e data é único', () => {
    const r = acharPecaDoContexto(
      { peca: 'Acórdão', data: '2026-08-05' },
      [peca(1, 'Acórdão', '2026-08-05', 'ac.pdf'), peca(2, 'Acórdão', '2026-08-04', 'outro.pdf')],
    );
    expect(r).toEqual({ ok: true, storagePath: 'ac.pdf', id: 1 });
  });

  it('NÃO escolhe quando duas peças têm o mesmo título e a mesma data', () => {
    const r = acharPecaDoContexto(
      { peca: 'Certidão', data: '2026-08-07' },
      [peca(1, 'Certidão', '2026-08-07', 'a.pdf'), peca(2, 'Certidão', '2026-08-07', 'b.pdf')],
    );
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.motivo).toContain('2 peças');
  });

  it('data com hora casa com a data pura do acervo', () => {
    const r = acharPecaDoContexto(
      { peca: 'Sentença', data: '2026-08-05T00:00:00+00:00' },
      [peca(1, 'Sentença', '2026-08-05', 's.pdf')],
    );
    expect(r.ok).toBe(true);
  });

  it('peça lida mas sem arquivo baixado diz isso, em vez de abrir vazio', () => {
    const r = acharPecaDoContexto(
      { peca: 'Intimação', data: '2026-08-05' },
      [peca(1, 'Intimação', '2026-08-05', null)],
    );
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.motivo).toContain('não foi baixado');
  });

  it('nada parecido no acervo devolve motivo, não um chute', () => {
    const r = acharPecaDoContexto({ peca: 'Petição', data: '2026-01-01' }, []);
    expect(r.ok).toBe(false);
  });

  it('lê `titulo` quando o rascunho antigo não tem `peca`', () => {
    const r = acharPecaDoContexto(
      { titulo: 'Recurso de Revista', data: '2026-08-20' },
      [peca(3, 'Recurso de Revista', '2026-08-20', 'rr.pdf')],
    );
    expect(r).toEqual({ ok: true, storagePath: 'rr.pdf', id: 3 });
  });
});
