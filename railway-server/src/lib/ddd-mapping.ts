/**
 * Brazilian DDD → State (UF) and capital city mapping.
 * Ported from supabase/functions/_shared/ddd-mapping.ts
 */

interface DDDInfo { uf: string; capital: string; }

const DDD_MAP: Record<string, DDDInfo> = {
  '11': { uf: 'SP', capital: 'São Paulo' }, '12': { uf: 'SP', capital: 'São Paulo' },
  '13': { uf: 'SP', capital: 'São Paulo' }, '14': { uf: 'SP', capital: 'São Paulo' },
  '15': { uf: 'SP', capital: 'São Paulo' }, '16': { uf: 'SP', capital: 'São Paulo' },
  '17': { uf: 'SP', capital: 'São Paulo' }, '18': { uf: 'SP', capital: 'São Paulo' },
  '19': { uf: 'SP', capital: 'São Paulo' },
  '21': { uf: 'RJ', capital: 'Rio de Janeiro' }, '22': { uf: 'RJ', capital: 'Rio de Janeiro' },
  '24': { uf: 'RJ', capital: 'Rio de Janeiro' },
  '27': { uf: 'ES', capital: 'Vitória' }, '28': { uf: 'ES', capital: 'Vitória' },
  '31': { uf: 'MG', capital: 'Belo Horizonte' }, '32': { uf: 'MG', capital: 'Belo Horizonte' },
  '33': { uf: 'MG', capital: 'Belo Horizonte' }, '34': { uf: 'MG', capital: 'Belo Horizonte' },
  '35': { uf: 'MG', capital: 'Belo Horizonte' }, '37': { uf: 'MG', capital: 'Belo Horizonte' },
  '38': { uf: 'MG', capital: 'Belo Horizonte' },
  '41': { uf: 'PR', capital: 'Curitiba' }, '42': { uf: 'PR', capital: 'Curitiba' },
  '43': { uf: 'PR', capital: 'Curitiba' }, '44': { uf: 'PR', capital: 'Curitiba' },
  '45': { uf: 'PR', capital: 'Curitiba' }, '46': { uf: 'PR', capital: 'Curitiba' },
  '47': { uf: 'SC', capital: 'Florianópolis' }, '48': { uf: 'SC', capital: 'Florianópolis' },
  '49': { uf: 'SC', capital: 'Florianópolis' },
  '51': { uf: 'RS', capital: 'Porto Alegre' }, '53': { uf: 'RS', capital: 'Porto Alegre' },
  '54': { uf: 'RS', capital: 'Porto Alegre' }, '55': { uf: 'RS', capital: 'Porto Alegre' },
  '61': { uf: 'DF', capital: 'Brasília' },
  '62': { uf: 'GO', capital: 'Goiânia' }, '64': { uf: 'GO', capital: 'Goiânia' },
  '63': { uf: 'TO', capital: 'Palmas' },
  '67': { uf: 'MS', capital: 'Campo Grande' },
  '65': { uf: 'MT', capital: 'Cuiabá' }, '66': { uf: 'MT', capital: 'Cuiabá' },
  '68': { uf: 'AC', capital: 'Rio Branco' },
  '69': { uf: 'RO', capital: 'Porto Velho' },
  '92': { uf: 'AM', capital: 'Manaus' }, '97': { uf: 'AM', capital: 'Manaus' },
  '95': { uf: 'RR', capital: 'Boa Vista' },
  '91': { uf: 'PA', capital: 'Belém' }, '93': { uf: 'PA', capital: 'Belém' },
  '94': { uf: 'PA', capital: 'Belém' },
  '96': { uf: 'AP', capital: 'Macapá' },
  '98': { uf: 'MA', capital: 'São Luís' }, '99': { uf: 'MA', capital: 'São Luís' },
  '86': { uf: 'PI', capital: 'Teresina' }, '89': { uf: 'PI', capital: 'Teresina' },
  '85': { uf: 'CE', capital: 'Fortaleza' }, '88': { uf: 'CE', capital: 'Fortaleza' },
  '84': { uf: 'RN', capital: 'Natal' },
  '83': { uf: 'PB', capital: 'João Pessoa' },
  '81': { uf: 'PE', capital: 'Recife' }, '87': { uf: 'PE', capital: 'Recife' },
  '82': { uf: 'AL', capital: 'Maceió' },
  '79': { uf: 'SE', capital: 'Aracaju' },
  '71': { uf: 'BA', capital: 'Salvador' }, '73': { uf: 'BA', capital: 'Salvador' },
  '74': { uf: 'BA', capital: 'Salvador' }, '75': { uf: 'BA', capital: 'Salvador' },
  '77': { uf: 'BA', capital: 'Salvador' },
};

export function extractDDD(phone: string): string | null {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('55') && digits.length >= 12) return digits.substring(2, 4);
  if (digits.length >= 10 && digits.length <= 11) return digits.substring(0, 2);
  return null;
}

export function getLocationFromDDD(phone: string): { state: string; city: string } | null {
  const ddd = extractDDD(phone);
  if (!ddd) return null;
  const info = DDD_MAP[ddd];
  if (!info) return null;
  return { state: info.uf, city: info.capital };
}
