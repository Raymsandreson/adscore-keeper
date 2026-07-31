/**
 * Sincroniza a instância do POP (lead_checklist_instances.items) com o
 * template atual (checklist_templates.items).
 *
 * Contexto: os items da instância são uma CÓPIA feita no momento em que o
 * lead/processo entrou na fase. Editar o POP depois disso mudava só o
 * template — a ficha do processo seguia mostrando a versão antiga do passo
 * (ex: "PEDIDO" continuou aparecendo depois de virar "REGISTRAR RESULTADO
 * DO BENEFÍCIO", em 92 instâncias do POP Salário Maternidade Urbano).
 *
 * Regra (decidida pelo usuário em 31/07/2026):
 * - Passo AINDA NÃO marcado → adota o conteúdo novo do template (nome,
 *   descrição, script, automação, checklist do passo). Preserva as marcas
 *   de documento que continuam existindo.
 * - Passo JÁ marcado cujo TRABALHO mudou (nome, checklist do passo ou
 *   respostas) → o registro do que foi feito continua na lista, riscado e
 *   com o selo 'alterado', e o passo novo entra logo abaixo DESMARCADO, para
 *   ser executado. O registro antigo guarda `supersededBy` (id do passo que
 *   o substituiu), o que o mantém preso ao passo certo nos loads seguintes.
 * - Passo JÁ marcado com mudança que NÃO exige refazer (script, descrição,
 *   modelo de mensagem, destino/status) → fica como está, sem duplicar; só
 *   recebe o selo 'alterado'.
 * - Passo JÁ marcado que saiu do POP → fica na lista com o selo 'removido'.
 * - Passo não marcado que saiu do POP → some da instância (nada a preservar).
 *
 * O registro antigo (`supersededBy`) é histórico: não é marcável e não entra
 * no cálculo de progresso — quem manda no percentual é o POP de hoje.
 *
 * `popChange`/`popNewLabel` são campos de EXIBIÇÃO, calculados a cada load e
 * removidos antes de gravar (`itemsToPersist`) — o banco guarda só o
 * `supersededBy`, que é o que amarra o histórico ao passo atual.
 */

export type PopChange = 'alterado' | 'removido';

export interface SyncDocItem {
  id: string;
  label?: string;
  checked?: boolean;
  /** Resposta escolhida quando o item é uma pergunta (estado do lead). */
  selectedAnswerId?: string;
  /**
   * "Não se aplica" a este caso — estado do LEAD, igual a `checked`: destrava o
   * passo sem afirmar que o item foi feito (ver src/lib/stepSubitems.ts). Fica
   * fora das comparações com o template, senão o passo seria dado como alterado
   * no POP e reaberto a cada marcação.
   */
  notApplicable?: boolean;
  popChange?: PopChange;
  [key: string]: unknown;
}

export interface SyncItem {
  id: string;
  label?: string;
  checked?: boolean;
  selectedAnswerId?: string;
  docChecklist?: SyncDocItem[];
  /**
   * Registro do que foi feito antes de o POP mudar: guarda o id do passo
   * ATUAL que substituiu este. Persiste no banco — é o que mantém o
   * histórico colado ao passo certo e impede que ele seja confundido com
   * um passo excluído do POP.
   */
  supersededBy?: string;
  popChange?: PopChange;
  /** Nome atual no POP, quando o passo marcado foi renomeado. */
  popNewLabel?: string;
  [key: string]: unknown;
}

/** Passos históricos não são marcáveis nem entram no progresso. */
export function isHistoryItem(item: { supersededBy?: string }): boolean {
  return !!item.supersededBy;
}

/** JSON com chaves ordenadas — comparação estável entre loads. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter(k => obj[k] !== undefined).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

/** Projeção do passo sem estado do lead — usada só para detectar mudança de conteúdo. */
function configOf(item: SyncItem): string {
  const { checked: _c, selectedAnswerId: _s, popChange: _p, popNewLabel: _n, docChecklist, ...rest } = item;
  const docs = (docChecklist || []).map(d => {
    const { checked: _dc, selectedAnswerId: _ds, notApplicable: _dn, popChange: _dp, ...docRest } = d;
    return docRest;
  });
  return stableStringify({ ...rest, docChecklist: docs });
}

/**
 * O passo precisa ser REFEITO? Só quando muda o trabalho em si — o nome, o
 * checklist do passo ou as respostas da pergunta. Mexer em script, descrição,
 * modelo de mensagem, tipo de atividade ou destino/status não obriga ninguém
 * a refazer o que já foi feito (e duplicar a linha nesses casos só poluiria a
 * ficha a cada ajuste de texto do POP).
 */
function needsRedo(templateItem: SyncItem, existing: SyncItem): boolean {
  if ((templateItem.label || '') !== (existing.label || '')) return true;
  if (stableStringify(templateItem.answers) !== stableStringify(existing.answers)) return true;

  const docsOf = (item: SyncItem) =>
    (item.docChecklist || []).map(d => {
      const { checked: _c, selectedAnswerId: _s, notApplicable: _n, popChange: _p, ...rest } = d;
      return rest;
    });
  return stableStringify(docsOf(templateItem)) !== stableStringify(docsOf(existing));
}

/** Id estável e sem colisão para o registro do passo que foi substituído. */
function historyIdFor(baseId: string, usedIds: Set<string>): string {
  let candidate = `${baseId}__feito`;
  let n = 2;
  while (usedIds.has(candidate)) {
    candidate = `${baseId}__feito${n}`;
    n += 1;
  }
  return candidate;
}

/**
 * Remove os campos de exibição antes de gravar no banco. Obrigatório em
 * QUALQUER update de items feito pela UI (marcar passo, marcar documento):
 * o selo é derivado a cada load e não pode ser persistido.
 */
export function stripDisplayFields(items: SyncItem[]): SyncItem[] {
  return items.map(item => {
    const { popChange: _p, popNewLabel: _n, docChecklist, ...rest } = item;
    const out: SyncItem = { ...rest };
    if (docChecklist) {
      out.docChecklist = docChecklist.map(d => {
        const { popChange: _dp, ...docRest } = d;
        return docRest as SyncDocItem;
      });
    }
    return out;
  });
}

/**
 * Aplica o template ao checklist do passo preservando o que já foi marcado.
 * Documento marcado que saiu do template é mantido com selo 'removido'.
 */
function mergeDocs(
  templateDocs: SyncDocItem[] | undefined,
  instanceDocs: SyncDocItem[] | undefined,
): SyncDocItem[] | undefined {
  if (!templateDocs) {
    // Template sem checklist: só sobrevive o que estava marcado (com selo).
    const kept = (instanceDocs || []).filter(d => d.checked).map(d => ({ ...d, popChange: 'removido' as PopChange }));
    return kept.length > 0 ? kept : undefined;
  }

  const byId = new Map((instanceDocs || []).map(d => [d.id, d]));
  const merged: SyncDocItem[] = templateDocs.map(td => {
    const existing = byId.get(td.id);
    if (!existing) return { ...td, checked: false };
    // Preserva o estado do lead: marcação, resposta escolhida (item-pergunta)
    // e o "não se aplica" — quem já resolveu o item não refaz a decisão a cada
    // ajuste de texto do POP.
    const kept: SyncDocItem = { ...td, checked: existing.checked || false };
    if (existing.selectedAnswerId) kept.selectedAnswerId = existing.selectedAnswerId;
    if (existing.notApplicable) kept.notApplicable = true;
    return kept;
  });

  const templateIds = new Set(templateDocs.map(d => d.id));
  for (const existing of instanceDocs || []) {
    if (templateIds.has(existing.id)) continue;
    if (existing.checked) merged.push({ ...existing, popChange: 'removido' });
  }

  return merged;
}

export interface SyncResult {
  /** Items para exibir — inclui os selos popChange/popNewLabel. */
  items: SyncItem[];
  /** Items para gravar — sem os selos. */
  itemsToPersist: SyncItem[];
  /** true quando o conteúdo gravado mudou (só então vale um UPDATE). */
  changed: boolean;
  /** Conclusão recalculada a partir dos items finais. */
  isCompleted: boolean;
}

export function syncInstanceItems(
  templateItems: SyncItem[] | null | undefined,
  instanceItems: SyncItem[] | null | undefined,
): SyncResult {
  const template = templateItems || [];
  const instance = instanceItems || [];
  const templateById = new Map(template.map(t => [t.id, t]));
  const templateIds = new Set(template.map(t => t.id));

  // Registros de passos já substituídos em syncs anteriores.
  const history = instance.filter(isHistoryItem);
  const live = instance.filter(i => !isHistoryItem(i));
  const liveById = new Map(live.map(i => [i.id, i]));

  const usedIds = new Set(instance.map(i => i.id));
  const items: SyncItem[] = [];

  /**
   * Passo saindo do template para a instância. Os documentos passam pelo
   * mergeDocs mesmo sem estado anterior: é o que garante `checked: false`
   * neles e, com isso, que o sync seguinte não veja diferença e regrave
   * (idempotência).
   */
  const fromTemplate = (templateItem: SyncItem): SyncItem => {
    const docs = mergeDocs(templateItem.docChecklist, undefined);
    const fresh: SyncItem = { ...templateItem, checked: false };
    if (docs) fresh.docChecklist = docs;
    else delete fresh.docChecklist;
    return fresh;
  };

  const historyBadge = (item: SyncItem): SyncItem => {
    const current = item.supersededBy ? templateById.get(item.supersededBy) : undefined;
    if (!current) return { ...item, popChange: 'removido' };
    return {
      ...item,
      popChange: 'alterado',
      ...(current.label && current.label !== item.label ? { popNewLabel: current.label } : {}),
    };
  };

  for (const templateItem of template) {
    // Histórico deste passo vem primeiro (o que foi feito antes da mudança).
    for (const old of history) {
      if (old.supersededBy === templateItem.id) items.push(historyBadge(old));
    }

    const existing = liveById.get(templateItem.id);

    if (!existing) {
      items.push(fromTemplate(templateItem));
      continue;
    }

    if (existing.checked) {
      if (!needsRedo(templateItem, existing)) {
        // Mudança que não obriga a refazer: mantém como está, só sinaliza.
        const changed = configOf(templateItem) !== configOf(existing);
        items.push(changed ? { ...existing, popChange: 'alterado' } : existing);
        continue;
      }

      // O trabalho mudou: guarda o que foi feito e reabre o passo novo.
      const historyId = historyIdFor(templateItem.id, usedIds);
      usedIds.add(historyId);
      items.push(historyBadge({ ...existing, id: historyId, supersededBy: templateItem.id }));
      items.push(fromTemplate(templateItem));
      continue;
    }

    const docs = mergeDocs(templateItem.docChecklist, existing.docChecklist);
    const merged: SyncItem = { ...templateItem, checked: false };
    if (existing.selectedAnswerId) merged.selectedAnswerId = existing.selectedAnswerId;
    if (docs) merged.docChecklist = docs;
    else delete merged.docChecklist;
    items.push(merged);
  }

  // Passos que saíram do POP: só ficam os que já tinham sido marcados.
  for (const existing of live) {
    if (templateIds.has(existing.id)) continue;
    if (existing.checked) items.push({ ...existing, popChange: 'removido' });
  }

  // Histórico cujo passo atual também saiu do POP: vira registro removido.
  for (const old of history) {
    if (old.supersededBy && templateIds.has(old.supersededBy)) continue;
    items.push({ ...old, popChange: 'removido' });
  }

  const itemsToPersist = stripDisplayFields(items);
  const changed = stableStringify(itemsToPersist) !== stableStringify(stripDisplayFields(instance));
  // Só os passos vivos definem a conclusão — histórico é registro do passado.
  const liveFinal = itemsToPersist.filter(i => !isHistoryItem(i));
  const isCompleted = liveFinal.length > 0 && liveFinal.every(i => !!i.checked);

  return { items, itemsToPersist, changed, isCompleted };
}

/** Rótulo curto do selo exibido no passo/documento. */
export const POP_CHANGE_LABEL: Record<PopChange, string> = {
  alterado: 'alterado no POP',
  removido: 'removido do POP',
};
