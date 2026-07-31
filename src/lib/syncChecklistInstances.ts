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
 * - Passo JÁ marcado → NÃO é reescrito: o que foi feito fica registrado como
 *   foi feito. Só recebe um aviso de que o POP mudou (`popChange`):
 *     'alterado' → o passo continua no POP, mas com outro conteúdo
 *     'removido' → o passo não existe mais no POP
 * - Passo não marcado que saiu do POP → some da instância (nada a preservar).
 *
 * `popChange`/`popNewLabel` são campos de EXIBIÇÃO, calculados a cada load e
 * removidos antes de gravar (`itemsToPersist`) — o banco não guarda selo.
 */

export type PopChange = 'alterado' | 'removido';

export interface SyncDocItem {
  id: string;
  label?: string;
  checked?: boolean;
  popChange?: PopChange;
  [key: string]: unknown;
}

export interface SyncItem {
  id: string;
  label?: string;
  checked?: boolean;
  selectedAnswerId?: string;
  docChecklist?: SyncDocItem[];
  popChange?: PopChange;
  /** Nome atual no POP, quando o passo marcado foi renomeado. */
  popNewLabel?: string;
  [key: string]: unknown;
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
    const { checked: _dc, popChange: _dp, ...docRest } = d;
    return docRest;
  });
  return stableStringify({ ...rest, docChecklist: docs });
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
    return existing ? { ...td, checked: existing.checked || false } : { ...td, checked: false };
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
  const instanceById = new Map(instance.map(i => [i.id, i]));

  const items: SyncItem[] = [];

  for (const templateItem of template) {
    const existing = instanceById.get(templateItem.id);

    if (!existing) {
      items.push({ ...templateItem, checked: false });
      continue;
    }

    if (existing.checked) {
      // Passo já marcado: conteúdo congelado. Só avisa se o POP mudou.
      const changed = configOf(templateItem) !== configOf(existing);
      items.push(
        changed
          ? {
              ...existing,
              popChange: 'alterado',
              ...(templateItem.label && templateItem.label !== existing.label
                ? { popNewLabel: templateItem.label }
                : {}),
            }
          : existing,
      );
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
  const templateIds = new Set(template.map(t => t.id));
  for (const existing of instance) {
    if (templateIds.has(existing.id)) continue;
    if (existing.checked) items.push({ ...existing, popChange: 'removido' });
  }

  const itemsToPersist = stripDisplayFields(items);
  const changed = stableStringify(itemsToPersist) !== stableStringify(stripDisplayFields(instance));
  const isCompleted = itemsToPersist.length > 0 && itemsToPersist.every(i => !!i.checked);

  return { items, itemsToPersist, changed, isCompleted };
}

/** Rótulo curto do selo exibido no passo/documento. */
export const POP_CHANGE_LABEL: Record<PopChange, string> = {
  alterado: 'alterado no POP',
  removido: 'removido do POP',
};
