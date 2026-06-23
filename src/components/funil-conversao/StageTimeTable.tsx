import { fmt } from '@/lib/funilFormat';
import type { StageTimeRow } from '@/lib/funilData';

interface Props {
  title: string;
  total: number;
  badgeTone: 'verde' | 'ambar';
  rows: StageTimeRow[];
}

export function StageTimeTable({ title, total, badgeTone, rows }: Props) {
  const badgeClasses =
    badgeTone === 'verde'
      ? { bg: 'rgba(34,197,94,.12)', text: '#34d399', ring: 'rgba(34,197,94,.3)' }
      : { bg: 'rgba(234,179,8,.12)', text: '#eab308', ring: 'rgba(234,179,8,.32)' };

  return (
    <section
      className="rounded-[18px] border border-white/[.07] bg-[#14151d] p-6"
      aria-label={`Tempo na etapa — ${title}`}
    >
      <div className="mb-4 flex items-center justify-between">
        <div className="min-w-0">
          <p
            className="text-[12px] text-[#a6a8f0]"
            style={{ fontFamily: 'Newsreader, serif', fontStyle: 'italic' }}
          >
            Acima de 7 dias parados
          </p>
          <h3
            className="mt-0.5 truncate text-[18px] text-[#f4f5fa]"
            style={{ fontFamily: 'Newsreader, serif', fontWeight: 500 }}
          >
            {title}
          </h3>
        </div>
        <span
          className="shrink-0 rounded-full px-2.5 py-1 text-[11.5px] font-medium"
          style={{
            background: badgeClasses.bg,
            color: badgeClasses.text,
            boxShadow: `inset 0 0 0 1px ${badgeClasses.ring}`,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {fmt(total)}
        </span>
      </div>

      <ul className="flex flex-col">
        {rows.map((r, i) => (
          <li
            key={i}
            className="flex items-center justify-between gap-3 border-b border-white/[.04] py-2.5 last:border-b-0 transition-colors duration-150 hover:bg-white/[.028] px-1"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] text-[#f4f5fa]" title={r.lead}>
                {r.lead}
              </div>
              <div className="mt-0.5 text-[11.5px] text-[#6b7080]">
                acolhedor · <span className="text-[#8b90a3]">{r.acolhedor ?? '—'}</span>
              </div>
            </div>
            <span
              className="shrink-0 text-[11.5px] text-[#f0a3a0]"
              style={{ fontFamily: 'Newsreader, serif', fontStyle: 'italic' }}
            >
              s/ registro
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
