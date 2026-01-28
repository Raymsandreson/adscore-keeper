/**
 * Parser for structured lead messages
 * Extracts standard and custom fields from formatted text messages
 */

export interface ParsedLeadData {
  // Standard lead fields
  lead_name: string;
  city: string;
  state: string;
  notes: string;
  // Custom fields extracted from message
  customFields: Record<string, string>;
  // Raw parsed data for reference
  rawFields: Record<string, string>;
}

// Mapping of common field labels to standard lead fields
const standardFieldMappings: Record<string, keyof ParsedLeadData | null> = {
  'nome da vítima': 'lead_name',
  'nome': 'lead_name',
  'vítima': 'lead_name',
  'cidade da visita': 'city',
  'cidade': 'city',
  'estado da visita': 'state',
  'estado': 'state',
  'uf': 'state',
};

// Field labels to look for (emoji + label patterns)
const fieldPatterns = [
  { emoji: '📅', labels: ['data da criação', 'data de criação'] },
  { emoji: '🔢', labels: ['lead título', 'título do lead', 'titulo'] },
  { emoji: '✅', labels: ['status'] },
  { emoji: '👤', labels: ['acolhedor', 'responsável'] },
  { emoji: '⚠️', labels: ['tipo de caso', 'tipo'] },
  { emoji: '📰', labels: ['origem do caso', 'origem'] },
  { emoji: '🔗', labels: ['link do grupo', 'link grupo', 'grupo whatsapp'] },
  { emoji: '📍', labels: ['cidade da visita', 'cidade'] },
  { emoji: '🏛', labels: ['estado da visita', 'estado'] },
  { emoji: '🌎', labels: ['região da visita', 'região'] },
  { emoji: '📅', labels: ['data do acidente', 'data acidente'] },
  { emoji: '💥', labels: ['dano', 'tipo de dano'] },
  { emoji: '🆔', labels: ['nome da vítima', 'vítima', 'nome'] },
  { emoji: '🎂', labels: ['idade da vítima', 'idade'] },
  { emoji: '📌', labels: ['endereço do acidente', 'endereço', 'local'] },
  { emoji: '🏢', labels: ['empresa tomadora', 'empresa'] },
  { emoji: '📰', labels: ['link da notícia', 'notícia', 'link noticia'] },
  { emoji: '💰', labels: ['porte', 'porte empresa'] },
  { emoji: '⚖️', labels: ['responsabilidade'] },
  { emoji: '📜', labels: ['viabilidade jurídica', 'viabilidade'] },
];

export function parseLeadMessage(message: string): ParsedLeadData {
  const result: ParsedLeadData = {
    lead_name: '',
    city: '',
    state: '',
    notes: '',
    customFields: {},
    rawFields: {},
  };

  if (!message || typeof message !== 'string') {
    return result;
  }

  // Split message into lines
  const lines = message.split('\n').filter(line => line.trim());

  // Process each line
  for (const line of lines) {
    // Skip empty lines or lines that are just tips/suggestions
    if (line.includes('💡 **Dica') || line.startsWith('1.') || line.startsWith('2.') || line.startsWith('3.')) {
      continue;
    }

    // Try to extract field name and value
    // Pattern: emoji **label:** value or emoji label: value
    const match = line.match(/^([^\*:]+)?(?:\*\*)?([^:*]+)(?:\*\*)?:\s*(.+)$/);
    
    if (match) {
      const rawLabel = (match[2] || '').trim().toLowerCase();
      let value = (match[3] || '').trim();
      
      // Clean up value - remove markdown formatting
      value = value.replace(/\*\*/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim();
      
      // Check for links in parentheses
      const linkMatch = value.match(/\(?(https?:\/\/[^\s)]+)\)?/);
      if (linkMatch) {
        value = value.replace(/^\|?\s*/, '').trim();
      }

      // Store raw field
      result.rawFields[rawLabel] = value;

      // Map to standard fields
      let mappedToStandard = false;
      for (const [pattern, field] of Object.entries(standardFieldMappings)) {
        if (rawLabel.includes(pattern) && field) {
          (result as any)[field] = value;
          mappedToStandard = true;
          break;
        }
      }

      // If not mapped to standard, add to custom fields
      if (!mappedToStandard && value) {
        // Capitalize the field name for display
        const fieldName = rawLabel
          .split(' ')
          .map(word => word.charAt(0).toUpperCase() + word.slice(1))
          .join(' ');
        result.customFields[fieldName] = value;
      }
    }
  }

  // Build notes from all parsed data
  const notesLines: string[] = [];
  for (const [key, value] of Object.entries(result.rawFields)) {
    if (value && key !== 'nome da vítima' && key !== 'cidade da visita' && key !== 'estado da visita') {
      notesLines.push(`${key.charAt(0).toUpperCase() + key.slice(1)}: ${value}`);
    }
  }
  result.notes = notesLines.join('\n');

  return result;
}

// Get state abbreviation from full name or abbreviation
export function normalizeState(state: string): string {
  const stateMap: Record<string, string> = {
    'acre': 'AC',
    'alagoas': 'AL',
    'amapá': 'AP',
    'amazonas': 'AM',
    'bahia': 'BA',
    'ceará': 'CE',
    'distrito federal': 'DF',
    'espírito santo': 'ES',
    'goiás': 'GO',
    'maranhão': 'MA',
    'mato grosso': 'MT',
    'mato grosso do sul': 'MS',
    'minas gerais': 'MG',
    'pará': 'PA',
    'paraíba': 'PB',
    'paraná': 'PR',
    'pernambuco': 'PE',
    'piauí': 'PI',
    'rio de janeiro': 'RJ',
    'rio grande do norte': 'RN',
    'rio grande do sul': 'RS',
    'rondônia': 'RO',
    'roraima': 'RR',
    'santa catarina': 'SC',
    'são paulo': 'SP',
    'sergipe': 'SE',
    'tocantins': 'TO',
  };

  const normalized = state.trim().toLowerCase();
  
  // If it's already an abbreviation (2 chars), return uppercase
  if (normalized.length === 2) {
    return normalized.toUpperCase();
  }

  // Look up full name
  return stateMap[normalized] || state.toUpperCase();
}
