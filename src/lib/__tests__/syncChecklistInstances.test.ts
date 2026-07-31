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

  it('passo JÁ marcado não é reescrito — só recebe o aviso de alterado', () => {
    const r = syncInstanceItems([passoNoPop], [{ id: '5ef2b06f', label: 'PEDIDO', checked: true }]);

    expect(r.items[0].label).toBe('PEDIDO');
    expect(r.items[0].checked).toBe(true);
    expect(r.items[0].popChange).toBe('alterado');
    expect(r.items[0].popNewLabel).toBe('REGISTRAR RESULTADO DO BENEFÍCIO');
    // Nada muda no banco: o selo é só exibição.
    expect(r.changed).toBe(false);
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

  it('itemsToPersist nunca leva os selos para o banco', () => {
    const r = syncInstanceItems([passoNoPop], [{ id: '5ef2b06f', label: 'PEDIDO', checked: true }]);
    const json = JSON.stringify(r.itemsToPersist);

    expect(json).not.toContain('popChange');
    expect(json).not.toContain('popNewLabel');
    expect(JSON.stringify(stripDisplayFields(r.items))).toBe(json);
  });

  it('is_completed sai de todos os passos finais marcados', () => {
    const semMarcar = syncInstanceItems([passoNoPop], [{ id: '5ef2b06f', label: 'PEDIDO', checked: false }]);
    const marcado = syncInstanceItems([passoNoPop], [{ id: '5ef2b06f', label: 'PEDIDO', checked: true }]);

    expect(semMarcar.isCompleted).toBe(false);
    expect(marcado.isCompleted).toBe(true);
  });
});
