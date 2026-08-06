// "Modo Corrida" do telão /tv/atividades — o ranking vira uma pista de corrida
// cartoon. Cada assessor é um piloto numa raia; a posição do carro na pista
// segue a POSIÇÃO NO RANKING (1º colado na 🏁, último na largada). Clicar no
// carro abre o seletor de modelo/cor (salvo no banco por nome); clicar no nome
// abre a análise.
//
// Layout à prova de sobreposição: coluna fixa à esquerda (medalha + nome +
// números, sempre 100% visível) e a raia à direita onde SÓ o carro anda.

import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  CAR_MODELS, CAR_COLORS, CAR_BY_ID, RACE_CSS, autoCarFor, DEFAULT_COLOR,
} from './raceCars';
import type { DetailCriterio } from './RankDetailSheet';

export interface RaceRow {
  nome: string;
  resultado: number;
  fases: number;
  objetivos: number;
  passos: number;
  concluidas: number;
  atrasadas: number;
  doc_itens?: number;
  ativo_seg: number;
  ocioso_seg: number;
  chat_resp_seg: number | null;
  aprov_pct: number | null;
  /** Média das estrelas RECEBIDAS no período (null = ninguém avaliou ainda). */
  media_estrelas?: number | string | null;
  notas_n?: number;
  /** Feedbacks que a pessoa deveria avaliar e não avaliou (backlog total). */
  fb_pendentes?: number;
  pend_cliente?: number;
  home_office?: boolean;
}
export interface CarChoice { car_id: string; color: string }

export function nameKey(nome: string) {
  return nome.trim().toLowerCase();
}

const MEDALS = ['🥇', '🥈', '🥉'];

// Média de estrelas → rótulo curto pt-BR ("3,3"); sem nota no período = traço.
export function estrelaLabel(v: number | string | null | undefined) {
  const n = v == null ? NaN : Number(v);
  return Number.isFinite(n) ? n.toFixed(1).replace('.', ',') : '—';
}

// Tempo do cronômetro (segundos) → rótulo curto; 0/sem uso = traço.
function fmtTempo(s: number | null | undefined) {
  if (!s) return '—';
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${Math.floor(s / 3600)}h${String(Math.round((s % 3600) / 60)).padStart(2, '0')}`;
}

// Rótulo do escopo do recorde, por período aberto no telão. "por dia/semana/mês"
// (não "do dia") pra deixar claro que é a melhor marca de UM dia/semana/mês já
// registrado — e não o recorde de hoje.
const SCOPE_LABEL: Record<string, string> = {
  hoje: 'por dia',
  semana: 'por semana',
  mes: 'por mês',
};

// Faixa útil da raia, em % da largura (o carro é posicionado pelo `left`).
const START = 2;   // largada
const FLOOR = 12;  // último colocado que já pontuou
const FINISH = 80; // 1º do ranking, colado na bandeira

// Pontuou = tem qualquer entrega no período. `atrasadas` não conta (é critério
// negativo) e tempo de cronômetro também não — senão quem só ficou logado
// largaria na frente de quem não abriu o sistema.
function pontuou(r: RaceRow) {
  return (r.resultado || 0) > 0 || (r.fases || 0) > 0 || (r.objetivos || 0) > 0
    || (r.passos || 0) > 0 || (r.doc_itens || 0) > 0 || (r.concluidas || 0) > 0;
}

// Assinatura dos critérios do ranking (mesma lista do ORDER BY da RPC
// tv_atividades_ranking). Serve só pra detectar empate REAL: dois pilotos com
// todos os critérios iguais dividem a mesma marca na pista, em vez de um
// aparecer na frente do outro por causa do desempate alfabético.
function tieKey(r: RaceRow) {
  return [
    r.resultado, r.fases, r.objetivos, r.passos, r.doc_itens ?? 0,
    r.concluidas, r.atrasadas,
    r.media_estrelas ?? -1, r.fb_pendentes ?? 0,
    r.ativo_seg, r.ocioso_seg,
    r.chat_resp_seg ?? -1,
  ].join('|');
}

/**
 * Posição de cada carro na pista (% do `left`), derivada da POSIÇÃO NO RANKING.
 * O array chega ordenado pela RPC tv_atividades_ranking (resultado > fases >
 * objetivos > passos > itens do checklist > concluídas > atrasadas > média de
 * estrelas > feedbacks sem avaliar > tempo ativo > ocioso > resposta no chat),
 * então basta usar o índice: 1º colado na
 * bandeira, último dos que pontuaram no piso. Antes o carro andava só por
 * PASSOS e o 1º do ranking podia aparecer atrás do 4º na pista. Derivando do
 * índice, qualquer mudança futura de critério na RPC aparece na corrida
 * sozinha — sem replicar a regra de ordenação aqui.
 */
export function computeTrackPositions(ranking: RaceRow[]): number[] {
  // Quem ainda não pontuou nada no período fica na largada (não "andou"), em
  // vez de ganhar meio caminho de graça só por existir na lista. Como esses
  // ficam sempre no fim do ranking, a escada continua íntegra.
  const scored = ranking.filter(pontuou).length;
  const last = Math.max(scored - 1, 1); // divisor da faixa dos que pontuaram
  let slot = 0;      // posição efetiva; empate real herda a do anterior
  let prev = FINISH; // trava de monotonicidade: ninguém passa quem está acima
  return ranking.map((r, i) => {
    if (i > 0 && tieKey(r) !== tieKey(ranking[i - 1])) slot = i;
    const p = !pontuou(r) || slot >= scored
      ? START
      : Math.max(START, FINISH - (slot / last) * (FINISH - FLOOR));
    prev = Math.min(prev, p);
    return prev;
  });
}

export default function WackyRaceTrack({
  ranking,
  cars,
  onSaveCar,
  onAnalyze,
  onDetail,
  meta,
  periodo = 'hoje',
}: {
  ranking: RaceRow[];
  cars: Record<string, CarChoice>;
  onSaveCar: (nome: string, car_id: string, color: string) => void;
  onAnalyze: (row: RaceRow, rank: number) => void;
  // Clique num número da linha → lista do que compôs aquele número.
  // count é string quando o chip não é contagem (⭐ mostra a média formatada).
  onDetail?: (row: RaceRow, criterio: DetailCriterio, count: number | string) => void;
  // Meta = RECORDE individual de passos do período/time (linha de chegada).
  meta?: number;
  periodo?: 'hoje' | 'semana' | 'mes';
}) {
  // Piloto sendo editado (nome) → abre o seletor de carro.
  const [picking, setPicking] = useState<RaceRow | null>(null);

  // A pista segue o RANKING, não uma métrica isolada (ver computeTrackPositions).
  const trackPos = useMemo(() => computeTrackPositions(ranking), [ranking]);

  // Recorde do período (linha de chegada simbólica): quem iguala/supera ganha o
  // troféu 🏆 ao lado do nome. É um selo à parte — não mexe na posição do carro.
  const hasMeta = typeof meta === 'number' && meta > 0;
  const finish = hasMeta ? (meta as number) : 0;
  const scopeLabel = SCOPE_LABEL[periodo] ?? 'por dia';

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
        <span className="text-amber-300">
          🏁 Chegada = 1º do ranking
          {hasMeta && (
            <span className="ml-2 text-white/35">
              · recorde {scopeLabel}: <b className="tabular-nums">{finish}</b> passos
            </span>
          )}
        </span>
      </div>

      <div className="space-y-1.5 md:space-y-2">
        {ranking.map((r, i) => {
          const car = carOf(r.nome);
          const model = CAR_BY_ID[car.car_id] ?? CAR_MODELS[0];
          // Posição na pista = posição no ranking (empate divide a mesma marca).
          const prog = trackPos[i];
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
              {/* div (e não button) porque cada número dentro é clicável por si
                  — botão dentro de botão é HTML inválido. */}
              <div
                role="button"
                tabIndex={0}
                onClick={() => onAnalyze(r, i + 1)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onAnalyze(r, i + 1); } }}
                title={`Analisar desempenho de ${r.nome}`}
                className="group flex w-[46%] md:w-[36%] shrink-0 cursor-pointer items-center gap-2 text-left"
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
                  <span className="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-0 text-sm md:text-xl lg:text-2xl font-black tabular-nums text-white/80">
                    <RaceStat n={r.resultado ?? 0} label="status" cor="text-yellow-300" onClick={onDetail && (() => onDetail(r, 'status', r.resultado ?? 0))} />
                    <RaceStat n={r.fases ?? 0} label="fases" cor="text-amber-300" onClick={onDetail && (() => onDetail(r, 'fases', r.fases ?? 0))} />
                    <RaceStat n={r.objetivos ?? 0} label="obj" cor="text-lime-400" onClick={onDetail && (() => onDetail(r, 'objetivos', r.objetivos ?? 0))} />
                    <RaceStat n={r.passos} label="passos" cor="text-sky-400" onClick={onDetail && (() => onDetail(r, 'passos', r.passos))} />
                    <RaceStat n={r.concluidas} label="concl" cor="text-emerald-400" onClick={onDetail && (() => onDetail(r, 'concluidas', r.concluidas))} />
                    <RaceStat n={r.atrasadas} label="atr" cor="text-rose-400" onClick={onDetail && (() => onDetail(r, 'atrasadas', r.atrasadas))} />
                    {/* Qualidade do retorno (nota recebida) e dívida de avaliação (a dar). */}
                    <RaceStat
                      n={estrelaLabel(r.media_estrelas)}
                      label="⭐"
                      cor="text-amber-400"
                      onClick={onDetail && (() => onDetail(r, 'estrelas', estrelaLabel(r.media_estrelas)))}
                    />
                    <RaceStat
                      n={r.fb_pendentes ?? 0}
                      label="s/ avaliar"
                      cor="text-pink-400"
                      onClick={onDetail && (() => onDetail(r, 'fb_pendentes', r.fb_pendentes ?? 0))}
                    />
                  </span>
                  {/* Horas do cronômetro — linha discreta, não compete com os números principais. */}
                  <span className="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-0 text-[10px] md:text-xs font-bold tabular-nums text-white/40">
                    <span>⏱️ <b className="text-teal-400">{fmtTempo(r.ativo_seg)}</b> <span className="uppercase tracking-wider text-white/35">ativo</span></span>
                    <span>💤 <b className="text-orange-400">{fmtTempo(r.ocioso_seg)}</b> <span className="uppercase tracking-wider text-white/35">ocioso</span></span>
                  </span>
                </span>
              </div>

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
        🏁 A posição na pista segue o <b className="text-white/60">ranking</b> (1º na frente) ·
        clique no <b className="text-white/60">carro</b> pra escolher modelo e cor ·
        clique no <b className="text-white/60">nome</b> pra analisar &amp; mandar mensagem ·
        clique num <b className="text-white/60">número</b> pra ver o que entrou nele
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

/* ---------- Número de um critério na linha do piloto ---------- */
// Clicar abre o detalhe daquele critério; o stopPropagation evita que o clique
// suba pra coluna (que abre a análise do assessor).
function RaceStat({
  n, label, cor, onClick,
}: { n: number | string; label: string; cor: string; onClick?: () => void }) {
  return (
    <span>
      <b
        className={cn(
          cor,
          onClick && 'cursor-pointer rounded px-0.5 transition hover:bg-white/10 hover:ring-1 hover:ring-white/25',
        )}
        title={onClick ? `Ver o que entrou em ${label}` : undefined}
        onClick={onClick ? e => { e.stopPropagation(); onClick(); } : undefined}
      >
        {n}
      </b>{' '}
      <span className="text-[0.65em] font-bold uppercase tracking-wider text-white/45">{label}</span>
    </span>
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
