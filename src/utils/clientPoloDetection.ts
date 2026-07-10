/**
 * Detecção automática de qual polo do processo é o NOSSO cliente,
 * cruzando os advogados dos "envolvidos" (Escavador) com as OABs dos
 * usuários do sistema (tabela profile_oab_entries).
 *
 * Regra: se um advogado de uma parte tem OAB igual à de um usuário do
 * escritório, aquela parte é nosso cliente → retornamos o polo dela.
 */

/** Normaliza uma OAB para a chave "<numero-digits>-<UF>". */
export function oabKey(numero: string | number | null | undefined, uf: string | null | undefined): string | null {
  const num = String(numero ?? '').replace(/\D/g, '');
  const estado = String(uf ?? '').trim().toUpperCase();
  if (!num || !estado) return null;
  return `${num}-${estado}`;
}

/**
 * Retorna 'ATIVO' | 'PASSIVO' quando um advogado de uma parte casa com uma OAB
 * do sistema; senão null. `oabSet` são as chaves oabKey() dos usuários.
 */
export function detectClientPolo(envolvidos: any[] | null | undefined, oabSet: Set<string>): 'ATIVO' | 'PASSIVO' | null {
  if (!Array.isArray(envolvidos) || oabSet.size === 0) return null;
  for (const e of envolvidos) {
    const polo = e?.polo;
    if (polo !== 'ATIVO' && polo !== 'PASSIVO') continue;
    const advs = Array.isArray(e?.advogados) ? e.advogados : [];
    for (const a of advs) {
      const oabs = Array.isArray(a?.oabs) ? a.oabs : [];
      for (const o of oabs) {
        const key = oabKey(o?.numero, o?.uf);
        if (key && oabSet.has(key)) return polo;
      }
    }
  }
  return null;
}
