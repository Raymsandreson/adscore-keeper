// "Modo Corrida" do telão /tv/atividades — o ranking vira uma pista de corrida
// cartoon. Cada assessor é um piloto numa raia; a posição do carro na pista é
// proporcional aos PASSOS (líder mais perto da 🏁). Clicar no carro abre o
// seletor de modelo/cor (salvo no banco por nome); clicar no nome abre a análise.
//
// Layout à prova de sobreposição: coluna fixa à esquerda (medalha + nome +
// números, sempre 100% visível) e a raia à direita onde SÓ o carro anda.

import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  CAR_MODELS, CAR_COLORS, CAR_BY_ID, RACE_CSS, autoCarFor, DEFAULT_COLOR,
} from './raceCars';

export interface RaceRow {
  nome: string;
  passos: number;
  concluidas: number;
  atrasadas: number;
  ativo_seg: number;
  ocioso_seg: number;
  chat_resp_seg: number | null;
  aprov_pct: number | null;
  home_office?: boolean;
}
export interface CarChoice { car_id: string; color: string }

export function nameKey(nome: string) {
  return nome.trim().toLowerCase();
}

const MEDALS = ['🥇', '🥈', '🥉'];

// Rótulo do escopo do recorde, por período aberto no telão.
const SCOPE_LABEL: Record<string, string> = {
  hoje: 'do dia',
  semana: 'da semana',
  mes: 'do mês',
};

export default function WackyRaceTrack({
  ranking,
  cars,
  onSaveCar,
  onAnalyze,
  meta,
  periodo = 'hoje',
}: {
  ranking: RaceRow[];
  cars: Record<string, CarChoice>;
  onSaveCar: (nome: string, car_id: string, color: string) => void;
  onAnalyze: (row: RaceRow, rank: number) => void;
  // Meta = RECORDE individual de passos do período/time (linha de chegada).
  meta?: number;
  periodo?: 'hoje' | 'semana' | 'mes';
}) {
  // Piloto sendo editado (nome) → abre o seletor de carro.
  const [picking, setPicking] = useState<RaceRow | null>(null);

  // Líder do momento — fallback quando ainda não há recorde (meta 0), pra pista
  // não ficar com todos empilhados na bandeira.
  const maxP = useMemo(
    () => Math.max(1, ...ranking.map(r => r.passos)),
    [ranking],
  );
  // Linha de chegada = a META (recorde do período a bater). Sem recorde ainda
  // (ex.: 1ª semana/mês) cai no líder atual. Progresso ∝ passos/chegada, travado
  // na bandeira; quem iguala/supera o recorde ganha o troféu 🏆.
  const hasMeta = typeof meta === 'number' && meta > 0;
  const finish = hasMeta ? (meta as number) : maxP;
  const scopeLabel = SCOPE_LABEL[periodo] ?? 'do dia';

  const carOf = (nome: string): CarChoice => {
    const chosen = cars[nameKey(nome)];
    if (chosen && CAR_BY_ID[chosen.car_id]) return chosen;
    return autoCarFor(nome); // fallback determinístico até escolherem
  };

  return (
    <div className="wc-spin mt-5 rounded-2xl border border-white/10 bg-gradient-to-b from-slate-800/60 to-slate-900/60 p-3 md:p-4 overflow-hidden">
      <style>{RACE_CSS}</style>

      {/* Faixa "largada → chegada" */}
      <div className="mb-2 flex items-center justify-between px-1 text-[10px] md:text-xs font-black uppercase tracking-widest text-white/40">
        <span>🚦 Largada</span>
        {hasMeta ? (
          <span className="text-amber-300">
            🏁 Meta: recorde {scopeLabel} — <b className="tabular-nums">{finish}</b> passos
          </span>
        ) : (
          <span className="text-amber-300">🏁 Chegada = líder (sem recorde ainda)</span>
        )}
      </div>

      <div className="space-y-1.5 md:space-y-2">
        {ranking.map((r, i) => {
          const car = carOf(r.nome);
          const model = CAR_BY_ID[car.car_id] ?? CAR_MODELS[0];
          // Progresso ∝ passos/chegada, travado na bandeira (não passa dela).
          const prog = 2 + Math.min(r.passos / finish, 1) * 78;
          // Igualou/superou o recorde do período → bateu a meta.
          const bateu = hasMeta && r.passos >= finish;
          const CarSvg = model.Car;
          return (
            <div
              key={r.nome}
              className={cn(
                'flex items-stretch gap-2 md:gap-3 rounded-xl px-1.5 py-1 md:px-2',
                i === 0 && 'bg-amber-400/10 ring-1 ring-amber-400/30',
              )}
            >
              {/* ----- Coluna fixa: medalha + nome + números (sempre visível) ----- */}
              <button
                onClick={() => onAnalyze(r, i + 1)}
                title={`Analisar desempenho de ${r.nome}`}
                className="group flex w-[42%] md:w-[30%] shrink-0 items-center gap-2 text-left"
              >
                <span className="w-7 shrink-0 text-center text-lg md:text-2xl font-black tabular-nums">
                  {MEDALS[i] ?? <span className="text-white/40 text-sm md:text-lg">{i + 1}º</span>}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1 font-bold text-xs md:text-base truncate group-hover:text-amber-300 transition">
                    <span className="truncate">{r.nome}</span>
                    {r.home_office && <span title="Home office">🏠</span>}
                    {bateu && (
                      <span className="shrink-0 animate-pulse" title={`Bateu o recorde ${scopeLabel} (${finish} passos)!`}>🏆</span>
                    )}
                  </span>
                  <span className="text-[10px] md:text-xs text-white/50">
                    <b className="text-sky-400">{r.passos}</b> passos ·{' '}
                    <b className="text-emerald-400">{r.concluidas}</b> concl ·{' '}
                    <b className="text-rose-400">{r.atrasadas}</b> atr
                  </span>
                </span>
              </button>

              {/* ----- Raia: só o carro anda aqui ----- */}
              <div className="relative flex-1 self-center h-12 md:h-16">
                {/* asfalto + faixa central tracejada */}
                <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-8 md:h-11 rounded-lg bg-slate-950/50 border border-white/5" />
                <div className="absolute inset-x-2 top-1/2 -translate-y-1/2 border-t-2 border-dashed border-white/15" />
                {/* linha de chegada */}
                <div
                  className="absolute right-0 top-1/2 -translate-y-1/2 h-8 md:h-11 w-3 rounded-r-lg opacity-80"
                  style={{
                    backgroundImage:
                      'repeating-conic-gradient(#fff 0deg 90deg, #111 90deg 180deg)',
                    backgroundSize: '8px 8px',
                  }}
                  title="Chegada"
                />
                {/* carro */}
                <button
                  onClick={() => setPicking(r)}
                  title={`Trocar o carro de ${r.nome}`}
                  className="absolute top-1/2 z-10 h-11 w-[76px] md:h-14 md:w-[104px] -translate-y-1/2 transition-[left] duration-1000 ease-out hover:scale-110 hover:z-20"
                  style={{ left: `${prog}%` }}
                >
                  {/* poeirinha atrás */}
                  <span className="pointer-events-none absolute -left-2 bottom-1 h-3 w-3 rounded-full bg-white/25 blur-[2px]" />
                  <CarSvg color={car.color || DEFAULT_COLOR} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-3 text-center text-[10px] md:text-xs text-white/40">
        🏎️ Clique no <b className="text-white/60">carro</b> pra escolher o seu modelo e cor ·
        clique no <b className="text-white/60">nome</b> pra analisar &amp; mandar mensagem
      </p>

      {picking && (
        <CarPicker
          row={picking}
          current={carOf(picking.nome)}
          onClose={() => setPicking(null)}
          onPick={(car_id, color) => {
            onSaveCar(picking.nome, car_id, color);
            setPicking(null);
          }}
        />
      )}
    </div>
  );
}

/* ---------- Seletor de carro (modelo + cor) ---------- */
function CarPicker({
  row, current, onClose, onPick,
}: {
  row: RaceRow;
  current: CarChoice;
  onClose: () => void;
  onPick: (car_id: string, color: string) => void;
}) {
  const [carId, setCarId] = useState(current.car_id);
  const [color, setColor] = useState(current.color || DEFAULT_COLOR);
  const Preview = (CAR_BY_ID[carId] ?? CAR_MODELS[0]).Car;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="wc-spin w-full max-w-lg rounded-2xl bg-slate-900 border border-white/10 p-5 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-black text-white">
            🏁 Carro de <span className="text-amber-300">{row.nome}</span>
          </h3>
          <button onClick={onClose} className="text-white/50 hover:text-white text-xl leading-none">×</button>
        </div>

        {/* Preview grande */}
        <div className="mt-3 h-24 rounded-xl bg-slate-950/60 border border-white/5 px-6">
          <Preview color={color} />
        </div>

        {/* Modelos */}
        <div className="mt-4 text-[11px] font-black uppercase tracking-widest text-white/40">Modelo</div>
        <div className="mt-2 grid grid-cols-4 gap-2">
          {CAR_MODELS.map(m => {
            const M = m.Car;
            const active = m.id === carId;
            return (
              <button
                key={m.id}
                onClick={() => setCarId(m.id)}
                title={m.name}
                className={cn(
                  'rounded-lg border p-1 transition',
                  active ? 'border-amber-400 bg-amber-400/10' : 'border-white/10 hover:border-white/30',
                )}
              >
                <div className="h-9"><M color={color} /></div>
                <div className="text-[9px] font-bold text-white/50 truncate">{m.emoji} {m.name}</div>
              </button>
            );
          })}
        </div>

        {/* Cores */}
        <div className="mt-4 text-[11px] font-black uppercase tracking-widest text-white/40">Cor</div>
        <div className="mt-2 flex flex-wrap gap-2">
          {CAR_COLORS.map(c => (
            <button
              key={c.id}
              onClick={() => setColor(c.hex)}
              title={c.name}
              className={cn(
                'h-8 w-8 rounded-full ring-2 transition hover:scale-110',
                color === c.hex ? 'ring-white' : 'ring-transparent',
              )}
              style={{ backgroundColor: c.hex }}
            />
          ))}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-full px-4 py-2 text-sm font-bold text-white/60 hover:text-white">
            Cancelar
          </button>
          <button
            onClick={() => onPick(carId, color)}
            className="rounded-full bg-amber-400 px-5 py-2 text-sm font-black text-slate-900 hover:bg-amber-300 transition"
          >
            Correr com esse 🏁
          </button>
        </div>
      </div>
    </div>
  );
}
