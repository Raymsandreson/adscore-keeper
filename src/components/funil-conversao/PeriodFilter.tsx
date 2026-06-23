import type { Periodo } from '@/lib/funilData';

const OPTIONS: { value: Periodo; label: string }[] = [
  { value: 'hoje', label: 'Hoje' },
  { value: 'semana', label: 'Semana' },
  { value: 'mes', label: 'Este mês' },
];

export function PeriodFilter({ value, onChange }: { value: Periodo; onChange: (p: Periodo) => void }) {
  return (
    <div
      role="tablist"
      aria-label="Período"
      className="inline-flex rounded-full border border-white/10 bg-[#14151d] p-1"
    >
      {OPTIONS.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={[
              'rounded-full px-4 py-1.5 text-[12.5px] font-medium transition-all duration-150',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#6366f1] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0b10]',
              active
                ? 'text-white shadow-[0_6px_20px_-8px_rgba(99,102,241,.8)]'
                : 'text-[#8b90a3] hover:text-[#f4f5fa]',
            ].join(' ')}
            style={
              active
                ? { background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)' }
                : undefined
            }
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
