import { useCallback, useEffect, useRef, useState } from 'react';

// useRaceMusic — trilha do telão da "Corrida Maluca".
// Toca um ARQUIVO de áudio se houver um configurado; se não houver (ou falhar
// ao carregar), cai numa TRILHA SINTETIZADA original via Web Audio — sem
// depender de nenhum asset e sem risco de direito autoral.
//
// Fonte do arquivo, em ordem de prioridade:
//   1. ?musica=<url> na URL do telão
//   2. localStorage['telao_musica_url']
//   3. /telao-musica.mp3 (é só soltar o arquivo em public/)
//
// Áudio no navegador só inicia após um gesto do usuário (clicar no botão),
// então nada toca sozinho — é play/pausa quando quiser.

export type MusicSource = 'file' | 'synth' | null;

const DEFAULT_FILE = '/telao-musica.mp3';
const LS_KEY = 'telao_musica_url';

function resolveFileUrl(): string {
  try {
    const q = new URLSearchParams(window.location.search).get('musica');
    if (q) return q;
    const ls = window.localStorage.getItem(LS_KEY);
    if (ls) return ls;
  } catch {
    /* localStorage/URL indisponível — usa o padrão */
  }
  return DEFAULT_FILE;
}

/* ===================== Motor sintetizado (Web Audio) ===================== */

interface SynthController {
  start: () => void;
  stop: () => void;
  setVolume: (v: number) => void;
  dispose: () => void;
}

const LOOKAHEAD = 0.1; // s agendados à frente
const INTERVALO = 25; // ms do relógio
const TEMPO = 152; // BPM
const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);
const volCurve = (v: number) => Math.pow(Math.max(0, Math.min(1, v)), 1.4) * 0.9;

// Progressão de 8 compassos (raiz em midi + intervalos do acorde).
const ACORDES = [
  { r: 48, t: [0, 4, 7] }, // C
  { r: 43, t: [0, 4, 7] }, // G
  { r: 45, t: [0, 3, 7] }, // Am
  { r: 41, t: [0, 4, 7] }, // F
  { r: 48, t: [0, 4, 7] }, // C
  { r: 43, t: [0, 4, 7] }, // G
  { r: 41, t: [0, 4, 7] }, // F
  { r: 43, t: [0, 4, 7] }, // G (turnaround)
];
const KICK = [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0];
const SNARE = [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1];
const HAT = [1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 1, 1];
const C5 = 72;
// melodia por compasso: [passo, grau (semitons acima de C5), duração em passos]
const MEL: number[][][] = [
  [[0, 4, 2], [2, 7, 2], [4, 12, 2], [6, 7, 1], [7, 9, 1], [10, 7, 2], [12, 4, 2], [14, 2, 2]],
  [[0, 2, 2], [2, 7, 2], [4, 11, 2], [8, 7, 2], [10, 11, 1], [11, 12, 1], [12, 14, 4]],
  [[0, 12, 2], [2, 9, 2], [4, 7, 2], [6, 4, 2], [8, 9, 2], [10, 12, 2], [12, 16, 2], [14, 12, 2]],
  [[0, 9, 2], [2, 12, 2], [4, 17, 2], [8, 12, 2], [10, 9, 2], [12, 5, 4]],
  [[0, 4, 2], [2, 7, 2], [4, 12, 2], [6, 7, 1], [7, 9, 1], [10, 12, 2], [12, 16, 2], [14, 12, 2]],
  [[0, 14, 2], [2, 11, 2], [4, 7, 2], [6, 11, 2], [8, 14, 2], [12, 11, 2], [14, 7, 2]],
  [[0, 17, 2], [2, 12, 2], [4, 9, 2], [8, 12, 2], [10, 17, 2], [12, 16, 1], [13, 14, 1], [14, 12, 2]],
  [[0, 14, 2], [2, 11, 2], [4, 7, 2], [6, 5, 2], [8, 2, 2], [10, 7, 2], [12, 11, 2], [14, 7, 2]],
];

function createSynth(initialVol: number): SynthController {
  const AC: typeof AudioContext =
    window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new AC();
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.knee.value = 24;
  comp.ratio.value = 3;
  comp.attack.value = 0.004;
  comp.release.value = 0.18;
  const master = ctx.createGain();
  master.gain.value = 0;
  comp.connect(master).connect(ctx.destination);

  let running = false;
  let step = 0;
  let next = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let vol = initialVol;

  const env = (g: GainNode, t: number, a: number, d: number, pico: number) => {
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(pico, t + a);
    g.gain.exponentialRampToValueAtTime(0.0008, t + a + d);
  };
  const kick = (t: number) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.13);
    env(g, t, 0.002, 0.26, 1);
    o.connect(g).connect(comp);
    o.start(t);
    o.stop(t + 0.3);
  };
  const noiseBuffer = (len: number, fade: boolean) => {
    const b = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (fade ? 1 - i / len : 1);
    return b;
  };
  const snare = (t: number) => {
    const s = ctx.createBufferSource();
    s.buffer = noiseBuffer(2200, true);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1900;
    f.Q.value = 0.8;
    const g = ctx.createGain();
    env(g, t, 0.001, 0.18, 0.5);
    s.connect(f).connect(g).connect(comp);
    s.start(t);
    s.stop(t + 0.2);
  };
  const hat = (t: number, ac: boolean) => {
    const s = ctx.createBufferSource();
    s.buffer = noiseBuffer(900, false);
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 7500;
    const g = ctx.createGain();
    env(g, t, 0.001, ac ? 0.06 : 0.03, ac ? 0.28 : 0.16);
    s.connect(f).connect(g).connect(comp);
    s.start(t);
    s.stop(t + 0.09);
  };
  const baixo = (t: number, freq: number, dur: number) => {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = freq;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 420;
    f.Q.value = 6;
    const g = ctx.createGain();
    env(g, t, 0.006, dur, 0.32);
    o.connect(f).connect(g).connect(comp);
    o.start(t);
    o.stop(t + dur + 0.05);
  };
  const metal = (t: number, freqs: number[], dur: number) => {
    const g = ctx.createGain();
    env(g, t, 0.012, dur, 0.16);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 2600;
    f.Q.value = 0.7;
    g.connect(f).connect(comp);
    freqs.forEach((fr, i) => {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = fr;
      o.detune.value = (i - 1) * 7;
      o.connect(g);
      o.start(t);
      o.stop(t + dur + 0.05);
    });
  };
  const lead = (t: number, freq: number, dur: number) => {
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = freq;
    const vib = ctx.createOscillator();
    const vg = ctx.createGain();
    vib.frequency.value = 6;
    vg.gain.value = freq * 0.012;
    vib.connect(vg).connect(o.frequency);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 3400;
    const g = ctx.createGain();
    env(g, t, 0.008, dur, 0.2);
    o.connect(f).connect(g).connect(comp);
    o.start(t);
    vib.start(t);
    o.stop(t + dur + 0.05);
    vib.stop(t + dur + 0.05);
  };

  const agendarPasso = (passo: number, t: number) => {
    const sps = passo % 16;
    const comp16 = Math.floor(passo / 16) % 8;
    const ac = ACORDES[comp16];
    if (KICK[sps]) kick(t);
    if (SNARE[sps]) snare(t);
    if (HAT[sps]) hat(t, sps % 4 === 0);
    if (sps % 2 === 0) {
      const oct = sps % 8 === 4 ? 12 : 0;
      baixo(t, midi(ac.r - 12 + oct), 0.16);
    }
    if (sps === 0 || sps === 8) metal(t, ac.t.map((iv) => midi(ac.r + iv)), sps === 0 ? 0.5 : 0.34);
    const semi = 60 / TEMPO / 4;
    for (const [p, grau, dur] of MEL[comp16]) {
      if (p === sps) lead(t, midi(C5 + grau - 12), dur * semi * 0.9);
    }
  };

  const relogio = () => {
    while (next < ctx.currentTime + LOOKAHEAD) {
      const semi = 60 / TEMPO / 4;
      const atraso = step % 2 === 1 ? semi * 0.1 : 0; // swing bouncy
      agendarPasso(step, next + atraso);
      next += semi;
      step++;
    }
    timer = setTimeout(relogio, INTERVALO);
  };

  return {
    start() {
      if (ctx.state === 'suspended') void ctx.resume();
      if (running) return;
      running = true;
      step = 0;
      next = ctx.currentTime + 0.08;
      const t = ctx.currentTime;
      master.gain.cancelScheduledValues(t);
      master.gain.setValueAtTime(master.gain.value, t);
      master.gain.linearRampToValueAtTime(volCurve(vol), t + 0.25);
      relogio();
    },
    stop() {
      if (!running) return;
      running = false;
      if (timer) clearTimeout(timer);
      timer = null;
      const t = ctx.currentTime;
      master.gain.cancelScheduledValues(t);
      master.gain.setValueAtTime(master.gain.value, t);
      master.gain.linearRampToValueAtTime(0.0001, t + 0.2);
    },
    setVolume(v: number) {
      vol = v;
      if (running) master.gain.setTargetAtTime(volCurve(v), ctx.currentTime, 0.04);
    },
    dispose() {
      if (timer) clearTimeout(timer);
      timer = null;
      void ctx.close();
    },
  };
}

/* ===================== Hook público ===================== */

export interface RaceMusic {
  playing: boolean;
  source: MusicSource;
  volume: number;
  toggle: () => void;
  play: () => void;
  pause: () => void;
  setVolume: (v: number) => void;
}

export function useRaceMusic(): RaceMusic {
  const [playing, setPlaying] = useState(false);
  const [source, setSource] = useState<MusicSource>(null);
  const [volume, setVolumeState] = useState(0.7);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const synthRef = useRef<SynthController | null>(null);
  const volRef = useRef(volume);
  volRef.current = volume;

  const startSynth = useCallback(() => {
    if (!synthRef.current) synthRef.current = createSynth(volRef.current);
    synthRef.current.start();
    setSource('synth');
    setPlaying(true);
  }, []);

  const play = useCallback(() => {
    // 1ª tentativa: arquivo de áudio. Falhou → trilha sintetizada.
    if (!audioRef.current) {
      const a = new Audio(resolveFileUrl());
      a.loop = true;
      a.preload = 'auto';
      a.volume = volRef.current;
      audioRef.current = a;
    }
    const a = audioRef.current;
    a.volume = volRef.current;
    a.play()
      .then(() => {
        setSource('file');
        setPlaying(true);
      })
      .catch(() => {
        // sem arquivo servível (404/decodificação/bloqueio) → cai no sintetizado
        startSynth();
      });
  }, [startSynth]);

  const pause = useCallback(() => {
    audioRef.current?.pause();
    synthRef.current?.stop();
    setPlaying(false);
  }, []);

  const toggle = useCallback(() => {
    if (playing) pause();
    else play();
  }, [playing, play, pause]);

  const setVolume = useCallback((v: number) => {
    const clamped = Math.max(0, Math.min(1, v));
    setVolumeState(clamped);
    if (audioRef.current) audioRef.current.volume = clamped;
    synthRef.current?.setVolume(clamped);
  }, []);

  // Se o arquivo der erro DEPOIS de começar (ex.: rede caiu), cai no sintetizado.
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onErr = () => {
      if (source === 'file') startSynth();
    };
    a.addEventListener('error', onErr);
    return () => a.removeEventListener('error', onErr);
  }, [source, startSynth]);

  // Limpeza ao desmontar o telão.
  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      synthRef.current?.dispose();
    };
  }, []);

  return { playing, source, volume, toggle, play, pause, setVolume };
}
