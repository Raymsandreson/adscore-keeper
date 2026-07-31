import { describe, it, expect } from 'vitest';
import { syncInstanceItems, stripDisplayFields, type SyncItem } from '../syncChecklistInstances';

// Caso real que motivou o fix (31/07/2026): o POP "Salário Maternidade Urbano"
// renomeou o passo "PEDIDO" para "REGISTRAR RESULTADO DO BENEFÍCIO" e adicionou
// um checklist de pergunta. As 92 instâncias seguiam mostrando "PEDIDO".
const passoNoPop: SyncItem = {
  id: '5ef2b06f',
  label: 'REGISTRAR RESULTADO DO BENEFÍCIO',
  docChecklist: [
    { id: 'chk_resultado', label: 'Qual foi o resultado final do benefício no INSS?', type: 'verificacao' },
  ],
};

describe('syncInstanceItems', () => {
  it('passo ainda NÃO marcado adota o conteúdo novo do POP', () => {
    const r = syncInstanceItems([passoNoPop], [{ id: '5ef2b06f', label: 'PEDIDO', checked: false }]);

    expect(r.items[0].label).toBe('REGISTRAR RESULTADO DO BENEFÍCIO');
    expect(r.items[0].docChecklist).toHaveLength(1);
    expect(r.items[0].popChange).toBeUndefined();
    expect(r.changed).toBe(true);
  });

  it('passo JÁ marcado vira histórico e o passo novo entra aberto abaixo', () => {
    const r = syncInstanceItems([passoNoPop], [{ id: '5ef2b06f', label: 'PEDIDO', checked: true }]);

    expect(r.items).toHaveLength(2);

    const [historico, novo] = r.items;
    expect(historico.label).toBe('PEDIDO');
    expect(historico.checked).toBe(true);
    expect(historico.id).toBe('5ef2b06f__feito');
    expect(historico.supersededBy).toBe('5ef2b06f');
    expect(historico.popChange).toBe('alterado');
    expect(historico.popNewLabel).toBe('REGISTRAR RESULTADO DO BENEFÍCIO');

    expect(novo.id).toBe('5ef2b06f');
    expect(novo.label).toBe('REGISTRAR RESULTADO DO BENEFÍCIO');
    expect(novo.checked).toBe(false);
    expect(novo.docChecklist).toHaveLength(1);

    expect(r.changed).toBe(true);
    // O passo novo está pendente: o objetivo deixa de estar concluído.
    expect(r.isCompleted).toBe(false);
  });

  it('roda de novo sem duplicar histórico nem reabrir nada (idempotente)', () => {
    const primeiro = syncInstanceItems([passoNoPop], [{ id: '5ef2b06f', label: 'PEDIDO', checked: true }]);
    const segundo = syncInstanceItems([passoNoPop], primeiro.itemsToPersist);

    expect(segundo.items).toHaveLength(2);
    expect(segundo.changed).toBe(false);
    expect(segundo.items[0].popChange).toBe('alterado');
    expect(segundo.items[0].popNewLabel).toBe('REGISTRAR RESULTADO DO BENEFÍCIO');
  });

  it('marcar o passo novo conclui o objetivo — histórico não segura', () => {
    const sync = syncInstanceItems([passoNoPop], [{ id: '5ef2b06f', label: 'PEDIDO', checked: true }]);
    const respondido = sync.itemsToPersist.map(i => (i.supersededBy ? i : { ...i, checked: true }));

    const depois = syncInstanceItems([passoNoPop], respondido);
    expect(depois.isCompleted).toBe(true);
    expect(depois.changed).toBe(false);
  });

  it('mudança que não exige refazer (script) não duplica o passo', () => {
    const template: SyncItem[] = [{ ...passoNoPop, script: 'Ligar antes de registrar' }];
    const instancia: SyncItem[] = [{
      ...passoNoPop,
      checked: true,
      docChecklist: [{ ...passoNoPop.docChecklist![0], checked: true }],
    }];

    const r = syncInstanceItems(template, instancia);
    expect(r.items).toHaveLength(1);
    expect(r.items[0].popChange).toBe('alterado');
    expect(r.items[0].supersededBy).toBeUndefined();
    expect(r.changed).toBe(false);
  });

  it('histórico cujo passo atual saiu do POP vira registro removido', () => {
    const primeiro = syncInstanceItems([passoNoPop], [{ id: '5ef2b06f', label: 'PEDIDO', checked: true }]);
    const depois = syncInstanceItems([], primeiro.itemsToPersist);

    expect(depois.items).toHaveLength(1);
    expect(depois.items[0].id).toBe('5ef2b06f__feito');
    expect(depois.items[0].popChange).toBe('removido');
  });

  it('passo marcado que saiu do POP fica na lista com aviso de removido', () => {
    const r = syncInstanceItems([], [{ id: 'antigo', label: 'PASSO VELHO', checked: true }]);

    expect(r.items).toHaveLength(1);
    expect(r.items[0].popChange).toBe('removido');
    expect(r.changed).toBe(false);
  });

  it('passo NÃO marcado que saiu do POP some da instância', () => {
    const r = syncInstanceItems([], [{ id: 'antigo', label: 'PASSO VELHO', checked: false }]);

    expect(r.items).toHaveLength(0);
    expect(r.changed).toBe(true);
  });

  it('passo novo do POP entra desmarcado', () => {
    const r = syncInstanceItems([passoNoPop, { id: 'novo', label: 'NOVO PASSO' }], []);

    expect(r.items.map(i => i.id)).toEqual(['5ef2b06f', 'novo']);
    expect(r.items.every(i => i.checked === false)).toBe(true);
  });

  it('preserva resposta escolhida e documentos já marcados ao sincronizar', () => {
    const template: SyncItem[] = [{
      id: 'p1',
      label: 'PROTOCOLO (novo nome)',
      answers: [{ id: 'a1', label: 'Sim' }],
      docChecklist: [
        { id: 'd1', label: 'RG' },
        { id: 'd2', label: 'Certidão' },
      ],
    }];
    const instancia: SyncItem[] = [{
      id: 'p1',
      label: 'PROTOCOLO',
      checked: false,
      selectedAnswerId: 'a1',
      docChecklist: [
        { id: 'd1', label: 'RG', checked: true },
        { id: 'd_removido', label: 'Documento que saiu do POP', checked: true },
        { id: 'd_removido_2', label: 'Documento que saiu do POP e não foi marcado' },
      ],
    }];

    const r = syncInstanceItems(template, instancia);
    const docs = r.items[0].docChecklist!;

    expect(r.items[0].label).toBe('PROTOCOLO (novo nome)');
    expect(r.items[0].selectedAnswerId).toBe('a1');
    expect(docs.find(d => d.id === 'd1')?.checked).toBe(true);
    expect(docs.find(d => d.id === 'd2')?.checked).toBe(false);
    expect(docs.find(d => d.id === 'd_removido')?.popChange).toBe('removido');
    expect(docs.find(d => d.id === 'd_removido_2')).toBeUndefined();
  });

  it('não grava nada quando instância e POP já estão iguais', () => {
    const instancia: SyncItem[] = [{ ...passoNoPop, checked: false, docChecklist: [{ ...passoNoPop.docChecklist![0], checked: false }] }];
    const r = syncInstanceItems([passoNoPop], instancia);

    expect(r.changed).toBe(false);
  });

  it('itemsToPersist leva o supersededBy mas nunca os selos', () => {
    const r = syncInstanceItems([passoNoPop], [{ id: '5ef2b06f', label: 'PEDIDO', checked: true }]);
    const json = JSON.stringify(r.itemsToPersist);

    expect(json).not.toContain('popChange');
    expect(json).not.toContain('popNewLabel');
    expect(json).toContain('supersededBy');
    expect(JSON.stringify(stripDisplayFields(r.items))).toBe(json);
  });

  it('is_completed sai dos passos do POP de hoje', () => {
    const semMarcar = syncInstanceItems([passoNoPop], [{ id: '5ef2b06f', label: 'PEDIDO', checked: false }]);
    const igualAoPop = syncInstanceItems([passoNoPop], [{
      ...passoNoPop,
      checked: true,
      docChecklist: [{ ...passoNoPop.docChecklist![0], checked: false }],
    }]);

    expect(semMarcar.isCompleted).toBe(false);
    expect(igualAoPop.isCompleted).toBe(true);
  });
});
