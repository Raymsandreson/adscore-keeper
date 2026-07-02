/**
 * Lista de user_ids (Cloud) que NÃO devem aparecer no seletor de Assessor
 * ao criar/editar atividades. Ex.: usuários inativos, contas de teste, perfis
 * duplicados que ainda não podem ser removidos do banco.
 *
 * Para esconder mais alguém, basta adicionar o user_id aqui.
 */
export const ASSIGNEE_BLOCKLIST: ReadonlySet<string> = new Set<string>([
  // Contas de teste
  'fcdcfa1a-1d79-4df0-a4ce-ba09566cd550', // xxx xxxx
  '5758d388-9815-4dc5-9c61-6883d2a36f83', // xxxxx xxxxxxxx
  '02b34231-3b52-4691-8b23-bcf2a3b7bb4c', // teste
  // Inativos (laranja)
  'c3a63117-35db-4278-8129-2a928a791120', // Andréia Luany Lima Cavalcante
  'a79b147a-4b5b-4250-a937-6f3492b2e9b5', // Manoel Vitor Rocha Martins
  '56b2452d-3112-40ac-a52b-2e6d254245e7', // Ingrede Suelen Ferreira Beserra Campos
  '1aa8d398-bc0b-46df-8821-b73da545637e', // Arino da Silva Avelino
  // Inativos (amarelo)
  'e55bcaa7-00c8-467c-8f4f-49e7f48a1f08', // Vera Lucia Rafael Justino
  '30079161-55db-433b-b64e-c67a85fb320e', // Luis da silva viana
  'b0f07415-4fa8-4997-bafb-7fa80ee2820f', // Andriele Gomes Ferreira
  '1abf569d-d9a3-40a0-8e64-82bfde1827c9', // Gedeon Rodrigues da Silva
  '3e12ad15-e061-466d-94eb-3f0d99fd51a9', // Adalto Tavares Cavalcante Junior
]);

export function filterAssignableMembers<T extends { user_id: string }>(members: T[]): T[] {
  return members.filter(m => !ASSIGNEE_BLOCKLIST.has(m.user_id));
}
