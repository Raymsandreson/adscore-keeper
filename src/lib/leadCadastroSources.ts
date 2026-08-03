/**
 * Origens que contam como cadastro genuíno de caso (feito por uma pessoa):
 *   - "Internet" → lead veio de Notícias e completou o fluxo "Cadastrar Caso Viável".
 *   - "manual"   → cadastrado diretamente na aba de Leads ("Adicionar Lead").
 *   - "whatsapp" → caso captado/registrado pelo fluxo de WhatsApp.
 * Excluímos "google_alerts" (itens brutos de notícia auto-importados pelo coletor)
 * e demais origens automáticas (referral, cat_import, etc.).
 */
export const CADASTRO_SOURCES = ["Internet", "manual", "whatsapp"] as const;

export const SOURCE_LABELS: Record<string, string> = {
  Internet: "Notícias",
  manual: "Manual",
  whatsapp: "WhatsApp",
};
