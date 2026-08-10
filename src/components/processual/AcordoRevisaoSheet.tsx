// =============================================================================
// Aba lateral de revisão de UM acordo extraído da ata pela IA.
//
// A revisão existe porque extração de IA não entra na régua sozinha: um falso
// "acordo homologado" move o processo de estação E reclassifica dinheiro de
// PROJETADO para A RECEBER no relatório do fundo.
//
// O TRECHO LITERAL É O CORAÇÃO DESTA TELA. Sem ele, conferir exigiria reabrir o
// PDF e caçar a passagem — e ninguém revisaria 27 processos assim. Com ele, a
// decisão costuma sair na leitura de duas linhas; o PDF fica a um clique para
// quando a citação não bastar.
// =============================================================================
import { useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { MediaLightbox } from '@/components/whatsapp/MediaLightbox';
import { invokeCloudFunction } from '@/lib/functionRouter';
import { useAuthContext } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Check, X, FileText, Loader2, AlertTriangle, Users } from 'lucide-react';
import type { AcordoProcesso } from '@/hooks/useAcordoExtracoes';

interface Props {
  acordo: AcordoProcesso | null;
  onOpenChange: (open: boolean) => void;
  onRevisado: (cnj: string, aprovado: boolean, userId?: string | null) => Promise<void>;
}

function moeda(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function dataBr(iso: string | null): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

export function AcordoRevisaoSheet({ acordo, onOpenChange, onRevisado }: Props) {
  const { user } = useAuthContext();
  const [salvando, setSalvando] = useState<'aprovar' | 'rejeitar' | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [abrindoPdf, setAbrindoPdf] = useState(false);

  if (!acordo) return null;
  const { principal, apoio } = acordo;
  const d = principal.dados || ({} as AcordoProcesso['principal']['dados']);
  const reclamantes = Array.isArray(d.por_reclamante) ? d.por_reclamante : [];

  const abrirAta = async (documentoId: number) => {
    setAbrindoPdf(true);
    try {
      // O bucket dos autos é privado: a URL é assinada no servidor e vale 5 min.
      const { data, error } = await invokeCloudFunction<{ success: boolean; url?: string; error?: string }>(
        'jm-documento-url',
        { documento_id: documentoId },
      );
      if (error) throw error;
      if (!data?.success || !data.url) throw new Error(data?.error || 'não foi possível abrir a ata');
      setPdfUrl(data.url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao abrir a ata');
    } finally {
      setAbrindoPdf(false);
    }
  };

  const decidir = async (aprovado: boolean) => {
    setSalvando(aprovado ? 'aprovar' : 'rejeitar');
    try {
      await onRevisado(acordo.processo_cnj, aprovado, user?.id);
      toast.success(aprovado ? 'Acordo confirmado' : 'Marcado como não-acordo');
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao salvar a revisão');
    } finally {
      setSalvando(null);
    }
  };

  return (
    <>
      <Sheet open={!!acordo} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
          <SheetHeader className="text-left">
            <SheetTitle className="break-all">{acordo.processo_cnj}</SheetTitle>
            <SheetDescription>
              Acordo lido pela IA na ata de audiência. Confira antes de virar marco.
            </SheetDescription>
          </SheetHeader>

          <div className="mt-4 space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={principal.confianca === 'alta' ? 'default' : 'secondary'}>
                confiança {principal.confianca}
              </Badge>
              {d.parcial ? (
                <Badge variant="destructive" className="gap-1">
                  <AlertTriangle className="h-3 w-3" /> acordo parcial
                </Badge>
              ) : null}
              {acordo.revisado ? (
                <Badge variant={acordo.aprovado ? 'default' : 'secondary'}>
                  {acordo.aprovado ? 'confirmado' : 'rejeitado'}
                </Badge>
              ) : null}
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <Campo rotulo="Homologado em" valor={dataBr(principal.data_extraida)} />
              <Campo rotulo="Valor total" valor={moeda(d.valor_total)} />
              <Campo rotulo="Parcelas" valor={d.n_parcelas ? String(d.n_parcelas) : '—'} />
              <Campo rotulo="Valor da parcela" valor={moeda(d.valor_parcela)} />
              <Campo rotulo="Devedor" valor={d.devedor || '—'} className="col-span-2" />
            </div>

            {d.parcial && d.prossegue_contra ? (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                <p className="font-medium text-amber-700 dark:text-amber-400">
                  O processo não acabou
                </p>
                <p className="mt-1 text-muted-foreground">
                  O acordo alcançou parte dos réus. Prossegue contra{' '}
                  <span className="font-medium text-foreground">{d.prossegue_contra}</span>.
                </p>
              </div>
            ) : null}

            {reclamantes.length > 0 ? (
              <div>
                <p className="mb-2 flex items-center gap-1.5 text-sm font-medium">
                  <Users className="h-4 w-4" /> Rateio por reclamante
                </p>
                <div className="space-y-1">
                  {reclamantes.map((r, i) => (
                    <div key={`${r.nome}-${i}`} className="flex items-center justify-between gap-3 rounded-md bg-muted/50 px-3 py-2 text-sm">
                      <span className="min-w-0 flex-1 truncate">{r.nome}</span>
                      <span className="shrink-0 font-medium">{moeda(r.valor)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {principal.trecho ? (
              <div>
                <p className="mb-2 text-sm font-medium">O que está escrito na ata</p>
                <blockquote className="border-l-2 border-primary/60 bg-muted/40 py-2 pl-3 pr-2 text-sm italic text-muted-foreground">
                  “{principal.trecho}”
                </blockquote>
              </div>
            ) : null}

            {principal.motivo ? (
              <div>
                <p className="mb-1 text-sm font-medium">Leitura da IA</p>
                <p className="text-sm text-muted-foreground">{principal.motivo}</p>
              </div>
            ) : null}

            <Separator />

            <div className="space-y-2">
              <p className="text-sm font-medium">Documento</p>
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start gap-2"
                disabled={abrindoPdf}
                onClick={() => abrirAta(principal.documento_id)}
                title="abrir a ata aqui mesmo"
              >
                {abrindoPdf ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                Ver a ata de {dataBr(principal.data_extraida)}
              </Button>

              {apoio.length > 0 ? (
                <>
                  <p className="pt-1 text-xs text-muted-foreground">
                    Outras {apoio.length} ata(s) deste processo também apontaram acordo:
                  </p>
                  {apoio.map((a) => (
                    <Button
                      key={a.id}
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start gap-2 text-muted-foreground"
                      disabled={abrindoPdf}
                      onClick={() => abrirAta(a.documento_id)}
                      title="abrir a ata aqui mesmo"
                    >
                      <FileText className="h-4 w-4" />
                      Ata de {dataBr(a.data_extraida)}
                    </Button>
                  ))}
                </>
              ) : null}
            </div>

            <Separator />

            <div className="flex gap-2 pb-6">
              <Button
                className="flex-1 gap-2"
                disabled={salvando !== null}
                onClick={() => decidir(true)}
              >
                {salvando === 'aprovar' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Confirmar acordo
              </Button>
              <Button
                variant="outline"
                className="flex-1 gap-2"
                disabled={salvando !== null}
                onClick={() => decidir(false)}
              >
                {salvando === 'rejeitar' ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                Não é acordo
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* PDF nunca abre página nem aba — regra dura do produto. */}
      <MediaLightbox url={pdfUrl} title="Ata da audiência" onClose={() => setPdfUrl(null)} />
    </>
  );
}

function Campo({ rotulo, valor, className }: { rotulo: string; valor: string; className?: string }) {
  return (
    <div className={className}>
      <p className="text-xs text-muted-foreground">{rotulo}</p>
      <p className="font-medium break-words">{valor}</p>
    </div>
  );
}
