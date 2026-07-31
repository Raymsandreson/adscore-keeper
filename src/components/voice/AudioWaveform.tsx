import { useEffect, useRef, useState } from 'react';

interface AudioWaveformProps {
  /** Analyser ligado na fonte que está sendo gravada (mic, interno ou mix) */
  analyser: AnalyserNode | null;
  active: boolean;
  className?: string;
}

const BARS = 44;
const SILENCE_THRESHOLD = 0.012;
const SILENCE_DELAY_MS = 2500;

/** Oscilação da voz em tempo real — barras espelhadas no centro. */
export function AudioWaveform({ analyser, active, className }: AudioWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const levelsRef = useRef<number[]>(new Array(BARS).fill(0));
  const silentSinceRef = useRef<number | null>(null);
  const [silent, setSilent] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (!analyser || !active) {
      levelsRef.current = new Array(BARS).fill(0);
      silentSinceRef.current = null;
      setSilent(false);
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    const buffer = new Uint8Array(analyser.fftSize);
    const samplesPerBar = Math.floor(buffer.length / BARS);

    const draw = () => {
      rafRef.current = requestAnimationFrame(draw);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      const cssWidth = canvas.clientWidth;
      const cssHeight = canvas.clientHeight;
      if (canvas.width !== cssWidth * dpr || canvas.height !== cssHeight * dpr) {
        canvas.width = cssWidth * dpr;
        canvas.height = cssHeight * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssWidth, cssHeight);

      analyser.getByteTimeDomainData(buffer);

      let framePeak = 0;
      for (let i = 0; i < BARS; i++) {
        let sum = 0;
        for (let j = 0; j < samplesPerBar; j++) {
          const v = (buffer[i * samplesPerBar + j] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / samplesPerBar);
        if (rms > framePeak) framePeak = rms;
        // sobe rápido, desce suave — evita tremida
        const prev = levelsRef.current[i];
        levelsRef.current[i] = rms > prev ? rms : prev * 0.82 + rms * 0.18;
      }

      const now = Date.now();
      if (framePeak < SILENCE_THRESHOLD) {
        if (silentSinceRef.current === null) silentSinceRef.current = now;
        else if (now - silentSinceRef.current > SILENCE_DELAY_MS) setSilent(true);
      } else {
        silentSinceRef.current = null;
        setSilent((s) => (s ? false : s));
      }

      const color = getComputedStyle(canvas).color;
      ctx.fillStyle = color;
      const gap = 2;
      const barWidth = Math.max(1, (cssWidth - gap * (BARS - 1)) / BARS);
      const mid = cssHeight / 2;
      const radius = Math.min(barWidth / 2, 2);

      for (let i = 0; i < BARS; i++) {
        const level = Math.min(1, levelsRef.current[i] * 2.6);
        const h = Math.max(2, level * (cssHeight - 6));
        const x = i * (barWidth + gap);
        const y = mid - h / 2;
        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, barWidth, h, radius);
        else ctx.rect(x, y, barWidth, h);
        ctx.fill();
      }
    };

    draw();
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [analyser, active]);

  return (
    <div className={`rounded-lg border bg-muted/40 px-3 py-2 ${className || ''}`}>
      <canvas ref={canvasRef} className="block h-12 w-full text-primary" />
      {active && silent && (
        <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-500">
          Sem sinal — verifique se a fonte escolhida está emitindo som.
        </p>
      )}
    </div>
  );
}
