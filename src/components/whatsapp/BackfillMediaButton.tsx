import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Wrench, Loader2 } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from 'sonner';
import { cloudFunctions } from '@/lib/functionRouter';

type Status = {
  success?: boolean;
  running?: boolean;
  total?: number;
  processed?: number;
  ok?: number;
  fail?: number;
  siblingCopied?: number;
  decrypted?: number;
  phase?: string;
  startedAt?: string;
  lastError?: string;
};

export function BackfillMediaButton() {
  const [status, setStatus] = useState<Status>({});
  const pollRef = useRef<number | null>(null);

  const refresh = async () => {
    try {
      const r = await cloudFunctions.invoke('whatsapp-backfill-media', { body: { action: 'status' } });
      const s = (r.data || {}) as Status;
      setStatus(s);
      if (!s.running && pollRef.current) {
        window.clearInterval(pollRef.current);
        pollRef.current = null;
        const copied = s.siblingCopied ?? 0;
        const decoded = s.decrypted ?? 0;
        toast.success(`Reparo concluído: ${copied} copiadas de irmãos + ${decoded} decifradas` + (s.fail ? ` (${s.fail} falhas)` : ''));
      }
    } catch {/* silencioso */}
  };

  const start = async () => {
    try {
      const r = await cloudFunctions.invoke('whatsapp-backfill-media', { body: { action: 'start' } });
      const s = (r.data || {}) as Status;
      if (s.success === false) {
        toast.error(s.lastError || 'Não foi possível iniciar o reparo.');
        return;
      }
      toast.info('Reparo iniciado. Vou avisar quando terminar.');
      if (pollRef.current) window.clearInterval(pollRef.current);
      pollRef.current = window.setInterval(refresh, 3000);
      refresh();
    } catch (e) {
      toast.error('Erro ao iniciar reparo');
    }
  };

  useEffect(() => {
    refresh();
    return () => { if (pollRef.current) window.clearInterval(pollRef.current); };
  }, []);

  const running = !!status.running;
  const phase = status.phase === 'sibling-copy' ? 'copiando entre irmãos' : status.phase === 'decrypting' ? `decifrando ${status.processed ?? 0}/${status.total ?? '?'}` : 'iniciando';
  const label = running
    ? `Reparando mídias (${phase})`
    : 'Reparar todas as mídias antigas (varredura no banco)';

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          onClick={start}
          disabled={running}
          title={label}
        >
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wrench className="h-4 w-4" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
