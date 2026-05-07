// Modal bloqueante de checkpoints pós-ZapSign.
// Lê `onboarding_checkpoints` no Externo, mostra cada passo em ordem,
// só libera o próximo após confirmação manual de cada um.
//
// Render global: vive no WhatsAppInbox (não desmonta com troca de chat).
import { useEffect, useMemo, useState } from 'react';
import { db } from '@/integrations/supabase';
import { cloudFunctions } from '@/lib/functionRouter';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, Circle, Loader2, AlertCircle } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { toast } from '@/hooks/use-toast';

const STEP_ORDER = [
  'create_group',
  'send_initial_message',
  'import_docs',
  'create_case_process',
  'create_onboarding_activity',
] as const;

type StepKey = typeof STEP_ORDER[number];

const STEP_LABEL: Record<StepKey, string> = {
  create_group: '1. Criar grupo no WhatsApp',
  send_initial_message: '2. Enviar mensagem inicial',
  import_docs: '3. Importar documentos',
  create_case_process: '4. Criar Caso + Processo',
  create_onboarding_activity: '5. Atividade de Onboarding',
};

interface Checkpoint {
  id: string;
  lead_id: string;
  step: StepKey;
  status: 'pending' | 'running' | 'done' | 'failed';
  payload: any;
  result: any;
  error_message: string | null;
}

// Função roda no Railway (Railway-first). O routing vive em src/lib/functionRouter.ts.

export function OnboardingCheckpointHost() {
  const { user } = useAuth();
  const [leadId, setLeadId] = useState<string | null>(null);
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [busy, setBusy] = useState(false);

  // Form fields per-step
  const [msgText, setMsgText] = useState('');
  const [processType, setProcessType] = useState<string>('');
  const [feePct, setFeePct] = useState<string>('');

  // Descobre lead com checkpoints pendentes
  const refresh = async () => {
    const dbAny = db as any;
    const { data: pendings } = await dbAny
      .from('onboarding_checkpoints')
      .select('lead_id')
      .in('status', ['pending', 'running', 'failed'])
      .order('created_at', { ascending: true })
      .limit(1);
    const lid = (pendings?.[0]?.lead_id as string) || null;
    setLeadId(lid);
    if (lid) {
      const { data } = await dbAny
        .from('onboarding_checkpoints')
        .select('*')
        .eq('lead_id', lid);
      const sorted = ([...(data || [])] as Checkpoint[]).sort(
        (a, b) => STEP_ORDER.indexOf(a.step) - STEP_ORDER.indexOf(b.step),
      );
      setCheckpoints(sorted);
    } else {
      setCheckpoints([]);
    }
  };

  useEffect(() => {
    refresh();
    const ch = db
      .channel('onboarding-checkpoints-host')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'onboarding_checkpoints' },
        () => refresh(),
      )
      .subscribe();
    return () => { db.removeChannel(ch); };
  }, []);

  const currentStep = useMemo(() => {
    return checkpoints.find((c) => c.status !== 'done');
  }, [checkpoints]);

  const allDone = checkpoints.length > 0 && checkpoints.every((c) => c.status === 'done');

  // Pré-preenche mensagem inicial
  useEffect(() => {
    if (currentStep?.step === 'send_initial_message' && !msgText) {
      const name = currentStep.payload?.lead_name || 'cliente';
      setMsgText(
        `Olá ${name}! 👋\nSeja bem-vindo(a). Recebemos sua assinatura e a partir de agora vamos cuidar do seu caso.`,
      );
    }
  }, [currentStep?.id]);

  const execute = async (extra: Record<string, unknown> = {}) => {
    if (!currentStep) return;
    setBusy(true);
    try {
      const { data, error } = await cloudFunctions.invoke<{ success: boolean; error?: string }>(
        'onboarding-checkpoint-execute',
        {
          body: {
            checkpoint_id: currentStep.id,
            user_id: user?.id,
            extra,
          },
        },
      );
      if (error || !data?.success) {
        toast({
          title: 'Falhou',
          description: data?.error || error?.message || 'Erro desconhecido',
          variant: 'destructive',
        });
      } else {
        toast({ title: 'OK', description: `${STEP_LABEL[currentStep.step]} concluído` });
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const handleConfirm = () => {
    if (!currentStep) return;
    switch (currentStep.step) {
      case 'create_group':
      case 'create_onboarding_activity':
        return execute();
      case 'send_initial_message':
        if (!msgText.trim()) {
          toast({ title: 'Mensagem vazia', variant: 'destructive' });
          return;
        }
        return execute({ message_text: msgText });
      case 'import_docs':
        // MVP: avança sem importar; importação real fica no fluxo dedicado.
        return execute({ documents: [] });
      case 'create_case_process':
        if (!processType || !feePct) {
          toast({ title: 'Preencha tipo e %', variant: 'destructive' });
          return;
        }
        return execute({ process_type: processType, fee_percentage: Number(feePct) });
    }
  };

  const open = !!leadId && !allDone;

  return (
    <Dialog open={open} onOpenChange={() => { /* bloqueante: não fecha */ }}>
      <DialogContent
        className="w-[95vw] max-w-lg"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Onboarding pós-assinatura</DialogTitle>
          <DialogDescription>
            Confirme cada etapa para liberar a próxima. Esta janela não pode ser fechada até concluir.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {checkpoints.map((c) => {
            const isCurrent = currentStep?.id === c.id;
            return (
              <div
                key={c.id}
                className={`flex items-start gap-2 rounded-md border p-2 text-sm ${
                  isCurrent ? 'border-primary bg-primary/5' : 'opacity-70'
                }`}
              >
                {c.status === 'done' && <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5" />}
                {c.status === 'pending' && <Circle className="h-4 w-4 text-muted-foreground mt-0.5" />}
                {c.status === 'running' && <Loader2 className="h-4 w-4 animate-spin mt-0.5" />}
                {c.status === 'failed' && <AlertCircle className="h-4 w-4 text-destructive mt-0.5" />}
                <div className="flex-1">
                  <div className="font-medium">{STEP_LABEL[c.step]}</div>
                  {c.error_message && (
                    <div className="text-xs text-destructive mt-1">{c.error_message}</div>
                  )}
                  {c.status === 'done' && c.result && (
                    <div className="text-xs text-muted-foreground mt-1 truncate">
                      {JSON.stringify(c.result)}
                    </div>
                  )}
                </div>
                <Badge variant={c.status === 'done' ? 'default' : 'outline'} className="text-[10px]">
                  {c.status}
                </Badge>
              </div>
            );
          })}
        </div>

        {currentStep && (
          <div className="space-y-3 border-t pt-3">
            <div className="text-sm font-medium">{STEP_LABEL[currentStep.step]}</div>

            {currentStep.step === 'send_initial_message' && (
              <Textarea
                value={msgText}
                onChange={(e) => setMsgText(e.target.value)}
                rows={4}
                placeholder="Mensagem inicial..."
              />
            )}

            {currentStep.step === 'create_case_process' && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Tipo do processo</Label>
                  <Select value={processType} onValueChange={setProcessType}>
                    <SelectTrigger><SelectValue placeholder="Escolher" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="judicial">Judicial</SelectItem>
                      <SelectItem value="administrativo">Administrativo</SelectItem>
                      <SelectItem value="extrajudicial">Extrajudicial</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Honorários (%)</Label>
                  <Input
                    type="number"
                    value={feePct}
                    onChange={(e) => setFeePct(e.target.value)}
                    placeholder="Ex: 30"
                  />
                </div>
              </div>
            )}

            {currentStep.step === 'create_group' && (
              <div className="text-xs text-muted-foreground">
                Lead: <b>{currentStep.payload?.lead_name}</b> · {currentStep.payload?.lead_phone}
              </div>
            )}

            {currentStep.step === 'import_docs' && (
              <div className="text-xs text-muted-foreground">
                Importa anexos do envelope ZapSign + mídias dos últimos 7 dias.
                <br />Para customizar a lista, use a tela do caso depois. Aqui apenas confirme.
              </div>
            )}

            {currentStep.step === 'create_onboarding_activity' && (
              <div className="text-xs text-muted-foreground">
                Cria atividade <b>ONBOARDING CLIENTE</b> atribuída ao acolhedor.
              </div>
            )}

            <Button onClick={handleConfirm} disabled={busy} className="w-full">
              {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Confirmar e avançar
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
