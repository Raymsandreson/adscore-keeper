import { Eye } from 'lucide-react';
import { PeriodFilter } from './PeriodFilter';
import type { Periodo } from '@/lib/funilData';

export function Header({ periodo, setPeriodo }: { periodo: Periodo; setPeriodo: (p: Periodo) => void }) {
  return (
    <header className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
      <div className="flex items-start gap-4">
        <div
          className="grid h-12 w-12 shrink-0 place-items-center rounded-xl text-[20px] font-semibold text-white shadow-[0_10px_30px_-12px_rgba(99,102,241,.7)]"
          style={{ background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)' }}
          aria-hidden
        >
          F
        </div>
        <div>
          <h1
            className="text-[34px] leading-[1.1] tracking-[-0.01em] text-[#f4f5fa]"
            style={{ fontFamily: 'Newsreader, serif', fontWeight: 500 }}
          >
            Funil de Conversão
          </h1>
          <p className="mt-1 text-[13px] text-[#8b90a3]">
            Planilha BPC-LOAS · BASE_UNIFICADA · histórico de etapas{' '}
            <span style={{ fontFamily: 'Newsreader, serif', fontStyle: 'italic' }}>(horário de Brasília)</span>
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <PeriodFilter value={periodo} onChange={setPeriodo} />
        <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[.04] px-3 py-1.5 text-[12px] text-[#8b90a3]">
          <Eye className="h-3.5 w-3.5" aria-hidden />
          somente leitura
        </span>
      </div>
    </header>
  );
}
