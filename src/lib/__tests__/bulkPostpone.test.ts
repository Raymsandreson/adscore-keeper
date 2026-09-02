import { describe, it, expect } from 'vitest';
import { planejarAdiamento, responsaveisNoCloud, type AtividadeAdiavel } from '@/lib/bulkPostpone';

const atv = (over: Partial<AtividadeAdiavel> = {}): AtividadeAdiavel => ({
  id: 'a1',
  status: 'pendente',
  title: 'Ligar para o cliente',
  assigned_to: 'ext-ana',
  assigned_to_ids: null,
  ...over,
});

/** Externo → Cloud como o remap faz na tela; o que não conhece devolve null. */
const paraCloud = (ext: string | null | undefined) =>
  ({ 'ext-ana': 'cloud-ana', 'ext-bia': 'cloud-bia' } as Record<string, string>)[ext || ''] || null;

describe('planejarAdiamento', () => {
  it('adia o caso simples', () => {
    const p = planejarAdiamento([atv()], new Map(), paraCloud);
    expect(p.adiar.map(a => a.id)).toEqual(['a1']);
    expect(p.concluidas).toHaveLength(0);
    expect(p.ausentes).toHaveLength(0);
  });

  it('não adia concluída — a data dela registra quando o trabalho foi feito', () => {
    const p = planejarAdiamento([atv({ id: 'feita', status: 'concluida' })], new Map(), paraCloud);
    expect(p.adiar).toHaveLength(0);
    expect(p.concluidas.map(a => a.id)).toEqual(['feita']);
  });

  it('em_andamento e reagendada continuam adiáveis', () => {
    const p = planejarAdiamento(
      [atv({ id: 'x', status: 'em_andamento' }), atv({ id: 'y', status: 'reagendada' })],
      new Map(),
      paraCloud,
    );
    expect(p.adiar.map(a => a.id)).toEqual(['x', 'y']);
  });

  it('pula quem está de férias no dia, com o motivo', () => {
    const ausentes = new Map([['cloud-ana', 'Ana — Férias de 01/09/2026 a 10/09/2026']]);
    const p = planejarAdiamento([atv({ id: 'da-ana' }), atv({ id: 'da-bia', assigned_to: 'ext-bia' })], ausentes, paraCloud);
    expect(p.adiar.map(a => a.id)).toEqual(['da-bia']);
    expect(p.ausentes[0].a.id).toBe('da-ana');
    expect(p.ausentes[0].motivo).toContain('Férias');
  });

  it('férias de co-assessor também tira a atividade do lote', () => {
    const ausentes = new Map([['cloud-bia', 'Bia — Folga em 05/09/2026']]);
    const p = planejarAdiamento(
      [atv({ id: 'com-bia', assigned_to: 'ext-ana', assigned_to_ids: ['ext-ana', 'ext-bia'] })],
      ausentes,
      paraCloud,
    );
    expect(p.adiar).toHaveLength(0);
    expect(p.ausentes[0].motivo).toContain('Folga');
  });

  it('responsável sem correspondência no Cloud não trava o adiamento', () => {
    const ausentes = new Map([['cloud-ana', 'Ana — Férias']]);
    const p = planejarAdiamento([atv({ id: 'orfa', assigned_to: 'ext-desconhecido' })], ausentes, paraCloud);
    expect(p.adiar.map(a => a.id)).toEqual(['orfa']);
  });
});

describe('responsaveisNoCloud', () => {
  it('junta titular e co-assessores sem repetir', () => {
    const ids = responsaveisNoCloud(
      [atv({ assigned_to: 'ext-ana', assigned_to_ids: ['ext-ana', 'ext-bia'] }), atv({ assigned_to: 'ext-bia' })],
      paraCloud,
    );
    expect(ids.sort()).toEqual(['cloud-ana', 'cloud-bia']);
  });

  it('ignora concluída — ela não vai ser reescrita, a ausência dela não importa', () => {
    const ids = responsaveisNoCloud([atv({ status: 'concluida', assigned_to: 'ext-ana' })], paraCloud);
    expect(ids).toEqual([]);
  });
});
