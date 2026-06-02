// Fonte única do mapeamento instância -> operador (acolhedor).
// Usado por: backfill-acolhedor-from-group-owner, create-whatsapp-group.

// Instâncias compartilhadas / bots — NUNCA viram acolhedor
export const SHARED_INSTANCES = new Set([
  "WHATSJUD IA",
  "Atendimento Previdenciário",
  "Atendimento Previdenciário 2",
  "Atendimento Processual",
  "Andreia Atendimento Maternidade",
  "Luiz Abraci",
  "Prudencred",
  "Léo Teste",
].map((s) => s.toLowerCase()));

// instance_name → full_name canônico (profiles.full_name)
export const INSTANCE_TO_OPERATOR: Record<string, string> = {
  "Ana Ligia": "Ana Lígia Santos Cavalcante",
  "Analyne Oliveira": "Analyne Sousa de Oliveira",
  "Andressa SDR": "Andressa Leão da Silva Duarte",
  "BRUNO DANTAS": "Bruno Wenner Dantas Nunes",
  "cris": "Crisley Costa de Oliveira",
  "ISRAEL ATENDIMENTO": "Israel de Jesus Carvalho Filho",
  "João Manoel- Acolhedor": "João Manoel Cavalcante Santana",
  "João Pedro": "João Pedro Sá",
  "Juliana Pimentel": "Juliana Clara Santos Pimentel",
  "Karolyne Atendimento": "Maria Karolyne de Aguiar Nunes",
  "Luana Gerente": "Luana Barros",
  "Mateus Atendimento": "Mateus Santos Saraiva",
  "Prev. Edilan": "Edilan da silva santos",
  "Viviane": "Viviane Amorin",
  "Raym": "Raymsandreson de Morais Prudêncio",
  "Dom": "Dom",
};

/**
 * Resolve o nome do acolhedor a partir do instance_name da instância criadora.
 * Retorna null se:
 *  - instance_name vazio
 *  - instância é compartilhada (bot/atendimento coletivo)
 *  - não há mapeamento conhecido
 *
 * Case-insensitive nas duas listas.
 */
export function resolveOperatorFromInstance(instanceName: string | null | undefined): string | null {
  if (!instanceName) return null;
  const lower = instanceName.toLowerCase().trim();
  if (!lower) return null;
  if (SHARED_INSTANCES.has(lower)) return null;
  // case-insensitive lookup
  for (const [key, name] of Object.entries(INSTANCE_TO_OPERATOR)) {
    if (key.toLowerCase() === lower) return name;
  }
  return null;
}
