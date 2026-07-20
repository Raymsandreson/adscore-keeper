const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const BR_DATE_RE = /^(\d{2})\/(\d{2})\/(\d{4})$/;
// Aceita apenas datetime ISO com a parte de data completa (YYYY-MM-DD seguido de T/espaço).
const ISO_DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})[T ]/;

function isValidDateParts(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    !Number.isNaN(date.getTime()) &&
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function toIsoDate(year: number, month: number, day: number) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Converte entrada de data para `YYYY-MM-DD` ou `null`.
 *
 * Regra: só devolve string quando ano, mês e dia existem e formam data válida.
 * Data parcial ("2024", "05/2024", "2024-05") vira `null` — nunca completamos
 * mês/dia por conta própria, e mandar o parcial pro Postgres derruba o INSERT
 * inteiro com 22007 (invalid input syntax for type date).
 */
export function normalizeDateInput(value?: string | null) {
  if (!value) return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  const isoMatch = trimmed.match(ISO_DATE_RE);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    return isValidDateParts(Number(year), Number(month), Number(day)) ? trimmed : null;
  }

  const brMatch = trimmed.match(BR_DATE_RE);
  if (brMatch) {
    const [, day, month, year] = brMatch;
    return isValidDateParts(Number(year), Number(month), Number(day))
      ? toIsoDate(Number(year), Number(month), Number(day))
      : null;
  }

  // Sem parse via Date(): "2024" vira Date válido (01/01) e devolvia "2024" pro
  // Postgres → 22007. O guard por regex sozinho também não basta — "2024-05"
  // passaria e o Date() completaria o dia 01, inventando informação.
  const dateTimeMatch = trimmed.match(ISO_DATETIME_RE);
  if (dateTimeMatch) {
    const [, year, month, day] = dateTimeMatch;
    return isValidDateParts(Number(year), Number(month), Number(day))
      ? toIsoDate(Number(year), Number(month), Number(day))
      : null;
  }

  return null;
}
