/**
 * O cartão de saldo do Escavador no sino.
 *  1. em alerta: vermelho, com o motivo — é o alarme, não pode ser discreto;
 *  2. fora de alerta: saldo, média/dia e dias que dura;
 *  3. sem leitura ainda: diz isso, em vez de mostrar R$ 0,00 (que é um número
 *     errado fantasiado de dado).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const { dbMock, dados } = vi.hoisted(() => {
  const dados: { linha: unknown } = { linha: null };
  const from = () => {
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'limit', 'order']) q[m] = () => q;
    q.maybeSingle = () => Promise.resolve({ data: dados.linha, error: null });
    return q;
  };
  return { dbMock: { from }, dados };
});
vi.mock('@/integrations/supabase', () => ({ db: dbMock, externalSupabase: dbMock, supabase: dbMock, authClient: dbMock }));

import { EscavadorSaldoCard } from '../EscavadorSaldoCard';

beforeEach(() => { dados.linha = null; });

describe('EscavadorSaldoCard', () => {
  it('em alerta fica vermelho e diz o motivo', async () => {
    dados.linha = { saldo_reais: 95.5, creditos: 9550, lido_em: '2026-09-09T20:00:00Z', gasto_24h_reais: 10, gasto_7d_media_dia: 18.2, dias_restantes: 5.2, bloqueadas_saldo_24h: 0, alerta: true, motivo: 'Saldo abaixo de R$ 150.', alertado_em: null };
    render(<EscavadorSaldoCard />);
    await waitFor(() => expect(screen.getByTestId('escavador-saldo')).toHaveTextContent('R$ 95,50'));
    expect(screen.getByTestId('escavador-saldo').className).toMatch(/red/);
    expect(screen.getByText('Saldo abaixo de R$ 150.')).toBeInTheDocument();
    expect(screen.getByText(/dá para ~5 dias/)).toBeInTheDocument();
  });

  it('fora de alerta mostra saldo e ritmo, sem vermelho', async () => {
    dados.linha = { saldo_reais: 408.45, creditos: 40845, lido_em: '2026-09-09T20:00:00Z', gasto_24h_reais: 10.55, gasto_7d_media_dia: 17.5, dias_restantes: 23.3, bloqueadas_saldo_24h: 0, alerta: false, motivo: null, alertado_em: null };
    render(<EscavadorSaldoCard />);
    await waitFor(() => expect(screen.getByTestId('escavador-saldo')).toHaveTextContent('R$ 408,45'));
    expect(screen.getByTestId('escavador-saldo').className).not.toMatch(/red/);
    expect(screen.getByText(/R\$ 17,50\/dia/)).toBeInTheDocument();
  });

  it('sem leitura diz que ainda não leu, não R$ 0,00', async () => {
    dados.linha = null;
    render(<EscavadorSaldoCard />);
    await waitFor(() => expect(screen.getByTestId('escavador-saldo')).toHaveTextContent('ainda não lido'));
    expect(screen.queryByText(/R\$ 0,00/)).toBeNull();
  });
});
