import { createContext, useContext, useEffect, useRef, useState, useCallback, ReactNode } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { externalSupabase, ensureExternalSession } from '@/integrations/supabase/external-client';
import { useAuthContext } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import {
  createPeerConnection,
  getMicStream,
  Ringtone,
  type CallSignalEvent,
  type CallSignalPayload,
} from '@/lib/webrtcCall';

type CallStatus = 'idle' | 'calling' | 'incoming' | 'connected';

interface CallContextValue {
  status: CallStatus;
  remoteName: string | null;
  remoteId: string | null;
  muted: boolean;
  durationSec: number;
  remoteStream: MediaStream | null;
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

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const inboxRef = useRef<RealtimeChannel | null>(null);
  const outChannelRef = useRef<RealtimeChannel | null>(null);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const incomingOfferRef = useRef<RTCSessionDescriptionInit | null>(null);
  const remoteIdRef = useRef<string | null>(null);
  const durationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ringTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ringtoneRef = useRef<Ringtone | null>(null);
  // status espelhado em ref p/ handlers assíncronos não pegarem valor velho
  const statusRef = useRef<CallStatus>('idle');
  statusRef.current = status;
  const myNameRef = useRef(myName);
  myNameRef.current = myName;

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
    ch.send({
      type: 'broadcast',
      event,
      payload: { from: myId, fromName: myNameRef.current, ...payload } as CallSignalPayload,
    });
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
    ringtoneRef.current?.stop();
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
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    if (outChannelRef.current) {
      externalSupabase.removeChannel(outChannelRef.current);
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
      setRemoteStream(e.streams[0] ?? null);
    };
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      if (st === 'connected') {
        ringtoneRef.current?.stop();
        if (ringTimeoutRef.current) { clearTimeout(ringTimeoutRef.current); ringTimeoutRef.current = null; }
        setStatus('connected');
        if (!durationTimerRef.current) {
          setDurationSec(0);
          durationTimerRef.current = setInterval(() => setDurationSec((d) => d + 1), 1000);
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

      const stream = await getMicStream();
      localStreamRef.current = stream;

      await ensureOutChannel(targetUserId);

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
      toast.error(err?.name === 'NotAllowedError' ? 'Permissão de microfone negada.' : 'Não foi possível iniciar a chamada.');
      cleanup();
    }
  }, [myId, ensureOutChannel, attachPcHandlers, sendSignal, cleanup]);

  const acceptCall = useCallback(async () => {
    const offer = incomingOfferRef.current;
    const targetId = remoteIdRef.current;
    if (!offer || !targetId || !myId) return;

    try {
      ringtoneRef.current?.stop();
      const stream = await getMicStream();
      localStreamRef.current = stream;

      await ensureOutChannel(targetId);

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
      toast.error(err?.name === 'NotAllowedError' ? 'Permissão de microfone negada.' : 'Não foi possível atender.');
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
