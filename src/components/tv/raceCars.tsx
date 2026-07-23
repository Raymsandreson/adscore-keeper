// Frota de carros do "Modo Corrida" do telão /tv/atividades.
// Desenhos ORIGINAIS em SVG, no clima cartoon de corrida — nenhum veículo é
// cópia de obra protegida (nada de Corrida Maluca/Hanna-Barbera). Cada carro
// aceita uma cor de carroceria; rodas giram quando o container tem `.wc-spin`.

import type { CSSProperties } from 'react';

export interface CarColor { id: string; hex: string; name: string; }
export interface CarModel {
  id: string;
  name: string;
  emoji: string;
  Car: (props: { color: string }) => JSX.Element;
}

// Paleta de cores de carroceria (cartoon, saturada — brilha no telão).
export const CAR_COLORS: CarColor[] = [
  { id: 'red', hex: '#ef4444', name: 'Vermelho' },
  { id: 'orange', hex: '#f97316', name: 'Laranja' },
  { id: 'amber', hex: '#f59e0b', name: 'Âmbar' },
  { id: 'lime', hex: '#84cc16', name: 'Verde-limão' },
  { id: 'emerald', hex: '#10b981', name: 'Esmeralda' },
  { id: 'cyan', hex: '#06b6d4', name: 'Ciano' },
  { id: 'sky', hex: '#0ea5e9', name: 'Azul' },
  { id: 'indigo', hex: '#6366f1', name: 'Índigo' },
  { id: 'violet', hex: '#8b5cf6', name: 'Violeta' },
  { id: 'fuchsia', hex: '#d946ef', name: 'Magenta' },
  { id: 'pink', hex: '#ec4899', name: 'Rosa' },
  { id: 'slate', hex: '#64748b', name: 'Grafite' },
];
export const DEFAULT_COLOR = CAR_COLORS[0].hex;

// CSS injetado uma vez pela pista: gira as rodas e balança a carroceria.
export const RACE_CSS = `
@keyframes wc-spin-kf { to { transform: rotate(360deg); } }
@keyframes wc-bob-kf { 0%,100% { transform: translateY(0) rotate(-.6deg); } 50% { transform: translateY(-2px) rotate(.6deg); } }
.wc-spin .wc-wheel { animation: wc-spin-kf .5s linear infinite; }
.wc-wheel { transform-box: fill-box; transform-origin: center; }
.wc-spin .wc-body { animation: wc-bob-kf .5s ease-in-out infinite; transform-origin: 50% 90%; }
@media (prefers-reduced-motion: reduce) {
  .wc-spin .wc-wheel, .wc-spin .wc-body { animation: none; }
}
`;

const wheelStyle: CSSProperties = { transformBox: 'fill-box', transformOrigin: 'center' };

// Roda cartoon reutilizável (girável). Posicionada por translate no <g> externo;
// o <g> interno (.wc-wheel) gira em torno do próprio centro sem conflito.
function Wheel({ cx, cy, r = 12 }: { cx: number; cy: number; r?: number }) {
  return (
    <g transform={`translate(${cx} ${cy})`}>
      <circle r={r + 1.5} fill="#0f172a" />
      <g className="wc-wheel" style={wheelStyle}>
        <circle r={r} fill="#1f2937" />
        <circle r={r * 0.42} fill="#e5e7eb" />
        <circle r={r * 0.15} fill="#94a3b8" />
        <rect x={-1.1} y={-r * 0.92} width={2.2} height={r * 1.84} rx={1} fill="#cbd5e1" />
        <rect x={-r * 0.92} y={-1.1} width={r * 1.84} height={2.2} rx={1} fill="#cbd5e1" />
        <g transform="rotate(45)">
          <rect x={-1.1} y={-r * 0.92} width={2.2} height={r * 1.84} rx={1} fill="#cbd5e1" />
          <rect x={-r * 0.92} y={-1.1} width={r * 1.84} height={2.2} rx={1} fill="#cbd5e1" />
        </g>
      </g>
    </g>
  );
}

// Vidro/cabine — tom claro azulado padrão.
const GLASS = '#bae6fd';
const SHADE = 'rgba(0,0,0,0.18)';
const LINE = '#0f172a';

/* ============================ MODELOS ============================ */
// viewBox padrão 0 0 160 92; rodas apoiadas em y≈66.

function Rocket({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 160 92" width="100%" height="100%">
      <g className="wc-body">
        {/* chama */}
        <path d="M22 60 L2 52 L14 60 L2 68 Z" fill="#f59e0b" />
        <path d="M20 60 L8 55 L16 60 L8 65 Z" fill="#fde047" />
        {/* corpo foguete */}
        <path d="M26 66 Q26 40 70 40 L118 42 Q150 46 150 60 Q150 66 130 68 L40 70 Q26 70 26 66 Z" fill={color} stroke={LINE} strokeWidth="2.5" />
        {/* nariz */}
        <path d="M118 42 Q150 46 150 60 L150 60 Q152 51 138 44 Z" fill={SHADE} />
        {/* aletas */}
        <path d="M30 44 L46 40 L44 54 Z" fill={color} stroke={LINE} strokeWidth="2" />
        {/* cabine */}
        <path d="M60 42 Q66 26 86 30 Q98 33 96 44 Z" fill={GLASS} stroke={LINE} strokeWidth="2.5" />
        <circle cx="120" cy="55" r="4" fill="#fff" stroke={LINE} strokeWidth="1.5" />
      </g>
      <Wheel cx={54} cy={68} />
      <Wheel cx={116} cy={68} />
    </svg>
  );
}

function HotRod({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 160 92" width="100%" height="100%">
      <g className="wc-body">
        {/* rabo baixo + cabine alta atrás */}
        <path d="M18 66 L30 60 L96 58 Q104 40 124 42 L138 44 Q150 46 150 60 L150 66 Z" fill={color} stroke={LINE} strokeWidth="2.5" />
        {/* cabine */}
        <path d="M104 44 Q108 30 124 32 L134 34 Q140 42 138 46 Z" fill={GLASS} stroke={LINE} strokeWidth="2.5" />
        {/* motor exposto na frente-esquerda */}
        <rect x="34" y="46" width="20" height="14" rx="2" fill="#334155" stroke={LINE} strokeWidth="2" />
        <rect x="38" y="38" width="3" height="10" fill="#94a3b8" />
        <rect x="44" y="35" width="3" height="13" fill="#94a3b8" />
        <rect x="50" y="38" width="3" height="10" fill="#94a3b8" />
        {/* escapamento */}
        <path d="M92 62 q14 4 26 2" fill="none" stroke="#cbd5e1" strokeWidth="3" strokeLinecap="round" />
      </g>
      <Wheel cx={54} cy={68} r={11} />
      <Wheel cx={126} cy={66} r={15} />
    </svg>
  );
}

function Tank({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 160 92" width="100%" height="100%">
      <g className="wc-body">
        {/* canhão */}
        <rect x="96" y="40" width="54" height="7" rx="3" fill="#475569" stroke={LINE} strokeWidth="2" />
        <circle cx="150" cy="43" r="3.5" fill="#1e293b" />
        {/* torre */}
        <path d="M74 46 Q76 30 98 32 Q112 34 110 46 Z" fill={color} stroke={LINE} strokeWidth="2.5" />
        {/* casco */}
        <path d="M30 62 Q28 48 44 48 L120 48 Q134 48 132 62 Z" fill={color} stroke={LINE} strokeWidth="2.5" />
        <rect x="30" y="58" width="102" height="5" fill={SHADE} />
        {/* esteira */}
        <rect x="26" y="62" width="112" height="16" rx="8" fill="#334155" stroke={LINE} strokeWidth="2.5" />
      </g>
      <Wheel cx={44} cy={70} r={9} />
      <Wheel cx={82} cy={70} r={9} />
      <Wheel cx={120} cy={70} r={9} />
    </svg>
  );
}

function Jalopy({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 160 92" width="100%" height="100%">
      <g className="wc-body">
        {/* corpo alto anos-20 */}
        <path d="M28 64 L30 40 Q30 34 40 34 L112 34 Q122 34 126 44 L138 52 Q146 54 146 62 L146 64 Z" fill={color} stroke={LINE} strokeWidth="2.5" />
        {/* teto/cabine */}
        <rect x="42" y="24" width="66" height="16" rx="4" fill={color} stroke={LINE} strokeWidth="2.5" />
        {/* janelas */}
        <rect x="48" y="28" width="26" height="12" rx="2" fill={GLASS} stroke={LINE} strokeWidth="1.5" />
        <rect x="78" y="28" width="26" height="12" rx="2" fill={GLASS} stroke={LINE} strokeWidth="1.5" />
        {/* faróis/frente */}
        <circle cx="140" cy="52" r="4" fill="#fde047" stroke={LINE} strokeWidth="1.5" />
        <rect x="28" y="52" width="6" height="12" fill={SHADE} />
      </g>
      <Wheel cx={52} cy={66} r={13} />
      <Wheel cx={122} cy={66} r={13} />
    </svg>
  );
}

function Buggy({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 160 92" width="100%" height="100%">
      <g className="wc-body">
        {/* carroceria curvinha (conversível) */}
        <path d="M24 64 Q20 44 46 44 Q54 30 78 32 Q96 33 104 46 L134 48 Q150 50 148 62 Q148 66 130 66 L34 66 Q24 66 24 64 Z" fill={color} stroke={LINE} strokeWidth="2.5" />
        {/* banco/interior */}
        <path d="M60 45 Q66 36 80 37 Q90 38 94 47 Z" fill={SHADE} />
        {/* flor no capô */}
        <g transform="translate(122 40)">
          <circle r="3.4" fill="#fde047" />
          <circle cx="0" cy="-6" r="3.4" fill="#fff" />
          <circle cx="6" cy="0" r="3.4" fill="#fff" />
          <circle cx="0" cy="6" r="3.4" fill="#fff" />
          <circle cx="-6" cy="0" r="3.4" fill="#fff" />
        </g>
        {/* coraçãozinho lateral */}
        <path d="M40 54 q-4 -5 -8 -1 q-3 3 8 9 q11 -6 8 -9 q-4 -4 -8 1 Z" fill="#fff" opacity="0.9" />
      </g>
      <Wheel cx={50} cy={68} />
      <Wheel cx={120} cy={68} />
    </svg>
  );
}

function Boulder({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 160 92" width="100%" height="100%">
      <g className="wc-body">
        {/* toldo colorido (parte que recebe a cor) */}
        <path d="M46 40 Q80 14 116 40 Z" fill={color} stroke={LINE} strokeWidth="2.5" />
        <path d="M46 40 L116 40" stroke={LINE} strokeWidth="2.5" />
        {/* postes do toldo */}
        <rect x="50" y="40" width="4" height="18" fill="#78716c" />
        <rect x="108" y="40" width="4" height="18" fill="#78716c" />
        {/* pedra/tronco */}
        <path d="M28 66 Q26 52 44 54 Q60 48 84 54 Q112 48 132 56 Q142 58 138 66 Q120 72 80 72 Q44 72 28 66 Z" fill="#a8a29e" stroke={LINE} strokeWidth="2.5" />
        <ellipse cx="66" cy="60" rx="5" ry="3" fill={SHADE} />
        <ellipse cx="104" cy="61" rx="6" ry="3.5" fill={SHADE} />
      </g>
      {/* rodas de pedra */}
      <g transform="translate(52 70)">
        <circle r="13" fill="#78716c" stroke={LINE} strokeWidth="2.5" />
        <g className="wc-wheel" style={wheelStyle}>
          <circle r="4" fill="#57534e" />
          <rect x="-1.5" y="-11" width="3" height="22" fill="#57534e" />
          <rect x="-11" y="-1.5" width="22" height="3" fill="#57534e" />
        </g>
      </g>
      <g transform="translate(118 70)">
        <circle r="13" fill="#78716c" stroke={LINE} strokeWidth="2.5" />
        <g className="wc-wheel" style={wheelStyle}>
          <circle r="4" fill="#57534e" />
          <rect x="-1.5" y="-11" width="3" height="22" fill="#57534e" />
          <rect x="-11" y="-1.5" width="22" height="3" fill="#57534e" />
        </g>
      </g>
    </svg>
  );
}

function Kart({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 160 92" width="100%" height="100%">
      <g className="wc-body">
        {/* chassi baixo */}
        <path d="M30 62 L36 56 L112 56 L128 60 L136 60 L136 64 L30 64 Z" fill={color} stroke={LINE} strokeWidth="2.5" />
        {/* bico */}
        <path d="M112 56 L134 58 Q140 59 138 63 L120 62 Z" fill={SHADE} />
        {/* banco/piloto */}
        <path d="M62 56 Q66 42 82 44 Q92 45 92 56 Z" fill="#334155" stroke={LINE} strokeWidth="2" />
        <circle cx="76" cy="40" r="7" fill="#fbbf24" stroke={LINE} strokeWidth="2" />
        {/* volante */}
        <line x1="92" y1="50" x2="102" y2="46" stroke={LINE} strokeWidth="2.5" />
        <circle cx="103" cy="45" r="4" fill="none" stroke={LINE} strokeWidth="2.5" />
        {/* aerofólio */}
        <rect x="28" y="46" width="4" height="16" fill={LINE} />
        <rect x="20" y="46" width="16" height="4" rx="2" fill={color} stroke={LINE} strokeWidth="1.5" />
      </g>
      <Wheel cx={48} cy={66} r={11} />
      <Wheel cx={120} cy={66} r={13} />
    </svg>
  );
}

function Torpedo({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 160 92" width="100%" height="100%">
      <g className="wc-body">
        {/* charuto/bala aerodinâmico */}
        <path d="M14 58 Q14 48 34 46 L120 44 Q152 46 152 56 Q152 62 120 62 L34 62 Q14 62 14 58 Z" fill={color} stroke={LINE} strokeWidth="2.5" />
        {/* faixa de corrida */}
        <path d="M20 54 L150 52 L150 56 L20 58 Z" fill="#fff" opacity="0.85" />
        {/* barbatana */}
        <path d="M22 46 L34 30 L44 46 Z" fill={color} stroke={LINE} strokeWidth="2" />
        {/* cabine bolha */}
        <path d="M70 46 Q78 32 96 36 Q106 39 104 47 Z" fill={GLASS} stroke={LINE} strokeWidth="2.5" />
        {/* nariz */}
        <path d="M120 44 Q152 46 152 56 Q150 48 132 45 Z" fill={SHADE} />
      </g>
      <Wheel cx={50} cy={64} r={11} />
      <Wheel cx={118} cy={64} r={11} />
    </svg>
  );
}

export const CAR_MODELS: CarModel[] = [
  { id: 'rocket', name: 'Foguete', emoji: '🚀', Car: Rocket },
  { id: 'hotrod', name: 'Hot Rod', emoji: '🔧', Car: HotRod },
  { id: 'torpedo', name: 'Torpedo', emoji: '💨', Car: Torpedo },
  { id: 'kart', name: 'Kart', emoji: '🏎️', Car: Kart },
  { id: 'buggy', name: 'Buggy Flor', emoji: '🌼', Car: Buggy },
  { id: 'jalopy', name: 'Calhambeque', emoji: '🎩', Car: Jalopy },
  { id: 'tank', name: 'Tanque', emoji: '💣', Car: Tank },
  { id: 'boulder', name: 'Pedra', emoji: '🪨', Car: Boulder },
];

export const CAR_BY_ID: Record<string, CarModel> = Object.fromEntries(
  CAR_MODELS.map(m => [m.id, m]),
);

// Escolha determinística de carro/cor pra quem ainda não escolheu (por nome).
export function autoCarFor(name: string): { car_id: string; color: string } {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return {
    car_id: CAR_MODELS[h % CAR_MODELS.length].id,
    color: CAR_COLORS[(h >> 3) % CAR_COLORS.length].hex,
  };
}
