// =============================================================================
// Telão — FOCO DOS GERENTES: quanto do que cada gerente concluiu ficou na área
// dele, contra o piso combinado, e (na carteira processual) quantos processos
// saíram por ACORDO ou por EXECUÇÃO.
//
// Fica na coluna lateral, abaixo do Top de Avaliação: empilha, não cobre nada
// (regra permanente ui-sem-sobreposicao). Numa vista de time específico mostra
// só o gestor daquele time; na vista geral e no grupo gerencial, todos.
//
// O ranking do telão mede VOLUME de atividade. Este card mede DIREÇÃO: gerente
// pode encerrar trinta atividades e nenhuma ser da área que ele foi contratado
// para tocar. Por isso quem está abaixo do piso vem primeiro e em vermelho.
// =============================================================================
import { useEffect, useMemo, useState } from 'react';
import { db, ensureExternalSession } from '@/integrations/supabase';
import { Crosshair, Handshake, Gavel, ArrowDown, ArrowUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ManagerFocusRow } from '@/hooks/useManagerFocus';

interface Props {
  /** Nome do time em exibição; null/vazio = vista geral (todos os gerentes). */
  teamName?: string | null;
  /** true quando o telão está no grupo gerencial — mostra todos. */
  gerencial?: boolean;
  /** Telão passa 60_000 para atualizar sozinho. */
  refreshMs?: number;
}

/** Mesmo mês corrente do relatório diário: foco é padrão, não fato de um dia. */
function inicioDoMes(): string {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function Barra({ pct, min }: { pct: number; min: number | null }) {
  const ok = min === null || pct >= min;
  return (
    <div className="relative h-2 w-full overflow-hidden rounded-full bg-white/10">
      <div
        className={cn('h-full rounded-full transition-all duration-700', ok ? 'bg-emerald-400' : 'bg-red-400')}
        style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
      />
      {min !== null && (
        <div
          className="absolute top-0 h-2 w-0.5 bg-white/70"
          style={{ left: `${Math.max(0, Math.min(100, min))}%` }}
        />
      )}
    </div>
  );
}

export default function TvFocoGerentesPanel({ teamName, gerencial = false, refreshMs = 0 }: Props) {
  const [rows, setRows] = useState<ManagerFocusRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const carregar = async () => {
      try {
        await ensureExternalSession();
        const { data, error } = await (db as any).rpc('manager_focus_status', {
          p_since: inicioDoMes(),
          p_until: new Date().toISOString(),
        });
        if (error) throw new Error(error.message);
        if (!cancelled) setRows((data as ManagerFocusRow[]) || []);
      } catch (e) {
        console.warn('[TvFocoGerentesPanel] falha ao carregar:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    carregar();
    if (!refreshMs) return () => { cancelled = true; };
    const id = setInterval(carregar, refreshMs);
    return () => { cancelled = true; clearInterval(id); };
  }, [refreshMs]);

  const linhas = useMemo(() => {
    // Vista de um time: só quem gerencia aquele time. Geral/gerencial: todos.
    const doTime = !gerencial && teamName
      ? rows.filter(r => (r.times || []).includes(teamName))
      : rows;
    // Só entra quem tem o que mostrar — gerente sem configuração e sem carteira
    // viraria uma linha vazia no telão.
    return doTime
      .filter(r => (r.configurado && r.pct !== null) || (r.track_process_exits && r.processos_carteira > 0))
      .sort((a, b) => {
        const rank = (r: ManagerFocusRow) => (r.atingiu === false ? 0 : r.atingiu === true ? 1 : 2);
        return rank(a) - rank(b) || (a.pct ?? 0) - (b.pct ?? 0);
      });
  }, [rows, teamName, gerencial]);

  if (loading && !linhas.length) return null;
  if (!linhas.length) return null;

  return (
    <aside className="h-fit rounded-2xl border border-sky-400/25 bg-white/[0.04] p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-base font-black uppercase tracking-wide text-sky-300">
          <Crosshair className="h-4 w-4 shrink-0 text-sky-400" />
          Foco dos Gerentes
        </h2>
        <span className="shrink-0 rounded-full bg-sky-400/15 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-sky-300/90">
          no mês
        </span>
      </div>

      <div className="mt-3 space-y-3">
        {linhas.map(r => (
          <div key={r.manager_user_id}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-sm font-black text-white/90">{r.nome}</span>
              {r.pct !== null && (
                <span className={cn(
                  'shrink-0 text-xl font-black tabular-nums leading-none',
                  r.atingiu ? 'text-emerald-300' : 'text-red-300',
                )}>
                  {r.pct}%
                </span>
              )}
            </div>

            {r.pct !== null && (
              <>
                <div className="mt-1"><Barra pct={r.pct} min={r.min_percent} /></div>
                <div className="mt-1 flex items-center justify-between gap-2 text-[10px] font-black uppercase tracking-wider text-white/45">
                  <span className="truncate">{r.focus_label}</span>
                  <span className="shrink-0">piso {r.min_percent}%</span>
                </div>
              </>
            )}

            {r.track_process_exits && (
              <>
                {/* Entrou × saiu: o que não sai trava o que pode entrar. */}
                <div className="mt-1.5 flex items-center gap-3 text-[11px] font-black text-white/70">
                  <span className="flex items-center gap-1">
                    <ArrowDown className="h-3.5 w-3.5 text-sky-400" />
                    <span className="tabular-nums">{r.entradas}</span> entrou
                  </span>
                  <span className="flex items-center gap-1">
                    <ArrowUp className="h-3.5 w-3.5 text-emerald-400" />
                    <span className="tabular-nums">{r.saidas}</span> saiu
                  </span>
                  {r.vazao_pct !== null && (
                    <span className={cn(
                      'ml-auto shrink-0 tabular-nums',
                      r.vazao_pct >= 100 ? 'text-emerald-300' : 'text-amber-300',
                    )}>
                      vazão {r.vazao_pct}%
                    </span>
                  )}
                </div>
                <div className="mt-1 flex items-center gap-3 text-[10px] font-black uppercase tracking-wider text-white/45">
                  <span className="flex items-center gap-1">
                    <Handshake className="h-3 w-3 text-emerald-400" />
                    <span className="tabular-nums">{r.saidas_por_acordo}</span> acordo
                  </span>
                  <span className="flex items-center gap-1">
                    <Gavel className="h-3 w-3 text-sky-400" />
                    <span className="tabular-nums">{r.saidas_por_execucao}</span> execução
                  </span>
                  {r.exit_target ? (
                    <span className="ml-auto shrink-0 text-white/40 tabular-nums">
                      {r.saidas}/{r.exit_target}
                    </span>
                  ) : null}
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </aside>
  );
}
