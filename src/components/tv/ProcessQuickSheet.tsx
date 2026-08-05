import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { externalSupabase, ensureExternalSession } from '@/integrations/supabase/external-client';
import ProcessDetailSheet from '@/components/cases/ProcessDetailSheet';

// Abre a ficha COMPLETA do processo em aba lateral, sem sair do telão — mesma
// ProcessDetailSheet da tela de Processos, não um resumo (ver a regra dos
// formulários únicos). Só busca a linha inteira do processo, que é o que o
// formulário precisa pra montar (o mesmo `select *` do openProcess da
// ProcessesPage). Carregado sob demanda pelo telão (lazy) pra não pesar a TV.

interface Props {
  processId: string;
  onClose: () => void;
}

export default function ProcessQuickSheet({ processId, onClose }: Props) {
  const [processo, setProcesso] = useState<Record<string, unknown> | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await ensureExternalSession();
        const { data, error } = await externalSupabase
          .from('lead_processes')
          .select('*')
          .eq('id', processId)
          .maybeSingle();
        if (cancelled) return;
        if (error) throw error;
        if (!data) {
          setErro('Processo não encontrado — pode ter sido excluído.');
          return;
        }
        setProcesso(data as Record<string, unknown>);
      } catch (e) {
        if (!cancelled) setErro(e instanceof Error ? e.message : 'Erro ao abrir o processo.');
      }
    })();
    return () => { cancelled = true; };
  }, [processId]);

  // Enquanto a linha não chega (ou se falhou), um painel próprio — assim o
  // clique tem resposta imediata em vez de parecer que nada aconteceu.
  if (!processo) {
    return (
      <Sheet open onOpenChange={open => { if (!open) onClose(); }}>
        <SheetContent side="right" className="w-full sm:max-w-md border-white/10 bg-slate-950 text-white">
          <SheetHeader>
            <SheetTitle className="text-white">Processo</SheetTitle>
          </SheetHeader>
          {erro ? (
            <div className="mt-4 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300">{erro}</div>
          ) : (
            <div className="flex items-center justify-center gap-2 py-16 text-white/50">
              <Loader2 className="h-5 w-5 animate-spin" /> Abrindo o processo…
            </div>
          )}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <ProcessDetailSheet
      open
      onOpenChange={open => { if (!open) onClose(); }}
      process={processo}
    />
  );
}
