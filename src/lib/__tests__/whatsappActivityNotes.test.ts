import { describe, expect, it } from 'vitest';
import { escolherAtividadeDaNota, lerNotaDeAtividade } from '@/lib/whatsappActivityNotes';

describe('lerNotaDeAtividade', () => {
  it('lê título, tipo e lead do texto gravado na conversa', () => {
    const nota = '📋 Atividade criada: "ENCAMINHAR DOCUMENTOS - PLANEJAMENTO" (Tarefa) — Lead: Giovanni de Osti(giba) Londrina Sócio';
    expect(lerNotaDeAtividade(nota)).toEqual({
      title: 'ENCAMINHAR DOCUMENTOS - PLANEJAMENTO',
      typeLabel: 'Tarefa',
      leadName: 'Giovanni de Osti(giba) Londrina Sócio',
    });
  });

  it('aceita nota sem lead', () => {
    expect(lerNotaDeAtividade('📋 Atividade criada: "Ligar amanhã" (Ligacao)')).toEqual({
      title: 'Ligar amanhã',
      typeLabel: 'Ligacao',
      leadName: null,
    });
  });

  it('ignora texto que não é nota de atividade', () => {
    expect(lerNotaDeAtividade('Cliente pediu retorno na segunda')).toBeNull();
    expect(lerNotaDeAtividade('')).toBeNull();
    expect(lerNotaDeAtividade(null)).toBeNull();
  });
});

describe('escolherAtividadeDaNota', () => {
  const dados = { title: 'Enviar documentos', typeLabel: 'Tarefa', leadName: 'Giovanni' };
  const notaEm = '2026-08-20T15:32:00.000Z';

  it('fica com a atividade criada mais perto da nota', () => {
    const id = escolherAtividadeDaNota([
      { id: 'antiga', created_at: '2026-01-10T10:00:00.000Z', lead_name: 'Giovanni' },
      { id: 'certa', created_at: '2026-08-20T15:31:50.000Z', lead_name: 'Giovanni' },
    ], dados, notaEm);
    expect(id).toBe('certa');
  });

  it('o lead da nota tem prioridade sobre a proximidade de data', () => {
    const id = escolherAtividadeDaNota([
      { id: 'outro-lead', created_at: '2026-08-20T15:32:00.000Z', lead_name: 'Maria' },
      { id: 'certa', created_at: '2026-08-20T15:20:00.000Z', lead_name: 'Giovanni' },
    ], dados, notaEm);
    expect(id).toBe('certa');
  });

  it('sem candidata, não inventa id', () => {
    expect(escolherAtividadeDaNota([], dados, notaEm)).toBeNull();
  });
});
