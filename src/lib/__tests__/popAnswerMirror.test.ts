import { describe, it, expect } from 'vitest';
import { normalizeLabel, mirrorLabelsOf, isMirrorOfAnswer } from '../popAnswerMirror';

// Caso real: POP - BPC Administrativo, passo "Resultado do Requerimento
// Administrativo". As respostas e os itens do checklist de verificação têm os
// mesmos nomes — o item é espelho e não deve ser marcável.
const passo = {
  answers: [
    { id: 'a1', label: 'Requerimento Deferido' },
    { id: 'a2', label: 'Requerimento Indeferido' },
  ],
};

describe('espelho resposta ↔ item de checklist', () => {
  it('normaliza acento, caixa e espaço sobrando', () => {
    expect(normalizeLabel('  Requerimento  DEFERIDO ')).toBe('requerimento deferido');
    expect(normalizeLabel('Concessão / Deferido')).toBe('concessao / deferido');
    expect(normalizeLabel(undefined)).toBe('');
  });

  it('reconhece o item que repete uma resposta do passo', () => {
    const mirrors = mirrorLabelsOf(passo);

    expect(isMirrorOfAnswer('Requerimento Deferido', mirrors)).toBe(true);
    expect(isMirrorOfAnswer('requerimento  indeferido', mirrors)).toBe(true);
    // Item que existe só no checklist continua marcável.
    expect(isMirrorOfAnswer('Carta de Concessão/Indeferimento', mirrors)).toBe(false);
  });

  it('passo sem respostas não tem espelho', () => {
    const mirrors = mirrorLabelsOf({ answers: [] });
    expect(mirrors.size).toBe(0);
    expect(isMirrorOfAnswer('Qualquer item', mirrors)).toBe(false);
    expect(mirrorLabelsOf(null).size).toBe(0);
  });

  it('rótulo vazio nunca casa (evita marcar item sem nome por engano)', () => {
    const mirrors = mirrorLabelsOf({ answers: [{ id: 'x', label: '   ' }] });
    expect(isMirrorOfAnswer('', mirrors)).toBe(false);
    expect(isMirrorOfAnswer('   ', mirrors)).toBe(false);
  });
});
