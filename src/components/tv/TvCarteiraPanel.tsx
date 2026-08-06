// =============================================================================
// Vista "Carteira" do telão: esforço de um lado, resultado do outro.
//
// A corrida maluca ranqueia VOLUME DE ATIVIDADE. Atividade é esforço, não
// resultado — dá pra registrar trinta atividades num processo parado. Esta
// vista põe os dois lado a lado, por pessoa: quantas atividades ela concluiu e
// em quantos processos da carteira dela o processo efetivamente ANDOU (tem
// marco).
//
// O que motivou (medido em 06/08/2026): uma pessoa com 148 processos tinha 11
// com marco (7%); outra, com 13 processos, tinha 8 (62%). O ranking de
// atividade sozinho não mostra essa diferença — e é justamente ela que importa.
//
// Cuidado deliberado: isto NÃO é um ranking de "quem é melhor". Carteira grande
// com pouco marco pode ser processo novo, matéria lenta ou distribuição
// desigual. Por isso a vista mostra os números lado a lado e NÃO ordena por
// "desempenho" nem premia ninguém — quem interpreta é a gestão.
// =============================================================================
import { useMemo } from 'react';
import type { RaceRow } from '@/components/tv/WackyRaceTrack';
import { useCarteiraMarcos, cruzarComAtividades, chaveNome } from '@/lib/carteiraMarcos';

interface Props {
  /** Ranking de atividades já carregado pela página do telão. */
  rows: RaceRow[];
  /** Telão passa 60_000 pra atualizar sozinho. */
  refreshMs?: number;
}

function Barra({ pct, className }: { pct: number; className: string }) {
  return (
    <div className="h-2.5 w-full rounded-full bg-white/10 overflow-hidden">
      <div
        className={`h-full rounded-full transition-all duration-700 ${className}`}
        style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
      />
    </div>
  );
}

export default function TvCarteiraPanel({ rows, refreshMs = 0 }: Props) {
  const { data: carteira, loading, error } = useCarteiraMarcos(refreshMs);

  const linhas = useMemo(() => {
    const porNome = new Map<string, number>();
    for (const r of rows) porNome.set(chaveNome(r.nome), r.concluidas ?? 0);
    // Carteira maior primeiro: é onde mora o risco de processo parado.
    return cruzarComAtividades(carteira, porNome)
      .filter(l => l.processos > 0)
      .sort((a, b) => b.processos - a.processos);
  }, [carteira, rows]);

  const maxAtiv = useMemo(
    () => Math.max(1, ...linhas.map(l => l.atividades ?? 0)),
    [linhas],
  );

  if (loading && !linhas.length) {
    return <div className="p-8 text-center text-2xl text-white/60">Carregando carteira…</div>;
  }
  if (error) {
    return <div className="p-8 text-center text-2xl text-rose-400">{error}</div>;
  }
  if (!linhas.length) {
    return <div className="p-8 text-center text-2xl text-white/60">Sem processos atribuídos.</div>;
  }

  return (
    <div className="w-full h-full flex flex-col gap-3 p-4 overflow-hidden">
      <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_minmax(0,3fr)] gap-4 px-2
                      text-sm uppercase tracking-wide text-white/50 shrink-0">
        <div>Responsável</div>
        <div>Atividades concluídas</div>
        <div>Processos que andaram</div>
      </div>

      <div className="flex-1 flex flex-col gap-2 overflow-hidden">
        {linhas.map((l) => {
          // Só destaca quando há carteira relevante — 2 de 3 processos não diz nada.
          const alerta = l.processos >= 20 && l.pctComMarco < 15;
          return (
            <div
              key={l.userId ?? l.nome}
              className={`grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_minmax(0,3fr)] gap-4
                          items-center rounded-lg px-2 py-1.5
                          ${alerta ? 'bg-amber-500/10' : ''}`}
            >
              <div className="truncate text-lg text-white/90" title={l.nome}>
                {l.nome}
              </div>

              <div className="flex items-center gap-2">
                <Barra
                  pct={((l.atividades ?? 0) / maxAtiv) * 100}
                  className="bg-sky-400"
                />
                <span className="w-14 text-right tabular-nums text-lg text-white/80">
                  {l.atividades ?? '—'}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <Barra
                  pct={l.pctComMarco}
                  className={alerta ? 'bg-amber-400' : 'bg-emerald-400'}
                />
                <span className="w-28 text-right tabular-nums text-lg text-white/80">
                  {l.processosComMarco}/{l.processos}
                  <span className={`ml-1 text-sm ${alerta ? 'text-amber-300' : 'text-white/50'}`}>
                    {l.pctComMarco}%
                  </span>
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <p className="shrink-0 text-center text-xs text-white/40">
        Atividade é esforço; marco é o processo andando. Carteira grande com poucos
        marcos pode ser processo novo ou matéria lenta — o número abre a conversa, não a fecha.
      </p>
    </div>
  );
}
