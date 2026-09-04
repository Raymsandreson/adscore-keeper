// Helpers de ligação de voz WebRTC (assessor -> assessor) pelo chat interno.
// Zero custo por minuto: peer-to-peer + STUN público. Sinalização vai por
// Supabase Realtime broadcast (ver CallContext).

/**
 * STUN públicos do Google. Cobrem a maioria dos NATs (casa/escritório comum).
 * Redes corporativas com NAT simétrico podem exigir um TURN dedicado (Fase 2).
 */
export const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

export function createPeerConnection(): RTCPeerConnection {
  return new RTCPeerConnection({ iceServers: ICE_SERVERS });
}

/** Pede o microfone (só áudio). Lança se o usuário negar. */
export function getMicStream(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({ audio: true, video: false });
}

/** Como um toque soa: frequência, volume, onde cada bipe cai no ciclo. */
export interface RingtoneOptions {
  /** Frequência do tom, em Hz. */
  freq?: number;
  /** Volume de pico (0–1). */
  volume?: number;
  /** Início de cada bipe dentro do ciclo, em segundos. */
  offsets?: number[];
  /** Duração de cada bipe, em segundos. */
  duration?: number;
  /** Tamanho do ciclo, em ms. */
  periodMs?: number;
}

/**
 * Chamada SAINDO ("tuu… tuu…"): 1 segundo de tom e 4 de silêncio, o padrão
 * brasileiro. Sem isso quem liga fica no escuro até o outro atender — não dá
 * pra saber se está chamando ou se travou.
 */
export const RINGBACK: RingtoneOptions = {
  freq: 425,
  volume: 0.07,
  offsets: [0],
  duration: 1,
  periodMs: 5000,
};

/**
 * Toque de chamada gerado via WebAudio — sem depender de arquivo de áudio.
 * Sem opções: dois bipes curtos repetidos, o toque de quem está RECEBENDO.
 */
export class Ringtone {
  private ctx: AudioContext | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly freq: number;
  private readonly volume: number;
  private readonly offsets: number[];
  private readonly duration: number;
  private readonly periodMs: number;

  constructor(opts: RingtoneOptions = {}) {
    this.freq = opts.freq ?? 480;
    this.volume = opts.volume ?? 0.15;
    this.offsets = opts.offsets ?? [0, 0.25];
    this.duration = opts.duration ?? 0.18;
    this.periodMs = opts.periodMs ?? 2000;
  }

  start() {
    if (this.timer) return;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();
      const beep = () => {
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        this.offsets.forEach((off) => this.playTone(now + off, this.duration));
      };
      beep();
      this.timer = setInterval(beep, this.periodMs);
    } catch {
      // silencioso — ringtone é secundário
    }
  }

  private playTone(startAt: number, duration: number) {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = this.freq;
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(this.volume, startAt + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(startAt);
    osc.stop(startAt + duration + 0.02);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.ctx) {
      this.ctx.close().catch(() => {});
      this.ctx = null;
    }
  }
}

/**
 * Grava a conversa inteira misturando os dois lados (meu microfone + a voz que
 * chega do outro) num único áudio, via WebAudio. Usado para depois transcrever
 * e resumir a ligação.
 */
export class CallRecorder {
  private ctx: AudioContext | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private mime = 'audio/webm';

  /** Começa a gravar a mistura de local + remoto. Silencioso em caso de erro. */
  start(local: MediaStream, remote: MediaStream): boolean {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx || typeof MediaRecorder === 'undefined') return false;
      this.ctx = new AudioCtx();
      const dest = this.ctx.createMediaStreamDestination();
      [local, remote].forEach((s) => {
        if (s && s.getAudioTracks().length > 0) {
          this.ctx!.createMediaStreamSource(s).connect(dest);
        }
      });
      this.mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : '';
      this.recorder = this.mime
        ? new MediaRecorder(dest.stream, { mimeType: this.mime })
        : new MediaRecorder(dest.stream);
      this.chunks = [];
      this.recorder.ondataavailable = (e) => { if (e.data.size > 0) this.chunks.push(e.data); };
      this.recorder.start();
      return true;
    } catch {
      this.dispose();
      return false;
    }
  }

  /** Para a gravação e devolve o áudio (ou null se nada foi capturado). */
  stop(): Promise<Blob | null> {
    return new Promise((resolve) => {
      const rec = this.recorder;
      const type = this.mime || 'audio/webm';
      if (!rec || rec.state === 'inactive') {
        const blob = this.chunks.length ? new Blob(this.chunks, { type }) : null;
        this.dispose();
        resolve(blob);
        return;
      }
      rec.onstop = () => {
        const blob = this.chunks.length ? new Blob(this.chunks, { type }) : null;
        this.dispose();
        resolve(blob);
      };
      try { rec.stop(); } catch { this.dispose(); resolve(null); }
    });
  }

  private dispose() {
    try { this.ctx?.close(); } catch { /* noop */ }
    this.ctx = null;
    this.recorder = null;
  }
}

export type CallSignalEvent = 'offer' | 'answer' | 'ice' | 'hangup' | 'reject';

export interface CallSignalPayload {
  from: string;
  fromName?: string;
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
}
