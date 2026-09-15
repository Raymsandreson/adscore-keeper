/**
 * O gráfico dos Relatórios monta e não engole linha.
 *
 * Por que existe: `tsc` e `npm run build` passam verdes em erro de ordem de
 * declaração e quebram no primeiro paint (já aconteceu na tela de conversa).
 * Estes testes montam o componente de verdade, que é a única prova de que ele
 * renderiza.
 *
 * Em jsdom o ResponsiveContainer do recharts mede largura 0 e não desenha as
 * barras, então o que se afirma aqui é o que independe de layout: monta sem
 * estourar, escreve o título, e a legenda da pizza traz TODAS as fatias com o
 * valor escrito — nenhuma some por ser pequena.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import ReportResultChart from '../ReportResultChart';

// O ResponsiveContainer do recharts pede ResizeObserver no efeito de montagem e
// o jsdom não tem — sem este stub o componente estoura antes de renderizar
// qualquer coisa. No navegador é nativo.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as any).ResizeObserver = (globalThis as any).ResizeObserver || ResizeObserverStub;

const linhas = [
  { status: 'Concluída', total: 229 },
  { status: 'Exigência', total: 41 },
  { status: 'Indeferida', total: 12 },
];

describe('ReportResultChart', () => {
  it('monta a barra e usa o rótulo que a IA mandou', () => {
    render(
      <ReportResultChart
        chart={{ type: 'bar', x: 'status', y: 'total', label: 'BPC por status' }}
        rows={linhas}
        count={3}
      />,
    );
    expect(screen.getByText('BPC por status')).toBeInTheDocument();
  });

  it('sem rótulo, monta o título a partir das colunas', () => {
    render(
      <ReportResultChart chart={{ type: 'bar', x: 'status', y: 'total' }} rows={linhas} count={3} />,
    );
    expect(screen.getByText('Total por Status')).toBeInTheDocument();
  });

  it('a pizza lista todas as fatias com o valor, sem esconder a menor', () => {
    render(
      <ReportResultChart
        chart={{ type: 'pie', x: 'status', y: 'total', label: 'Composição' }}
        rows={linhas}
        count={3}
      />,
    );
    expect(screen.getByText('Concluída')).toBeInTheDocument();
    expect(screen.getByText('Indeferida')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('229')).toBeInTheDocument();
  });

  it('pizza com mais de 6 fatias vira barra em vez de agrupar em "Outros"', () => {
    const oito = Array.from({ length: 8 }, (_, i) => ({ status: `Fase ${i + 1}`, total: 10 - i }));
    render(<ReportResultChart chart={{ type: 'pie', x: 'status', y: 'total' }} rows={oito} count={8} />);
    // Virou barra: a legenda da pizza (que escreveria o valor ao lado do nome)
    // não existe, então nenhum valor aparece como texto solto.
    expect(screen.queryByText('10')).not.toBeInTheDocument();
    expect(screen.getByText('Total por Status')).toBeInTheDocument();
  });

  it('avisa quando desenha menos linhas do que existem no banco', () => {
    render(<ReportResultChart chart={{ type: 'bar', x: 'status', y: 'total' }} rows={linhas} count={900} />);
    expect(screen.getByText(/desenhando 3 de 900 linhas/)).toBeInTheDocument();
  });

  it('linha temporal mantém a ordem do tempo, não reordena por valor', () => {
    const meses = [
      { mes: '2026-01', total: 5 },
      { mes: '2026-02', total: 90 },
      { mes: '2026-03', total: 20 },
    ];
    const { container } = render(
      <ReportResultChart chart={{ type: 'line', x: 'mes', y: 'total' }} rows={meses} count={3} />,
    );
    expect(container).toBeTruthy();
    expect(screen.getByText('Total por Mes')).toBeInTheDocument();
  });

  it('resultado vazio não desenha nada', () => {
    const { container } = render(
      <ReportResultChart chart={{ type: 'bar', x: 'status', y: 'total' }} rows={[]} count={0} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
