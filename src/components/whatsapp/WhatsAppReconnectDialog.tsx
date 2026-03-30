import { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Loader2, RefreshCw, QrCode, CheckCircle2, XCircle, Wifi, Smartphone, Copy } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';

interface WhatsAppReconnectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  instanceId: string;
  instanceName: string;
  onReconnected?: () => void;
}

type Step = 'idle' | 'connecting' | 'showing_qr' | 'showing_pairing' | 'ask_phone' | 'connected' | 'error';

export function WhatsAppReconnectDialog({
  open,
  onOpenChange,
  instanceId,
  instanceName,
  onReconnected,
}: WhatsAppReconnectDialogProps) {
  const [step, setStep] = useState<Step>('idle');
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [pollCount, setPollCount] = useState(0);
  const [phoneInput, setPhoneInput] = useState('');

  useEffect(() => {
    if (open) {
      setStep('idle');
      setQrCode(null);
      setPairingCode(null);
      setErrorMsg(null);
      setPollCount(0);
      setPhoneInput('');
    }
  }, [open]);

  const handleConnect = useCallback(async () => {
    setStep('connecting');
    setErrorMsg(null);
    setQrCode(null);
    setPollCount(0);
    try {
      const { data, error } = await cloudFunctions.invoke('reconnect-whatsapp', {
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
        setStep('connecting');
        setPollCount(1);
      }
    } catch (err: any) {
      setStep('error');
      setErrorMsg(err.message || 'Erro ao conectar');
    }
  }, [instanceId, instanceName, onReconnected, onOpenChange]);

  const handlePairingCode = useCallback(async (phone?: string) => {
    setStep('connecting');
    setErrorMsg(null);
    setPairingCode(null);
    try {
      const body: any = { instance_id: instanceId, action: 'pairing_code' };
      if (phone) body.phone = phone;

      const { data, error } = await cloudFunctions.invoke('reconnect-whatsapp', { body });
      if (error) throw error;

      if (data?.already_connected) {
        setStep('connected');
        toast.success(`${instanceName} já está conectada!`);
        onReconnected?.();
        setTimeout(() => onOpenChange(false), 2000);
        return;
      }

      if (data?.needs_phone) {
        setStep('ask_phone');
        return;
      }

      if (data?.pairingCode) {
        setPairingCode(data.pairingCode);
        setStep('showing_pairing');
        toast.success('Código gerado!');
      } else {
        setStep('error');
        setErrorMsg(data?.message || 'Não foi possível gerar o código de pareamento.');
      }
    } catch (err: any) {
      // Check if needs_phone from error response
      if (err.message?.includes('needs_phone') || err.message?.includes('Informe o número')) {
        setStep('ask_phone');
        return;
      }
      setStep('error');
      setErrorMsg(err.message || 'Erro ao gerar código');
    }
  }, [instanceId, instanceName, onReconnected, onOpenChange]);

  const handleSubmitPhone = useCallback(() => {
    const cleaned = phoneInput.replace(/\D/g, '');
    if (cleaned.length < 10) {
      toast.error('Informe um número válido com DDD');
      return;
    }
    handlePairingCode(cleaned);
  }, [phoneInput, handlePairingCode]);

  const handleRestart = useCallback(async () => {
    setStep('connecting');
    setErrorMsg(null);
    try {
      const { data, error } = await cloudFunctions.invoke('reconnect-whatsapp', {
        body: { instance_id: instanceId, action: 'restart' },
      });
      if (error) throw error;
      toast.success('Restart solicitado!');
      setTimeout(() => handleConnect(), 5000);
    } catch (err: any) {
      setStep('error');
      setErrorMsg(err.message || 'Erro ao reiniciar');
    }
  }, [instanceId, handleConnect]);

  const copyPairingCode = useCallback(() => {
    if (pairingCode) {
      navigator.clipboard.writeText(pairingCode);
      toast.success('Código copiado!');
    }
  }, [pairingCode]);

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
        const { data } = await cloudFunctions.invoke('reconnect-whatsapp', {
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

  // Poll status when showing QR or pairing code
  useEffect(() => {
    if (step !== 'showing_qr' && step !== 'showing_pairing') return;
    const checkConnection = async () => {
      try {
        const { data } = await cloudFunctions.invoke('check-whatsapp-status');
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

  const refreshQr = useCallback(async () => {
    setQrCode(null);
    try {
      const { data } = await cloudFunctions.invoke('reconnect-whatsapp', {
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
            Conecte a instância ao WhatsApp via QR Code ou Código de Pareamento.
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
                <Button onClick={() => handlePairingCode()} className="w-full" variant="default">
                  <Smartphone className="h-4 w-4 mr-2" />
                  Código de Pareamento (WhatsApp)
                </Button>
                <Button onClick={handleConnect} variant="outline" className="w-full">
                  <QrCode className="h-4 w-4 mr-2" />
                  Gerar QR Code
                </Button>
                <Button onClick={handleRestart} variant="ghost" className="w-full text-muted-foreground">
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Reiniciar e Conectar
                </Button>
              </div>
              <p className="text-xs text-muted-foreground text-center">
                📱 O código de pareamento será enviado via WhatsApp com instruções de uso.
              </p>
            </>
          )}

          {/* Step: Ask Phone */}
          {step === 'ask_phone' && (
            <>
              <div className="h-16 w-16 rounded-full bg-amber-500/10 flex items-center justify-center">
                <Smartphone className="h-8 w-8 text-amber-500" />
              </div>
              <p className="text-sm text-muted-foreground text-center">
                Informe o número do WhatsApp vinculado a esta instância para gerar o código de pareamento.
              </p>
              <div className="w-full space-y-3">
                <Input
                  placeholder="Ex: 5586999999999"
                  value={phoneInput}
                  onChange={(e) => setPhoneInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSubmitPhone()}
                  className="text-center text-lg font-mono"
                  type="tel"
                />
                <p className="text-xs text-muted-foreground text-center">
                  Formato: código do país + DDD + número (ex: 55 86 99999-9999)
                </p>
                <Button onClick={handleSubmitPhone} className="w-full">
                  <Smartphone className="h-4 w-4 mr-2" />
                  Gerar Código de Pareamento
                </Button>
                <Button onClick={handleConnect} variant="outline" className="w-full">
                  <QrCode className="h-4 w-4 mr-2" />
                  Usar QR Code em vez disso
                </Button>
              </div>
              <p className="text-xs text-muted-foreground text-center">
                💾 O número será salvo automaticamente para uso futuro.
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
                Abra o WhatsApp → <strong>Aparelhos Conectados</strong> → <strong>Conectar</strong> e escaneie o código.
              </p>
              <Button variant="outline" size="sm" onClick={refreshQr}>
                <RefreshCw className="h-3 w-3 mr-1" />
                Atualizar QR Code
              </Button>
            </>
          )}

          {/* Step: Showing Pairing Code */}
          {step === 'showing_pairing' && pairingCode && (
            <>
              <div className="border-2 border-primary rounded-xl p-6 bg-white text-center">
                <p className="text-xs text-muted-foreground mb-2">Código de Pareamento</p>
                <p className="text-3xl font-mono font-bold tracking-widest text-foreground">
                  {pairingCode}
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={copyPairingCode}>
                <Copy className="h-3 w-3 mr-1" />
                Copiar código
              </Button>
              <div className="text-sm text-muted-foreground text-center space-y-1">
                <p className="font-medium text-foreground">📱 Como usar:</p>
                <p>1. Abra o WhatsApp no celular</p>
                <p>2. ⋮ → <strong>Aparelhos conectados</strong></p>
                <p>3. <strong>Conectar aparelho</strong></p>
                <p>4. <strong>Conectar com número de telefone</strong></p>
                <p>5. Digite o código acima</p>
              </div>
              <Badge variant="outline" className="text-xs">
                ⏰ Expira em 5 minutos
              </Badge>
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
                <Button onClick={() => handlePairingCode()} className="w-full">
                  <Smartphone className="h-4 w-4 mr-2" />
                  Código de Pareamento
                </Button>
                <Button onClick={handleConnect} variant="outline" className="w-full">
                  <QrCode className="h-4 w-4 mr-2" />
                  Tentar QR Code
                </Button>
                <Button onClick={handleRestart} variant="ghost" className="w-full text-muted-foreground">
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
