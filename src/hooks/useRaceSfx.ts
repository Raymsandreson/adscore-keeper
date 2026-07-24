import { useCallback, useEffect, useRef, useState } from 'react';

// useRaceSfx — efeitos sonoros do telão da Corrida Maluca.
//   • vroom(): zoada de aceleração (motor cantando pneu) numa ultrapassagem comum
//   • recordSound(): som de RECORDE — toca um arquivo configurável (ex.: o clipe
//     que vocês escolherem); se não houver/falhar, cai numa fanfarra sintetizada.
//   • say(texto): narra em voz alta (pt-BR, SpeechSynthesis)
//
// Áudio no navegador só desbloqueia após um gesto do usuário. Como o telão
// atualiza sozinho, deixamos um "destravador" no primeiro clique/tecla: a
// partir daí os efeitos tocam mesmo nas atualizações automáticas.
//
// enabled fica salvo no localStorage pra o telão lembrar entre recargas.

const LS_KEY = 'telao_sfx_on';

// Som de RECORDE: um ARQUIVO configurável toca quando alguém bate o recorde de
// passos do período. Ordem de prioridade:
//   1. ?record=<url> na URL do telão
//   2. localStorage['telao_record_url']
//   3. /telao-record.mp3 (é só soltar o arquivo em public/)
// Se o arquivo não existir/carregar, cai numa fanfarra sintetizada (Web Audio).
const LS_RECORD_URL = 'telao_record_url';
const DEFAULT_RECORD_FILE = '/telao-record.mp3';

function resolveRecordUrl(): string {
  try {
    const q = new URLSearchParams(window.location.search).get('record');
    if (q) return q;
    const ls = window.localStorage.getItem(LS_RECORD_URL);
    if (ls) return ls;
  } catch {
    /* indisponível — usa o padrão */
  }
  return DEFAULT_RECORD_FILE;
}

export interface RaceSfx {
  vroom: () => void;
  recordSound: () => void;
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
  // Arquivo de recorde (opcional). fileOk vira true só quando carrega.
  const recordAudioRef = useRef<HTMLAudioElement | null>(null);
  const recordOkRef = useRef(false);

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

  // Probe do arquivo de recorde: só marca ok quando dá pra tocar.
  useEffect(() => {
    let a: HTMLAudioElement | null = null;
    try {
      a = new Audio(resolveRecordUrl());
      a.preload = 'auto';
      const ok = () => { recordOkRef.current = true; };
      const bad = () => { recordOkRef.current = false; };
      a.addEventListener('canplaythrough', ok);
      a.addEventListener('error', bad);
      recordAudioRef.current = a;
      a.load();
    } catch {
      recordOkRef.current = false;
    }
    return () => {
      a?.pause();
      recordAudioRef.current = null;
    };
  }, []);

  const setEnabled = useCallback((b: boolean) => {
    setEnabledState(b);
    try {
      window.localStorage.setItem(LS_KEY, b ? '1' : '0');
    } catch {
      /* ignora */
    }
  }, []);

  const env = (g: GainNode, t: number, a: number, d: number, pico: number) => {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(pico, t + a);
    g.gain.exponentialRampToValueAtTime(0.0008, t + a + d);
  };

  // Ultrapassagem comum — chime ascendente suave (sensação de "subiu/venceu").
  // Sem ruído áspero: não assusta nem incomoda no ambiente.
  const vroom = useCallback(() => {
    if (!enabledRef.current) return;
    const ctx = getCtx();
    if (!ctx || ctx.state !== 'running') return;
    const t0 = ctx.currentTime;

    const master = ctx.createGain();
    master.gain.value = 0.32; // volume ameno
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 4500; // tira o agudo áspero, som "quentinho"
    master.connect(lp).connect(ctx.destination);

    // Notinha tipo sininho: triângulo + um harmônico sine baixinho.
    const nota = (freq: number, t: number, dur: number, pico: number) => {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(pico, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
      g.connect(master);
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = freq;
      o.connect(g);
      o.start(t);
      o.stop(t + dur + 0.05);
      const h = ctx.createOscillator();
      h.type = 'sine';
      h.frequency.value = freq * 2;
      const hg = ctx.createGain();
      hg.gain.value = 0.16;
      h.connect(hg).connect(g);
      h.start(t);
      h.stop(t + dur + 0.05);
    };

    // Arpejo maior ascendente E–G#–B e remate uma oitava acima (E6) = "vitória".
    nota(659.25, t0 + 0.0, 0.26, 0.5); // E5
    nota(830.61, t0 + 0.075, 0.26, 0.5); // G#5
    nota(987.77, t0 + 0.15, 0.3, 0.5); // B5
    nota(1318.51, t0 + 0.235, 0.5, 0.42); // E6 (remate sustentado)
  }, [getCtx]);

  // Fanfarra sintetizada — reserva do som de recorde quando não há arquivo.
  const synthFanfarra = useCallback(() => {
    const ctx = getCtx();
    if (!ctx || ctx.state !== 'running') return;
    const t0 = ctx.currentTime;

    const master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);

    // Arpejo triunfal C–E–G–C subindo + acorde sustentado (metais).
    const notas = [523.25, 659.25, 783.99, 1046.5];
    notas.forEach((f, i) => {
      const t = t0 + i * 0.1;
      const g = ctx.createGain();
      env(g, t, 0.02, 0.28, 0.35);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 3000;
      g.connect(lp).connect(master);
      for (const det of [-6, 6]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f;
        o.detune.value = det;
        o.connect(g);
        o.start(t);
        o.stop(t + 0.34);
      }
    });
    // Acorde final sustentado.
    const tc = t0 + 0.42;
    const gc = ctx.createGain();
    env(gc, tc, 0.03, 0.9, 0.4);
    const lpc = ctx.createBiquadFilter();
    lpc.type = 'lowpass';
    lpc.frequency.value = 3200;
    gc.connect(lpc).connect(master);
    for (const f of [523.25, 659.25, 783.99]) {
      for (const det of [-7, 7]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f;
        o.detune.value = det;
        o.connect(gc);
        o.start(tc);
        o.stop(tc + 1.0);
      }
    }
    // Prato (crash) — ruído com decaimento longo.
    const len = Math.floor(ctx.sampleRate * 1.1);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 1.5);
    const crash = ctx.createBufferSource();
    crash.buffer = buf;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 6000;
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(0.3, t0);
    cg.gain.exponentialRampToValueAtTime(0.0008, t0 + 1.1);
    crash.connect(hp).connect(cg).connect(master);
    crash.start(t0);
    crash.stop(t0 + 1.1);
  }, [getCtx]);

  // Som de RECORDE: arquivo configurável; se não houver/falhar, fanfarra.
  const recordSound = useCallback(() => {
    if (!enabledRef.current) return;
    const a = recordAudioRef.current;
    if (a && recordOkRef.current) {
      try {
        a.currentTime = 0;
        void a.play().catch(() => synthFanfarra());
        return;
      } catch {
        /* falhou o replay do arquivo → fanfarra */
      }
    }
    synthFanfarra();
  }, [synthFanfarra]);

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
      const ptVoice =
        synth.getVoices().find((v) => /pt[-_]?BR/i.test(v.lang)) ||
        synth.getVoices().find((v) => /^pt/i.test(v.lang));
      if (ptVoice) u.voice = ptVoice;
      synth.cancel(); // evita fila acumulando em vários eventos seguidos
      synth.speak(u);
    } catch {
      /* voz indisponível — segue só com o som + banner */
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

  return { vroom, recordSound, say, enabled, setEnabled };
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
