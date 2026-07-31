import { useCallback, useEffect, useRef, useState } from 'react';
import { cloudFunctions } from '@/lib/functionRouter';

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
// Voz de locutor (ElevenLabs). '0' = usa só a voz do navegador.
const LS_NARRATOR = 'telao_voz_locutor';

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

// ===================== Presets do som de ultrapassagem =====================
// 5 opções suaves, com clima de "subiu/venceu", sem ruído áspero. A escolha
// fica salva no localStorage. Cada função toca no ctx.currentTime.
export type OvertakePresetId = 'chime' | 'arcade' | 'whoosh' | 'fanfarrinha' | 'sino';
export interface OvertakePreset { id: OvertakePresetId; nome: string; desc: string; }
export const OVERTAKE_PRESETS: OvertakePreset[] = [
  { id: 'chime', nome: 'Chime', desc: 'Sininho subindo — leve e alegre' },
  { id: 'arcade', nome: 'Arcade', desc: 'Bliches de fase concluída, retrô' },
  { id: 'whoosh', nome: 'Whoosh', desc: 'Swoosh suave, bem discreto' },
  { id: 'fanfarrinha', nome: 'Fanfarrinha', desc: 'Ta-dá curtinho de metais' },
  { id: 'sino', nome: 'Sino', desc: 'Um toque de sino, limpo' },
];

function playChime(ctx: AudioContext) {
  const t0 = ctx.currentTime;
  const master = ctx.createGain();
  master.gain.value = 0.32;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 4500;
  master.connect(lp).connect(ctx.destination);
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
  nota(659.25, t0 + 0.0, 0.26, 0.5); // E5
  nota(830.61, t0 + 0.075, 0.26, 0.5); // G#5
  nota(987.77, t0 + 0.15, 0.3, 0.5); // B5
  nota(1318.51, t0 + 0.235, 0.5, 0.42); // E6
}

function playArcade(ctx: AudioContext) {
  const t0 = ctx.currentTime;
  const master = ctx.createGain();
  master.gain.value = 0.22;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 5200;
  master.connect(lp).connect(ctx.destination);
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
    const t = t0 + i * 0.06;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.09);
    g.connect(master);
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = f;
    o.connect(g);
    o.start(t);
    o.stop(t + 0.1);
  });
}

function playWhoosh(ctx: AudioContext) {
  const t0 = ctx.currentTime;
  const master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);
  const len = Math.floor(ctx.sampleRate * 0.5);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const noise = ctx.createBufferSource();
  noise.buffer = buf;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 1.2;
  bp.frequency.setValueAtTime(500, t0);
  bp.frequency.exponentialRampToValueAtTime(4000, t0 + 0.35);
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.0001, t0);
  ng.gain.exponentialRampToValueAtTime(0.32, t0 + 0.12);
  ng.gain.exponentialRampToValueAtTime(0.0008, t0 + 0.5);
  noise.connect(bp).connect(ng).connect(master);
  noise.start(t0);
  noise.stop(t0 + 0.5);
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(300, t0);
  o.frequency.exponentialRampToValueAtTime(900, t0 + 0.35);
  const og = ctx.createGain();
  og.gain.setValueAtTime(0.0001, t0);
  og.gain.exponentialRampToValueAtTime(0.18, t0 + 0.1);
  og.gain.exponentialRampToValueAtTime(0.0008, t0 + 0.45);
  o.connect(og).connect(master);
  o.start(t0);
  o.stop(t0 + 0.5);
}

function playFanfarrinha(ctx: AudioContext) {
  const t0 = ctx.currentTime;
  const master = ctx.createGain();
  master.gain.value = 0.28;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 2600;
  master.connect(lp).connect(ctx.destination);
  const brass = (f: number, t: number, dur: number) => {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    g.connect(master);
    for (const det of [-7, 7]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = det;
      o.connect(g);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
  };
  brass(392.0, t0, 0.16); // G4 (curto "ta")
  brass(523.25, t0 + 0.12, 0.42); // C5 (sustentado "dá")
}

function playSino(ctx: AudioContext) {
  const t0 = ctx.currentTime;
  const master = ctx.createGain();
  master.gain.value = 0.4;
  master.connect(ctx.destination);
  const base = 987.77; // B5
  ([[1, 0.5], [2.01, 0.3], [2.99, 0.16], [4.2, 0.09]] as [number, number][]).forEach(([ratio, gain]) => {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = base * ratio;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + 1.0);
    o.connect(g).connect(master);
    o.start(t0);
    o.stop(t0 + 1.05);
  });
}

const PRESET_PLAY: Record<OvertakePresetId, (ctx: AudioContext) => void> = {
  chime: playChime,
  arcade: playArcade,
  whoosh: playWhoosh,
  fanfarrinha: playFanfarrinha,
  sino: playSino,
};

// ===================== Narração (voz de locutor) =====================
// A voz é a do próprio navegador (SpeechSynthesis). Três detalhes fazem ela
// funcionar de verdade num telão que fica ligado o dia todo:
//   1. getVoices() volta [] na primeira chamada — a lista carrega assíncrona,
//      via evento 'voiceschanged'. Sem esperar, cai na voz padrão do Windows.
//   2. speak() no mesmo tick de cancel() é engolido (cancel é assíncrono).
//   3. o Chrome suspende o synth quando a aba passa horas em fullscreen; sem
//      resume() a fala entra na fila e nunca sai.
// Preferimos voz masculina pt-BR (Daniel, no Windows) com pitch grave pra dar
// clima de narração esportiva.
const VOZ_MASCULINA =
  /(daniel|ant[oô]nio|antonio|ricardo|felipe|thiago|jo[aã]o|paulo|h[eé]lio|heitor|f[aá]bio|male|homem|man\b)/i;

function escolherVoz(vozes: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const ptBR = vozes.filter((v) => /pt[-_]?BR/i.test(v.lang));
  const pt = ptBR.length ? ptBR : vozes.filter((v) => /^pt/i.test(v.lang));
  return pt.find((v) => VOZ_MASCULINA.test(v.name)) || pt[0] || null;
}

// Bordões de narrador. Sorteia sem repetir a frase anterior, pra não virar
// papagaio num telão que dispara isso o dia inteiro. Sem pronome de gênero —
// o ranking tem gente de todo tipo e a voz não vai errar com ninguém.
const BORDOES_ULTRAPASSAGEM: ((a: string, b: string) => string)[] = [
  (a, b) => `Olha lá, amigos! ${a} ultrapassou ${b}!`,
  (a, b) => `Que ultrapassagem! ${a} deixou ${b} pra trás!`,
  (a, b) => `Tá lá! ${a} passou ${b} por dentro!`,
  (a, b) => `Não acredito! ${a} tomou a posição de ${b}!`,
  (a, b) => `Haja coração! ${a} ultrapassou ${b}!`,
  (a, b) => `Voando baixo! ${a} passou ${b}!`,
  (a, b) => `Pegou a curva e foi! ${a} deixou ${b} no retrovisor!`,
];

const BORDOES_RECORDE: ((nome: string, passos: number) => string)[] = [
  (n, p) => `Amigos, novo recorde! ${n}, ${p} passos!`,
  (n, p) => `Isso é história! ${n} bateu o recorde com ${p} passos!`,
  (n, p) => `Novo recorde da casa! ${n}, ${p} passos!`,
  (n, p) => `Tá lá o recorde! ${n}, com ${p} passos!`,
  (n, p) => `Que fenômeno! ${n} fez ${p} passos e é o novo recorde!`,
];

function sorteiaDiferente(total: number, ultimo: number): number {
  if (total <= 1) return 0;
  let i = Math.floor(Math.random() * total);
  if (i === ultimo) i = (i + 1) % total;
  return i;
}

let ultimoUltra = -1;
export function narracaoUltrapassagem(a: string, b: string): string {
  ultimoUltra = sorteiaDiferente(BORDOES_ULTRAPASSAGEM.length, ultimoUltra);
  return BORDOES_ULTRAPASSAGEM[ultimoUltra](a, b);
}

let ultimoRecorde = -1;
export function narracaoRecorde(nome: string, passos: number): string {
  ultimoRecorde = sorteiaDiferente(BORDOES_RECORDE.length, ultimoRecorde);
  return BORDOES_RECORDE[ultimoRecorde](nome, passos);
}

const LS_PRESET = 'telao_overtake_preset';
function loadPreset(): OvertakePresetId {
  try {
    const v = window.localStorage.getItem(LS_PRESET) as OvertakePresetId | null;
    if (v && v in PRESET_PLAY) return v;
  } catch {
    /* ignora */
  }
  return 'chime';
}

export interface RaceSfx {
  vroom: () => void;
  recordSound: () => void;
  say: (texto: string) => void;
  /** Igual ao say, mas ignora o botão de som — é um teste explícito. */
  sayPreview: (texto: string) => void;
  /** Nome da voz que o navegador vai usar (null = nenhuma voz pt disponível). */
  voiceName: string | null;
  /** Voz de locutor (ElevenLabs) ligada. Desligada = só a voz do navegador. */
  narrator: boolean;
  setNarrator: (b: boolean) => void;
  /** De onde saiu a última narração — pro painel mostrar o que está valendo. */
  lastNarration: 'locutor' | 'navegador' | null;
  enabled: boolean;
  setEnabled: (b: boolean) => void;
  preset: OvertakePresetId;
  setPreset: (id: OvertakePresetId) => void;
  preview: (id: OvertakePresetId) => void;
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

  const [preset, setPresetState] = useState<OvertakePresetId>(loadPreset);
  const presetRef = useRef(preset);
  presetRef.current = preset;

  const ctxRef = useRef<AudioContext | null>(null);
  // Arquivo de recorde (opcional). fileOk vira true só quando carrega.
  const recordAudioRef = useRef<HTMLAudioElement | null>(null);
  const recordOkRef = useRef(false);
  // Narração: lista de vozes (carrega assíncrona) + referência da fala em curso
  // (sem guardar, o Chrome coleta a utterance no meio e a voz simplesmente some).
  const vozesRef = useRef<SpeechSynthesisVoice[]>([]);
  const [voiceName, setVoiceName] = useState<string | null>(null);
  // Voz de locutor (ElevenLabs via telao-narrar). Elemento de áudio reusado,
  // cache de URL por frase (a mesma frase não paga geração duas vezes) e um
  // "silêncio" temporário quando a rota responde que não dá (sem chave/crédito).
  const narrAudioRef = useRef<HTMLAudioElement | null>(null);
  const narrCacheRef = useRef<Map<string, string>>(new Map());
  const narrOffAteRef = useRef(0);
  const [narrator, setNarratorState] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(LS_NARRATOR) !== '0';
    } catch {
      return true;
    }
  });
  const narratorRef = useRef(narrator);
  narratorRef.current = narrator;
  const [lastNarration, setLastNarration] = useState<'locutor' | 'navegador' | null>(null);
  const falaRef = useRef<SpeechSynthesisUtterance | null>(null);
  const falaTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const vozAquecidaRef = useRef(false);

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

  // Aquece a voz junto com o áudio: o Chrome só deixa falar depois de um gesto
  // do usuário na página, e uma fala muda no clique já registra essa permissão.
  const aquecerVoz = useCallback(() => {
    if (vozAquecidaRef.current) return;
    try {
      const synth = window.speechSynthesis;
      if (!synth) return;
      synth.resume();
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      u.rate = 2;
      u.lang = 'pt-BR';
      synth.speak(u);
      vozAquecidaRef.current = true;
    } catch {
      /* sem voz — os sons continuam */
    }
  }, []);

  // Destrava o áudio no primeiro gesto (o telão pode nunca ter recebido clique).
  useEffect(() => {
    const unlock = () => {
      getCtx();
      aquecerVoz();
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, [getCtx, aquecerVoz]);

  // Lista de vozes: getVoices() volta [] na primeira chamada e só se popula no
  // evento 'voiceschanged'. Sem isso, a narração cai na voz padrão do sistema.
  useEffect(() => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    const carregar = () => {
      try {
        vozesRef.current = synth.getVoices() || [];
      } catch {
        vozesRef.current = [];
      }
      setVoiceName(escolherVoz(vozesRef.current)?.name ?? null);
    };
    carregar();
    synth.addEventListener?.('voiceschanged', carregar);
    return () => synth.removeEventListener?.('voiceschanged', carregar);
  }, []);

  // O Chrome suspende o synth quando a aba passa horas em fullscreen/segundo
  // plano: a fala vai pra fila e nunca sai. Um resume() periódico destrava.
  useEffect(() => {
    const id = setInterval(() => {
      try {
        const synth = window.speechSynthesis;
        if (synth?.paused) synth.resume();
      } catch {
        /* ignora */
      }
    }, 10_000);
    return () => clearInterval(id);
  }, []);

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

  // Ultrapassagem comum — toca o preset escolhido (todos suaves, "de vitória").
  const vroom = useCallback(() => {
    if (!enabledRef.current) return;
    const ctx = getCtx();
    if (!ctx || ctx.state !== 'running') return;
    PRESET_PLAY[presetRef.current]?.(ctx);
  }, [getCtx]);

  // Escolhe o preset (salva) e toca uma amostra pra ouvir na hora.
  const setPreset = useCallback((id: OvertakePresetId) => {
    setPresetState(id);
    try {
      window.localStorage.setItem(LS_PRESET, id);
    } catch {
      /* ignora */
    }
  }, []);

  // Testa qualquer preset, mesmo com os efeitos desligados (é um teste explícito).
  const preview = useCallback((id: OvertakePresetId) => {
    const ctx = getCtx();
    if (!ctx || ctx.state !== 'running') return;
    PRESET_PLAY[id]?.(ctx);
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

  const falarTexto = useCallback((texto: string) => {
    const synth = window.speechSynthesis;
    if (!synth) return;

    const falar = () => {
      try {
        const u = new SpeechSynthesisUtterance(texto);
        u.lang = 'pt-BR';
        u.rate = 1.12; // um tico acelerado, como locutor
        u.pitch = 0.9; // mais grave
        u.volume = 1;
        const voz = escolherVoz(vozesRef.current.length ? vozesRef.current : synth.getVoices() || []);
        if (voz) u.voice = voz;
        falaRef.current = u; // segura a referência até terminar (senão o GC come)
        u.onend = () => {
          if (falaRef.current === u) falaRef.current = null;
        };
        synth.resume(); // pode estar suspenso desde a última vez que a aba dormiu
        synth.speak(u);
      } catch {
        /* voz indisponível — segue só com o som + banner */
      }
    };

    try {
      if (falaTimerRef.current) clearTimeout(falaTimerRef.current);
      // cancel() é assíncrono: falar no mesmo tick faz o Chrome engolir a fala.
      // Só cancela quando há algo na fila, e aí espera o cancel assentar.
      if (synth.speaking || synth.pending) {
        synth.cancel();
        falaTimerRef.current = setTimeout(falar, 140);
      } else {
        falar();
      }
    } catch {
      /* ignora */
    }
  }, []);

  // Voz de locutor: pede o mp3 pro telao-narrar (Railway → ElevenLabs, com
  // cache no storage) e toca. Devolve false quando não rolou — aí quem chamou
  // cai na voz do navegador, que é feia mas nunca deixa o telão mudo.
  const narrarComLocutor = useCallback(async (texto: string): Promise<boolean> => {
    if (!narratorRef.current) return false;
    if (Date.now() < narrOffAteRef.current) return false; // silenciado após falha

    try {
      let url = narrCacheRef.current.get(texto);
      if (!url) {
        const { data, error } = await cloudFunctions.invoke<{
          success: boolean;
          audio_url?: string;
          reason?: string;
        }>('telao-narrar', { body: { texto } });

        if (error || !data?.success || !data.audio_url) {
          // Sem chave/crédito não adianta insistir a cada ultrapassagem:
          // segura a camada por 30 min e narra com a voz do navegador.
          const motivo = data?.reason || 'erro';
          const grave = motivo === 'sem_api_key' || motivo === 'sem_credito';
          narrOffAteRef.current = Date.now() + (grave ? 30 * 60_000 : 2 * 60_000);
          console.warn('[telao] narração de locutor indisponível:', motivo);
          return false;
        }
        url = data.audio_url;
        // Cache pequeno: o telão repete muito as mesmas frases num dia.
        if (narrCacheRef.current.size > 60) narrCacheRef.current.clear();
        narrCacheRef.current.set(texto, url);
      }

      if (!narrAudioRef.current) narrAudioRef.current = new Audio();
      const a = narrAudioRef.current;
      a.src = url;
      a.currentTime = 0;
      a.volume = 1;
      await a.play();
      setLastNarration('locutor');
      return true;
    } catch (e) {
      console.warn('[telao] falha ao tocar narração de locutor:', e);
      narrOffAteRef.current = Date.now() + 2 * 60_000;
      return false;
    }
  }, []);

  const narrar = useCallback((texto: string) => {
    void narrarComLocutor(texto).then((ok) => {
      if (ok) return;
      setLastNarration('navegador');
      falarTexto(texto);
    });
  }, [narrarComLocutor, falarTexto]);

  const say = useCallback((texto: string) => {
    if (!enabledRef.current) return;
    narrar(texto);
  }, [narrar]);

  // Teste explícito da narração: fala mesmo com o som desligado e, como vem de
  // um clique, também serve de gesto que libera a voz no Chrome.
  const sayPreview = useCallback((texto: string) => {
    aquecerVoz();
    narrar(texto);
  }, [aquecerVoz, narrar]);

  const setNarrator = useCallback((b: boolean) => {
    setNarratorState(b);
    narrOffAteRef.current = 0; // religar limpa o silêncio de uma falha anterior
    try {
      window.localStorage.setItem(LS_NARRATOR, b ? '1' : '0');
    } catch {
      /* ignora */
    }
  }, []);

  // Silencia a fala pendente ao desmontar o telão.
  useEffect(() => {
    return () => {
      try {
        if (falaTimerRef.current) clearTimeout(falaTimerRef.current);
        window.speechSynthesis?.cancel();
        narrAudioRef.current?.pause();
      } catch {
        /* ignora */
      }
    };
  }, []);

  return {
    vroom, recordSound, say, sayPreview, voiceName,
    narrator, setNarrator, lastNarration,
    enabled, setEnabled, preset, setPreset, preview,
  };
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
