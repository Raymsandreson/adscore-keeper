// =============================================================================
// "o que muda com esta peça" — o retorno que faltava depois de anexar.
//
// O Raym, em 25/08/2026: "mudei a documentação, mas nada mudou. Deveria abrir um
// popup com as mudanças que vão se suceder dessa — como no caso é os valores."
//
// Ele estava certo. Trocar a peça de um marco e não ver nada acontecer é pior
// que não poder trocar: a pessoa mexe, o número continua igual, e conclui que a
// tela quebrou. Este diálogo fecha esse laço.
//
// NADA É GRAVADO AQUI. A tela mostra o que a peça diz ao lado do que a carteira
// tem hoje, e para. Aplicar exige decidir como uma leitura vira decisão em
// `jm_decisoes` — modelagem que não se resolve num botão.
// =============================================================================
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertTriangle, ArrowRight, CalendarClock, CheckCircle2 } from 'lucide-react';

const brl = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 });

const dataBR = (d: string | null | undefined) => {
  const m = String(d ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '—';
};

const semAcento = (v: string) =>
  v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

interface ParteLida { nome?: string; verbas?: { valor?: number }[] }
interface ParcelaLida { n_parcela?: number; data_prevista?: string; valor?: number; beneficiario?: string }

export interface ValorAtual { cliente: string; valor: number }

interface Props {
  aberto: boolean;
  onClose: () => void;
  carregando: boolean;
  erro: string | null;
  /** A leitura crua da peça. null enquanto não voltou. */
  leitura: Record<string, unknown> | null;
  /** O que a carteira mostra hoje, para o lado a lado. */
  atuais: ValorAtual[];
  tituloPeca: string;
}

export function MudancasDaPecaDialog({
  aberto, onClose, carregando, erro, leitura, atuais, tituloPeca,
}: Props) {
  const partes = (Array.isArray(leitura?.partes) ? leitura.partes : []) as ParteLida[];
  const cronograma = (Array.isArray(leitura?.cronograma) ? leitura.cronograma : []) as ParcelaLida[];
  const valorPeca = num(leitura?.valor_condenacao);

  const somaParte = (p: ParteLida) => (p.verbas ?? []).reduce((s, v) => s + num(v.valor), 0);
  const totalPeca = partes.reduce((s, p) => s + somaParte(p), 0);
  const totalAtual = atuais.reduce((s, a) => s + a.valor, 0);
  const diferenca = totalPeca - totalAtual;

  // Casa por nome sem acento: a peça escreve "JOAO", a carteira "JOÃO".
  const atualDe = (nome: string) =>
    atuais.find(a => semAcento(a.cliente) === semAcento(nome))?.valor ?? null;

  return (
    <Dialog open={aberto} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-base">O que muda com esta peça</DialogTitle>
          <p className="text-xs text-muted-foreground">{tituloPeca}</p>
        </DialogHeader>

        {carregando ? (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Lendo a peça… costuma levar meio minuto.
            </p>
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        ) : erro ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {erro}
          </p>
        ) : !leitura ? (
          <p className="text-xs text-muted-foreground">A peça não devolveu leitura.</p>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {leitura.especie != null && <Badge variant="outline">{String(leitura.especie)}</Badge>}
              {valorPeca > 0 && <span className="font-semibold">{brl(valorPeca)}</span>}
              {(leitura.processo as { forma_pagamento?: string } | null)?.forma_pagamento && (
                <Badge variant="secondary">
                  {(leitura.processo as { forma_pagamento?: string }).forma_pagamento}
                </Badge>
              )}
            </div>

            {partes.length > 0 && (
              <section className="rounded-lg border">
                <div className="border-b px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Valor por parte
                </div>
                <div className="divide-y">
                  {partes.map((p, i) => {
                    const novo = somaParte(p);
                    const atual = atualDe(String(p.nome ?? ''));
                    const muda = atual == null || Math.abs(novo - atual) > 0.01;
                    return (
                      <div key={i} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs">
                        <span className="min-w-0 flex-1 truncate font-medium">{p.nome ?? '(sem nome)'}</span>
                        <span className="flex items-center gap-2">
                          {atual != null && (
                            <span className={muda ? 'text-muted-foreground line-through' : 'text-muted-foreground'}>
                              {brl(atual)}
                            </span>
                          )}
                          {muda && <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />}
                          {muda && <span className="font-semibold text-emerald-600 dark:text-emerald-400">{brl(novo)}</span>}
                          {!muda && <CheckCircle2 className="h-3 w-3 text-emerald-500" />}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center justify-between border-t px-3 py-2 text-xs">
                  <span className="text-muted-foreground">total das partes</span>
                  <span className="flex items-center gap-2">
                    <span className="text-muted-foreground line-through">{brl(totalAtual)}</span>
                    <ArrowRight className="h-3 w-3 text-muted-foreground" />
                    <span className="font-semibold">{brl(totalPeca)}</span>
                    {Math.abs(diferenca) > 0.01 && (
                      <Badge variant="outline" className={diferenca > 0
                        ? 'border-emerald-500/50 text-emerald-600 dark:text-emerald-400'
                        : 'border-destructive/50 text-destructive'}>
                        {diferenca > 0 ? '+' : ''}{brl(diferenca)}
                      </Badge>
                    )}
                  </span>
                </div>
              </section>
            )}

            {cronograma.length > 0 && (
              <section className="rounded-lg border">
                <div className="flex items-center gap-1.5 border-b px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <CalendarClock className="h-3.5 w-3.5" />
                  Cronograma — {cronograma.length} parcela{cronograma.length === 1 ? '' : 's'}
                </div>
                <div className="max-h-56 divide-y overflow-y-auto">
                  {cronograma.map((c, i) => (
                    <div key={i} className="flex items-center justify-between gap-2 px-3 py-1.5 text-xs">
                      <span className="w-8 shrink-0 text-muted-foreground">{c.n_parcela ?? i + 1}ª</span>
                      <span className="min-w-0 flex-1 truncate text-muted-foreground">
                        {c.beneficiario || 'todos os beneficiários'}
                      </span>
                      <span className="shrink-0 text-muted-foreground">{dataBR(c.data_prevista)}</span>
                      <span className="w-24 shrink-0 text-right font-medium">{brl(num(c.valor))}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <p className="flex items-start gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] leading-snug text-amber-700 dark:text-amber-400">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                <strong>Nada foi gravado.</strong> Isto é o que a peça diz, ao lado do que a carteira
                mostra hoje. Aplicar depende de decidir como uma leitura vira decisão lançada — e essa
                decisão não cabe num botão.
              </span>
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
