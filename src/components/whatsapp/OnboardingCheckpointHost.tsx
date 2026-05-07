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
import { setOnboardingPending } from '@/lib/onboardingGuard';
import { LeadEditDialog } from '@/components/kanban/LeadEditDialog';
import { ContactDetailSheet } from '@/components/contacts/ContactDetailSheet';
import { DashboardChatPreview } from '@/components/whatsapp/DashboardChatPreview';
import { useLeads } from '@/hooks/useLeads';
import { useKanbanBoards } from '@/hooks/useKanbanBoards';

const STEP_ORDER = [
  'confirm_funnel',
  'setup_lead_close',
  'create_group',
  'send_initial_message',
  'import_docs',
  'create_case_process',
  'create_onboarding_activity',
] as const;

type StepKey = typeof STEP_ORDER[number];

const STEP_LABEL: Record<StepKey, string> = {
  confirm_funnel: '1. Confirmar funil do lead',
  setup_lead_close: '2. Criar lead/contato e marcar como fechado',
  create_group: '3. Criar grupo no WhatsApp',
  send_initial_message: '4. Enviar mensagem inicial',
  import_docs: '5. Importar documentos',
  create_case_process: '6. Criar Caso + Processo',
  create_onboarding_activity: '7. Atividade de Onboarding',
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

interface Props {
  /** Telefone (somente dígitos) da conversa atualmente aberta. */
  selectedPhone?: string | null;
}

export function OnboardingCheckpointHost({ selectedPhone }: Props = {}) {
  const { user } = useAuth();
  const [leadId, setLeadId] = useState<string | null>(null);
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [busy, setBusy] = useState(false);

  // Painel lateral / drawer
  const { updateLead } = useLeads();
  const { boards } = useKanbanBoards();
  const [leadSheetOpen, setLeadSheetOpen] = useState(false);
  const [leadSheetData, setLeadSheetData] = useState<any>(null);
  const [contactSheetOpen, setContactSheetOpen] = useState(false);
  const [contactSheetData, setContactSheetData] = useState<any>(null);
  const [groupDrawer, setGroupDrawer] = useState<{ jid: string; name: string; instance: string } | null>(null);

  const openLeadById = async (id: string) => {
    const dbAny = db as any;
    const { data } = await dbAny.from('leads').select('*').eq('id', id).maybeSingle();
    if (data) { setLeadSheetData(data); setLeadSheetOpen(true); }
    else toast({ title: 'Lead não encontrado', variant: 'destructive' });
  };
  const openContactById = async (id: string) => {
    const dbAny = db as any;
    const { data } = await dbAny.from('contacts').select('*').eq('id', id).maybeSingle();
    if (data) { setContactSheetData(data); setContactSheetOpen(true); }
    else toast({ title: 'Contato não encontrado', variant: 'destructive' });
  };

  // Form fields per-step
  const [msgText, setMsgText] = useState('');
  const [processType, setProcessType] = useState<string>('');
  const [feePct, setFeePct] = useState<string>('');
  const [selectedBoardId, setSelectedBoardId] = useState<string>('');

  const normPhone = (selectedPhone || '').replace(/\D/g, '').slice(-8);

  // Descobre todos os leads com checkpoints pendentes e expõe ao guard.
  // Só abre o modal se o telefone do lead pendente bater com a conversa aberta.
  const refresh = async () => {
    const dbAny = db as any;
    const { data: pendings } = await dbAny
      .from('onboarding_checkpoints')
      .select('lead_id, payload')
      .in('status', ['pending', 'running', 'failed'])
      .order('created_at', { ascending: true });

    const seen = new Map<string, string>(); // lead_id -> phone
    for (const row of (pendings || []) as Array<{ lead_id: string; payload: any }>) {
      if (!row.lead_id || seen.has(row.lead_id)) continue;
      const ph = (row.payload?.lead_phone || '').toString();
      seen.set(row.lead_id, ph);
    }
    setOnboardingPending(
      Array.from(seen.entries()).map(([lead_id, phone]) => ({ lead_id, phone })),
    );

    // Match: lead pendente cujo telefone bate com a conversa aberta
    let match: string | null = null;
    if (normPhone) {
      for (const [lid, ph] of seen.entries()) {
        if ((ph || '').replace(/\D/g, '').slice(-8) === normPhone) {
          match = lid;
          break;
        }
      }
    }
    setLeadId(match);

    if (match) {
      const { data } = await dbAny
        .from('onboarding_checkpoints')
        .select('*')
        .eq('lead_id', match);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normPhone]);

  const currentStep = useMemo(() => {
    return checkpoints.find((c) => c.status !== 'done');
  }, [checkpoints]);

  const allDone = checkpoints.length > 0 && checkpoints.every((c) => c.status === 'done');

  // Pré-preenche mensagem inicial usando o template do board_group_settings
  useEffect(() => {
    if (currentStep?.step !== 'send_initial_message' || msgText) return;
    (async () => {
      const name = currentStep.payload?.lead_name || 'cliente';
      const boardId = currentStep.payload?.board_id;
      const groupResult = checkpoints.find((c) => c.step === 'create_group')?.result || {};
      const groupName = groupResult?.group_name || '';
      let template = '';
      if (boardId) {
        const dbAny = db as any;
        const { data } = await dbAny
          .from('board_group_settings')
          .select('initial_message_template')
          .eq('board_id', boardId)
          .maybeSingle();
        template = data?.initial_message_template || '';
      }
      if (template) {
        const filled = template
          .replace(/\{lead_name\}/g, name)
          .replace(/\{group_name\}/g, groupName)
          .replace(/\{victim_name\}/g, currentStep.payload?.victim_name || '')
          .replace(/\{case_type\}/g, currentStep.payload?.case_type || '');
        setMsgText(filled);
      } else {
        setMsgText(
          `Olá ${name}! 👋\nSeja bem-vindo(a). Recebemos sua assinatura e a partir de agora vamos cuidar do seu caso.`,
        );
      }
    })();
  }, [currentStep?.id]);

  // Pré-seleciona board atual no passo confirm_funnel
  useEffect(() => {
    if (currentStep?.step !== 'confirm_funnel') return;
    const cur = currentStep.payload?.board_id || '';
    if (cur && !selectedBoardId) setSelectedBoardId(cur);
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
      case 'confirm_funnel':
        if (!selectedBoardId) {
          toast({ title: 'Selecione um funil', variant: 'destructive' });
          return;
        }
        return execute({ board_id: selectedBoardId });
      case 'setup_lead_close':
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
  const hasFailed = checkpoints.some((c) => c.status === 'failed');

  const skipCurrent = async () => {
    if (!currentStep) return;
    setBusy(true);
    try {
      const dbAny = db as any;
      await dbAny
        .from('onboarding_checkpoints')
        .update({
          status: 'done',
          result: { skipped_by_user: true, previous_status: currentStep.status },
          updated_at: new Date().toISOString(),
        })
        .eq('id', currentStep.id);
      toast({ title: 'Etapa pulada', description: STEP_LABEL[currentStep.step] });
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const closeAll = async () => {
    setBusy(true);
    try {
      const dbAny = db as any;
      const ids = checkpoints.filter((c) => c.status !== 'done').map((c) => c.id);
      if (ids.length) {
        await dbAny
          .from('onboarding_checkpoints')
          .update({
            status: 'done',
            result: { cancelled_by_user: true },
            updated_at: new Date().toISOString(),
          })
          .in('id', ids);
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
    <Dialog open={open} onOpenChange={(o) => { if (!o && hasFailed) closeAll(); }}>
      <DialogContent
        className="w-[95vw] max-w-lg"
        onPointerDownOutside={(e) => { if (!hasFailed) e.preventDefault(); }}
        onEscapeKeyDown={(e) => { if (!hasFailed) e.preventDefault(); }}
      >
        <DialogHeader>
          <DialogTitle>Onboarding pós-assinatura</DialogTitle>
          <DialogDescription>
            Confirme cada etapa para liberar a próxima.
            {hasFailed
              ? ' Uma etapa falhou — você pode pular ou fechar para resolver depois.'
              : ' Esta janela não pode ser fechada até concluir.'}
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
                    <DoneResultSummary
                      step={c.step}
                      result={c.result}
                      payload={c.payload}
                      checkpointId={c.id}
                      leadId={c.lead_id}
                      onOpenLead={(id) => openLeadById(id)}
                      onOpenContact={(id) => openContactById(id)}
                      onOpenGroup={(jid, name) => setGroupDrawer({
                        jid,
                        name,
                        instance: (c.payload?.instance_name || '') as string,
                      })}
                      onRefresh={refresh}
                    />
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

            {currentStep.step === 'setup_lead_close' && (
              <div className="text-xs text-muted-foreground space-y-1">
                <div>Marca o lead como <b>fechado</b> e cria/atualiza o contato do signatário.</div>
                <div>Lead: <b>{currentStep.payload?.lead_name}</b></div>
                {currentStep.payload?.signer_name && (
                  <div>Signatário: <b>{currentStep.payload?.signer_name}</b></div>
                )}
                {currentStep.payload?.lead_phone && (
                  <div>Telefone: {currentStep.payload?.lead_phone}</div>
                )}
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

            <div className="flex gap-2">
              <Button onClick={handleConfirm} disabled={busy} className="flex-1">
                {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                {currentStep.status === 'failed' ? 'Tentar novamente' : 'Confirmar e avançar'}
              </Button>
              {currentStep.status === 'failed' && (
                <Button onClick={skipCurrent} disabled={busy} variant="outline">
                  Pular
                </Button>
              )}
            </div>
            {hasFailed && (
              <Button onClick={closeAll} disabled={busy} variant="ghost" className="w-full text-xs">
                Cancelar onboarding (marcar tudo como feito)
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>

    {/* Painel lateral: Lead */}
    {leadSheetData && (
      <LeadEditDialog
        open={leadSheetOpen}
        onOpenChange={(v) => { setLeadSheetOpen(v); if (!v) setLeadSheetData(null); }}
        lead={leadSheetData}
        onSave={async (id, updates) => { await updateLead(id, updates); }}
        boards={boards}
        mode="sheet"
      />
    )}

    {/* Painel lateral: Contato */}
    {contactSheetData && (
      <ContactDetailSheet
        open={contactSheetOpen}
        onOpenChange={(v) => { setContactSheetOpen(v); if (!v) setContactSheetData(null); }}
        contact={contactSheetData}
        mode="sheet"
      />
    )}

    {/* Drawer (de baixo pra cima): Conversa do grupo do WhatsApp */}
    {groupDrawer && (
      <DashboardChatPreview
        open={!!groupDrawer}
        onOpenChange={(v) => { if (!v) setGroupDrawer(null); }}
        phone={groupDrawer.jid}
        contactName={groupDrawer.name}
        instanceName={groupDrawer.instance}
        hasLead={true}
        hasContact={false}
        wasResponded={false}
        responseTimeMinutes={null}
      />
    )}
    </>
  );
}

function DoneResultSummary({
  step,
  result,
  payload,
  checkpointId,
  leadId,
  onOpenLead,
  onOpenContact,
  onOpenGroup,
  onRefresh,
}: {
  step: StepKey;
  result: any;
  payload?: any;
  checkpointId?: string;
  leadId: string;
  onOpenLead?: (id: string) => void;
  onOpenContact?: (id: string) => void;
  onOpenGroup?: (jid: string, name: string) => void;
  onRefresh?: () => void | Promise<void>;
}) {
  if (step === 'setup_lead_close') {
    return (
      <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
        <div>✅ Lead marcado como <b>fechado</b></div>
        {result.signer_name && (
          <div>
            Contato: <b>{result.signer_name}</b>
            {result.contact_reused && <span className="ml-1 italic">(existente)</span>}
          </div>
        )}
        <div className="flex gap-2 pt-0.5">
          <button type="button" onClick={() => onOpenLead?.(leadId)} className="text-primary underline">
            Ver lead
          </button>
          {result.contact_id && (
            <button type="button" onClick={() => onOpenContact?.(result.contact_id)} className="text-primary underline">
              Ver contato
            </button>
          )}
        </div>
      </div>
    );
  }
  if (step === 'create_group') {
    return (
      <CreateGroupSummary
        result={result}
        payload={payload}
        checkpointId={checkpointId}
        leadId={leadId}
        onOpenLead={onOpenLead}
        onOpenGroup={onOpenGroup}
        onRefresh={onRefresh}
      />
    );
  }
  if (step === 'create_case_process') {
    return (
      <div className="text-xs text-muted-foreground mt-1">
        {result.case_number && <span>Caso <b>{result.case_number}</b></span>}
      </div>
    );
  }
  return (
    <div className="text-xs text-muted-foreground mt-1 truncate">
      {typeof result === 'object' ? JSON.stringify(result) : String(result)}
    </div>
  );
}

function CreateGroupSummary({
  result,
  payload,
  checkpointId,
  leadId,
  onOpenLead,
  onOpenGroup,
  onRefresh,
}: {
  result: any;
  payload?: any;
  checkpointId?: string;
  leadId: string;
  onOpenLead?: (id: string) => void;
  onOpenGroup?: (jid: string, name: string) => void;
  onRefresh?: () => void | Promise<void>;
}) {
  const participants: Array<{ id: string; name: string; phone?: string }> = result.participants || [];
  const [groupName, setGroupName] = useState<string>(result?.group_name || '');
  const [groupLink, setGroupLink] = useState<string>(result?.group_link || '');
  const [renaming, setRenaming] = useState(false);

  useEffect(() => {
    if (groupName && groupLink) return;
    if (!result?.group_jid) return;
    (async () => {
      const dbAny = db as any;
      const { data } = await dbAny
        .from('lead_whatsapp_groups')
        .select('group_name, group_link')
        .eq('lead_id', leadId)
        .eq('group_jid', result.group_jid)
        .maybeSingle();
      if (data?.group_name && !groupName) setGroupName(data.group_name);
      if (data?.group_link && !groupLink) setGroupLink(data.group_link);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result?.group_jid, leadId]);

  const handleRename = async () => {
    if (!result?.group_jid) return;
    setRenaming(true);
    try {
      // Chama create-whatsapp-group com allow_rename: pula o DEDUP guard,
      // recalcula nome via board_group_settings (closed_group_name_prefix + closed_sequence)
      // e renomeia o grupo na UazAPI + atualiza leads.lead_name + lead_whatsapp_groups.group_name.
      const { data, error } = await cloudFunctions.invoke<any>('create-whatsapp-group', {
        body: {
          lead_id: leadId,
          lead_name: payload?.lead_name,
          phone: payload?.lead_phone,
          contact_phone: payload?.lead_phone,
          board_id: payload?.board_id,
          creation_origin: 'onboarding_checkpoint_rename',
          phase: 'closed',
          allow_rename: true,
        },
      });
      if (error || data?.success === false) {
        toast({
          title: 'Não foi possível renomear',
          description: data?.error || error?.message || 'Erro desconhecido',
          variant: 'destructive',
        });
        return;
      }
      const newName = data?.group_name || groupName;
      setGroupName(newName);
      // Atualiza o result do checkpoint pra refletir o novo nome
      if (checkpointId) {
        const dbAny = db as any;
        await dbAny
          .from('onboarding_checkpoints')
          .update({
            result: { ...result, group_name: newName },
            updated_at: new Date().toISOString(),
          })
          .eq('id', checkpointId);
      }
      toast({ title: 'Grupo renomeado', description: newName });
      await onRefresh?.();
    } finally {
      setRenaming(false);
    }
  };

  const displayName = groupName || 'Grupo';

  return (
    <div className="text-xs text-muted-foreground mt-1 space-y-1">
      <div>📱 Grupo: <b>{displayName}</b></div>
      {result.group_jid && <div className="font-mono text-[10px] truncate">{result.group_jid}</div>}
      {result.reused && <div className="italic">Reaproveitado de grupo existente</div>}
      {participants.length > 0 && (
        <div>
          <div className="font-medium">Vinculados ao lead ({participants.length}):</div>
          <ul className="list-disc list-inside max-h-24 overflow-auto">
            {participants.map((p) => (
              <li key={p.id} className="truncate">
                {p.name}{p.phone ? ` · ${p.phone}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex gap-2 pt-0.5 flex-wrap items-center">
        <button type="button" onClick={() => onOpenLead?.(leadId)} className="text-primary underline">
          Ver lead
        </button>
        {result.group_jid && (
          <button
            type="button"
            onClick={() => onOpenGroup?.(result.group_jid, displayName)}
            className="text-primary underline"
          >
            Abrir conversa do grupo
          </button>
        )}
        {groupLink && (
          <a href={groupLink} target="_blank" rel="noreferrer" className="text-primary underline">
            Abrir no app do WhatsApp
          </a>
        )}
        <button
          type="button"
          onClick={handleRename}
          disabled={renaming}
          className="text-primary underline disabled:opacity-50"
        >
          {renaming ? 'Renomeando…' : 'Reprocessar nome do grupo'}
        </button>
      </div>
    </div>
  );
}
