import { useState } from 'react';
import { AlertTriangle, PhoneOff, ShieldCheck, Clock, Repeat2, Users } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { useRiscoDeBanimento, type RiscoDaInstancia } from '@/hooks/useRiscoDeBanimento';

/**
 * Relatório de risco de banimento, ao vivo.
 *
 * Por que a tela existe: em 2026 perdemos ISRAEL ATENDIMENTO (11/08, 10:48),
 * Karolyne (02/09) e Mateus (11/09, 10:53) — as três no meio de um dia útil,
 * sempre depois de uma rampa de abordagem a número novo. O monitor que deveria
 * avisar (`instance_connection_log`) tinha parado de ser alimentado em
 * 28/04/2026, então o Israel ficou 35 dias morto sem ninguém saber.
 *
 * Clique abre painel lateral por cima, nunca redireciona — regra da casa.
 */

const CORES: Record<string, string> = {
  'PROVAVELMENTE BANIDA': 'bg-red-600 text-white',
  'CRÍTICO': 'bg-red-100 text-red-800 border-red-300',
  'SILÊNCIO SUSPEITO': 'bg-orange-100 text-orange-800 border-orange-300',
  'ATENÇÃO': 'bg-amber-100 text-amber-800 border-amber-300',
  'ABANDONADA': 'bg-slate-200 text-slate-700',
  'OK': 'bg-emerald-100 text-emerald-800 border-emerald-300',
  'NUNCA USADA': 'bg-slate-100 text-slate-500',
  'SEM DADOS': 'bg-slate-100 text-slate-500',
};

function horas(h: number | null): string {
  if (h == null) return '—';
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 48) return `${h.toFixed(1)}h`;
  return `${Math.floor(h / 24)} dias`;
}

function num(v: number | null, sufixo = ''): string {
  return v == null ? '—' : `${v}${sufixo}`;
}

export function RiscoBanimentoPanel() {
  const { instancias, carregando, erro } = useRiscoDeBanimento();
  const [aberta, setAberta] = useState<RiscoDaInstancia | null>(null);

  if (erro) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-red-700">
          Não consegui ler o risco das instâncias: {erro}
        </CardContent>
      </Card>
    );
  }

  const atualizadoEm = instancias[0]?.calculado_em
    ? new Date(instancias[0].calculado_em).toLocaleString('pt-BR')
    : null;

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4 shrink-0" />
            <span>Risco de banimento por instância</span>
            {atualizadoEm && (
              <span className="text-xs font-normal text-muted-foreground">
                atualizado em {atualizadoEm}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {carregando && <p className="text-sm text-muted-foreground">Carregando…</p>}
          {!carregando && instancias.length === 0 && (
            <p className="text-sm text-muted-foreground">Nenhuma instância ativa cadastrada.</p>
          )}

          {instancias.map((i) => (
            <button
              key={i.instance_name}
              type="button"
              onClick={() => setAberta(i)}
              className="w-full rounded-lg border p-3 text-left transition hover:bg-muted/50"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{i.instance_name}</p>
                  {i.owner_name && (
                    <p className="truncate text-xs text-muted-foreground">{i.owner_name}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge className={CORES[i.classificacao] ?? CORES['SEM DADOS']}>
                    {i.classificacao}
                  </Badge>
                  <span className="text-sm tabular-nums text-muted-foreground">{i.score}/100</span>
                </div>
              </div>

              <Progress value={i.score} className="mt-2 h-1.5" />

              {i.motivos.length > 0 && (
                <ul className="mt-2 space-y-0.5">
                  {i.motivos.slice(0, 3).map((m) => (
                    <li key={m} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                      <span>{m}</span>
                    </li>
                  ))}
                  {i.motivos.length > 3 && (
                    <li className="text-xs text-muted-foreground">
                      +{i.motivos.length - 3} outro(s)
                    </li>
                  )}
                </ul>
              )}
            </button>
          ))}
        </CardContent>
      </Card>

      <Sheet open={!!aberta} onOpenChange={(v) => !v && setAberta(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
          {aberta && (
            <>
              <SheetHeader>
                <SheetTitle>{aberta.instance_name}</SheetTitle>
                <SheetDescription>
                  {aberta.classificacao} · {aberta.score}/100 · última mensagem há{' '}
                  {horas(aberta.horas_sem_atividade)}
                </SheetDescription>
              </SheetHeader>

              <div className="mt-4 space-y-5 text-sm">
                {aberta.motivos.length > 0 && (
                  <section>
                    <h4 className="mb-2 font-medium">O que está pesando</h4>
                    <ul className="space-y-1">
                      {aberta.motivos.map((m) => (
                        <li key={m} className="flex items-start gap-2 text-muted-foreground">
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                          <span>{m}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                <section>
                  <h4 className="mb-2 flex items-center gap-1.5 font-medium">
                    <Users className="h-4 w-4" /> Abordagem a número novo
                  </h4>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
                    <dt className="text-muted-foreground">Hoje</dt>
                    <dd className="tabular-nums">{aberta.novos_hoje}</dd>
                    <dt className="text-muted-foreground">Pico em 7 dias</dt>
                    <dd className="tabular-nums">{aberta.novos_pico_7d}</dd>
                    <dt className="text-muted-foreground">Menor intervalo</dt>
                    <dd className="tabular-nums">{num(aberta.gap_minimo_seg, 's')}</dd>
                    <dt className="text-muted-foreground">Intervalo mediano</dt>
                    <dd className="tabular-nums">{num(aberta.gap_mediano_seg, 's')}</dd>
                    <dt className="text-muted-foreground">Abordagens em rajada</dt>
                    <dd className="tabular-nums">{aberta.abordagens_em_rajada}</dd>
                  </dl>
                  <p className="mt-2 text-xs text-muted-foreground">
                    As três instâncias perdidas em 2026 faziam de 50 a 99 números novos por dia,
                    com intervalo mínimo de 5 a 7 segundos. Nenhuma das que continuam vivas passou
                    de 34.
                  </p>
                </section>

                <section>
                  <h4 className="mb-2 flex items-center gap-1.5 font-medium">
                    <PhoneOff className="h-4 w-4" /> Quem nunca respondeu
                  </h4>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
                    <dt className="text-muted-foreground">Conversas (30d)</dt>
                    <dd className="tabular-nums">{aberta.conversas_7d}</dd>
                    <dt className="text-muted-foreground">Abertas por nós</dt>
                    <dd className="tabular-nums">{aberta.iniciadas_por_nos}</dd>
                    <dt className="text-muted-foreground">Frias sem resposta</dt>
                    <dd className="tabular-nums">
                      {aberta.frias_sem_resposta} ({num(aberta.pct_fria_sem_resposta, '%')})
                    </dd>
                  </dl>
                  <p className="mt-2 text-xs text-muted-foreground">
                    É o mais perto que conseguimos chegar de &quot;quantos me denunciaram&quot;: o
                    WhatsApp não nos conta quem bloqueou, e quem não responde é quem bloqueia.
                  </p>
                </section>

                <section>
                  <h4 className="mb-2 flex items-center gap-1.5 font-medium">
                    <Repeat2 className="h-4 w-4" /> Texto repetido
                  </h4>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
                    <dt className="text-muted-foreground">Primeiras mensagens</dt>
                    <dd className="tabular-nums">{aberta.primeiras_msgs}</dd>
                    <dt className="text-muted-foreground">Textos distintos</dt>
                    <dd className="tabular-nums">{aberta.textos_distintos}</dd>
                    <dt className="text-muted-foreground">Repetição</dt>
                    <dd className="tabular-nums">{num(aberta.pct_texto_repetido, '%')}</dd>
                  </dl>
                </section>

                <section>
                  <h4 className="mb-2 flex items-center gap-1.5 font-medium">
                    <Clock className="h-4 w-4" /> Volume e silêncio
                  </h4>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
                    <dt className="text-muted-foreground">Enviadas (7d)</dt>
                    <dd className="tabular-nums">{aberta.enviadas_7d}</dd>
                    <dt className="text-muted-foreground">Recebidas (7d)</dt>
                    <dd className="tabular-nums">{aberta.recebidas_7d}</dd>
                    <dt className="text-muted-foreground">Enviadas por recebida</dt>
                    <dd className="tabular-nums">{num(aberta.razao_env_rec)}</dd>
                    <dt className="text-muted-foreground">Sem mensagem há</dt>
                    <dd className="tabular-nums">{horas(aberta.horas_sem_atividade)}</dd>
                  </dl>
                </section>

                <section className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
                  <p className="mb-1 font-medium text-foreground">De onde vêm estes limiares</p>
                  <p>
                    Não são do Meta. O Meta publica critérios de qualidade (bloqueios, denúncias,
                    limites por faixa) apenas para a API oficial do WhatsApp Business — a UazAPI
                    não tem contrato nem tabela de limites, e nada do que dispara banimento nela é
                    documentado. Estes números saíram da nossa própria base: 3 instâncias mortas
                    contra 6 vivas. É heurística calibrada, não lei. No backtest, as três marcaram
                    o 1º e o 2º lugar do ranking na véspera de cada queda.
                  </p>
                </section>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
