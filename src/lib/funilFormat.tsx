// Helpers de formatação pt-BR + hook de count-up animado.
import { useEffect, useRef, useState } from 'react';

const ptBR = new Intl.NumberFormat('pt-BR');
const ptBRDec = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export const fmt = (n: number) => ptBR.format(Math.round(n));
export const fmtDec = (n: number) => ptBRDec.format(n);
export const fmtPct = (n: number) => `${fmtDec(n)}%`;

/** Suaviza count-up para destacar a troca de período. */
export function useCountUp(value: number, durationMs = 600): number {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  const startRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    fromRef.current = display;
    startRef.current = null;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);

    const target = value;
    const from = fromRef.current;

    const tick = (ts: number) => {
      if (startRef.current === null) startRef.current = ts;
      const elapsed = ts - startRef.current;
      const t = Math.min(1, elapsed / durationMs);
      // easeOutCubic
      const eased = 1 - Math.pow(1 - t, 3);
      const current = from + (target - from) * eased;
      setDisplay(current);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, durationMs]);

  return display;
}

/** Versão renderizável: <CountUp value={3273} /> */
export function CountUp({
  value,
  decimals = 0,
  suffix = '',
  className,
}: {
  value: number;
  decimals?: number;
  suffix?: string;
  className?: string;
}) {
  const d = useCountUp(value);
  const text = decimals > 0
    ? new Intl.NumberFormat('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(d)
    : fmt(d);
  return <span className={className} style={{ fontVariantNumeric: 'tabular-nums' }}>{text}{suffix}</span>;
}
