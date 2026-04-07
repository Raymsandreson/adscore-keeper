/**
 * Brazilian DDD → State (UF) and capital city mapping.
 * When a DDD covers multiple cities, we default to the state capital.
 */

interface DDDInfo {
  uf: string;
  capital: string;
}

const DDD_MAP: Record<string, DDDInfo> = {
  // São Paulo
  '11': { uf: 'SP', capital: 'São Paulo' },
  '12': { uf: 'SP', capital: 'São Paulo' },
  '13': { uf: 'SP', capital: 'São Paulo' },
  '14': { uf: 'SP', capital: 'São Paulo' },
  '15': { uf: 'SP', capital: 'São Paulo' },
  '16': { uf: 'SP', capital: 'São Paulo' },
  '17': { uf: 'SP', capital: 'São Paulo' },
  '18': { uf: 'SP', capital: 'São Paulo' },
  '19': { uf: 'SP', capital: 'São Paulo' },
  // Rio de Janeiro
  '21': { uf: 'RJ', capital: 'Rio de Janeiro' },
  '22': { uf: 'RJ', capital: 'Rio de Janeiro' },
  '24': { uf: 'RJ', capital: 'Rio de Janeiro' },
  // Espírito Santo
  '27': { uf: 'ES', capital: 'Vitória' },
  '28': { uf: 'ES', capital: 'Vitória' },
  // Minas Gerais
  '31': { uf: 'MG', capital: 'Belo Horizonte' },
  '32': { uf: 'MG', capital: 'Belo Horizonte' },
  '33': { uf: 'MG', capital: 'Belo Horizonte' },
  '34': { uf: 'MG', capital: 'Belo Horizonte' },
  '35': { uf: 'MG', capital: 'Belo Horizonte' },
  '37': { uf: 'MG', capital: 'Belo Horizonte' },
  '38': { uf: 'MG', capital: 'Belo Horizonte' },
  // Paraná
  '41': { uf: 'PR', capital: 'Curitiba' },
  '42': { uf: 'PR', capital: 'Curitiba' },
  '43': { uf: 'PR', capital: 'Curitiba' },
  '44': { uf: 'PR', capital: 'Curitiba' },
  '45': { uf: 'PR', capital: 'Curitiba' },
  '46': { uf: 'PR', capital: 'Curitiba' },
  // Santa Catarina
  '47': { uf: 'SC', capital: 'Florianópolis' },
  '48': { uf: 'SC', capital: 'Florianópolis' },
  '49': { uf: 'SC', capital: 'Florianópolis' },
  // Rio Grande do Sul
  '51': { uf: 'RS', capital: 'Porto Alegre' },
  '53': { uf: 'RS', capital: 'Porto Alegre' },
  '54': { uf: 'RS', capital: 'Porto Alegre' },
  '55': { uf: 'RS', capital: 'Porto Alegre' },
  // Distrito Federal
  '61': { uf: 'DF', capital: 'Brasília' },
  // Goiás
  '62': { uf: 'GO', capital: 'Goiânia' },
  '64': { uf: 'GO', capital: 'Goiânia' },
  // Tocantins
  '63': { uf: 'TO', capital: 'Palmas' },
  // Mato Grosso do Sul
  '67': { uf: 'MS', capital: 'Campo Grande' },
  // Mato Grosso
  '65': { uf: 'MT', capital: 'Cuiabá' },
  '66': { uf: 'MT', capital: 'Cuiabá' },
  // Acre
  '68': { uf: 'AC', capital: 'Rio Branco' },
  // Rondônia
  '69': { uf: 'RO', capital: 'Porto Velho' },
  // Amazonas
  '92': { uf: 'AM', capital: 'Manaus' },
  '97': { uf: 'AM', capital: 'Manaus' },
  // Roraima
  '95': { uf: 'RR', capital: 'Boa Vista' },
  // Pará
  '91': { uf: 'PA', capital: 'Belém' },
  '93': { uf: 'PA', capital: 'Belém' },
  '94': { uf: 'PA', capital: 'Belém' },
  // Amapá
  '96': { uf: 'AP', capital: 'Macapá' },
  // Maranhão
  '98': { uf: 'MA', capital: 'São Luís' },
  '99': { uf: 'MA', capital: 'São Luís' },
  // Piauí
  '86': { uf: 'PI', capital: 'Teresina' },
  '89': { uf: 'PI', capital: 'Teresina' },
  // Ceará
  '85': { uf: 'CE', capital: 'Fortaleza' },
  '88': { uf: 'CE', capital: 'Fortaleza' },
  // Rio Grande do Norte
  '84': { uf: 'RN', capital: 'Natal' },
  // Paraíba
  '83': { uf: 'PB', capital: 'João Pessoa' },
  // Pernambuco
  '81': { uf: 'PE', capital: 'Recife' },
  '87': { uf: 'PE', capital: 'Recife' },
  // Alagoas
  '82': { uf: 'AL', capital: 'Maceió' },
  // Sergipe
  '79': { uf: 'SE', capital: 'Aracaju' },
  // Bahia
  '71': { uf: 'BA', capital: 'Salvador' },
  '73': { uf: 'BA', capital: 'Salvador' },
  '74': { uf: 'BA', capital: 'Salvador' },
  '75': { uf: 'BA', capital: 'Salvador' },
  '77': { uf: 'BA', capital: 'Salvador' },
};

/**
 * Extract DDD from a Brazilian phone number (with or without country code).
 * Expects digits only. Returns 2-digit DDD or null.
 */
export function extractDDD(phone: string): string | null {
  const digits = phone.replace(/\D/g, '');
  // 55 + DDD + number (11-13 digits)
  if (digits.startsWith('55') && digits.length >= 12) {
    return digits.substring(2, 4);
  }
  // DDD + number (10-11 digits)
  if (digits.length >= 10 && digits.length <= 11) {
    return digits.substring(0, 2);
  }
  return null;
}

/**
 * Get state and city from a phone number's DDD.
 */
export function getLocationFromDDD(phone: string): { state: string; city: string } | null {
  const ddd = extractDDD(phone);
  if (!ddd) return null;
  const info = DDD_MAP[ddd];
  if (!info) return null;
  return { state: info.uf, city: info.capital };
}
