import { useEffect, useState, lazy, Suspense } from 'react';
import { Loader2, ListChecks, CheckCircle2, AlarmClock, PanelRightOpen, Target, Flag, Goal, Star, Inbox } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { externalSupabase, ensureExternalSession } from '@/integrations/supabase/external-client';
import { cn } from '@/lib/utils';

// A ficha da atividade abre num painel AO LADO — nunca redirect nem aba nova
// (regra do produto; ver .agents/skills/ui-sem-redirecionar). Lazy porque é o
// formulário completo de atividade.
const ActivityFullSheet = lazy(() =>
  import('@/components/activities/ActivityFullSheet').then(m => ({ default: m.ActivityFullSheet })),
);
const ProcessQuickSheet = lazy(() => import('@/components/tv/ProcessQuickSheet'));
import FeedbackAvaliarInline from '@/components/tv/FeedbackAvaliarInline';

// Painel lateral do telão /tv/atividades: ao clicar num chip de critério
// (status / fases / objetivos / passos / concluídas / atrasadas) de uma pessoa,
// lista o que compôs aquele número. Fonte: RPC tv_ranking_detalhe no Externo,
// que replica exatamente os filtros do tv_atividades_ranking — a soma aqui bate
// com o número do telão.

export type DetailCriterio =
  | 'status' | 'fases' | 'objetivos' | 'passos' | 'concluidas' | 'atrasadas'
  | 'estrelas' | 'fb_pendentes' | 'pend_cliente';

interface DetailItem {
  tipo: 'status' | 'fase' | 'objetivo' | 'passo' | 'concluida' | 'atrasada' | 'estrela' | 'fb_pendente'
    | 'pend_cliente';
  quando?: string;
  titulo: string | null;
  lead_nome?: string | null;
  lead_id?: string | null;
  /** Onde o item mora — o RPC devolve o que consegue afirmar de cada um. */
  objetivo?: string | null;
  fase?: string | null;
  pop?: string | null;
  processo?: string | null;
  /** De onde a marcação saiu — gravado no log a partir de 04/08/2026. */
  origem?: 'atividade' | 'processo' | null;
  /** Passo: atividade de onde a marcação saiu (metadata.activity_id). */
  atividade?: string | null;
  activity_id?: string;
  process_id?: string | null;
  deadline?: string;
  dias_atraso?: number;
  /** Estrela: nota recebida, com quem deu e por quê. */
  nota?: number | null;
  desfecho?: string | null;
  avaliador?: string | null;
  justificativa?: string | null;
  /** Feedback pendente: de quem é o retorno parado esperando avaliação. */
  responsavel?: string | null;
  retorno?: string | null;
  dias_parado?: number;
  /** Pendência do cliente: prazo combinado, quantas cobranças e a fala dele. */
  prazo?: string | null;
  cobrancas?: number;
  origem_pendencia?: 'ia' | 'manual';
  trecho?: string | null;
}

// Linha "de onde veio a marcação". A regra é a do Raym (04/08/2026): marcou
// dentro da atividade → atalho da atividade; marcou dentro da ficha do processo
// → atalho do processo. Sem origem gravada (funil, WhatsApp, ou passo anterior
// a 04/08) a linha diz isso em vez de inventar um vínculo.
function Origem({
  it, onAtividade, onProcesso,
}: {
  it: DetailItem;
  onAtividade: (id?: string) => void;
  onProcesso: (id?: string | null) => void;
}) {
  const verbo = it.tipo === 'passo' ? 'marcado' : 'fechou';
  const naAtividade = it.origem === 'atividade' && it.atividade && it.activity_id;
  const noProcesso = it.origem === 'processo' && it.processo && it.process_id;

  // Sem origem no log: não dá pra afirmar de onde saiu. Nada de datar o aviso —
  // o registro de origem entra em vigor no deploy, não numa data do calendário,
  // e passo marcado pelo funil/WhatsApp nunca vai ter origem.
  if (!naAtividade && !noProcesso) {
    return <div className="mt-1.5 text-xs italic text-white/25">origem não registrada</div>;
  }
  return (
    <div className="mt-1.5 flex items-start gap-1.5 text-xs">
      <span className="shrink-0 text-white/35">
        {verbo} {naAtividade ? 'na atividade:' : 'no processo:'}
      </span>
      <button
        className="group/o inline-flex min-w-0 flex-1 items-start gap-1 text-left font-semibold text-sky-300 hover:text-sky-200"
        onClick={e => {
          e.stopPropagation();
          if (naAtividade) onAtividade(it.activity_id);
          else onProcesso(it.process_id);
        }}
        title={naAtividade ? 'Abrir a atividade aqui do lado' : 'Abrir o processo aqui do lado'}
      >
        <span className="min-w-0 underline decoration-sky-300/40 underline-offset-2 group-hover/o:decoration-sky-200">
          {naAtividade ? it.atividade : it.processo}
        </span>
        <PanelRightOpen className="mt-0.5 h-3 w-3 shrink-0 opacity-60" />
      </button>
    </div>
  );
}

// Rótulo + valor num chip só, pra não virar sopa de texto solto.
function Chip({ label, valor, onClick }: { label: string; valor: string; onClick?: () => void }) {
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-baseline gap-1 rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[11px]',
        onClick && 'cursor-pointer transition hover:bg-white/[0.12]',
      )}
      onClick={onClick ? e => { e.stopPropagation(); onClick(); } : undefined}
      title={onClick ? 'Abrir o processo aqui do lado' : undefined}
    >
      <span className="shrink-0 uppercase tracking-wider text-white/30">{label}</span>
      <span className={cn('min-w-0 truncate', onClick ? 'text-sky-300 underline decoration-sky-300/30 underline-offset-2' : 'text-white/70')}>
        {valor}
      </span>
    </span>
  );
}

const CRITERIO_CFG: Record<DetailCriterio, { titulo: string; cor: string; Icon: typeof ListChecks }> = {
  status: { titulo: 'Status esperado', cor: 'text-yellow-300', Icon: Target },
  fases: { titulo: 'Fases', cor: 'text-amber-300', Icon: Flag },
  objetivos: { titulo: 'Objetivos', cor: 'text-lime-400', Icon: Goal },
  passos: { titulo: 'Passos', cor: 'text-sky-400', Icon: ListChecks },
  concluidas: { titulo: 'Concluídas', cor: 'text-emerald-400', Icon: CheckCircle2 },
  atrasadas: { titulo: 'Atrasadas', cor: 'text-rose-400', Icon: AlarmClock },
  estrelas: { titulo: 'Média das avaliações', cor: 'text-amber-400', Icon: Star },
  fb_pendentes: { titulo: 'Feedbacks sem avaliar', cor: 'text-pink-400', Icon: Inbox },
  pend_cliente: { titulo: 'Pendências do cliente em aberto', cor: 'text-cyan-400', Icon: Inbox },
};

// "Atrasadas" e "feedbacks sem avaliar" não usam o período aberto no telão — são
// backlog total, igual ao ranking. Deixar explícito pra ninguém achar que o
// número está errado. (Status passou a respeitar o período em 04/08/2026.)
function escopoLabel(criterio: DetailCriterio, periodLabel: string) {
  if (criterio === 'atrasadas') return 'backlog total (não filtra por período)';
  if (criterio === 'fb_pendentes') return 'esperando a avaliação dela · backlog total';
  if (criterio === 'pend_cliente') return 'o cliente ficou de fazer e não fez · backlog total';
  if (criterio === 'estrelas') return `notas recebidas · ${periodLabel}`;
  return periodLabel;
}

interface Props {
  nome: string;
  criterio: DetailCriterio;
  /** Contagem do chip; string quando o número não é contagem (⭐ = média). */
  count: number | string;
  since: string; // ISO — mesmo p_since passado ao ranking
  periodLabel: string; // "hoje" | "semana" | "mês"
  /** Abre a ficha do processo em aba lateral, sem sair do telão. */
  onAbrirProcesso?: (processId: string) => void;
  onClose: () => void;
}

export default function RankDetailSheet({ nome, criterio, count, since, periodLabel, onAbrirProcesso, onClose }: Props) {
  const [items, setItems] = useState<DetailItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Atividade aberta ao lado, sem tirar ninguém desta lista.
  const [atividadeAberta, setAtividadeAberta] = useState<string | null>(null);
  // Processo aberto aqui mesmo quando quem usa o componente não trata (fora do telão).
  const [processoLocal, setProcessoLocal] = useState<string | null>(null);
  const cfg = CRITERIO_CFG[criterio];

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await ensureExternalSession();
        const { data, error: qErr } = await (externalSupabase as any).rpc('tv_ranking_detalhe', {
          p_nome: nome,
          p_criterio: criterio,
          p_since: since,
        });
        if (cancelled) return;
        if (qErr) throw qErr;
        setItems(Array.isArray(data) ? data : []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Falha ao carregar o detalhe.');
      }
    })();
    return () => { cancelled = true; };
  }, [nome, criterio, since]);

  // Atividade abre em painel AO LADO (side="left"), nunca redirecionando nem em
  // aba nova — regra do produto, ver .agents/skills/ui-sem-redirecionar.
  const openActivity = (id?: string) => {
    if (id) setAtividadeAberta(id);
  };
  // Ficha do processo em aba lateral, por cima do detalhe — sem tirar ninguém
  // do telão. Sem o callback (uso fora do telão), abre o ProcessQuickSheet aqui
  // mesmo: redirecionar/abrir aba nova é proibido pela regra do produto.
  const openProcesso = (id?: string | null) => {
    if (!id) return;
    if (onAbrirProcesso) onAbrirProcesso(id);
    else setProcessoLocal(id);
  };

  return (
    <Sheet open onOpenChange={open => { if (!open) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto border-white/10 bg-slate-950 text-white">
        <SheetHeader>
          <SheetTitle className="flex items-baseline gap-2 text-white">
            <cfg.Icon className={cn('h-5 w-5 shrink-0 self-center', cfg.cor)} />
            <span className={cn('text-2xl font-black tabular-nums', cfg.cor)}>{count}</span>
            <span className="text-lg font-bold">{cfg.titulo}</span>
          </SheetTitle>
          <div className="text-left text-sm text-white/60">
            {nome} · {escopoLabel(criterio, periodLabel)}
          </div>
        </SheetHeader>

        <div className="mt-4 space-y-2">
          {error ? (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300">{error}</div>
          ) : items === null ? (
            <div className="flex items-center gap-2 py-10 justify-center text-white/50">
              <Loader2 className="h-5 w-5 animate-spin" /> Carregando…
            </div>
          ) : items.length === 0 ? (
            <div className="py-10 text-center text-white/50">
              {criterio === 'fb_pendentes' ? 'Nenhum feedback esperando avaliação. 👏'
                : criterio === 'pend_cliente' ? 'Nenhuma pendência de cliente em aberto. 👏'
                : 'Nada no período.'}
            </div>
          ) : (
            items.map((it, i) => (
              <div
                key={i}
                className={cn(
                  'rounded-lg border border-white/10 bg-white/[0.04] p-3',
                  it.activity_id && 'cursor-pointer transition hover:bg-white/[0.1]'
                )}
                onClick={() => openActivity(it.activity_id)}
                title={it.activity_id ? 'Abrir a atividade aqui do lado' : undefined}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1 text-sm font-semibold leading-snug">
                    {it.titulo || '(sem título)'}
                  </div>
                  {it.activity_id && <PanelRightOpen className="h-3.5 w-3.5 shrink-0 text-white/40 mt-0.5" />}
                </div>
                {/* Onde esse item mora: cliente · processo · objetivo · fase · POP */}
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {it.lead_nome && <Chip label="cliente" valor={it.lead_nome} />}
                  {/* Com origem no processo o chip sairia repetido — o número
                      já aparece na linha de origem, ali como atalho. Fora isso,
                      o chip abre o processo quando o vínculo é certo (o POP do
                      checklist é o do processo). */}
                  {it.processo && it.origem !== 'processo' && (
                    <Chip
                      label="processo"
                      valor={it.processo}
                      onClick={it.process_id ? () => openProcesso(it.process_id) : undefined}
                    />
                  )}
                  {it.objetivo && <Chip label="objetivo" valor={it.objetivo} />}
                  {it.fase && <Chip label="fase" valor={it.fase} />}
                  {it.pop && <Chip label="POP" valor={it.pop} />}
                </div>

                {/* De onde a marcação saiu: dentro da atividade → atalho da
                    atividade; dentro da ficha do processo → atalho do processo.
                    No objetivo/fase é a origem do último passo, que fechou o
                    conjunto. Só existe a partir de 04/08 (antes o log não
                    guardava a origem). */}
                {(it.tipo === 'passo' || it.tipo === 'objetivo' || it.tipo === 'fase') && (
                  <Origem it={it} onAtividade={openActivity} onProcesso={openProcesso} />
                )}

                {/* Nota recebida: estrelas + quem avaliou + o porquê. */}
                {it.tipo === 'estrela' && (
                  <div className="mt-1.5 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="flex items-center gap-0.5">
                        {[1, 2, 3, 4, 5].map(n => (
                          <Star
                            key={n}
                            className={cn('h-3.5 w-3.5', (it.nota || 0) >= n ? 'fill-amber-400 text-amber-400' : 'text-white/20')}
                          />
                        ))}
                      </span>
                      {it.desfecho && (
                        <span className={cn(
                          'rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider',
                          it.desfecho === 'satisfeito' ? 'bg-emerald-400/15 text-emerald-300'
                            : it.desfecho === 'incompleto' ? 'bg-amber-400/15 text-amber-300'
                            : 'bg-rose-400/15 text-rose-300',
                        )}>
                          {it.desfecho}
                        </span>
                      )}
                      {it.avaliador && <span className="text-xs text-white/40">por {it.avaliador}</span>}
                    </div>
                    {it.justificativa && (
                      <p className="rounded bg-white/[0.04] p-1.5 text-xs leading-snug text-white/60">{it.justificativa}</p>
                    )}
                  </div>
                )}

                {/* Feedback parado esperando a avaliação dela: de quem é o
                    retorno, há quantos dias e o que foi escrito. */}
                {it.tipo === 'fb_pendente' && (
                  <div className="mt-1.5 space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="text-white/40">retorno de <b className="text-white/70">{it.responsavel || '—'}</b></span>
                      {typeof it.dias_parado === 'number' && it.dias_parado > 0 && (
                        <span className="font-bold text-pink-400">
                          parado há {it.dias_parado} {it.dias_parado === 1 ? 'dia' : 'dias'}
                        </span>
                      )}
                    </div>
                    {it.retorno && (
                      <p className="rounded bg-white/[0.04] p-1.5 text-xs leading-snug text-white/60 line-clamp-4">{it.retorno}</p>
                    )}
                    {/* Avaliar aqui mesmo — mesma regra do funil de Atividades
                        (src/lib/feedbackEvaluation.ts), sem sair do telão. */}
                    {it.activity_id && (
                      <FeedbackAvaliarInline
                        alvo={{ id: it.activity_id, assigned_to_name: it.responsavel ?? null, title: it.titulo }}
                      />
                    )}
                  </div>
                )}

                {/* Pendência do cliente: há quantos dias está parada, quantas
                    vezes já foi cobrado e o que ele disse quando prometeu. */}
                {it.tipo === 'pend_cliente' && (
                  <div className="mt-1.5 space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      {typeof it.dias_parado === 'number' && it.dias_parado > 0 && (
                        <span className="font-bold text-cyan-400">
                          combinado há {it.dias_parado} {it.dias_parado === 1 ? 'dia' : 'dias'}
                        </span>
                      )}
                      {typeof it.cobrancas === 'number' && it.cobrancas > 0 && (
                        <span className="text-white/40">cobrado {it.cobrancas}x</span>
                      )}
                      {it.prazo && (
                        <span className="text-white/40">
                          prazo {format(new Date(`${it.prazo}T00:00:00`), 'dd/MM/yyyy', { locale: ptBR })}
                        </span>
                      )}
                    </div>
                    {it.trecho && (
                      <p className="rounded bg-white/[0.04] p-1.5 text-xs leading-snug text-white/60 line-clamp-3">“{it.trecho}”</p>
                    )}
                  </div>
                )}

                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-white/50">
                  {it.tipo === 'atrasada' ? (
                    <>
                      {it.deadline && <span>prazo {format(new Date(`${it.deadline}T00:00:00`), 'dd/MM/yyyy', { locale: ptBR })}</span>}
                      {typeof it.dias_atraso === 'number' && (
                        <span className="font-bold text-rose-400">{it.dias_atraso} {it.dias_atraso === 1 ? 'dia' : 'dias'} de atraso</span>
                      )}
                    </>
                  ) : (
                    it.quando && <span>{format(new Date(it.quando), "dd/MM · HH'h'mm", { locale: ptBR })}</span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </SheetContent>

      {/* Ficha da atividade AO LADO (esquerda), sem cobrir esta lista e sem
          tirar ninguém da tela. */}
      {atividadeAberta && (
        <Suspense fallback={null}>
          <ActivityFullSheet
            open
            onOpenChange={o => { if (!o) setAtividadeAberta(null); }}
            activityId={atividadeAberta}
            side="left"
          />
        </Suspense>
      )}

      {/* Processo, quando quem chamou não trata (fora do telão). */}
      {processoLocal && (
        <Suspense fallback={null}>
          <ProcessQuickSheet processId={processoLocal} onClose={() => setProcessoLocal(null)} />
        </Suspense>
      )}
    </Sheet>
  );
}
