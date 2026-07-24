import { useCallback, useEffect, useRef, useState } from 'react';

// useRaceSfx — efeitos sonoros do telão da Corrida Maluca.
//   • vroom(): zoada de aceleração (motor cantando pneu) quando alguém ultrapassa
//   • say(texto): narra em voz alta quem ultrapassou quem (pt-BR, SpeechSynthesis)
//
// Áudio no navegador só desbloqueia após um gesto do usuário. Como o telão
// atualiza sozinho, deixamos um "destravador" no primeiro clique/tecla: a
// partir daí os efeitos tocam mesmo nas atualizações automáticas.
//
// enabled fica salvo no localStorage pra o telão lembrar entre recargas.

const LS_KEY = 'telao_sfx_on';

export interface RaceSfx {
  vroom: () => void;
  say: (texto: string) => void;
  enabled: boolean;
  setEnabled: (b: boolean) => void;
}

export function useRaceSfx(): RaceSfx {
  const [enabled, setEnabledState] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(LS_KEY) !== '0';
    } catch {
      return true;
    }
  });
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const ctxRef = useRef<AudioContext | null>(null);

  const getCtx = useCallback((): AudioContext | null => {
    try {
      if (!ctxRef.current) {
        const AC: typeof AudioContext =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        ctxRef.current = new AC();
      }
      if (ctxRef.current.state === 'suspended') void ctxRef.current.resume();
      return ctxRef.current;
    } catch {
      return null;
    }
  }, []);

  // Destrava o áudio no primeiro gesto (o telão pode nunca ter recebido clique).
  useEffect(() => {
    const unlock = () => getCtx();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, [getCtx]);

  const setEnabled = useCallback((b: boolean) => {
    setEnabledState(b);
    try {
      window.localStorage.setItem(LS_KEY, b ? '1' : '0');
    } catch {
      /* ignora */
    }
  }, []);

  const vroom = useCallback(() => {
    if (!enabledRef.current) return;
    const ctx = getCtx();
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;

    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(0.6, t + 0.06);
    out.gain.exponentialRampToValueAtTime(0.28, t + 0.42);
    out.gain.exponentialRampToValueAtTime(0.0008, t + 0.85);
    out.connect(ctx.destination);

    // Motor: duas serras batendo (uma leve desafinação) subindo e caindo de rotação.
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(500, t);
    filt.frequency.exponentialRampToValueAtTime(3200, t + 0.4);
    filt.frequency.exponentialRampToValueAtTime(900, t + 0.82);
    filt.Q.value = 7;
    filt.connect(out);

    for (const det of [-8, 8]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.detune.value = det;
      o.frequency.setValueAtTime(85, t);
      o.frequency.exponentialRampToValueAtTime(430, t + 0.4); // acelera
      o.frequency.exponentialRampToValueAtTime(180, t + 0.82); // alivia
      o.connect(filt);
      o.start(t);
      o.stop(t + 0.9);
    }

    // Cantada de pneu: ruído passando por bandpass que varre agudo.
    const len = Math.floor(ctx.sampleRate * 0.5);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 0.9;
    bp.frequency.setValueAtTime(1200, t);
    bp.frequency.exponentialRampToValueAtTime(4200, t + 0.45);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.25, t);
    ng.gain.exponentialRampToValueAtTime(0.0008, t + 0.5);
    noise.connect(bp).connect(ng).connect(out);
    noise.start(t);
    noise.stop(t + 0.5);
  }, [getCtx]);

  const say = useCallback((texto: string) => {
    if (!enabledRef.current) return;
    try {
      const synth = window.speechSynthesis;
      if (!synth) return;
      const u = new SpeechSynthesisUtterance(texto);
      u.lang = 'pt-BR';
      u.rate = 1.08;
      u.pitch = 1.05;
      u.volume = 1;
      const ptVoice = synth.getVoices().find((v) => /pt[-_]?BR/i.test(v.lang)) || synth.getVoices().find((v) => /^pt/i.test(v.lang));
      if (ptVoice) u.voice = ptVoice;
      synth.cancel(); // evita fila acumulando em várias ultrapassagens seguidas
      synth.speak(u);
    } catch {
      /* voz indisponível — segue só com a zoada + banner */
    }
  }, []);

  // Silencia a fala pendente ao desmontar o telão.
  useEffect(() => {
    return () => {
      try {
        window.speechSynthesis?.cancel();
      } catch {
        /* ignora */
      }
    };
  }, []);

  return { vroom, say, enabled, setEnabled };
}

// Detecta ultrapassagens comparando a ordem anterior com a nova.
// prev/next: nome → índice no ranking (0 = líder). Retorna, no máximo `max`
// eventos mais significativos (maior salto de posições), cada um dizendo que
// A passou B (B é o mais bem posicionado que A deixou pra trás).
export interface Ultrapassagem {
  a: string;
  b: string;
  ganho: number;
}
export function detectarUltrapassagens(
  prev: Map<string, number>,
  nextOrder: string[],
  max = 2,
): Ultrapassagem[] {
  const nextIndex = new Map<string, number>();
  nextOrder.forEach((n, i) => nextIndex.set(n, i));
  const eventos: Ultrapassagem[] = [];

  for (const nome of nextOrder) {
    const pi = prev.get(nome);
    const ni = nextIndex.get(nome)!;
    if (pi == null || ni >= pi) continue; // entrou agora ou não subiu

    let passou: string | null = null;
    let passouNi = Infinity;
    for (const outro of nextOrder) {
      if (outro === nome) continue;
      const opi = prev.get(outro);
      const oni = nextIndex.get(outro)!;
      if (opi == null) continue;
      // 'outro' estava na frente antes (opi < pi) e agora está atrás (oni > ni)
      if (opi < pi && oni > ni && oni < passouNi) {
        passou = outro;
        passouNi = oni;
      }
    }
    if (passou) eventos.push({ a: nome, b: passou, ganho: pi - ni });
  }

  eventos.sort((x, y) => y.ganho - x.ganho);
  return eventos.slice(0, max);
}
