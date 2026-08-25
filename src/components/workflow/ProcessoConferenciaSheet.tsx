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
import { useCallback, useEffect, useRef, useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertTriangle, CheckCircle2, FileText, Info, Loader2, Milestone, Paperclip, Plus, RefreshCw, ShieldAlert, Trash2, XCircle,
} from 'lucide-react';
import { useConferenciaProcesso, type AlvoConferencia, type NivelAlerta } from '@/hooks/useConferenciaProcesso';
import { FONTE_LABEL } from '@/hooks/useProcessoMarcos';
import { ESTAGIO_LABEL } from '@/hooks/usePopMarcos';
import { formatCnj, onlyDigits } from '@/lib/cnj';
import { MediaLightbox } from '@/components/whatsapp/MediaLightbox';
import { usePecasDoProcesso } from '@/hooks/usePecasDoProcesso';
import { melhorPeca, rotuloDaPeca, type AssuntoPeca, type PecaDoProcesso } from '@/lib/pecasDoProcesso';

const brl = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 });

const dataBR = (d: string | null) => {
  if (!d) return '—';
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : d;
};

/** "2026-07-01" -> "jul/2026". Número corrigido sem data não serve pra negociar. */
const mesAno = (iso: string | null) => {
  const m = (iso || '').match(/^(\d{4})-(\d{2})/);
  if (!m) return '—';
  const meses = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  return `${meses[Number(m[2]) - 1]}/${m[1]}`;
};

const INDICE_LABEL: Record<string, string> = {
  SELIC_SIMPLES_JT: 'SELIC simples (Justiça do Trabalho)',
  TCM_ESTADUAL: 'TCM (Justiça Estadual)',
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

function Secao({ titulo, children, acao, refSecao }: {
  titulo: string;
  children: React.ReactNode;
  acao?: React.ReactNode;
  refSecao?: React.Ref<HTMLElement>;
}) {
  return (
    <section ref={refSecao} className="rounded-lg border">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{titulo}</h3>
        {acao}
      </div>
      <div className="space-y-2 p-3">{children}</div>
    </section>
  );
}

/**
 * "ver a peça" — abre o PDF dos autos por cima da tela, nunca em aba nova.
 *
 * Regra permanente do projeto: clique que abre alguma coisa abre em painel por
 * cima, e o fechar devolve a pessoa exatamente de onde saiu. O MediaLightbox é
 * o mesmo visualizador do WhatsApp — mesma leitura, mesmo botão de baixar.
 *
 * Sem peça casada o botão NÃO aparece. Botão que não abre nada é pior que
 * ausência de botão: promete prova e entrega frustração.
 */
function BotaoPeca({ pecas, data, assunto, janelaDias, onAbrir }: {
  pecas: PecaDoProcesso[];
  data: string | null;
  assunto: AssuntoPeca;
  janelaDias?: number;
  onAbrir: (peca: PecaDoProcesso, rotulo: string) => void;
}) {
  const peca = melhorPeca(pecas, data, { assunto, janelaDias });
  if (!peca) return null;
  const rotulo = rotuloDaPeca(peca);
  return (
    <button
      type="button"
      onClick={() => onAbrir(peca, rotulo)}
      className="inline-flex items-center gap-1 text-[11px] underline underline-offset-2 hover:text-foreground"
      title={rotulo}
    >
      <Paperclip className="h-3 w-3 shrink-0" />
      ver a peça
      {peca.tipo === 'RESTRITO' && (
        <Badge variant="outline" className="ml-0.5 px-1 py-0 text-[8px]">restrita</Badge>
      )}
      {!peca.exata && <span className="text-muted-foreground">(+{peca.distanciaDias}d)</span>}
    </button>
  );
}

/**
 * "anexar peça" — o caminho manual, que existe porque o automático não basta.
 *
 * O certificado digital abre um tribunal em oito, e a peça que decide dinheiro
 * (termo de acordo, planilha homologada) é quase sempre restrita. Sem isto, a
 * carteira ficaria esperando um certificado que pode nunca funcionar.
 *
 * A peça entra amarrada à DATA DO MARCO — é o que faz o casamento por data
 * encontrá-la depois, sem nenhuma chave nova.
 */
function BotaoAnexar({ rotulo, data, onAnexar }: {
  rotulo: string;
  data: string | null;
  onAnexar: (a: File, d: { titulo: string; dataDocumento: string | null }) => Promise<{ ok: boolean; erro?: string }>;
}) {
  const input = useRef<HTMLInputElement | null>(null);
  const [subindo, setSubindo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  return (
    <>
      <input
        ref={input} type="file" accept="application/pdf" className="hidden"
        onChange={async (e) => {
          const a = e.target.files?.[0];
          e.target.value = ''; // permite reanexar o mesmo arquivo depois de um erro
          if (!a) return;
          setSubindo(true); setErro(null);
          const r = await onAnexar(a, { titulo: rotulo, dataDocumento: data });
          setSubindo(false);
          if (!r.ok) setErro(r.erro ?? 'falha ao anexar');
        }}
      />
      <button
        type="button"
        disabled={subindo}
        onClick={() => input.current?.click()}
        className="inline-flex items-center gap-1 text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:opacity-50"
        title={`Anexar a peça que comprova "${rotulo}"`}
      >
        {subindo ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
        {subindo ? 'anexando…' : 'anexar peça'}
      </button>
      {erro && <span className="text-[10px] text-destructive">{erro}</span>}
    </>
  );
}

/** Lixeira só onde ela é legítima: peça anexada à mão. O acervo do tribunal
 *  não se apaga — a policy do banco recusa, e a tela nem oferece. */
function BotaoExcluir({ peca, onExcluir }: {
  peca: PecaDoProcesso;
  onExcluir: (p: PecaDoProcesso) => Promise<{ ok: boolean; erro?: string }>;
}) {
  const [indo, setIndo] = useState(false);
  if (peca.origem !== 'manual') return null;
  return (
    <button
      type="button"
      disabled={indo}
      onClick={async () => { setIndo(true); await onExcluir(peca); setIndo(false); }}
      className="text-muted-foreground hover:text-destructive disabled:opacity-50"
      title="Excluir esta peça anexada à mão"
    >
      {indo ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
    </button>
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
    totalConferido, totalAtualizado, totalPago, somaIngenua, alertas, loading, erro,
    recarregar, leadDoProcesso, jcmIndice, jcmReferencia,
  } = useConferenciaProcesso(alvo);

  // As peças dos autos deste CNJ, para poder abrir a prova ao lado do número.
  const { pecas, assinar, anexar, excluir } = usePecasDoProcesso(alvo?.cnj ?? null);
  const [pecaAberta, setPecaAberta] = useState<{ url: string; titulo: string } | null>(null);
  const [erroPeca, setErroPeca] = useState<string | null>(null);

  const abrirPeca = useCallback(async (peca: PecaDoProcesso, rotulo: string) => {
    setErroPeca(null);
    const url = await assinar(peca.storagePath);
    // Assinatura falha quando o bucket não libera a sessão. Dizer isso é melhor
    // que abrir um visualizador vazio e deixar a pessoa achando que quebrou.
    if (!url) { setErroPeca(`Não consegui abrir "${rotulo}".`); return; }
    setPecaAberta({ url, titulo: rotulo });
  }, [assinar]);

  const recebidos = pagamentos.filter(p => p.data_recebida);
  const previstos = pagamentos.filter(p => !p.data_recebida);

  // Quem chegou clicando NO VALOR quer ver a abertura por parte, não os alertas.
  const secaoValores = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (alvo?.foco !== 'valores' || loading || !secaoValores.current) return;
    secaoValores.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [alvo?.foco, alvo?.processId, loading]);

  return (
    <Sheet open={!!alvo} onOpenChange={open => { if (!open) onClose(); }}>
      <SheetContent side="right" className="flex w-full flex-col gap-3 overflow-y-auto sm:max-w-xl">
        <SheetHeader className="space-y-1">
          <SheetTitle className="text-base">
            {/* De quem é o processo no lugar de maior destaque — o CNJ não diz
                nada para quem lê, o nome do caso diz. */}
            {leadDoProcesso || alvo?.leadNome || 'Conferência do processo'}
          </SheetTitle>
          {(leadDoProcesso || alvo?.leadNome) && (
            <p className="text-xs text-muted-foreground">Conferência do processo</p>
          )}
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
                      {(() => {
                        const p = melhorPeca(pecas, m.dataDetectada, { assunto: 'MARCO' });
                        // Sem peça casada, o que a linha precisa não é de um botão
                        // morto: é do caminho para trazer a prova que falta.
                        if (!p) {
                          return (
                            <BotaoAnexar rotulo={m.rotulo} data={m.dataDetectada} onAnexar={anexar} />
                          );
                        }
                        return (
                          <span className="flex shrink-0 items-center gap-1.5">
                            <BotaoPeca
                              pecas={pecas} data={m.dataDetectada} assunto="MARCO"
                              onAbrir={abrirPeca}
                            />
                            <BotaoExcluir peca={p} onExcluir={excluir} />
                          </span>
                        );
                      })()}
                      <span className="w-20 shrink-0 text-right text-muted-foreground">{dataBR(m.dataDetectada)}</span>
                    </div>
                  ))}
                </div>
              )}
            </Secao>

            {/* 3. Valor — a abertura por parte */}
            <Secao
              refSecao={secaoValores}
              titulo={clientes.length === 1 ? 'Valor da parte' : `Valor por parte (${clientes.length})`}
              acao={
                <span className="flex flex-col items-end leading-tight">
                  <span className="text-xs font-semibold">{brl(totalConferido)}</span>
                  {totalAtualizado > totalConferido + 0.01 && (
                    <span className="text-[10px] text-emerald-600 dark:text-emerald-400">
                      {brl(totalAtualizado)} corrigido
                    </span>
                  )}
                </span>
              }
            >
              {clientes.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Nenhum valor lançado na jurimetria para este CNJ — na carteira ele entra como projetado.
                </p>
              ) : (
                <>
                  <p className="text-[11px] leading-snug text-muted-foreground">
                    O valor é de cada PARTE, não do processo. O que a carteira mostra é a soma
                    das {clientes.length} {clientes.length === 1 ? 'parte' : 'partes'} abaixo.
                  </p>
                  {clientes.map(c => (
                    <div key={c.cliente} className="rounded-md border p-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="min-w-0 truncate text-sm font-medium">{c.cliente}</span>
                        <span className="flex items-center gap-2">
                          <Badge variant="outline" className="text-[9px]">{ESTAGIO_LABEL[c.estagio] || c.estagio}</Badge>
                          <span className="flex flex-col items-end leading-tight">
                            <span className="text-sm font-semibold">{brl(c.valor)}</span>
                            {c.valorAtualizado > c.valor + 0.01 && (
                              <span className="text-[10px] text-emerald-600 dark:text-emerald-400">
                                {brl(c.valorAtualizado)} corrigido
                              </span>
                            )}
                          </span>
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
                          {/* A conta inteira, para o número poder ser contestado. */}
                          {c.pagoEm ? (
                            <div className="text-emerald-700 dark:text-emerald-400">
                              Pago em {dataBR(c.pagoEm)} — valor que já caiu na conta não corrige;
                              fica pelo nominal.
                            </div>
                          ) : c.corrigido ? (
                            <div className="text-emerald-700 dark:text-emerald-400">
                              {brl(c.valor)} × {c.coeficiente?.toFixed(4)} = <span className="font-semibold">{brl(c.valorAtualizado)}</span>
                              <span className="text-muted-foreground">
                                {' '}· {jcmIndice ? INDICE_LABEL[jcmIndice] || jcmIndice : 'índice'} de{' '}
                                {dataBR(c.termoInicial)} até {mesAno(jcmReferencia)}
                                {c.termoEstimado && ' · termo estimado pela data da decisão'}
                              </span>
                            </div>
                          ) : (
                            <div className="text-amber-600 dark:text-amber-400">
                              Sem índice de correção para este ramo — o valor fica pelo nominal.
                            </div>
                          )}
                          {/* A prova vem primeiro de casa: temos os autos no bucket. O
                              site do tribunal só sobra para decisão cujo PDF não baixamos —
                              aí sim é exceção legítima, porque não roda dentro do app. */}
                          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                            <BotaoPeca
                              pecas={pecas} data={c.decisaoUsada.data_decisao} assunto="DECISAO"
                              onAbrir={abrirPeca}
                            />
                            {c.decisaoUsada.link && !melhorPeca(pecas, c.decisaoUsada.data_decisao, { assunto: 'DECISAO' }) && (
                              <a
                                href={c.decisaoUsada.link}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[11px] underline underline-offset-2"
                              >
                                ver a decisão no tribunal
                              </a>
                            )}
                          </div>
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
              acao={
                <span className="text-xs font-semibold">
                  {totalPago === 0 && recebidos.length > 0 && recebidos.every(p => p.valor_pago == null)
                    ? `${recebidos.length} parcela(s) recebida(s) sem valor importado`
                    : `${brl(totalPago)} recebido`}
                </span>
              }
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
                      <BotaoPeca
                        pecas={pecas} data={p.data_recebida ?? p.data_prevista}
                        assunto="PAGAMENTO" janelaDias={15} onAbrir={abrirPeca}
                      />
                      <span className="w-24 shrink-0 text-right font-medium">
                        {/* Recebida sem valor digitado ≠ recebeu zero — a planilha
                            importou o status sem o valor. Dizer "R$ 0,00" mentiria. */}
                        {(p.data_recebida ? p.valor_pago : p.valor_previsto) == null
                          ? <span className="font-normal text-muted-foreground">sem valor</span>
                          : brl(Number(p.data_recebida ? p.valor_pago : p.valor_previsto) || 0)}
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
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        {d.leadNome || <span className="italic text-muted-foreground">sem lead vinculado</span>}
                      </span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {d.title || '(sem título)'}
                      </span>
                    </span>
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
              Tudo nesta tela é leitura — conferir não altera nada. Os números repetem as regras da
              carteira: valor é quanto o processo vale (última decisão de cada parte), não o caixa do
              escritório. O corrigido aplica juros e correção do termo inicial de cada decisão até
              {' '}{mesAno(jcmReferencia)} — a carteira continua somando o nominal.
            </p>
          </>
        )}
        {/* Falha de assinatura não pode virar clique morto: a pessoa clicou
            esperando a prova e precisa saber por que ela não veio. */}
        {erroPeca && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
            {erroPeca} A peça está nos autos, mas o bucket não liberou o acesso.
          </p>
        )}
      </SheetContent>

      {/* Empilha por cima do próprio Sheet: telão -> conferência -> peça, e o
          fechar devolve à conferência, não à carteira. Mesmo visualizador do
          WhatsApp, com o mesmo botão de baixar. */}
      <MediaLightbox
        url={pecaAberta?.url ?? null}
        title={pecaAberta?.titulo ?? 'Peça dos autos'}
        onClose={() => setPecaAberta(null)}
      />
    </Sheet>
  );
}
