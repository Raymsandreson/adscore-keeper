import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface AnimatedNumberProps {
  value: number;
  duration?: number;
  className?: string;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  locale?: string;
}

export function AnimatedNumber({
  value,
  duration = 600,
  className,
  prefix = "",
  suffix = "",
  decimals = 0,
  locale = "pt-BR",
}: AnimatedNumberProps) {
  const [displayed, setDisplayed] = useState(value);
  const [animState, setAnimState] = useState<'idle' | 'counting' | 'pop'>('idle');
  const prevValue = useRef(value);
  const rafRef = useRef<number>();
  const direction = useRef<'up' | 'down'>('up');

  useEffect(() => {
    const from = prevValue.current;
    const to = value;
    prevValue.current = value;

    if (from === to) return;

    direction.current = to > from ? 'up' : 'down';
    setAnimState('counting');
    const startTime = performance.now();

    const animate = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = from + (to - from) * eased;

      setDisplayed(current);

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate);
      } else {
        setDisplayed(to);
        setAnimState('pop');
        setTimeout(() => setAnimState('idle'), 350);
      }
    };

    rafRef.current = requestAnimationFrame(animate);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [value, duration]);

  const formatted = decimals > 0
    ? displayed.toLocaleString(locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
    : Math.round(displayed).toLocaleString(locale);

  return (
    <span
      className={cn(
        "inline-block transition-all duration-200",
        animState === 'counting' && "text-primary",
        animState === 'pop' && direction.current === 'up' && "scale-110 text-success",
        animState === 'pop' && direction.current === 'down' && "scale-95 text-destructive",
        className,
      )}
    >
      {prefix}{formatted}{suffix}
    </span>
  );
}
