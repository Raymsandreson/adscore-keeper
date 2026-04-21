const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const BR_DATE_RE = /^(\d{2})\/(\d{2})\/(\d{4})$/;

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

  const isoDateTime = new Date(trimmed);
  if (!Number.isNaN(isoDateTime.getTime())) {
    return trimmed.slice(0, 10);
  }

  return null;
}