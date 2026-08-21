/**
 * Discagem — o único lugar do app que sabe transformar um telefone de lead em
 * uma ligação.
 *
 * Existe para ser um ponto de troca. Hoje a ligação sai por `tel:`, que entrega
 * o número já montado para o discador do aparelho (celular pareado, softphone
 * instalado, ramal). Amanhã, se a Callface expuser endpoint de originar chamada
 * ou se o Twilio ganhar um número brasileiro, muda-se `abrirDiscador` e mais
 * nada — as telas continuam chamando a mesma função.
 *
 * Por que não discagem automática: em 21/08/2026 chegam de 3 a 5 leads com
 * telefone válido por dia útil (a via de volume, a planilha do
 * `sheet-lead-ingest`, secou em julho). Robô que disca sozinho nesse volume só
 * queima lead — a chamada cai antes de ter gente na linha. E 27,5% dos leads
 * discáveis dos últimos 60 dias chegaram fora do horário comercial.
 */

/** Mesma normalização do railway `sheet-lead-ingest.ts`, para casar com o que já entra. */
export function normalizarTelefone(bruto: unknown): string {
  const d = String(bruto ?? '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length >= 12 && d.startsWith('55')) return d;
  if (d.length === 10 || d.length === 11) return '55' + d;
  return d;
}

/** 55 + DDD + 8 ou 9 dígitos. Fora disso o discador só queima tentativa. */
export function telefoneDiscavel(bruto: unknown): boolean {
  const d = normalizarTelefone(bruto);
  return d.length === 12 || d.length === 13;
}

/**
 * Celular antigo, de 8 dígitos, ganha o nono. Mesma regra que a edge
 * `twilio-voice-twiml` já aplica há tempos: assinante começando em 6-9 é móvel;
 * 2-5 é fixo e fica como está.
 */
export function comNonoDigito(digitos: string): string {
  if (digitos.length !== 12) return digitos;
  const ddd = digitos.slice(2, 4);
  const assinante = digitos.slice(4);
  if (!['6', '7', '8', '9'].includes(assinante[0])) return digitos;
  return `55${ddd}9${assinante}`;
}

/**
 * E.164 (`+5586981812709`). É o formato que todo discador entende sem adivinhar
 * prefixo — celular, softphone e ramal. Devolve '' se o número não for discável.
 */
export function paraE164(bruto: unknown): string {
  const d = normalizarTelefone(bruto);
  if (d.length !== 12 && d.length !== 13) return '';
  return '+' + comNonoDigito(d);
}

/** `tel:+55...` pronto para um `<a href>`. '' quando não há número discável. */
export function hrefTel(bruto: unknown): string {
  const e164 = paraE164(bruto);
  return e164 ? `tel:${e164}` : '';
}

/** (86) 98181-2709 a partir de 5586981812709. Só apresentação. */
export function exibirTelefone(bruto: unknown): string {
  const d = normalizarTelefone(bruto);
  const nac = d.startsWith('55') ? d.slice(2) : d;
  if (nac.length === 11) return `(${nac.slice(0, 2)}) ${nac.slice(2, 7)}-${nac.slice(7)}`;
  if (nac.length === 10) return `(${nac.slice(0, 2)}) ${nac.slice(2, 6)}-${nac.slice(6)}`;
  return String(bruto ?? '');
}

/**
 * Dispara a discagem fora de um clique em link — usado pela ação do toast, onde
 * não dá para pôr um `<a>`.
 *
 * Cria uma âncora e clica nela em vez de mexer em `location.href`: o handler
 * `tel:` é do sistema operacional, a página não navega, e nenhuma aba nova é
 * aberta. Devolve false quando o número não é discável, para quem chamou avisar.
 */
export function abrirDiscador(bruto: unknown): boolean {
  const href = hrefTel(bruto);
  if (!href) return false;
  const a = document.createElement('a');
  a.href = href;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  return true;
}
