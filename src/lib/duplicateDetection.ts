// Detecção de duplicados por nome/telefone e cálculo do patch de fusão.
// Usado pela busca global (GlobalDatabaseSearch) e pelo DuplicateMergeDialog.
// Regra de fusão (definida com o usuário): vencedor = updated_at mais novo;
// campos vazios do vencedor são preenchidos pelo perdedor mais recente que os tiver.

export function normalizeName(n?: string | null): string | null {
  if (!n) return null;
  const v = n
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return v.length >= 4 ? v : null;
}

// últimos 10 dígitos (ignora DDI 55 e nono dígito) — mesmo critério do scan de contatos
export function normalizePhone(p?: string | null): string | null {
  if (!p) return null;
  const digits = String(p).replace(/\D/g, '');
  if (digits.length < 8) return null;
  return digits.slice(-10).padStart(10, '0');
}

// campos escalares seguros para preencher no vencedor, por tipo
export const MERGE_FIELDS: Record<string, string[]> = {
  lead: ['lead_name', 'victim_name', 'lead_phone', 'lead_email', 'cpf', 'city', 'state', 'instagram_username', 'source'],
  contact: ['full_name', 'phone', 'email', 'instagram_username', 'cpf', 'city', 'state', 'profession', 'neighborhood'],
};

interface HasId {
  id: string;
}

export interface DuplicateGroup<T extends HasId> {
  key: string;
  reasons: string[]; // ex.: ["mesmo nome", "mesmo telefone"]
  members: T[]; // ordenados: vencedor primeiro (updated_at desc)
}

// --- union-find simples por id ---
class UnionFind {
  private parent = new Map<string, string>();
  find(x: string): string {
    if (!this.parent.has(x)) this.parent.set(x, x);
    let root = this.parent.get(x)!;
    if (root !== x) {
      root = this.find(root);
      this.parent.set(x, root);
    }
    return root;
  }
  union(a: string, b: string) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

/**
 * Agrupa itens que provavelmente são o mesmo registro (mesmo nome normalizado
 * OU mesmo telefone normalizado). Só retorna grupos com 2+ membros.
 */
export function detectDuplicates<T extends HasId>(
  items: T[],
  getName: (t: T) => string | null | undefined,
  getPhone?: (t: T) => string | null | undefined,
  getUpdatedAt?: (t: T) => string | null | undefined,
): DuplicateGroup<T>[] {
  if (items.length < 2) return [];

  const uf = new UnionFind();
  const byName = new Map<string, T[]>();
  const byPhone = new Map<string, T[]>();

  for (const it of items) {
    uf.find(it.id); // registra
    const n = normalizeName(getName(it));
    if (n) {
      if (!byName.has(n)) byName.set(n, []);
      byName.get(n)!.push(it);
    }
    if (getPhone) {
      const p = normalizePhone(getPhone(it));
      if (p) {
        if (!byPhone.has(p)) byPhone.set(p, []);
        byPhone.get(p)!.push(it);
      }
    }
  }

  const reasonFor = new Map<string, Set<string>>(); // root -> reasons
  const addReason = (id: string, reason: string) => {
    const root = uf.find(id);
    if (!reasonFor.has(root)) reasonFor.set(root, new Set());
    reasonFor.get(root)!.add(reason);
  };

  for (const list of byName.values()) {
    if (list.length < 2) continue;
    for (let i = 1; i < list.length; i++) uf.union(list[0].id, list[i].id);
    list.forEach((it) => addReason(it.id, 'mesmo nome'));
  }
  for (const list of byPhone.values()) {
    if (list.length < 2) continue;
    for (let i = 1; i < list.length; i++) uf.union(list[0].id, list[i].id);
    list.forEach((it) => addReason(it.id, 'mesmo telefone'));
  }

  // coleta componentes
  const comps = new Map<string, T[]>();
  for (const it of items) {
    const root = uf.find(it.id);
    if (!comps.has(root)) comps.set(root, []);
    comps.get(root)!.push(it);
  }

  const ts = (t: T) => (getUpdatedAt ? getUpdatedAt(t) : (t as any).updated_at) || '';
  const groups: DuplicateGroup<T>[] = [];
  for (const [root, members] of comps.entries()) {
    if (members.length < 2) continue;
    // dedup por id (segurança) e ordena vencedor primeiro (updated_at desc)
    const uniq = Array.from(new Map(members.map((m) => [m.id, m])).values());
    if (uniq.length < 2) continue;
    uniq.sort((a, b) => String(ts(b)).localeCompare(String(ts(a))));
    // reunião de reasons; se caíram juntos só por transitividade sem reason, marca genérico
    const reasons = Array.from(reasonFor.get(root) || new Set(['possível duplicado']));
    groups.push({ key: `${root}:${uniq.map((u) => u.id).join(',')}`, reasons, members: uniq });
  }
  return groups;
}

/**
 * Monta o patch a aplicar no vencedor: só preenche campos VAZIOS, usando o
 * perdedor mais recente que tiver valor. Nunca sobrescreve valor já presente.
 * (members já vem ordenado vencedor-primeiro por updated_at desc.)
 */
export function buildMergePatch<T extends HasId>(members: T[], fields: string[]): Record<string, any> {
  const [winner, ...losers] = members;
  const patch: Record<string, any> = {};
  const isEmpty = (v: any) => v === null || v === undefined || String(v).trim() === '';
  for (const f of fields) {
    if (!isEmpty((winner as any)[f])) continue;
    const fill = losers.find((l) => !isEmpty((l as any)[f]));
    if (fill) patch[f] = (fill as any)[f];
  }
  return patch;
}
