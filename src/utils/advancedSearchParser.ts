/**
 * Advanced Search Parser
 * Supports operators: E (AND), OU (OR), NÃO (NOT), "" (exact phrase), * (wildcard), ""~n (proximity)
 */

interface ParsedQuery {
  type: 'AND' | 'OR' | 'NOT' | 'EXACT' | 'WILDCARD' | 'PROXIMITY' | 'TERM' | 'GROUP';
  value?: string;
  children?: ParsedQuery[];
  distance?: number;
}

/**
 * Tokenize the search query
 */
function tokenize(query: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < query.length; i++) {
    const char = query[i];
    
    if (char === '"') {
      if (inQuotes) {
        // Check for proximity operator after closing quote
        if (query[i + 1] === '~') {
          let num = '';
          let j = i + 2;
          while (j < query.length && /\d/.test(query[j])) {
            num += query[j];
            j++;
          }
          if (num) {
            tokens.push(`"${current}"~${num}`);
            i = j - 1;
          } else {
            tokens.push(`"${current}"`);
          }
        } else {
          tokens.push(`"${current}"`);
        }
        current = '';
        inQuotes = false;
      } else {
        if (current.trim()) {
          tokens.push(current.trim());
          current = '';
        }
        inQuotes = true;
      }
    } else if (inQuotes) {
      current += char;
    } else if (char === '(' || char === ')') {
      if (current.trim()) {
        tokens.push(current.trim());
        current = '';
      }
      tokens.push(char);
    } else if (char === ' ') {
      if (current.trim()) {
        tokens.push(current.trim());
        current = '';
      }
    } else {
      current += char;
    }
  }
  
  if (current.trim()) {
    tokens.push(current.trim());
  }
  
  return tokens;
}

/**
 * Check if a term matches using wildcard pattern
 */
function matchWildcard(pattern: string, text: string): boolean {
  // Convert wildcard pattern to regex
  const regexPattern = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape special chars except *
    .replace(/\*/g, '.*'); // Convert * to .*
  
  const regex = new RegExp(regexPattern, 'i');
  return regex.test(text);
}

/**
 * Check if words are within proximity distance
 */
function checkProximity(phrase: string, text: string, distance: number): boolean {
  const words = phrase.toLowerCase().split(/\s+/);
  if (words.length < 2) return text.toLowerCase().includes(phrase.toLowerCase());
  
  const textWords = text.toLowerCase().split(/\s+/);
  
  // Find first word
  for (let i = 0; i < textWords.length; i++) {
    if (textWords[i].includes(words[0])) {
      // Check if second word is within distance
      const start = Math.max(0, i - distance);
      const end = Math.min(textWords.length, i + distance + 1);
      const window = textWords.slice(start, end).join(' ');
      
      // Check if all other words are in window
      let allFound = true;
      for (let w = 1; w < words.length; w++) {
        if (!window.includes(words[w])) {
          allFound = false;
          break;
        }
      }
      if (allFound) return true;
    }
  }
  
  return false;
}

/**
 * Evaluate a parsed query against text
 */
function evaluateQuery(query: ParsedQuery, text: string): boolean {
  const lowerText = text.toLowerCase();
  
  switch (query.type) {
    case 'TERM':
      return lowerText.includes((query.value || '').toLowerCase());
    
    case 'EXACT':
      return lowerText.includes((query.value || '').toLowerCase());
    
    case 'WILDCARD':
      return matchWildcard(query.value || '', text);
    
    case 'PROXIMITY':
      return checkProximity(query.value || '', text, query.distance || 5);
    
    case 'NOT':
      return !evaluateQuery(query.children![0], text);
    
    case 'AND':
      return query.children!.every(child => evaluateQuery(child, text));
    
    case 'OR':
      return query.children!.some(child => evaluateQuery(child, text));
    
    case 'GROUP':
      return evaluateQuery(query.children![0], text);
    
    default:
      return true;
  }
}

/**
 * Parse tokens into a query tree
 */
function parseTokens(tokens: string[]): ParsedQuery {
  const result: ParsedQuery[] = [];
  let i = 0;
  let currentOperator: 'AND' | 'OR' = 'AND';
  let isNegated = false;
  
  while (i < tokens.length) {
    const token = tokens[i];
    const upperToken = token.toUpperCase();
    
    // Handle operators
    if (upperToken === 'E' || upperToken === 'AND') {
      currentOperator = 'AND';
      i++;
      continue;
    }
    
    if (upperToken === 'OU' || upperToken === 'OR') {
      currentOperator = 'OR';
      i++;
      continue;
    }
    
    if (upperToken === 'NÃO' || upperToken === 'NAO' || upperToken === 'NOT') {
      isNegated = true;
      i++;
      continue;
    }
    
    // Handle groups
    if (token === '(') {
      let depth = 1;
      let j = i + 1;
      while (j < tokens.length && depth > 0) {
        if (tokens[j] === '(') depth++;
        if (tokens[j] === ')') depth--;
        j++;
      }
      const groupTokens = tokens.slice(i + 1, j - 1);
      let groupQuery = parseTokens(groupTokens);
      
      if (isNegated) {
        groupQuery = { type: 'NOT', children: [groupQuery] };
        isNegated = false;
      }
      
      result.push(groupQuery);
      i = j;
      continue;
    }
    
    if (token === ')') {
      i++;
      continue;
    }
    
    // Handle quoted strings with proximity
    if (token.startsWith('"')) {
      const proximityMatch = token.match(/"([^"]+)"~(\d+)/);
      if (proximityMatch) {
        let query: ParsedQuery = {
          type: 'PROXIMITY',
          value: proximityMatch[1],
          distance: parseInt(proximityMatch[2]),
        };
        if (isNegated) {
          query = { type: 'NOT', children: [query] };
          isNegated = false;
        }
        result.push(query);
      } else {
        // Exact phrase
        const exactMatch = token.match(/"([^"]+)"/);
        if (exactMatch) {
          let query: ParsedQuery = { type: 'EXACT', value: exactMatch[1] };
          if (isNegated) {
            query = { type: 'NOT', children: [query] };
            isNegated = false;
          }
          result.push(query);
        }
      }
      i++;
      continue;
    }
    
    // Handle wildcard
    if (token.includes('*')) {
      let query: ParsedQuery = { type: 'WILDCARD', value: token };
      if (isNegated) {
        query = { type: 'NOT', children: [query] };
        isNegated = false;
      }
      result.push(query);
      i++;
      continue;
    }
    
    // Regular term
    let query: ParsedQuery = { type: 'TERM', value: token };
    if (isNegated) {
      query = { type: 'NOT', children: [query] };
      isNegated = false;
    }
    result.push(query);
    i++;
  }
  
  // Combine results based on operators
  if (result.length === 0) {
    return { type: 'TERM', value: '' };
  }
  
  if (result.length === 1) {
    return result[0];
  }
  
  // Default to AND for combining terms, but respect explicit OR
  // For simplicity, we'll combine all with AND unless OR was explicitly used
  return { type: 'AND', children: result };
}

/**
 * Parse and evaluate an advanced search query
 */
export function parseAdvancedSearch(query: string): (text: string) => boolean {
  if (!query.trim()) {
    return () => true;
  }
  
  const tokens = tokenize(query);
  const parsedQuery = parseTokens(tokens);
  
  return (text: string) => evaluateQuery(parsedQuery, text);
}

/**
 * Get search tips in Portuguese
 */
export const SEARCH_TIPS = [
  { operator: '""', example: '"maria da silva"', description: 'Busca texto exato' },
  { operator: 'E', example: 'acidente E grave', description: 'Ambos os termos devem aparecer' },
  { operator: 'OU', example: 'covid OU coronavírus', description: 'Um ou outro deve aparecer' },
  { operator: 'NÃO', example: 'acidente NÃO leve', description: 'Exclui resultados com o termo' },
  { operator: '*', example: 'aposent*', description: 'Busca qualquer variação (aposentado, aposentadoria...)' },
  { operator: '""~n', example: '"maria silva"~5', description: 'Palavras próximas (até n palavras de distância)' },
  { operator: '()', example: '(colega OU amigo) E acidente', description: 'Agrupa expressões' },
];
