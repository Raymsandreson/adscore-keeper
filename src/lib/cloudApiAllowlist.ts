// Allowlist temporária para visualizar o menu "WhatsApp API".
// Quando a feature for liberada para toda a equipe, deletar este arquivo
// e remover o filtro em AppSidebar.tsx e o guard em WhatsAppApiPage.tsx.
export const CLOUD_API_ALLOWED_EMAILS: ReadonlyArray<string> = [
  'raymsandresonadv@gmail.com',
  'alexandrecavalcante.contato@gmail.com',
];

export function canSeeCloudApi(email: string | null | undefined): boolean {
  if (!email) return false;
  return CLOUD_API_ALLOWED_EMAILS.includes(email.toLowerCase().trim());
}
