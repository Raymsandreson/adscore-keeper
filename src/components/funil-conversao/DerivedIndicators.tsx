import { CountUp, fmt, fmtPct } from '@/lib/funilFormat';
import type { EtapaDist } from '@/lib/funilData';

export function DerivedIndicators({ distribuicao }: { distribuicao: EtapaDist[] }) {
  const total = distribuicao.reduce((s, e) => s + e.count, 0) || 1;
  const byId = Object.fromEntries(distribuicao.map((e) => [e.id, e]));

  const assinadas = byId.procAssinada?.count ?? 0;
  const recepcao = byId.recepcao?.count ?? 0;
  const desq = byId.desqualificado?.count ?? 0;
  // ativos = soma de todas exceto Recepção e Desqualificado
  const ativos = total - recepcao - desq;

  const items = [
    {
      label: 'Procurações assinadas',
      value: assinadas,
      pct: (assinadas / total) * 100,
      cor: '#22c55e',
    },
    {
      label: 'Leads ativos no funil',
      value: ativos,
      pct: (ativos / total) * 100,
      cor: '#6366f1',
    },
    {
      label: 'Taxa de desqualificação',
      value: desq,
      pct: (desq / total) * 100,
      cor: '#5b6172',
    },
  ];

  return (
    <div className="mt-6 border-t border-white/[.06] pt-5">
      <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-3">
        {items.map((i) => (
          <div key={i.label} className="flex flex-col">
            <span className="text-[10.5px] uppercase tracking-[0.14em] text-[#6b7080]">
              {i.label}
            </span>
            <div className="mt-1.5 flex items-baseline gap-2">
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: i.cor }}
                aria-hidden
              />
              <span
                className="text-[22px] leading-none font-medium text-[#f4f5fa]"
                style={{ fontVariantNumeric: 'tabular-nums', fontFamily: 'IBM Plex Sans, sans-serif' }}
              >
                <CountUp value={i.value} />
              </span>
              <span
                className="text-[12px] text-[#8b90a3]"
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                · {fmtPct(i.pct)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
