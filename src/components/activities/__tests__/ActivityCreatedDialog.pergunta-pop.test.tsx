/**
 * Atividade criada com POP PERGUNTA se algum passo já foi dado.
 *
 * Por que existe: parte do trabalho costuma já ter sido feita antes de a
 * atividade nascer (ligação atendida, protocolo enviado, documento anexado). Sem
 * a pergunta, o POP ficava parado numa fase que o processo já passou até alguém
 * lembrar de marcar — e o percentual da carteira mentia junto. Pedido do
 * usuário em 14/09/2026.
 *
 * O que este teste tranca:
 *  - com POP, a pergunta aparece e o "Sim" abre a aba lateral dos passos
 *    (intent `pop-passos:open`), levando lead/board/processo/atividade;
 *  - com POP, o diálogo NÃO se fecha sozinho em 5s — fechar sozinho seria o
 *    mesmo que não ter perguntado;
 *  - sem POP, nada muda: nem pergunta, nem espera.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ActivityCreatedDialog } from '../ActivityCreatedDialog';
import { subscribeToPopPassos, type PopPassosIntent } from '@/lib/popPassosIntent';

const POP = {
  leadId: 'lead-1',
  boardId: 'board-pop-1',
  processId: 'proc-1',
  activityId: 'atv-1',
};

describe('ActivityCreatedDialog: pergunta do POP na criação', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it('com POP, pergunta e o "Sim" dispara a aba lateral dos passos', () => {
    const recebidos: PopPassosIntent[] = [];
    const unsubscribe = subscribeToPopPassos(i => recebidos.push(i));
    const onOpenChange = vi.fn();

    render(
      <ActivityCreatedDialog
        open
        onOpenChange={onOpenChange}
        title="Protocolar recurso"
        onEdit={() => {}}
        onDelete={() => {}}
        pop={POP}
      />
    );

    expect(screen.getByText('Algum passo do POP já foi dado?')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Sim — marcar agora/ }));

    expect(recebidos).toHaveLength(1);
    expect(recebidos[0]).toMatchObject({
      leadId: 'lead-1',
      boardId: 'board-pop-1',
      processId: 'proc-1',
      activityId: 'atv-1',
      // Já respondeu que sim: o host abre os passos direto, sem perguntar de novo.
      perguntar: false,
      atividadeTitulo: 'Protocolar recurso',
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    unsubscribe();
  });

  it('com POP, o diálogo não se fecha sozinho', () => {
    const onOpenChange = vi.fn();
    render(
      <ActivityCreatedDialog
        open
        onOpenChange={onOpenChange}
        title="Protocolar recurso"
        onEdit={() => {}}
        onDelete={() => {}}
        pop={POP}
      />
    );

    act(() => { vi.advanceTimersByTime(10_000); });
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('sem POP, não pergunta nada e continua fechando sozinho', () => {
    const onOpenChange = vi.fn();
    render(
      <ActivityCreatedDialog
        open
        onOpenChange={onOpenChange}
        title="Ligar para o cliente"
        onEdit={() => {}}
        onDelete={() => {}}
      />
    );

    expect(screen.queryByText('Algum passo do POP já foi dado?')).toBeNull();
    act(() => { vi.advanceTimersByTime(6_000); });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
