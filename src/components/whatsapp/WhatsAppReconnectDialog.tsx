import { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, RefreshCw, QrCode, CheckCircle2, XCircle, Wifi } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface WhatsAppReconnectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  instanceId: string;
  instanceName: string;
  onReconnected?: () => void;
}

type Step = 'idle' | 'restarting' | 'waiting_qr' | 'showing_qr' | 'connected' | 'error';

export function WhatsAppReconnectDialog({
  open,
  onOpenChange,
  instanceId,
  instanceName,
  onReconnected,
}: WhatsAppReconnectDialogProps) {
  const [step, setStep] = useState<Step>('idle');
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [pollCount, setPollCount] = useState(0);

  // Reset state on open
  useEffect(() => {
    if (open) {
      setStep('idle');
      setQrCode(null);
      setErrorMsg(null);
      setPollCount(0);
    }
  }, [open]);

  const handleRestart = useCallback(async () => {
    setStep('restarting');
    setErrorMsg(null);
    try {
      const { data, error } = await supabase.functions.invoke('reconnect-whatsapp', {
        body: { instance_id: instanceId, action: 'restart' },
      });
      if (error) throw error;
      toast.success('Restart solicitado!');
      setTimeout(() => {
        setStep('waiting_qr');
      }, 3000);
    } catch (err: any) {
      setStep('error');
      setErrorMsg(err.message || 'Erro ao reiniciar');
    }
  }, [instanceId]);

  const handleDirectQr = useCallback(async () => {
    setStep('waiting_qr');
    setPollCount(0);
  }, []);

  const fetchQr = useCallback(async () => {
    try {
      const { data, error } = await supabase.functions.invoke('reconnect-whatsapp', {
        body: { instance_id: instanceId, action: 'qr' },
      });
      if (error) throw error;
      if (data?.qrCode) {
        setQrCode(data.qrCode);
        setStep('showing_qr');
      } else {
        setPollCount(prev => prev + 1);
      }
    } catch (err: any) {
      console.error('QR fetch error:', err);
      setPollCount(prev => prev + 1);
    }
  }, [instanceId]);

  // Poll for QR code when waiting
  useEffect(() => {
    if (step !== 'waiting_qr') return;
    fetchQr();
    const interval = setInterval(fetchQr, 5000);
    return () => clearInterval(interval);
  }, [step, fetchQr]);

  // Stop polling after 12 attempts (60s)
  useEffect(() => {
    if (pollCount >= 12 && step === 'waiting_qr') {
      setStep('error');
      setErrorMsg('Não foi possível obter o QR Code. Tente novamente.');
    }
  }, [pollCount, step]);

  // When showing QR, poll status to detect connection
  useEffect(() => {
    if (step !== 'showing_qr') return;
    const checkConnection = async () => {
      try {
        const { data } = await supabase.functions.invoke('check-whatsapp-status');
        const inst = (data || []).find((s: any) => s.id === instanceId);
        if (inst?.connected) {
          setStep('connected');
          toast.success(`${instanceName} reconectada!`);
          onReconnected?.();
          setTimeout(() => onOpenChange(false), 2000);
        }
      } catch {}
    };
    const interval = setInterval(checkConnection, 5000);
    return () => clearInterval(interval);
  }, [step, instanceId, instanceName, onReconnected, onOpenChange]);

  // Refresh QR (it expires)
  const refreshQr = useCallback(async () => {
    setQrCode(null);
    await fetchQr();
  }, [fetchQr]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wifi className="h-5 w-5" />
            Reconectar {instanceName}
          </DialogTitle>
          <DialogDescription>
            Reinicie a instância e escaneie o QR Code se necessário.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-4">
          {/* Step: Idle */}
          {step === 'idle' && (
            <>
              <div className="h-20 w-20 rounded-full bg-muted flex items-center justify-center">
                <RefreshCw className="h-10 w-10 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground text-center">
                Escolha uma opção para reconectar a instância.
              </p>
              <div className="w-full space-y-2">
                <Button onClick={handleRestart} className="w-full">
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Reiniciar Instância
                </Button>
                <Button onClick={handleDirectQr} variant="outline" className="w-full">
                  <QrCode className="h-4 w-4 mr-2" />
                  Obter QR Code Direto
                </Button>
              </div>
              <p className="text-xs text-muted-foreground text-center">
                💡 Se a sessão expirou, escaneie o QR Code no WhatsApp do celular em <strong>Aparelhos Conectados → Conectar aparelho</strong>.
              </p>
            </>
          )}

          {/* Step: Restarting */}
          {step === 'restarting' && (
            <>
              <Loader2 className="h-12 w-12 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Reiniciando instância...</p>
            </>
          )}

          {/* Step: Waiting for QR */}
          {step === 'waiting_qr' && (
            <>
              <Loader2 className="h-12 w-12 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Obtendo QR Code...</p>
              <Badge variant="outline" className="text-xs">
                Tentativa {pollCount}/12
              </Badge>
            </>
          )}

          {/* Step: Showing QR */}
          {step === 'showing_qr' && (
            <>
              <div className="border-2 border-primary rounded-xl p-2 bg-white">
                {qrCode ? (
                  <img
                    src={qrCode.startsWith('data:') ? qrCode : `data:image/png;base64,${qrCode}`}
                    alt="QR Code WhatsApp"
                    className="w-64 h-64 object-contain"
                  />
                ) : (
                  <div className="w-64 h-64 flex items-center justify-center">
                    <Loader2 className="h-8 w-8 animate-spin" />
                  </div>
                )}
              </div>
              <p className="text-sm text-muted-foreground text-center">
                Abra o WhatsApp no celular → <strong>Aparelhos Conectados</strong> → <strong>Conectar um aparelho</strong> e escaneie o código acima.
              </p>
              <Button variant="outline" size="sm" onClick={refreshQr}>
                <RefreshCw className="h-3 w-3 mr-1" />
                Atualizar QR Code
              </Button>
            </>
          )}

          {/* Step: Connected */}
          {step === 'connected' && (
            <>
              <div className="h-20 w-20 rounded-full bg-green-500/10 flex items-center justify-center">
                <CheckCircle2 className="h-10 w-10 text-green-500" />
              </div>
              <p className="text-base font-medium text-green-600">Conectada com sucesso!</p>
            </>
          )}

          {/* Step: Error */}
          {step === 'error' && (
            <>
              <div className="h-20 w-20 rounded-full bg-destructive/10 flex items-center justify-center">
                <XCircle className="h-10 w-10 text-destructive" />
              </div>
              <p className="text-sm text-destructive text-center">{errorMsg}</p>
              <div className="w-full space-y-2">
                <Button onClick={handleRestart} variant="outline" className="w-full">
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Tentar Novamente
                </Button>
                <Button onClick={handleDirectQr} variant="outline" className="w-full">
                  <QrCode className="h-4 w-4 mr-2" />
                  Obter QR Code Direto
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
