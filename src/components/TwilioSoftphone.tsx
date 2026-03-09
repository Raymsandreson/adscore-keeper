import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuthContext } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Phone, PhoneOff, PhoneCall, Mic, MicOff, X, Volume2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

// Twilio Client JS SDK loaded via CDN
declare global {
  interface Window {
    Twilio: any;
  }
}

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
  
  const deviceRef = useRef<any>(null);
  const activeCallRef = useRef<any>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sdkLoadedRef = useRef(false);

  // Update dial number when prop changes
  useEffect(() => {
    if (phoneNumber) setDialNumber(phoneNumber);
  }, [phoneNumber]);

  // Load Twilio Client JS SDK
  const loadTwilioSdk = useCallback((): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (window.Twilio?.Device) {
        sdkLoadedRef.current = true;
        resolve();
        return;
      }
      if (sdkLoadedRef.current) {
        resolve();
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://sdk.twilio.com/js/client/releases/1.14.3/twilio.min.js';
      script.async = true;
      script.onload = () => {
        sdkLoadedRef.current = true;
        resolve();
      };
      script.onerror = () => reject(new Error('Failed to load Twilio SDK'));
      document.head.appendChild(script);
    });
  }, []);

  // Initialize Twilio Device
  const initDevice = useCallback(async () => {
    if (!user) return;
    
    setStatus('loading');
    setErrorMsg(null);

    try {
      await loadTwilioSdk();

      // Get token from edge function
      const { data, error } = await supabase.functions.invoke('twilio-token');
      if (error) throw error;
      if (!data?.token) throw new Error('No token received');

      const device = new window.Twilio.Device(data.token, {
        codecPreferences: ['opus', 'pcmu'],
        closeProtection: true,
        enableRingingState: true,
      });

      device.on('ready', () => {
        console.log('Twilio Device ready');
        setStatus('ready');
      });

      device.on('error', (err: any) => {
        console.error('Twilio Device error:', err);
        setErrorMsg(err.message || 'Erro no dispositivo');
        setStatus('error');
      });

      device.on('connect', (conn: any) => {
        console.log('Call connected');
        setStatus('in-call');
        activeCallRef.current = conn;
        startTimer();
      });

      device.on('disconnect', () => {
        console.log('Call disconnected');
        stopTimer();
        setStatus('ready');
        activeCallRef.current = null;
        onCallEnd?.();
      });

      device.on('cancel', () => {
        console.log('Call cancelled');
        stopTimer();
        setStatus('ready');
        activeCallRef.current = null;
      });

      device.on('incoming', (conn: any) => {
        console.log('Incoming call from:', conn.parameters.From);
        setStatus('ringing');
        activeCallRef.current = conn;
        // Auto-accept for now
        conn.accept();
      });

      deviceRef.current = device;
    } catch (err: any) {
      console.error('Init error:', err);
      setErrorMsg(err.message || 'Erro ao inicializar');
      setStatus('error');
    }
  }, [user, loadTwilioSdk, onCallEnd]);

  // Timer
  const startTimer = () => {
    setCallDuration(0);
    timerRef.current = setInterval(() => {
      setCallDuration(prev => prev + 1);
    }, 1000);
  };

  const stopTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setCallDuration(0);
  };

  // Make call
  const handleCall = useCallback(async () => {
    const clean = dialNumber.replace(/\D/g, '');
    if (!clean || clean.length < 10) {
      toast.error('Informe um número válido');
      return;
    }

    if (!deviceRef.current) {
      await initDevice();
      // Wait a bit for device to be ready
      await new Promise(r => setTimeout(r, 1500));
    }

    if (!deviceRef.current) {
      toast.error('Dispositivo não inicializado');
      return;
    }

    setStatus('connecting');
    try {
      const phone = clean.startsWith('55') ? clean : `55${clean}`;
      const conn = deviceRef.current.connect({ phone });
      activeCallRef.current = conn;

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
      console.error('Call error:', err);
      toast.error(err.message || 'Erro ao ligar');
      setStatus('ready');
    }
  }, [dialNumber, initDevice, user, contactName, contactId, leadId, leadName]);

  // Hang up
  const handleHangup = useCallback(() => {
    if (activeCallRef.current) {
      activeCallRef.current.disconnect();
    }
    if (deviceRef.current) {
      deviceRef.current.disconnectAll();
    }
    stopTimer();
    setStatus('ready');
    activeCallRef.current = null;
  }, []);

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
  }, []);

  // Auto-init when component mounts
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
