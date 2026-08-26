// =============================================================================
// Conciliação dos acordos do POP — "o que foi lançado bate com o acordo?".
//
// Abre por cima da lista de POPs (Sheet lateral; fechar devolve onde estava).
//
// A régua: o contratual é SEMPRE 30% do bruto, então HC esperado = cota × 3/7.
// O SUCUMBENCIAL NÃO ENTRA na régua — varia de 5% a 15% conforme o juiz, pode
// ser majorado no cumprimento de sentença e pode ser dispensado. Ele aparece
// como observação, nunca como acusação.
// =============================================================================
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertTriangle, CheckCircle2, HelpCircle, RefreshCw, TrendingDown, TrendingUp } from 'lucide-react';
import { useConciliacaoAcordos } from '@/hooks/useConciliacaoAcordos';
import { ordenarPorDivergencia, totalizarConciliacao } from '@/lib/conciliacaoAcordo';
import { formatCnj } from '@/lib/cnj';

const brl = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 });

const dataBR = (d: string | null) => {
  const m = (d || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '—';
};

function Card({ titulo, valor, detalhe, tom }: {
  titulo: string; valor: string; detalhe?: string;
  tom: 'ok' | 'falta' | 'sobra' | 'neutro' | 'multa';
}) {
  const cores = {
    ok: 'border-emerald-500/40 bg-emerald-500/5',
    falta: 'border-destructive/40 bg-destructive/5',
    sobra: 'border-amber-500/40 bg-amber-500/5',
    multa: 'border-sky-500/40 bg-sky-500/5',
    neutro: 'border-border bg-muted/30',
  }[tom];
  return (
    <div className={`rounded-lg border p-3 ${cores}`}>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{titulo}</div>
      <div className="mt-0.5 text-lg font-semibold leading-tight">{valor}</div>
      {detalhe && <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{detalhe}</div>}
    </div>
  );
}

interface Props {
  board: { id: string; name: string } | null;
  onOpenChange: (aberto: boolean) => void;
}

export function PopConciliacaoSheet({ board, onOpenChange }: Props) {
  const { acordos, loading, erro, recarregar } = useConciliacaoAcordos(board?.id ?? null);
  const t = totalizarConciliacao(acordos.map(a => a.conciliacao));
  const ordenados = ordenarPorDivergencia(acordos);

  return (
    <Sheet open={!!board} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-3 overflow-y-auto sm:max-w-2xl">
        <SheetHeader className="space-y-1">
          <SheetTitle className="text-base">Conciliação dos acordos</SheetTitle>
          <p className="text-xs text-muted-foreground">{board?.name}</p>
        </SheetHeader>

        {loading ? (
          <div className="space-y-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full" />)}</div>
        ) : erro ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {erro}
          </p>
        ) : acordos.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nenhum acordo homologado neste POP.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Card titulo="Acordos conferidos" valor={String(t.acordos)}
                detalhe={`${t.ok} batem exatos${t.semCliente ? ` · ${t.semCliente} sem cota` : ''}`} tom="neutro" />
              <Card titulo="Honorário faltando" valor={brl(t.hcFaltando)}
                detalhe="lançado a menos que os 30% do contrato" tom="falta" />
              <Card titulo="Honorário sobrando" valor={brl(t.hcSobrando)}
                detalhe="lançado a mais que os 30%" tom="sobra" />
              <Card titulo="Multa por descumprimento" valor={brl(t.multa)}
                detalhe="devida, mas fora da conta do acordo" tom="multa" />
            </div>

            <p className="text-[11px] leading-snug text-muted-foreground">
              A régua é o contratual de <strong>30%</strong>: sobre o bruto, o cliente fica com 70% e o
              escritório com 30%, então o honorário devido é a cota do cliente × 3/7. O{' '}
              <strong>sucumbencial não entra na régua</strong> — ele varia de 5% a 15% conforme o juiz
              arbitrou, pode ser majorado no cumprimento de sentença e pode ser dispensado.
            </p>

            <div className="space-y-2">
              {ordenados.map(a => {
                const c = a.conciliacao;
                const Icone = c.situacao === 'OK' ? CheckCircle2
                  : c.situacao === 'SEM_CLIENTE' ? HelpCircle
                  : c.faltaHc > 0 ? TrendingDown : TrendingUp;
                const cor = c.situacao === 'OK' ? 'text-emerald-600 dark:text-emerald-400'
                  : c.situacao === 'SEM_CLIENTE' ? 'text-muted-foreground'
                  : c.faltaHc > 0 ? 'text-destructive' : 'text-amber-600 dark:text-amber-400';
                return (
                  <div key={a.processId} className="rounded-md border p-2.5">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">
                          {a.titulo || 'Processo sem título'}
                        </span>
                        <span className="block font-mono text-[11px] text-muted-foreground">
                          {formatCnj(a.cnj)} · acordo em {dataBR(a.dataAcordo)}
                        </span>
                      </span>
                      <span className={`flex shrink-0 items-center gap-1.5 text-sm font-semibold ${cor}`}>
                        <Icone className="h-4 w-4" />
                        {c.situacao === 'OK' ? 'confere'
                          : c.situacao === 'SEM_CLIENTE' ? 'sem cota lançada'
                          : brl(Math.abs(c.faltaHc))}
                      </span>
                    </div>

                    {c.situacao !== 'SEM_CLIENTE' && (
                      <div className="mt-1.5 grid grid-cols-3 gap-x-3 gap-y-0.5 text-[11px]">
                        <span className="text-muted-foreground">cota do cliente</span>
                        <span className="text-muted-foreground">honorário lançado</span>
                        <span className="text-muted-foreground">honorário devido (30%)</span>
                        <span className="font-medium">{brl(c.cliente)}</span>
                        <span className="font-medium">{brl(c.hc)}</span>
                        <span className="font-medium">{brl(c.hcEsperado)}</span>
                      </div>
                    )}

                    {/* Sucumbencial: comentário, nunca acusação. */}
                    {c.hs > 0 && (
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        Sucumbencial lançado: {brl(c.hs)}
                        {c.hsPctDoBruto != null && <> ({(c.hsPctDoBruto * 100).toFixed(1)}% do bruto)</>}
                        {c.hsForaDaFaixa && (
                          <Badge variant="outline" className="ml-1.5 border-amber-500/50 text-[9px] text-amber-600 dark:text-amber-400">
                            fora do usual de 5% a 15%
                          </Badge>
                        )}
                      </div>
                    )}

                    {c.multa > 0 && (
                      <div className="mt-1 text-[11px] text-sky-700 dark:text-sky-400">
                        Multa por descumprimento: {brl(c.multa)} — devida, mas fora da conta do acordo.
                      </div>
                    )}

                    {c.situacao === 'SEM_CLIENTE' && (
                      <div className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                        <AlertTriangle className="h-3 w-3" />
                        Sem cota do cliente lançada não há régua: 30% de quê? Este acordo não pode ser
                        conferido até alguém lançar a indenização.
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="flex justify-end pb-2">
              <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={() => void recarregar()}>
                <RefreshCw className="h-3 w-3" /> Recarregar
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
