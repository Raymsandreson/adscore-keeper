import { useEffect, useRef, useState } from "react";
import { fmt } from "@/lib/data";

export const FUNIL_THEME = {
  pageBg: "#0a0b10",
  cardBg: "#14151d",
  cardBorder: "rgba(255,255,255,0.07)",
  textPrimary: "#f4f5fa",
  textSecondary: "#8b90a3",
  textTertiary: "#6b7080",
  accent: "#6366f1",
  accentDeep: "#4f46e5",
  positive: "#22c55e",
  positiveSoft: "#34d399",
  alert: "#f0a3a0",
  warning: "#eab308",
  eyebrow: "#a6a8f0",
};

// ============ AnimatedNumber: count-up com fade ============
export function AnimatedNumber({
  value,
  className,
  style,
  format = (n) => fmt.format(n),
  duration = 600,
}: {
  value: number;
  className?: string;
  style?: React.CSSProperties;
  format?: (n: number) => string;
  duration?: number;
}) {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    fromRef.current = display;
    startRef.current = null;
    const target = value;
    const from = fromRef.current;
    let raf = 0;
    const step = (t: number) => {
      if (startRef.current == null) startRef.current = t;
      const p = Math.min(1, (t - startRef.current) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(Math.round(from + (target - from) * eased));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <span className={className} style={{ fontVariantNumeric: "tabular-nums", ...style }}>
      {format(display)}
    </span>
  );
}

// Card wrapper com estilo funil
export function FunilCard({
  children,
  className = "",
  style,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={"rounded-[18px] " + className}
      style={{
        background: FUNIL_THEME.cardBg,
        border: `1px solid ${FUNIL_THEME.cardBorder}`,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: '"Newsreader", serif',
        fontStyle: "italic",
        color: FUNIL_THEME.eyebrow,
        fontSize: 13,
        letterSpacing: 0.2,
      }}
    >
      {children}
    </div>
  );
}
