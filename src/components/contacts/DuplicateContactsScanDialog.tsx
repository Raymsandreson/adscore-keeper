import { useState } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, ScanSearch, Merge, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { cloudFunctions } from '@/lib/functionRouter';
import { externalSupabase } from '@/integrations/supabase/external-client';
import { toast } from 'sonner';
import {
  DuplicateContactMergeDialog,
  type IncomingContact,
  type ExistingContact,
} from '@/components/kanban/DuplicateContactMergeDialog';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFinished?: () => void;
}

interface AmbiguousGroup {
  key: string;
  reason: 'phone' | 'name';
  contacts: ExistingContact[];
}

interface ScanResult {
  total_contacts: number;
  total_groups: number;
  safe_count: number;
  ambiguous_count: number;
  merged_count: number;
  ambiguous: AmbiguousGroup[];
  merge_errors?: string[];
}

type Phase = 'idle' | 'scanning' | 'preview' | 'merging' | 'review' | 'done';

export function DuplicateContactsScanDialog({ open, onOpenChange, onFinished }: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [reviewIdx, setReviewIdx] = useState(0);
  const [reviewOpen, setReviewOpen] = useState(false);

  const runScan = async (mode: 'dry-run' | 'merge-safe') => {
    setPhase(mode === 'dry-run' ? 'scanning' : 'merging');
    try {
      const { data, error } = await cloudFunctions.invoke('scan-duplicate-contacts', {
        body: { mode },
      });
      if (error || !data?.success) {
        toast.error(`Falha na varredura: ${error?.message || data?.error || 'erro desconhecido'}`);
        setPhase('idle');
        return;
      }
      setScan(data as ScanResult);
      setPhase(mode === 'dry-run' ? 'preview' : (data.ambiguous_count > 0 ? 'review' : 'done'));
      if (mode === 'merge-safe') {
        toast.success(`Mesclados ${data.merged_count} contatos automaticamente`);
        if (data.ambiguous_count > 0) {
          setReviewIdx(0);
          setReviewOpen(true);
        }
      }
    } catch (err: any) {
      toast.error(`Erro: ${err.message}`);
      setPhase('idle');
    }
  };

  const currentGroup = scan?.ambiguous?.[reviewIdx];

  const incomingFromWinner = (g: AmbiguousGroup): IncomingContact => {
    // mostra o primeiro (mais antigo) como "novo" no diálogo; os demais como candidatos
    const sorted = [...g.contacts].sort((a, b) =>
      String(a.created_at || '').localeCompare(String(b.created_at || ''))
    );
    const first = sorted[0];
    return {
      full_name: first.full_name || '',
      phone: first.phone,
      email: first.email,
      instagram_username: (first as any).instagram_username,
      classification: first.classification,
      notes: first.notes,
      city: first.city,
      state: first.state,
      neighborhood: (first as any).neighborhood,
      street: (first as any).street,
      cep: (first as any).cep,
      profession: (first as any).profession,
    };
  };

  const candidatesFor = (g: AmbiguousGroup): ExistingContact[] => {
    const sorted = [...g.contacts].sort((a, b) =>
      String(a.created_at || '').localeCompare(String(b.created_at || ''))
    );
    return sorted.slice(1);
  };

  const handleMergeOne = async (targetId: string, merged: Partial<IncomingContact>) => {
    if (!currentGroup) return;
    try {
      // 1. atualiza alvo com campos escolhidos
      const payload: any = {};
      for (const [k, v] of Object.entries(merged)) {
        if (v !== undefined) payload[k] = v;
      }
      if (Object.keys(payload).length > 0) {
        const { error } = await externalSupabase.from('contacts').update(payload).eq('id', targetId);
        if (error) throw error;
      }
      // 2. re-aponta contact_leads dos demais → alvo
      const losers = currentGroup.contacts.filter((c) => c.id !== targetId);
      for (const l of losers) {
        // copia vínculos
        // @ts-ignore - contact_leads não tipada no externo
        const { data: links } = await externalSupabase.from('contact_leads' as any).select('lead_id').eq('contact_id', l.id);
        for (const link of (links || []) as any[]) {
          // @ts-ignore
          await externalSupabase.from('contact_leads' as any).insert({ contact_id: targetId, lead_id: link.lead_id }).then(() => {}, () => {});
        }
        // @ts-ignore
        await externalSupabase.from('contact_leads' as any).delete().eq('contact_id', l.id);
        // soft delete
        await externalSupabase.from('contacts').update({
          deleted_at: new Date().toISOString(),
          notes: `[Mesclado manualmente em ${new Date().toISOString()} no contato ${targetId}]`,
        } as any).eq('id', l.id);
      }
      toast.success('Contatos mesclados');
      advanceReview();
    } catch (err: any) {
      toast.error(`Erro ao mesclar: ${err.message}`);
    }
  };

  const handleSkip = () => advanceReview();

  const advanceReview = () => {
    setReviewOpen(false);
    setTimeout(() => {
      const next = reviewIdx + 1;
      if (!scan || next >= scan.ambiguous.length) {
        setPhase('done');
        onFinished?.();
        return;
      }
      setReviewIdx(next);
      setReviewOpen(true);
    }, 150);
  };

  const reset = () => {
    setPhase('idle');
    setScan(null);
    setReviewIdx(0);
    setReviewOpen(false);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ScanSearch className="h-5 w-5 text-primary" />
              Resolver contatos duplicados
            </DialogTitle>
            <DialogDescription>
              Vou varrer o cadastro, juntar automaticamente os casos óbvios (mesmo telefone + nome compatível)
              e te mostrar um a um os ambíguos para você decidir.
            </DialogDescription>
          </DialogHeader>

          {phase === 'idle' && (
            <div className="space-y-3 py-2">
              <p className="text-sm text-muted-foreground">
                Comece com uma <strong>simulação</strong> (não altera nada) para ver quantos contatos serão afetados.
              </p>
              <Button onClick={() => runScan('dry-run')}>
                <ScanSearch className="h-4 w-4 mr-1" />
                Simular varredura
              </Button>
            </div>
          )}

          {(phase === 'scanning' || phase === 'merging') && (
            <div className="flex items-center gap-3 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              {phase === 'scanning' ? 'Procurando duplicados…' : 'Mesclando casos seguros…'}
            </div>
          )}

          {phase === 'preview' && scan && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="border rounded p-2"><strong>{scan.total_contacts}</strong> contatos no banco</div>
                <div className="border rounded p-2"><strong>{scan.total_groups}</strong> grupos com duplicidade</div>
                <div className="border rounded p-2 bg-emerald-50 dark:bg-emerald-950/30">
                  <CheckCircle2 className="h-4 w-4 inline mr-1 text-emerald-600" />
                  <strong>{scan.safe_count}</strong> seguros (auto)
                </div>
                <div className="border rounded p-2 bg-amber-50 dark:bg-amber-950/30">
                  <AlertTriangle className="h-4 w-4 inline mr-1 text-amber-600" />
                  <strong>{scan.ambiguous_count}</strong> para revisar
                </div>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
                <Button onClick={() => runScan('merge-safe')}>
                  <Merge className="h-4 w-4 mr-1" />
                  Mesclar {scan.safe_count} seguros + revisar {scan.ambiguous_count}
                </Button>
              </DialogFooter>
            </div>
          )}

          {phase === 'review' && scan && (
            <div className="space-y-2">
              <p className="text-sm">
                Mesclamos <strong>{scan.merged_count}</strong> contatos automaticamente.
              </p>
              <p className="text-sm text-muted-foreground">
                Agora vamos revisar {scan.ambiguous_count} caso(s) ambíguo(s)…
              </p>
            </div>
          )}

          {phase === 'done' && scan && (
            <div className="space-y-3">
              <p className="text-sm">
                <CheckCircle2 className="h-4 w-4 inline mr-1 text-emerald-600" />
                Concluído. <strong>{scan.merged_count}</strong> mesclas automáticas + revisão dos ambíguos.
              </p>
              {scan.merge_errors && scan.merge_errors.length > 0 && (
                <ScrollArea className="h-24 border rounded p-2">
                  <p className="text-xs font-medium text-destructive mb-1">Erros:</p>
                  {scan.merge_errors.map((e, i) => (
                    <p key={i} className="text-xs text-muted-foreground">{e}</p>
                  ))}
                </ScrollArea>
              )}
              <DialogFooter>
                <Button onClick={() => { reset(); onOpenChange(false); }}>Fechar</Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {currentGroup && (
        <DuplicateContactMergeDialog
          open={reviewOpen}
          onOpenChange={(v) => { if (!v) handleSkip(); setReviewOpen(v); }}
          incoming={incomingFromWinner(currentGroup)}
          candidates={candidatesFor(currentGroup)}
          onMerge={handleMergeOne}
          onCreateNew={handleSkip}
        />
      )}
    </>
  );
}
