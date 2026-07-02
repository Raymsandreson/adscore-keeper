/**
 * Lista de user_ids (Cloud) que NÃO devem aparecer no seletor de Assessor
 * ao criar/editar atividades. Ex.: usuários inativos, contas de teste, perfis
 * duplicados que ainda não podem ser removidos do banco.
 *
 * Para esconder mais alguém, basta adicionar o user_id aqui.
 */
export const ASSIGNEE_BLOCKLIST: ReadonlySet<string> = new Set<string>([
  'e55bcaa7-00c8-467c-8f4f-49e7f48a1f08', // Vera Lucia Rafael Justino
]);

export function filterAssignableMembers<T extends { user_id: string }>(members: T[]): T[] {
  return members.filter(m => !ASSIGNEE_BLOCKLIST.has(m.user_id));
}
