// Detecção de duplicados e cálculo do patch de fusão.
// Usado pela busca global (GlobalDatabaseSearch) e pelo DuplicateMergeDialog.
// Regra de fusão (definida com o usuário): vencedor = updated_at mais novo;
// campos vazios do vencedor são preenchidos pelo perdedor mais recente que os tiver.
//
// Chaves de duplicidade por tipo:
//   lead/contato -> nome normalizado, telefone, CPF
//   processo     -> número CNJ (dígitos)  [nunca o "PREV nnn"]
//   caso         -> mesmo cliente (lead_id)  [nunca o "PREV nnn"]

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

// só dígitos, com comprimento mínimo (CPF=11, CNJ=20) — casamento EXATO, sem fuzzy
export function digitsExact(v?: string | null, min = 11): string | null {
  if (!v) return null;
  const d = String(v).replace(/\D/g, '');
  return d.length >= min ? d : null;
}

// campos escalares seguros para preencher no vencedor, por tipo
export const MERGE_FIELDS: Record<string, string[]> = {
  lead: ['lead_name', 'victim_name', 'lead_phone', 'lead_email', 'cpf', 'city', 'state', 'instagram_username', 'source'],
  contact: ['full_name', 'phone', 'email', 'instagram_username', 'cpf', 'city', 'state', 'profession', 'neighborhood'],
  case: ['case_number', 'title', 'description', 'benefit_type', 'status'],
  process: ['process_number', 'title', 'description', 'tribunal', 'classe', 'area', 'polo_ativo', 'polo_passivo', 'valor_causa'],
  campaign: ['name', 'status', 'meta_campaign_id'],
};

interface HasId {
  id: string;
}

export interface KeyFn<T> {
  label: string; // aparece no badge/dialog ("mesmo nome", "mesmo nº CNJ"…)
  fn: (t: T) => string | null | undefined; // valor JÁ normalizado, ou null pra ignorar
}

export interface DuplicateGroup<T extends HasId> {
  key: string;
  reasons: string[];
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
 * Agrupa itens que compartilham QUALQUER uma das chaves fornecidas.
 * Só retorna grupos com 2+ membros. Cada chave contribui um "reason".
 */
export function detectDuplicates<T extends HasId>(
  items: T[],
  keys: KeyFn<T>[],
  getUpdatedAt: (t: T) => string | null | undefined,
): DuplicateGroup<T>[] {
  if (items.length < 2) return [];

  const uf = new UnionFind();
  items.forEach((it) => uf.find(it.id));

  const reasonFor = new Map<string, Set<string>>(); // root -> reasons
  const addReason = (id: string, reason: string) => {
    const root = uf.find(id);
    if (!reasonFor.has(root)) reasonFor.set(root, new Set());
    reasonFor.get(root)!.add(reason);
  };

  for (const key of keys) {
    const buckets = new Map<string, T[]>();
    for (const it of items) {
      const v = key.fn(it);
      if (!v) continue;
      if (!buckets.has(v)) buckets.set(v, []);
      buckets.get(v)!.push(it);
    }
    for (const list of buckets.values()) {
      if (list.length < 2) continue;
      for (let i = 1; i < list.length; i++) uf.union(list[0].id, list[i].id);
      list.forEach((it) => addReason(it.id, key.label));
    }
  }

  const comps = new Map<string, T[]>();
  for (const it of items) {
    const root = uf.find(it.id);
    if (!comps.has(root)) comps.set(root, []);
    comps.get(root)!.push(it);
  }

  const ts = (t: T) => getUpdatedAt(t) || '';
  const groups: DuplicateGroup<T>[] = [];
  for (const [root, members] of comps.entries()) {
    const uniq = Array.from(new Map(members.map((m) => [m.id, m])).values());
    if (uniq.length < 2) continue;
    uniq.sort((a, b) => String(ts(b)).localeCompare(String(ts(a))));
    const reasons = Array.from(reasonFor.get(root) || new Set(['possível duplicado']));
    groups.push({ key: `${root}:${uniq.map((u) => u.id).join(',')}`, reasons, members: uniq });
  }
  return groups;
}

/**
 * Patch a aplicar no vencedor: só preenche campos VAZIOS, usando o perdedor
 * mais recente que tiver valor. Nunca sobrescreve valor já presente.
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
