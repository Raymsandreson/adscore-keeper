// =============================================================================
// Carteira do POP — aba lateral (Sheet) aberta de dentro do editor de POP.
//
// Mostra a régua de marcos com o dinheiro em cima: por marco, a relação dos
// processos e há quantos dias cada um está ali; por estágio financeiro, o valor
// da carteira; e no topo os agregados — média de tempo, índice de sucesso,
// custo de aquisição (CAC dos leads) e rentabilidade.
//
// Regras de UI da casa: Sheet por cima do editor (nada de redirecionar), fechar
// devolve exatamente onde estava. Regra de vocabulário: o valor exibido é o do
// PROCESSO (última decisão por cliente), não o caixa do escritório — o aviso
// fica visível na tela, não em tooltip.
// =============================================================================
import { useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ChevronDown, ChevronRight, Handshake, PauseCircle } from 'lucide-react';
import { useCarteiraDoPop, ESTAGIO_ORDEM, type GrupoMarco } from '@/hooks/useCarteiraDoPop';
import { ESTAGIO_LABEL } from '@/hooks/usePopMarcos';

interface Props {
  boardId: string | null;
  boardName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const brl = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

const dias = (d: number | null) => (d == null ? '—' : d === 0 ? 'hoje' : `${d} d`);

function EstagioChips({ porEstagio, compact }: { porEstagio: Record<string, number>; compact?: boolean }) {
  const presentes = ESTAGIO_ORDEM.filter(e => (porEstagio[e] || 0) > 0);
  if (!presentes.length) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {presentes.map(e => (
        <span
          key={e}
          className={`rounded bg-muted px-1.5 py-0.5 ${compact ? 'text-[10px]' : 'text-xs'} text-muted-foreground`}
        >
          {ESTAGIO_LABEL[e] || e}: <span className="font-medium text-foreground">{brl(porEstagio[e])}</span>
        </span>
      ))}
    </div>
  );
}

function GrupoDoMarco({ grupo }: { grupo: GrupoMarco }) {
  const [aberto, setAberto] = useState(false);
  return (
    <div className="rounded-lg border">
      <button
        type="button"
        className="flex w-full items-center gap-2 p-2.5 text-left hover:bg-muted/40"
        onClick={() => setAberto(v => !v)}
      >
        {aberto ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{grupo.rotulo}</span>
        <Badge variant="secondary" className="shrink-0">{grupo.processos.length}</Badge>
        {grupo.diasMedio != null && (
          <span className="shrink-0 text-xs text-muted-foreground">média {dias(grupo.diasMedio)}</span>
        )}
        {grupo.valor > 0 && (
          <span className="shrink-0 text-xs font-semibold">{brl(grupo.valor)}</span>
        )}
      </button>
      {aberto && (
        <div className="space-y-1 border-t p-2">
          <EstagioChips porEstagio={grupo.porEstagio} compact />
          {grupo.processos.map(p => (
            <div key={p.processId} className="flex items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-muted/40">
              <span className="min-w-0 flex-1 truncate">
                <span className="font-mono">{p.cnj}</span>
                {p.titulo ? <span className="ml-1.5 text-muted-foreground">{p.titulo}</span> : null}
              </span>
              {p.temAcordo && <Handshake className="h-3 w-3 shrink-0 text-emerald-500" aria-label="acordo homologado" />}
              {p.suspenso && <PauseCircle className="h-3 w-3 shrink-0 text-amber-500" aria-label="suspenso" />}
              {p.clientes > 1 && <span className="shrink-0 text-muted-foreground">{p.clientes} clientes</span>}
              {p.valor > 0 && <span className="shrink-0 font-medium">{brl(p.valor)}</span>}
              <span className="w-14 shrink-0 text-right text-muted-foreground" title="tempo neste marco">
                {dias(p.diasNoMarco)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function PopCarteiraSheet({ boardId, boardName, open, onOpenChange }: Props) {
  const { grupos, totais, loading, erro } = useCarteiraDoPop(open ? boardId : null);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-3 overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="text-base">Carteira · {boardName || 'POP'}</SheetTitle>
        </SheetHeader>

        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : erro ? (
          <p className="text-sm text-destructive">{erro}</p>
        ) : totais.processos === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum processo com CNJ vinculado a este POP.
          </p>
        ) : (
          <>
            {/* Agregados da carteira */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <div className="rounded-lg border p-2.5">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Carteira</div>
                <div className="text-lg font-semibold">{brl(totais.valor)}</div>
                <div className="text-xs text-muted-foreground">{totais.processos} processos · pago {brl(totais.pago)}</div>
              </div>
              <div className="rounded-lg border p-2.5">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Tempo médio</div>
                <div className="text-lg font-semibold">{dias(totais.mediaDiasNoMarco)}</div>
                <div className="text-xs text-muted-foreground">
                  no marco atual · idade média {totais.mediaIdadeDias != null ? `${Math.round(totais.mediaIdadeDias / 30)} meses` : '—'}
                </div>
              </div>
              <div className="rounded-lg border p-2.5">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Índice de sucesso</div>
                <div className="text-lg font-semibold">
                  {totais.indiceSucesso != null ? `${totais.indiceSucesso}%` : '—'}
                </div>
                <div className="text-xs text-muted-foreground">
                  {totais.avaliaveis > 0
                    ? `${totais.sucessos} de ${totais.avaliaveis} decididos avaliáveis`
                    : 'nenhum decidido com leitura de decisão ainda'}
                  {totais.semLeitura > 0 ? ` · ${totais.semLeitura} sem leitura de decisão` : ''}
                </div>
              </div>
              <div className="rounded-lg border p-2.5 sm:col-span-3">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Custo e rentabilidade</div>
                {totais.custo > 0 ? (
                  <div className="text-sm">
                    <span className="font-semibold">{brl(totais.custo)}</span>
                    <span className="text-muted-foreground"> de aquisição ({totais.leadsComCusto} de {totais.leadsTotal} leads com custo) · </span>
                    <span className="font-semibold">realizado − custo: {brl(totais.resultadoRealizado)}</span>
                    {totais.multiploPotencial != null && (
                      <span className="text-muted-foreground"> · carteira ÷ custo: {totais.multiploPotencial.toFixed(1)}x</span>
                    )}
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground">
                    Nenhum lead deste POP tem custo de aquisição (CAC) registrado — a rentabilidade
                    aparece aqui quando o custo do lead estiver preenchido.
                  </div>
                )}
              </div>
            </div>

            {/* Carteira toda por estágio financeiro */}
            <div className="rounded-lg border p-2.5">
              <div className="mb-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                Carteira por estágio financeiro
              </div>
              <EstagioChips porEstagio={totais.porEstagio} />
            </div>

            <p className="text-[11px] leading-snug text-muted-foreground">
              Valores = quanto o processo vale (última decisão de cada cliente), não o caixa do
              escritório — cota do cliente e honorário ainda não são separados. Índice de sucesso:
              entre os decididos com leitura de decisão (ou acordo), quantos saíram com valor
              fixado ou acordo homologado — decidido sem leitura é buraco de captura e fica fora
              da conta.
            </p>

            {/* Por marco */}
            <div className="space-y-1.5">
              {grupos.map(g => <GrupoDoMarco key={g.chave} grupo={g} />)}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
