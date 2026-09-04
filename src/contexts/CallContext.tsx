import { createContext, useContext, useEffect, useRef, useState, useCallback, ReactNode } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { externalSupabase, ensureExternalSession } from '@/integrations/supabase/external-client';
import { useAuthContext } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import {
  createPeerConnection,
  getMicStream,
  Ringtone,
  CallRecorder,
  type CallSignalEvent,
  type CallSignalPayload,
} from '@/lib/webrtcCall';

type CallStatus = 'idle' | 'calling' | 'incoming' | 'connecting' | 'connected';

/** Gravação de uma ligação já encerrada, aguardando transcrição/resumo. */
export interface PendingCallRecording {
  blob: Blob;
  remoteName: string;
  durationSec: number;
}

interface CallContextValue {
  status: CallStatus;
  remoteName: string | null;
  remoteId: string | null;
  muted: boolean;
  durationSec: number;
  remoteStream: MediaStream | null;
  /** Gravação da última ligação encerrada (null enquanto não há nada a resumir). */
  pendingRecording: PendingCallRecording | null;
  clearPendingRecording: () => void;
  /** Inicia uma ligação de voz para outro membro da equipe. */
  startCall: (targetUserId: string, targetName: string) => void;
  acceptCall: () => void;
  rejectCall: () => void;
  hangup: () => void;
  toggleMute: () => void;
}

const CallContext = createContext<CallContextValue | undefined>(undefined);

const inboxName = (userId: string) => `webrtc-inbox-${userId}`;
const RING_TIMEOUT_MS = 40_000;

export function CallProvider({ children }: { children: ReactNode }) {
  const { user, profile } = useAuthContext();
  const myId = user?.id ?? null;
  const myName = profile?.full_name || user?.email || 'Equipe';

  const [status, setStatus] = useState<CallStatus>('idle');
  const [remoteName, setRemoteName] = useState<string | null>(null);
  const [remoteId, setRemoteId] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [durationSec, setDurationSec] = useState(0);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [pendingRecording, setPendingRecording] = useState<PendingCallRecording | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const inboxRef = useRef<RealtimeChannel | null>(null);
  const outChannelRef = useRef<RealtimeChannel | null>(null);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const incomingOfferRef = useRef<RTCSessionDescriptionInit | null>(null);
  const remoteIdRef = useRef<string | null>(null);
  const durationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ringTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // timeout de estabelecimento da conexão do lado de quem atende (callee)
  const connectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ringtoneRef = useRef<Ringtone | null>(null);
  // gravação da chamada (mistura os dois lados) p/ transcrição posterior
  const recorderRef = useRef<CallRecorder | null>(null);
  const recordingActiveRef = useRef(false);
  const connectedAtRef = useRef<number | null>(null);
  const remoteNameRef = useRef<string>('Colega');
  // status espelhado em ref p/ handlers assíncronos não pegarem valor velho
  const statusRef = useRef<CallStatus>('idle');
  statusRef.current = status;
  const myNameRef = useRef(myName);
  myNameRef.current = myName;

  const clearPendingRecording = useCallback(() => setPendingRecording(null), []);

  // ---- helpers de sinalização ----

  const joinChannel = useCallback((name: string): Promise<RealtimeChannel> => {
    return new Promise((resolve, reject) => {
      const ch = externalSupabase.channel(name, { config: { broadcast: { ack: false, self: false } } });
      ch.subscribe((s) => {
        if (s === 'SUBSCRIBED') resolve(ch);
        else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') reject(new Error(s));
      });
    });
  }, []);

  const ensureOutChannel = useCallback(async (targetId: string) => {
    if (outChannelRef.current) return outChannelRef.current;
    const ch = await joinChannel(inboxName(targetId));
    outChannelRef.current = ch;
    return ch;
  }, [joinChannel]);

  const sendSignal = useCallback((event: CallSignalEvent, payload: Partial<CallSignalPayload>) => {
    const ch = outChannelRef.current;
    if (!ch || !myId) return;
    // Falha de canal nunca pode abortar quem chamou (hangup precisa sempre limpar).
    try {
      ch.send({
        type: 'broadcast',
        event,
        payload: { from: myId, fromName: myNameRef.current, ...payload } as CallSignalPayload,
      });
    } catch (e) {
      console.warn('[Call] sendSignal falhou:', event, e);
    }
  }, [myId]);

  // ---- ciclo de vida da chamada ----

  const stopDurationTimer = useCallback(() => {
    if (durationTimerRef.current) {
      clearInterval(durationTimerRef.current);
      durationTimerRef.current = null;
    }
  }, []);

  const cleanup = useCallback((opts?: { silent?: boolean }) => {
    stopDurationTimer();
    if (ringTimeoutRef.current) {
      clearTimeout(ringTimeoutRef.current);
      ringTimeoutRef.current = null;
    }
    if (connectTimeoutRef.current) {
      clearTimeout(connectTimeoutRef.current);
      connectTimeoutRef.current = null;
    }
    try { ringtoneRef.current?.stop(); } catch { /* noop */ }
    // Fecha a gravação ANTES de derrubar os streams e guarda o áudio p/ resumo.
    if (recordingActiveRef.current && recorderRef.current) {
      recordingActiveRef.current = false;
      const capturedName = remoteNameRef.current || 'Colega';
      const dur = connectedAtRef.current
        ? Math.round((Date.now() - connectedAtRef.current) / 1000)
        : 0;
      recorderRef.current.stop().then((blob) => {
        // só oferece resumo se a conversa teve alguns segundos de fato
        if (blob && blob.size > 0 && dur >= 3) {
          setPendingRecording({ blob, remoteName: capturedName, durationSec: dur });
        }
      }).catch(() => { /* noop */ });
    }
    connectedAtRef.current = null;
    if (pcRef.current) {
      try {
        pcRef.current.ontrack = null;
        pcRef.current.onicecandidate = null;
        pcRef.current.onconnectionstatechange = null;
        pcRef.current.close();
      } catch { /* noop */ }
      pcRef.current = null;
    }
    if (localStreamRef.current) {
      try { localStreamRef.current.getTracks().forEach((t) => t.stop()); } catch { /* noop */ }
      localStreamRef.current = null;
    }
    remoteStreamRef.current = null;
    if (outChannelRef.current) {
      // Nunca deixar a limpeza de canal impedir o reset de estado (senão o card
      // de chamada fica preso na tela e o usuário não consegue desligar).
      try { externalSupabase.removeChannel(outChannelRef.current); } catch { /* noop */ }
      outChannelRef.current = null;
    }
    pendingCandidatesRef.current = [];
    incomingOfferRef.current = null;
    remoteIdRef.current = null;
    setStatus('idle');
    setRemoteName(null);
    setRemoteId(null);
    setRemoteStream(null);
    setMuted(false);
    setDurationSec(0);
    if (!opts?.silent) { /* placeholder p/ toasts externos */ }
  }, [stopDurationTimer]);

  const attachPcHandlers = useCallback((pc: RTCPeerConnection) => {
    pc.onicecandidate = (e) => {
      if (e.candidate) sendSignal('ice', { candidate: e.candidate.toJSON() });
    };
    pc.ontrack = (e) => {
      const stream = e.streams[0] ?? null;
      remoteStreamRef.current = stream;
      setRemoteStream(stream);
    };
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      if (st === 'connected') {
        ringtoneRef.current?.stop();
        if (ringTimeoutRef.current) { clearTimeout(ringTimeoutRef.current); ringTimeoutRef.current = null; }
        if (connectTimeoutRef.current) { clearTimeout(connectTimeoutRef.current); connectTimeoutRef.current = null; }
        setStatus('connected');
        if (!durationTimerRef.current) {
          setDurationSec(0);
          durationTimerRef.current = setInterval(() => setDurationSec((d) => d + 1), 1000);
        }
        // inicia a gravação (mistura os dois lados) uma única vez ao conectar
        if (!recordingActiveRef.current && localStreamRef.current && remoteStreamRef.current) {
          if (!recorderRef.current) recorderRef.current = new CallRecorder();
          const started = recorderRef.current.start(localStreamRef.current, remoteStreamRef.current);
          recordingActiveRef.current = started;
          if (started) connectedAtRef.current = Date.now();
        }
      } else if (st === 'failed' || st === 'disconnected' || st === 'closed') {
        // se cair depois de conectado, encerra
        if (statusRef.current === 'connected') {
          toast.info('Chamada encerrada');
          cleanup();
        }
      }
    };
  }, [sendSignal, cleanup]);

  const startCall = useCallback(async (targetUserId: string, targetName: string) => {
    if (!myId) return;
    if (statusRef.current !== 'idle') {
      toast.error('Você já está em uma chamada.');
      return;
    }
    if (targetUserId === myId) return;

    try {
      setStatus('calling');
      setRemoteId(targetUserId);
      setRemoteName(targetName);
      remoteIdRef.current = targetUserId;
      remoteNameRef.current = targetName;

      // Canal de sinalização primeiro: garante que hangup/timeout consigam avisar
      // o outro lado mesmo se o microfone falhar depois.
      await ensureOutChannel(targetUserId);

      const stream = await getMicStream();
      localStreamRef.current = stream;

      const pc = createPeerConnection();
      pcRef.current = pc;
      attachPcHandlers(pc);
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      sendSignal('offer', { sdp: offer });

      ringTimeoutRef.current = setTimeout(() => {
        if (statusRef.current === 'calling') {
          sendSignal('hangup', {});
          toast.info(`${targetName} não atendeu.`);
          cleanup();
        }
      }, RING_TIMEOUT_MS);
    } catch (err: any) {
      console.error('[Call] startCall error:', err);
      toast.error(
        err?.name === 'NotAllowedError'
          ? 'Permissão de microfone negada.'
          : `Não foi possível iniciar a chamada (${err?.name || 'erro'}: ${err?.message || ''}).`,
      );
      cleanup();
    }
  }, [myId, ensureOutChannel, attachPcHandlers, sendSignal, cleanup]);

  const acceptCall = useCallback(async () => {
    const offer = incomingOfferRef.current;
    const targetId = remoteIdRef.current;
    if (!offer || !targetId || !myId) {
      // Antes isso saía calado -> "cliquei em atender e nada". Agora diz o motivo.
      console.warn('[Call] acceptCall abortado (dados incompletos):', {
        hasOffer: !!offer, hasTarget: !!targetId, hasMyId: !!myId,
      });
      toast.error('Não foi possível atender: a chamada chegou incompleta. Peça para ligarem de novo.');
      cleanup();
      return;
    }

    try {
      ringtoneRef.current?.stop();
      // Feedback imediato: o card sai de "Atender/Recusar" e mostra "Conectando…".
      setStatus('connecting');
      // Se o P2P não fechar (ex.: NAT simétrico sem TURN), não trava pra sempre.
      if (connectTimeoutRef.current) clearTimeout(connectTimeoutRef.current);
      connectTimeoutRef.current = setTimeout(() => {
        if (statusRef.current === 'connecting') {
          console.warn('[Call] conexão de voz não estabeleceu em 20s (possível bloqueio de rede / falta de TURN).');
          toast.error('Não consegui completar a conexão de voz — a rede pode estar bloqueando a chamada direta.');
          sendSignal('hangup', {});
          cleanup();
        }
      }, 20_000);
      // Canal antes do microfone: se o mic falhar, ainda conseguimos mandar 'reject'.
      await ensureOutChannel(targetId);

      const stream = await getMicStream();
      localStreamRef.current = stream;

      const pc = createPeerConnection();
      pcRef.current = pc;
      attachPcHandlers(pc);
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));

      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      // aplica ICE que chegou antes do remote description
      for (const c of pendingCandidatesRef.current) {
        try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch { /* noop */ }
      }
      pendingCandidatesRef.current = [];

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sendSignal('answer', { sdp: answer });
    } catch (err: any) {
      console.error('[Call] acceptCall error:', err);
      toast.error(
        err?.name === 'NotAllowedError'
          ? 'Permissão de microfone negada.'
          : `Não foi possível atender (${err?.name || 'erro'}: ${err?.message || ''}).`,
      );
      sendSignal('reject', {});
      cleanup();
    }
  }, [myId, ensureOutChannel, attachPcHandlers, sendSignal, cleanup]);

  const rejectCall = useCallback(async () => {
    const targetId = remoteIdRef.current;
    if (targetId) {
      await ensureOutChannel(targetId).catch(() => {});
      sendSignal('reject', {});
    }
    cleanup();
  }, [ensureOutChannel, sendSignal, cleanup]);

  const hangup = useCallback(() => {
    if (statusRef.current === 'idle') return;
    sendSignal('hangup', {});
    cleanup();
  }, [sendSignal, cleanup]);

  const toggleMute = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const next = !muted;
    stream.getAudioTracks().forEach((t) => { t.enabled = !next; });
    setMuted(next);
  }, [muted]);

  // ---- inbox: recebe sinais destinados a mim ----
  useEffect(() => {
    if (!myId) return;
    let cancelled = false;
    ringtoneRef.current = new Ringtone();

    const setup = async () => {
      await ensureExternalSession();
      if (cancelled) return;

      const ch = externalSupabase.channel(inboxName(myId), {
        config: { broadcast: { self: false } },
      });

      ch.on('broadcast', { event: 'offer' }, async ({ payload }) => {
        const p = payload as CallSignalPayload;
        // já em chamada -> ocupado
        if (statusRef.current !== 'idle') {
          const busy = await joinChannel(inboxName(p.from)).catch(() => null);
          if (busy) {
            busy.send({ type: 'broadcast', event: 'reject', payload: { from: myId } });
            externalSupabase.removeChannel(busy);
          }
          return;
        }
        incomingOfferRef.current = p.sdp ?? null;
        remoteIdRef.current = p.from;
        remoteNameRef.current = p.fromName || 'Membro da equipe';
        setRemoteId(p.from);
        setRemoteName(p.fromName || 'Membro da equipe');
        setStatus('incoming');
        ringtoneRef.current?.start();
      });

      ch.on('broadcast', { event: 'answer' }, async ({ payload }) => {
        const p = payload as CallSignalPayload;
        const pc = pcRef.current;
        if (!pc || !p.sdp) return;
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(p.sdp));
          for (const c of pendingCandidatesRef.current) {
            try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch { /* noop */ }
          }
          pendingCandidatesRef.current = [];
        } catch (e) {
          console.error('[Call] setRemoteDescription(answer) failed:', e);
        }
      });

      ch.on('broadcast', { event: 'ice' }, async ({ payload }) => {
        const p = payload as CallSignalPayload;
        if (!p.candidate) return;
        const pc = pcRef.current;
        if (pc && pc.remoteDescription) {
          try { await pc.addIceCandidate(new RTCIceCandidate(p.candidate)); } catch { /* noop */ }
        } else {
          pendingCandidatesRef.current.push(p.candidate);
        }
      });

      ch.on('broadcast', { event: 'hangup' }, () => {
        if (statusRef.current === 'idle') return;
        if (statusRef.current === 'incoming') toast.info('Chamada perdida');
        else toast.info('Chamada encerrada');
        cleanup();
      });

      ch.on('broadcast', { event: 'reject' }, () => {
        if (statusRef.current === 'calling') {
          toast.info(`${remoteName || 'Contato'} recusou / está ocupado.`);
        }
        cleanup();
      });

      ch.subscribe();
      inboxRef.current = ch;
    };

    setup();

    return () => {
      cancelled = true;
      if (inboxRef.current) {
        externalSupabase.removeChannel(inboxRef.current);
        inboxRef.current = null;
      }
      cleanup({ silent: true });
      ringtoneRef.current?.stop();
      ringtoneRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myId]);

  return (
    <CallContext.Provider
      value={{
        status, remoteName, remoteId, muted, durationSec, remoteStream,
        pendingRecording, clearPendingRecording,
        startCall, acceptCall, rejectCall, hangup, toggleMute,
      }}
    >
      {children}
    </CallContext.Provider>
  );
}

export function useCall() {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error('useCall precisa estar dentro de <CallProvider>');
  return ctx;
}

/**
 * Igual ao useCall, mas devolve null fora do <CallProvider> em vez de derrubar
 * a tela. É o que o chat interno da ficha usa: ele também abre em rota sem o
 * provider (o telão /tv/atividades abre o ProcessDetailSheet), e lá o botão de
 * ligar simplesmente não aparece.
 */
export function useCallOptional() {
  return useContext(CallContext) ?? null;
}
