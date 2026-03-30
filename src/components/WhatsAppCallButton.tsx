import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Phone, PhoneCall, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';

interface WhatsAppCallButtonProps {
  phoneNumber?: string;
  contactName?: string;
  contactId?: string;
  leadId?: string;
  leadName?: string;
  instanceName?: string;
  instanceId?: string;
  onCallInitiated?: (callRecordId: string | null) => void;
  compact?: boolean;
}

export function WhatsAppCallButton({
  phoneNumber = '',
  contactName,
  contactId,
  leadId,
  leadName,
  instanceName,
  instanceId,
  onCallInitiated,
  compact = false,
}: WhatsAppCallButtonProps) {
  const [dialNumber, setDialNumber] = useState(phoneNumber);
  const [calling, setCalling] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);

  // Sync external phone number
  useState(() => {
    if (phoneNumber) setDialNumber(phoneNumber);
  });

  const handleCall = useCallback(async () => {
    const clean = dialNumber.replace(/\D/g, '');
    if (!clean || clean.length < 10) {
      toast.error('Informe um número válido com DDD');
      return;
    }

    setCalling(true);
    setLastResult(null);

    try {
      const { data, error } = await cloudFunctions.invoke('make-whatsapp-call', {
        body: {
          phone: clean,
          instance_name: instanceName,
          instance_id: instanceId,
          contact_name: contactName,
          contact_id: contactId,
          lead_id: leadId,
          lead_name: leadName,
        },
      });

      if (error) throw error;

      if (data?.success) {
        toast.success(`Chamada WhatsApp iniciada para ${contactName || clean}`);
        setLastResult('initiated');
        onCallInitiated?.(data.call_record_id);
      } else {
        const errMsg = data?.error || 'Erro ao iniciar chamada';
        toast.error(errMsg);
        setLastResult('error');
      }
    } catch (err: any) {
      console.error('WhatsApp call error:', err);
      toast.error(err?.message || 'Erro ao ligar via WhatsApp');
      setLastResult('error');
    } finally {
      setCalling(false);
    }
  }, [dialNumber, instanceName, instanceId, contactName, contactId, leadId, leadName, onCallInitiated]);

  if (compact) {
    return (
      <Button
        size="sm"
        variant="default"
        onClick={handleCall}
        disabled={calling || !dialNumber.trim()}
        className="gap-1"
      >
        {calling ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Phone className="h-3 w-3" />
        )}
        Ligar (WhatsApp)
      </Button>
    );
  }

  return (
    <div className="rounded-xl border-2 bg-card p-4 shadow-lg space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <PhoneCall className="h-4 w-4 text-green-500" />
          <span className="text-sm font-semibold">Chamada WhatsApp</span>
        </div>
        {lastResult && (
          <Badge
            variant={lastResult === 'initiated' ? 'default' : 'destructive'}
            className="text-xs"
          >
            {lastResult === 'initiated' ? '✅ Chamada iniciada' : '❌ Erro'}
          </Badge>
        )}
      </div>

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
          disabled={calling || !dialNumber.trim()}
          className="shrink-0 bg-green-600 hover:bg-green-700"
        >
          {calling ? (
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

      <p className="text-[10px] text-muted-foreground">
        A chamada será feita pelo WhatsApp da instância conectada
      </p>
    </div>
  );
}
