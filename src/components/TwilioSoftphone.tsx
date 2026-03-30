import { useState, useEffect, useRef, useCallback } from 'react';
import { Device, Call } from '@twilio/voice-sdk';
import { supabase } from '@/integrations/supabase/client';
import { useAuthContext } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Phone, PhoneOff, PhoneCall, Mic, MicOff, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';

type SoftphoneStatus = 'idle' | 'loading' | 'ready' | 'connecting' | 'ringing' | 'in-call' | 'error';

interface TwilioSoftphoneProps {
  phoneNumber?: string;
  contactName?: string;
  contactId?: string;
  leadId?: string;
  leadName?: string;
  onCallEnd?: () => void;
  compact?: boolean;
}

export function TwilioSoftphone({
  phoneNumber = '',
  contactName,
  contactId,
  leadId,
  leadName,
  onCallEnd,
  compact = false,
}: TwilioSoftphoneProps) {
  const { user } = useAuthContext();
  const [status, setStatus] = useState<SoftphoneStatus>('idle');
  const [dialNumber, setDialNumber] = useState(phoneNumber);
  const [muted, setMuted] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const deviceRef = useRef<Device | null>(null);
  const activeCallRef = useRef<Call | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (phoneNumber) setDialNumber(phoneNumber);
  }, [phoneNumber]);

  // Timer helpers
  const startTimer = useCallback(() => {
    setCallDuration(0);
    timerRef.current = setInterval(() => {
      setCallDuration(prev => prev + 1);
    }, 1000);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setCallDuration(0);
  }, []);

  // Setup call event listeners (SDK v2.x uses Call object events)
  const setupCallListeners = useCallback((call: Call) => {
    call.on('accept', () => {
      console.log('[Twilio] Call accepted / connected');
      setStatus('in-call');
      startTimer();
    });

    call.on('ringing', (hasEarlyMedia: boolean) => {
      console.log('[Twilio] Call ringing, earlyMedia:', hasEarlyMedia);
      setStatus('ringing');
    });

    call.on('disconnect', () => {
      console.log('[Twilio] Call disconnected');
      stopTimer();
      setStatus('ready');
      activeCallRef.current = null;
      onCallEnd?.();
    });

    call.on('cancel', () => {
      console.log('[Twilio] Call cancelled');
      stopTimer();
      setStatus('ready');
      activeCallRef.current = null;
    });

    call.on('reject', () => {
      console.log('[Twilio] Call rejected');
      stopTimer();
      setStatus('ready');
      activeCallRef.current = null;
    });

    call.on('error', (error: any) => {
      console.error('[Twilio] Call error:', error);
      setErrorMsg(error.message || 'Erro na chamada');
      stopTimer();
      setStatus('error');
      activeCallRef.current = null;
    });
  }, [startTimer, stopTimer, onCallEnd]);

  // Initialize Twilio Device (SDK v2.x)
  const initDevice = useCallback(async () => {
    if (!user) return;

    setStatus('loading');
    setErrorMsg(null);

    try {
      // Get token from edge function
      const { data, error } = await cloudFunctions.invoke('twilio-token');
      if (error) throw error;
      if (!data?.token) throw new Error('No token received');

      console.log('[Twilio] Token received, initializing Device v2.x');

      const device = new Device(data.token, {
        codecPreferences: [Call.Codec.Opus, Call.Codec.PCMU],
        closeProtection: true,
        logLevel: 1, // warnings
      });

      // Device events (v2.x)
      device.on('registered', () => {
        console.log('[Twilio] Device registered');
        setStatus('ready');
      });

      device.on('error', (err: any) => {
        console.error('[Twilio] Device error:', err);
        setErrorMsg(err.message || 'Erro no dispositivo');
        setStatus('error');
      });

      device.on('incoming', (call: Call) => {
        console.log('[Twilio] Incoming call from:', call.parameters.From);
        setStatus('ringing');
        activeCallRef.current = call;
        setupCallListeners(call);
        call.accept();
      });

      device.on('tokenWillExpire', async () => {
        console.log('[Twilio] Token expiring, refreshing...');
        try {
          const { data: refreshData } = await cloudFunctions.invoke('twilio-token');
          if (refreshData?.token) {
            device.updateToken(refreshData.token);
          }
        } catch (e) {
          console.error('[Twilio] Token refresh failed:', e);
        }
      });

      // Register for incoming calls (opens signaling websocket)
      await device.register();

      deviceRef.current = device;
      console.log('[Twilio] Device initialized and registered');
    } catch (err: any) {
      console.error('[Twilio] Init error:', err);
      setErrorMsg(err.message || 'Erro ao inicializar');
      setStatus('error');
    }
  }, [user, setupCallListeners]);

  // Make call
  const handleCall = useCallback(async () => {
    const clean = dialNumber.replace(/\D/g, '');
    if (!clean || clean.length < 10) {
      toast.error('Informe um número válido');
      return;
    }

    if (!deviceRef.current) {
      await initDevice();
      // Small delay for registration
      await new Promise(r => setTimeout(r, 1000));
    }

    if (!deviceRef.current) {
      toast.error('Dispositivo não inicializado');
      return;
    }

    setStatus('connecting');
    try {
      const phone = clean.startsWith('55') ? clean : `55${clean}`;

      // SDK v2.x: connect returns a Promise<Call>
      const call = await deviceRef.current.connect({
        params: { phone },
      });

      activeCallRef.current = call;
      setupCallListeners(call);

      // Handle race condition: accept may have fired before listeners attached
      const callStatus = call.status();
      console.log('[Twilio] Call status after connect:', callStatus);
      if (callStatus === 'open') {
        console.log('[Twilio] Call already open, starting timer');
        setStatus('in-call');
        startTimer();
      }

      // Record call in database
      if (user) {
        await supabase.from('call_records').insert({
          user_id: user.id,
          call_type: 'realizada',
          call_result: 'em_andamento',
          contact_phone: dialNumber,
          contact_name: contactName || null,
          contact_id: contactId || null,
          lead_id: leadId || null,
          lead_name: leadName || null,
          phone_used: 'twilio-softphone',
          notes: 'Chamada via Softphone Twilio (WebRTC)',
          tags: ['twilio', 'softphone', 'webrtc'],
        });
      }

      toast.success(`Ligando para ${contactName || dialNumber}...`);
    } catch (err: any) {
      console.error('[Twilio] Call error:', err);
      toast.error(err.message || 'Erro ao ligar');
      setStatus('ready');
    }
  }, [dialNumber, initDevice, user, contactName, contactId, leadId, leadName, setupCallListeners]);

  // Hang up
  const handleHangup = useCallback(() => {
    if (activeCallRef.current) {
      activeCallRef.current.disconnect();
    }
    stopTimer();
    setStatus('ready');
    activeCallRef.current = null;
  }, [stopTimer]);

  // Toggle mute
  const toggleMute = useCallback(() => {
    if (activeCallRef.current) {
      const newMuted = !muted;
      activeCallRef.current.mute(newMuted);
      setMuted(newMuted);
    }
  }, [muted]);

  // Format duration
  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  };

  // Cleanup
  useEffect(() => {
    return () => {
      stopTimer();
      if (deviceRef.current) {
        deviceRef.current.destroy();
        deviceRef.current = null;
      }
    };
  }, [stopTimer]);

  // Auto-init
  useEffect(() => {
    if (user && status === 'idle') {
      initDevice();
    }
  }, [user, status, initDevice]);

  if (!user) return null;

  const isInCall = status === 'in-call' || status === 'connecting' || status === 'ringing';

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        {!isInCall ? (
          <Button
            size="sm"
            variant="default"
            onClick={handleCall}
            disabled={status === 'loading' || !dialNumber}
            className="gap-1"
          >
            {status === 'loading' ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Phone className="h-3 w-3" />
            )}
            Ligar (Softphone)
          </Button>
        ) : (
          <>
            <Badge variant="destructive" className="gap-1 animate-pulse">
              <PhoneCall className="h-3 w-3" />
              {formatTime(callDuration)}
            </Badge>
            <Button size="icon" variant="ghost" onClick={toggleMute} className="h-7 w-7">
              {muted ? <MicOff className="h-3 w-3" /> : <Mic className="h-3 w-3" />}
            </Button>
            <Button size="icon" variant="destructive" onClick={handleHangup} className="h-7 w-7">
              <PhoneOff className="h-3 w-3" />
            </Button>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-xl border-2 bg-card p-4 shadow-lg space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Phone className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Softphone</span>
        </div>
        <Badge
          variant={status === 'ready' ? 'default' : status === 'error' ? 'destructive' : 'secondary'}
          className="text-xs"
        >
          {status === 'idle' && 'Desligado'}
          {status === 'loading' && 'Carregando...'}
          {status === 'ready' && '● Online'}
          {status === 'connecting' && 'Conectando...'}
          {status === 'ringing' && '📞 Tocando...'}
          {status === 'in-call' && `🔴 ${formatTime(callDuration)}`}
          {status === 'error' && 'Erro'}
        </Badge>
      </div>

      {errorMsg && (
        <p className="text-xs text-destructive">{errorMsg}</p>
      )}

      {!isInCall ? (
        <>
          <div className="flex gap-2">
            <Input
              placeholder="Número com DDD..."
              value={dialNumber}
              onChange={e => setDialNumber(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCall()}
              className="text-sm font-mono"
              type="tel"
            />
            <Button
              size="icon"
              onClick={handleCall}
              disabled={status === 'loading' || !dialNumber.trim()}
              className="shrink-0"
            >
              {status === 'loading' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Phone className="h-4 w-4" />
              )}
            </Button>
          </div>
          {contactName && (
            <p className="text-xs text-muted-foreground">
              📞 {contactName}
            </p>
          )}
        </>
      ) : (
        <div className="text-center space-y-3">
          <div className="space-y-1">
            <p className="text-lg font-bold">{contactName || dialNumber}</p>
            {contactName && (
              <p className="text-xs text-muted-foreground font-mono">{dialNumber}</p>
            )}
          </div>

          <div className={cn(
            "text-2xl font-mono font-bold",
            status === 'connecting' && "animate-pulse text-muted-foreground",
            status === 'in-call' && "text-primary"
          )}>
            {status === 'connecting' ? 'Chamando...' : formatTime(callDuration)}
          </div>

          <div className="flex justify-center gap-3">
            <Button
              size="icon"
              variant={muted ? 'destructive' : 'outline'}
              onClick={toggleMute}
              className="h-12 w-12 rounded-full"
            >
              {muted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
            </Button>
            <Button
              size="icon"
              variant="destructive"
              onClick={handleHangup}
              className="h-12 w-12 rounded-full"
            >
              <PhoneOff className="h-5 w-5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
