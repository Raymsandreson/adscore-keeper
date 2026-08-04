// A pista do Modo Corrida tem que refletir a ORDEM DO RANKING, não os passos.
// Regressão do bug de 04/08/2026: o 1º do ranking (3 status, 0 passos) aparecia
// na largada enquanto a 4ª colocada (47 passos) liderava a pista.
import { describe, it, expect } from 'vitest';
import { computeTrackPositions, type RaceRow } from '../WackyRaceTrack';

function row(p: Partial<RaceRow> & { nome: string }): RaceRow {
  return {
    resultado: 0, fases: 0, objetivos: 0, passos: 0, doc_itens: 0,
    concluidas: 0, atrasadas: 0, ativo_seg: 0, ocioso_seg: 0,
    chat_resp_seg: null, aprov_pct: null,
    ...p,
  };
}

// Recorte real do topo do ranking de 04/08/2026 (RPC tv_atividades_ranking),
// já na ordem que ela devolve.
const REAL_TOP: RaceRow[] = [
  row({ nome: 'João Pedro', resultado: 3, passos: 0, concluidas: 10, atrasadas: 14 }),
  row({ nome: 'Jose Francisco', resultado: 1, fases: 6, objetivos: 6, passos: 19, concluidas: 13 }),
  row({ nome: 'Maria Lydia', fases: 18, objetivos: 18, passos: 40, concluidas: 33 }),
  row({ nome: 'Andressa', fases: 9, objetivos: 9, passos: 47, concluidas: 25, atrasadas: 199 }),
  row({ nome: 'Gisele', fases: 1, objetivos: 1, passos: 1, concluidas: 17, atrasadas: 19 }),
  row({ nome: 'Abderaman', objetivos: 1, passos: 19, concluidas: 20 }),
];

describe('computeTrackPositions', () => {
  it('coloca os carros na ordem do ranking, não na ordem de passos', () => {
    const pos = computeTrackPositions(REAL_TOP);
    // Estritamente decrescente: cada colocado atrás do anterior.
    for (let i = 1; i < pos.length; i++) expect(pos[i]).toBeLessThan(pos[i - 1]);
    // O 1º do ranking lidera a pista mesmo com 0 passos; a 4ª (47 passos) não.
    expect(pos[0]).toBeGreaterThan(pos[3]);
  });

  it('deixa na largada quem não pontuou e mantém a escada dos que pontuaram', () => {
    const pos = computeTrackPositions([
      ...REAL_TOP,
      row({ nome: 'Zerado A' }),
      row({ nome: 'Zerado B', ativo_seg: 3600 }), // só tempo logado não anda
    ]);
    expect(pos.slice(-2)).toEqual([2, 2]);
    expect(pos[0]).toBe(80);
    expect(pos[REAL_TOP.length - 1]).toBe(12);
  });

  it('empate real divide a mesma marca na pista', () => {
    const gemeos = [
      row({ nome: 'A', passos: 5, concluidas: 2 }),
      row({ nome: 'B', passos: 5, concluidas: 2 }),
      row({ nome: 'C', passos: 1 }),
    ];
    const pos = computeTrackPositions(gemeos);
    expect(pos[0]).toBe(pos[1]);
    expect(pos[2]).toBeLessThan(pos[1]);
  });
});
