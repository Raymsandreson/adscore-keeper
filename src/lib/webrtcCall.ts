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

/**
 * Toque de chamada gerado via WebAudio — sem depender de arquivo de áudio.
 * Dois bipes curtos repetidos, no padrão de telefone.
 */
export class Ringtone {
  private ctx: AudioContext | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  start() {
    if (this.timer) return;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();
      const beep = () => {
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        this.playTone(now, 0.18);
        this.playTone(now + 0.25, 0.18);
      };
      beep();
      this.timer = setInterval(beep, 2000);
    } catch {
      // silencioso — ringtone é secundário
    }
  }

  private playTone(startAt: number, duration: number) {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 480;
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(0.15, startAt + 0.02);
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

export type CallSignalEvent = 'offer' | 'answer' | 'ice' | 'hangup' | 'reject';

export interface CallSignalPayload {
  from: string;
  fromName?: string;
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
}
