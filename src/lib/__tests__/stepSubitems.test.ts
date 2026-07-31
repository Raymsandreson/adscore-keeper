import { describe, it, expect } from 'vitest';
import {
  isStepBlockedBySubItems,
  pendingSubItems,
  pendingSubItemsMessage,
  isSubItemResolved,
} from '../stepSubitems';
import { syncInstanceItems, type SyncItem } from '../syncChecklistInstances';

// Regra criada em 31/07/2026: sub-item do passo é CONDIÇÃO, não pontuação.
// Motivo medido no Externo: 1.690 dos 2.506 passos com sub-item (67%) foram
// concluídos sem nenhum item conferido.
const passoEmissaoGuia = {
  id: 'emitir_guia',
  label: 'EMITIR GUIA',
  docChecklist: [
    { id: 'd1', label: 'Guia emitida no GPS' },
    { id: 'd2', label: 'Comprovante anexado' },
  ],
};

describe('isStepBlockedBySubItems', () => {
  it('passo sem checklist não trava', () => {
    expect(isStepBlockedBySubItems({ id: 'x', label: 'Ligar para o cliente' })).toBe(false);
    expect(isStepBlockedBySubItems({ docChecklist: [] })).toBe(false);
    expect(isStepBlockedBySubItems(undefined)).toBe(false);
  });

  it('trava enquanto sobrar item em aberto e libera quando todos são resolvidos', () => {
    expect(isStepBlockedBySubItems(passoEmissaoGuia)).toBe(true);

    const umMarcado = {
      ...passoEmissaoGuia,
      docChecklist: [{ ...passoEmissaoGuia.docChecklist[0], checked: true }, passoEmissaoGuia.docChecklist[1]],
    };
    expect(isStepBlockedBySubItems(umMarcado)).toBe(true);
    expect(pendingSubItems(umMarcado).map(d => d.id)).toEqual(['d2']);

    const todosMarcados = {
      ...passoEmissaoGuia,
      docChecklist: passoEmissaoGuia.docChecklist.map(d => ({ ...d, checked: true })),
    };
    expect(isStepBlockedBySubItems(todosMarcados)).toBe(false);
  });

  it('"não se aplica" resolve o item sem marcá-lo como feito', () => {
    const comNA = {
      ...passoEmissaoGuia,
      docChecklist: [
        { ...passoEmissaoGuia.docChecklist[0], checked: true },
        { ...passoEmissaoGuia.docChecklist[1], notApplicable: true },
      ],
    };
    expect(isStepBlockedBySubItems(comNA)).toBe(false);
    expect(isSubItemResolved({ notApplicable: true })).toBe(true);
    expect(isSubItemResolved({ checked: false })).toBe(false);
  });

  it('espelho de resposta não trava — quem marca ele é a resposta escolhida', () => {
    // Os espelhos das respostas NÃO escolhidas ficam desmarcados por definição;
    // exigir marcação manual deixaria o passo impossível de fechar.
    const passoPergunta = {
      id: 'resultado',
      label: 'RESULTADO DO REQUERIMENTO',
      answers: [{ label: 'Requerimento Deferido' }, { label: 'Requerimento Indeferido' }],
      docChecklist: [
        { id: 'm1', label: 'Requerimento deferido' },
        { id: 'm2', label: 'REQUERIMENTO INDEFERIDO' },
      ],
    };
    expect(isStepBlockedBySubItems(passoPergunta)).toBe(false);
  });

  it('mensagem cita o item que falta', () => {
    expect(pendingSubItemsMessage({ docChecklist: [{ id: 'd1', label: 'Comprovante anexado' }] }))
      .toBe('Falta conferir "Comprovante anexado" para concluir este passo');
    expect(pendingSubItemsMessage(passoEmissaoGuia)).toContain('Faltam 2 itens');
  });
});

describe('notApplicable no sync com o POP', () => {
  const template: SyncItem[] = [{
    id: 'emitir_guia',
    label: 'EMITIR GUIA',
    docChecklist: [{ id: 'd1', label: 'Guia emitida no GPS' }],
  }];

  it('sobrevive ao sync e não faz o passo ser dado como alterado', () => {
    const instancia: SyncItem[] = [{
      id: 'emitir_guia',
      label: 'EMITIR GUIA',
      checked: false,
      // `checked: false` explícito: sem ele o sync grava o default e `changed`
      // seria true por isso, não pelo notApplicable — o que o teste quer isolar.
      docChecklist: [{ id: 'd1', label: 'Guia emitida no GPS', checked: false, notApplicable: true }],
    }];

    const r = syncInstanceItems(template, instancia);

    expect(r.items[0].docChecklist?.[0].notApplicable).toBe(true);
    expect(r.items[0].popChange).toBeUndefined();
    // Nada mudou de conteúdo: o "não se aplica" é estado do lead, não do POP.
    expect(r.changed).toBe(false);
  });
});
