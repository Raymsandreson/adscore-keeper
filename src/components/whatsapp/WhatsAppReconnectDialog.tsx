import { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, RefreshCw, QrCode, CheckCircle2, XCircle, Wifi } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface WhatsAppReconnectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  instanceId: string;
  instanceName: string;
  onReconnected?: () => void;
}

type Step = 'idle' | 'connecting' | 'showing_qr' | 'connected' | 'error';

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

  useEffect(() => {
    if (open) {
      setStep('idle');
      setQrCode(null);
      setErrorMsg(null);
      setPollCount(0);
    }
  }, [open]);

  // UazAPI V2: POST /instance/connect (sem phone = gera QR code)
  const handleConnect = useCallback(async () => {
    setStep('connecting');
    setErrorMsg(null);
    setQrCode(null);
    setPollCount(0);
    try {
      const { data, error } = await supabase.functions.invoke('reconnect-whatsapp', {
        body: { instance_id: instanceId, action: 'connect' },
      });
      if (error) throw error;

      if (data?.already_connected) {
        setStep('connected');
        toast.success(`${instanceName} já está conectada!`);
        onReconnected?.();
        setTimeout(() => onOpenChange(false), 2000);
        return;
      }

      if (data?.qrCode) {
        setQrCode(data.qrCode);
        setStep('showing_qr');
      } else {
        // QR not ready yet, start polling
        setStep('connecting');
        setPollCount(1);
      }
    } catch (err: any) {
      setStep('error');
      setErrorMsg(err.message || 'Erro ao conectar');
    }
  }, [instanceId, instanceName, onReconnected, onOpenChange]);

  const handleRestart = useCallback(async () => {
    setStep('connecting');
    setErrorMsg(null);
    try {
      const { data, error } = await supabase.functions.invoke('reconnect-whatsapp', {
        body: { instance_id: instanceId, action: 'restart' },
      });
      if (error) throw error;
      toast.success('Restart solicitado!');
      // Wait 5s then try to connect
      setTimeout(() => handleConnect(), 5000);
    } catch (err: any) {
      setStep('error');
      setErrorMsg(err.message || 'Erro ao reiniciar');
    }
  }, [instanceId, handleConnect]);

  // Poll for QR when connecting and no QR yet
  useEffect(() => {
    if (step !== 'connecting' || pollCount === 0) return;
    if (pollCount >= 12) {
      setStep('error');
      setErrorMsg('Não foi possível obter o QR Code. Tente novamente.');
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const { data } = await supabase.functions.invoke('reconnect-whatsapp', {
          body: { instance_id: instanceId, action: 'connect' },
        });
        if (data?.qrCode) {
          setQrCode(data.qrCode);
          setStep('showing_qr');
        } else if (data?.already_connected) {
          setStep('connected');
          toast.success(`${instanceName} conectada!`);
          onReconnected?.();
          setTimeout(() => onOpenChange(false), 2000);
        } else {
          setPollCount(prev => prev + 1);
        }
      } catch {
        setPollCount(prev => prev + 1);
      }
    }, 5000);
    return () => clearTimeout(timer);
  }, [step, pollCount, instanceId, instanceName, onReconnected, onOpenChange]);

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

  // Refresh QR
  const refreshQr = useCallback(async () => {
    setQrCode(null);
    try {
      const { data } = await supabase.functions.invoke('reconnect-whatsapp', {
        body: { instance_id: instanceId, action: 'connect' },
      });
      if (data?.qrCode) {
        setQrCode(data.qrCode);
      }
    } catch {}
  }, [instanceId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wifi className="h-5 w-5" />
            Reconectar {instanceName}
          </DialogTitle>
          <DialogDescription>
            Conecte a instância ao WhatsApp via QR Code.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-4">
          {/* Step: Idle */}
          {step === 'idle' && (
            <>
              <div className="h-20 w-20 rounded-full bg-muted flex items-center justify-center">
                <QrCode className="h-10 w-10 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground text-center">
                Escolha uma opção para reconectar a instância.
              </p>
              <div className="w-full space-y-2">
                <Button onClick={handleConnect} className="w-full">
                  <QrCode className="h-4 w-4 mr-2" />
                  Gerar QR Code
                </Button>
                <Button onClick={handleRestart} variant="outline" className="w-full">
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Reiniciar e Conectar
                </Button>
              </div>
              <p className="text-xs text-muted-foreground text-center">
                💡 Abra o WhatsApp no celular → <strong>Aparelhos Conectados</strong> → <strong>Conectar aparelho</strong> e escaneie o código.
              </p>
            </>
          )}

          {/* Step: Connecting */}
          {step === 'connecting' && (
            <>
              <Loader2 className="h-12 w-12 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">
                {pollCount > 0 ? 'Obtendo QR Code...' : 'Conectando instância...'}
              </p>
              {pollCount > 0 && (
                <Badge variant="outline" className="text-xs">
                  Tentativa {pollCount}/12
                </Badge>
              )}
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
                <Button onClick={handleConnect} className="w-full">
                  <QrCode className="h-4 w-4 mr-2" />
                  Tentar Gerar QR Code
                </Button>
                <Button onClick={handleRestart} variant="outline" className="w-full">
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Reiniciar e Conectar
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
