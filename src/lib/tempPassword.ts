// Gerador de senha provisória sem caracteres ambíguos.
// Proibidos: l (L minúsculo), I (i maiúsculo), 1, O (ó maiúsculo), 0.
const LOWER = 'abcdefghijkmnopqrstuvwxyz'; // sem "l"
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // sem "I" e "O"
const DIGITS = '23456789'; // sem "0" e "1"
const SYMBOLS = '!@#$%&*?+-=';

function pick(alphabet: string): string {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return alphabet[arr[0] % alphabet.length];
}

export function generateTempPassword(length = 14): string {
  const all = LOWER + UPPER + DIGITS + SYMBOLS;
  const chars = [pick(LOWER), pick(UPPER), pick(DIGITS), pick(SYMBOLS)];
  while (chars.length < Math.max(12, length)) chars.push(pick(all));
  // Fisher-Yates com fonte criptográfica
  for (let i = chars.length - 1; i > 0; i--) {
    const arr = new Uint32Array(1);
    crypto.getRandomValues(arr);
    const j = arr[0] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

export function validateTempPassword(pw: string): string | null {
  if (pw.length < 12) return 'A senha deve ter ao menos 12 caracteres.';
  if (!/[a-z]/.test(pw)) return 'A senha precisa de uma letra minúscula.';
  if (!/[A-Z]/.test(pw)) return 'A senha precisa de uma letra maiúscula.';
  if (!/[0-9]/.test(pw)) return 'A senha precisa de um número.';
  if (!/[^A-Za-z0-9]/.test(pw)) return 'A senha precisa de um símbolo.';
  return null;
}
