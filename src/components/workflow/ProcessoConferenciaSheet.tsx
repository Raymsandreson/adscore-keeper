// =============================================================================
// Conferência do processo — "esse valor e esse marco estão certos mesmo?".
//
// Abre por cima da Carteira do POP (Sheet lateral, empilhado; fechar devolve
// exatamente onde estava). Não é mais um relatório: é a MATÉRIA PRIMA ao lado do
// número, para o número poder ser contestado.
//
// O que a tela responde, nesta ordem:
//   1. Alertas — o que está errado ou frágil neste processo.
//   2. Marco — qual é o atual, que evidência o detectou, e a trilha inteira.
//   3. Valor — por cliente: qual decisão foi usada e quais foram DESCARTADAS
//      (somar todas infla ~2,6x; a tela mostra a soma ingênua para comparação).
//   4. Pagamentos — o que virou caixa de verdade.
// =============================================================================
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertTriangle, CheckCircle2, FileText, Info, Milestone, RefreshCw, ShieldAlert, XCircle,
} from 'lucide-react';
import { useConferenciaProcesso, type AlvoConferencia, type NivelAlerta } from '@/hooks/useConferenciaProcesso';
import { FONTE_LABEL } from '@/hooks/useProcessoMarcos';
import { ESTAGIO_LABEL } from '@/hooks/usePopMarcos';
import { formatCnj, onlyDigits } from '@/lib/cnj';

const brl = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 });

const dataBR = (d: string | null) => {
  if (!d) return '—';
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : d;
};

const CORES: Record<NivelAlerta, string> = {
  alto: 'border-destructive/40 bg-destructive/10 text-destructive',
  atencao: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400',
  info: 'border-border bg-muted/50 text-muted-foreground',
};

const ICONE: Record<NivelAlerta, typeof AlertTriangle> = {
  alto: ShieldAlert,
  atencao: AlertTriangle,
  info: Info,
};

function Secao({ titulo, children, acao }: { titulo: string; children: React.ReactNode; acao?: React.ReactNode }) {
  return (
    <section className="rounded-lg border">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{titulo}</h3>
        {acao}
      </div>
      <div className="space-y-2 p-3">{children}</div>
    </section>
  );
}

interface Props {
  alvo: AlvoConferencia | null;
  onClose: () => void;
  /** Abre a ficha completa do processo — o pai monta o sheet, para não aninhar. */
  onAbrirFicha: (processId: string) => void;
}

export function ProcessoConferenciaSheet({ alvo, onClose, onAbrirFicha }: Props) {
  const {
    marcos, marcoAtual, temAcordo, suspenso, clientes, pagamentos, duplicatas,
    totalConferido, totalPago, somaIngenua, alertas, loading, erro, recarregar,
  } = useConferenciaProcesso(alvo);

  const recebidos = pagamentos.filter(p => p.data_recebida);
  const previstos = pagamentos.filter(p => !p.data_recebida);

  return (
    <Sheet open={!!alvo} onOpenChange={open => { if (!open) onClose(); }}>
      <SheetContent side="right" className="flex w-full flex-col gap-3 overflow-y-auto sm:max-w-xl">
        <SheetHeader className="space-y-1">
          <SheetTitle className="text-base">Conferência do processo</SheetTitle>
          <p className="break-all font-mono text-xs text-muted-foreground">{formatCnj(onlyDigits(alvo?.cnj))}</p>
          {alvo?.titulo && <p className="text-xs text-muted-foreground">{alvo.titulo}</p>}
        </SheetHeader>

        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => alvo && onAbrirFicha(alvo.processId)}
          >
            <FileText className="h-3.5 w-3.5" /> Abrir ficha completa
          </Button>
          <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => void recarregar()} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Recarregar
          </Button>
        </div>

        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : erro ? (
          <p className="text-sm text-destructive">{erro}</p>
        ) : (
          <>
            {/* 1. O veredito da conferência */}
            {alertas.length === 0 ? (
              <div className="flex items-start gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-2.5 text-xs text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Nada divergente aqui: um cadastro só para este CNJ, marco de fase detectado com data,
                  e todo valor vem de decisão lida. O número da carteira se sustenta.
                </span>
              </div>
            ) : (
              <div className="space-y-1.5">
                {alertas.map((a, i) => {
                  const Icone = ICONE[a.nivel];
                  return (
                    <div key={i} className={`flex items-start gap-2 rounded-lg border p-2.5 text-xs ${CORES[a.nivel]}`}>
                      <Icone className="mt-0.5 h-4 w-4 shrink-0" />
                      <div className="min-w-0">
                        <div className="font-semibold">{a.titulo}</div>
                        <div className="opacity-90">{a.detalhe}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* 2. Marco */}
            <Secao titulo="Marco">
              {marcoAtual ? (
                <div className="rounded-md border bg-muted/30 p-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Milestone className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="text-sm font-semibold">{marcoAtual.rotulo}</span>
                    <Badge variant="secondary" className="text-[10px]">marco atual</Badge>
                    {temAcordo && <Badge className="bg-emerald-600 text-[10px] hover:bg-emerald-600">acordo homologado</Badge>}
                    {suspenso && <Badge className="bg-amber-500 text-[10px] hover:bg-amber-500">suspenso</Badge>}
                  </div>
                  <div className="mt-1.5 text-xs text-muted-foreground">
                    Detectado em <span className="font-medium text-foreground">{dataBR(marcoAtual.dataDetectada)}</span>
                    {marcoAtual.fonte && <> por <span className="font-medium text-foreground">{FONTE_LABEL[marcoAtual.fonte] || marcoAtual.fonte}</span></>}
                    {marcoAtual.temProvaDocumental
                      ? <> · <span className="text-emerald-600 dark:text-emerald-400">com prova documental</span></>
                      : <> · <span className="text-amber-600 dark:text-amber-400">sem prova documental</span></>}
                    {marcoAtual.estagioSugerido && <> · sugere estágio <span className="font-medium text-foreground">{ESTAGIO_LABEL[marcoAtual.estagioSugerido] || marcoAtual.estagioSugerido}</span></>}
                  </div>
                  <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
                    É o marco atual por ser o de maior ordem entre os que são FASE. Acordo e suspensão são
                    estado — atravessam fases e não disputam esta posição.
                  </p>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Nenhum marco de fase detectado neste processo.</p>
              )}

              {marcos.length > 0 && (
                <div className="space-y-1 pt-1">
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Trilha detectada</div>
                  {marcos.map(m => (
                    <div
                      key={`${m.chave}-${m.dataDetectada}`}
                      className={`flex items-center gap-2 rounded px-1.5 py-1 text-xs ${m.atual ? 'bg-muted/60 font-medium' : ''}`}
                    >
                      <span className="w-8 shrink-0 text-right font-mono text-[10px] text-muted-foreground">
                        {m.ordem ?? '—'}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{m.rotulo}</span>
                      {m.atravessaFases && (
                        <Badge variant="outline" className="shrink-0 text-[9px]">estado</Badge>
                      )}
                      {m.semCadastroNoPop && (
                        <Badge variant="outline" className="shrink-0 border-amber-500/50 text-[9px] text-amber-600 dark:text-amber-400">
                          fora do POP
                        </Badge>
                      )}
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {m.fonte ? FONTE_LABEL[m.fonte] || m.fonte : 'sem fonte'}
                      </span>
                      <span className="w-20 shrink-0 text-right text-muted-foreground">{dataBR(m.dataDetectada)}</span>
                    </div>
                  ))}
                </div>
              )}
            </Secao>

            {/* 3. Valor */}
            <Secao
              titulo="Valor por cliente"
              acao={<span className="text-xs font-semibold">{brl(totalConferido)}</span>}
            >
              {clientes.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Nenhum valor lançado na jurimetria para este CNJ — na carteira ele entra como projetado.
                </p>
              ) : (
                <>
                  {clientes.map(c => (
                    <div key={c.cliente} className="rounded-md border p-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="min-w-0 truncate text-sm font-medium">{c.cliente}</span>
                        <span className="flex items-center gap-2">
                          <Badge variant="outline" className="text-[9px]">{ESTAGIO_LABEL[c.estagio] || c.estagio}</Badge>
                          <span className="text-sm font-semibold">{brl(c.valor)}</span>
                        </span>
                      </div>

                      {c.decisaoUsada ? (
                        <div className="mt-1 text-[11px] text-muted-foreground">
                          Vale a decisão de <span className="font-medium text-foreground">{dataBR(c.decisaoUsada.data_decisao)}</span>
                          {c.decisaoUsada.tipo_evento && <> · {c.decisaoUsada.tipo_evento}</>}
                          {c.decisaoUsada.instancia && <> · {c.decisaoUsada.instancia}</>}
                          {c.decisaoUsada.orgao && <> · {c.decisaoUsada.orgao}</>}
                          <div>
                            moral {brl(c.danoMoral)} + estético {brl(c.danoEstetico)}
                          </div>
                          {c.decisaoUsada.link && (
                            /* Site do tribunal: não roda dentro do app — exceção legítima. */
                            <a
                              href={c.decisaoUsada.link}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="underline underline-offset-2"
                            >
                              ver a decisão no tribunal
                            </a>
                          )}
                        </div>
                      ) : (
                        <div className="mt-1 flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400">
                          <AlertTriangle className="h-3 w-3" /> valor sem decisão vinculada
                        </div>
                      )}

                      {c.descartadas.length > 0 && (
                        <div className="mt-1.5 border-t pt-1.5">
                          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                            Descartadas — decisões anteriores do mesmo cliente, NÃO somadas
                          </div>
                          {c.descartadas.map((d, i) => (
                            <div key={i} className="flex items-center gap-2 text-[11px] text-muted-foreground line-through">
                              <XCircle className="h-3 w-3 shrink-0 opacity-60" />
                              <span className="min-w-0 flex-1 truncate">
                                {dataBR(d.decisao?.data_decisao ?? null)}
                                {d.decisao?.tipo_evento ? ` · ${d.decisao.tipo_evento}` : ''}
                              </span>
                              <span>{brl(d.valor)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}

                  {somaIngenua > totalConferido + 0.01 && (
                    <p className="text-[11px] leading-snug text-muted-foreground">
                      Somar todas as linhas de valor daria {brl(somaIngenua)} — {(somaIngenua / (totalConferido || 1)).toFixed(1)}x
                      o correto. A conferência usa só a última decisão de cada cliente, como a carteira.
                    </p>
                  )}
                </>
              )}
            </Secao>

            {/* 4. Pagamentos */}
            <Secao
              titulo="Pagamentos"
              acao={<span className="text-xs font-semibold">{brl(totalPago)} recebido</span>}
            >
              {pagamentos.length === 0 ? (
                <p className="text-xs text-muted-foreground">Nenhuma parcela lançada para este processo.</p>
              ) : (
                <div className="space-y-1">
                  {[...recebidos, ...previstos].map(p => (
                    <div key={p.id} className="flex items-center gap-2 text-xs">
                      {p.data_recebida
                        ? <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-500" />
                        : <Info className="h-3 w-3 shrink-0 text-muted-foreground" />}
                      <span className="min-w-0 flex-1 truncate">
                        {p.cliente || '(sem cliente)'}
                        {p.n_parcela != null && <span className="text-muted-foreground"> · parcela {p.n_parcela}</span>}
                      </span>
                      <span className="shrink-0 text-muted-foreground">
                        {p.data_recebida ? `recebido ${dataBR(p.data_recebida)}` : `previsto ${dataBR(p.data_prevista)}`}
                      </span>
                      <span className="w-24 shrink-0 text-right font-medium">
                        {brl(Number(p.data_recebida ? p.valor_pago : p.valor_previsto) || 0)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Secao>

            {/* 5. Cadastros do mesmo CNJ */}
            {duplicatas.length > 1 && (
              <Secao titulo={`Cadastros deste CNJ (${duplicatas.length})`}>
                <p className="text-[11px] leading-snug text-muted-foreground">
                  A carteira soma por cadastro. Cada linha abaixo leva o valor inteiro do processo para o
                  total do POP — só uma deveria existir.
                </p>
                {duplicatas.map(d => (
                  <div key={d.id} className="flex items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-muted/40">
                    <span className="min-w-0 flex-1 truncate">{d.title || '(sem título)'}</span>
                    {d.esta && <Badge variant="secondary" className="shrink-0 text-[9px]">este</Badge>}
                    {d.workflowId !== alvo?.boardId && (
                      <Badge variant="outline" className="shrink-0 text-[9px]">outro POP</Badge>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 shrink-0 px-2 text-[11px]"
                      onClick={() => onAbrirFicha(d.id)}
                    >
                      abrir
                    </Button>
                  </div>
                ))}
              </Secao>
            )}

            <p className="pb-2 text-[11px] leading-snug text-muted-foreground">
              Tudo nesta tela é leitura — conferir não altera nada. Os números repetem as regras da carteira:
              valor é quanto o processo vale (última decisão por cliente), não o caixa do escritório.
            </p>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
