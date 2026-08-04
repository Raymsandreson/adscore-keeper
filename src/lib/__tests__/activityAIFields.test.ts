import { describe, it, expect } from 'vitest';
import { splitAIFields } from '../activityAIFields';

describe('splitAIFields', () => {
  it('preenche campo vazio sem perguntar', () => {
    const { autoApply, conflicts } = splitAIFields(
      { what_was_done: 'Liguei na vara', next_steps: 'Cobrar dia 10' },
      { what_was_done: '', next_steps: '' },
    );
    expect(autoApply).toEqual({ what_was_done: 'Liguei na vara', next_steps: 'Cobrar dia 10' });
    expect(conflicts).toHaveLength(0);
  });

  it('não sobrescreve campo preenchido — vira conflito', () => {
    const { autoApply, conflicts } = splitAIFields(
      { what_was_done: 'Versão da IA' },
      { what_was_done: 'Texto que o assessor escreveu' },
    );
    expect(autoApply.what_was_done).toBeUndefined();
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      key: 'what_was_done',
      current: 'Texto que o assessor escreveu',
      incoming: 'Versão da IA',
      defaultChecked: true,
    });
  });

  it('troca de assunto nunca vem marcada por padrão', () => {
    const { conflicts } = splitAIFields(
      { title: 'Acompanhar esclarecimentos do perito' },
      { title: 'ACIDENTE DE TRABALHO' },
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].key).toBe('title');
    expect(conflicts[0].defaultChecked).toBe(false);
  });

  it('apagar campo com conteúdo exige marcar na mão', () => {
    const { autoApply, conflicts } = splitAIFields(
      { notes: '' },
      { notes: 'Observação importante do cliente' },
    );
    expect(autoApply.notes).toBeUndefined();
    expect(conflicts[0].incoming).toBe('');
    expect(conflicts[0].defaultChecked).toBe(false);
  });

  it('texto idêntico (só espaçamento/caixa) não vira conflito', () => {
    const { autoApply, conflicts } = splitAIFields(
      { current_status: 'Aguardando  DESPACHO ' },
      { current_status: 'Aguardando despacho' },
    );
    expect(conflicts).toHaveLength(0);
    expect(autoApply.current_status).toBeUndefined();
  });

  it('metadados continuam aplicados direto', () => {
    const { autoApply, conflicts } = splitAIFields(
      { deadline: '2026-08-10', priority: 'urgente', assessor_names: ['Luana'] } as any,
      { title: 'ACIDENTE DE TRABALHO' },
    );
    expect(autoApply).toMatchObject({ deadline: '2026-08-10', priority: 'urgente', assessor_names: ['Luana'] });
    expect(conflicts).toHaveLength(0);
  });

  it('campo vazio que a IA também devolve vazio não gera ruído', () => {
    const { autoApply, conflicts } = splitAIFields(
      { solicitacao: '', resposta_juizo: '' },
      { solicitacao: '', resposta_juizo: '' },
    );
    expect(autoApply).toEqual({});
    expect(conflicts).toHaveLength(0);
  });
});
