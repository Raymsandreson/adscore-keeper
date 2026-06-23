import { useEffect, useState } from 'react';
import { FUNIL_DATA, type Periodo } from '@/lib/funilData';
import { Header } from '@/components/funil-conversao/Header';
import { KpiStrip } from '@/components/funil-conversao/KpiStrip';
import { InsightBanner } from '@/components/funil-conversao/InsightBanner';
import { FunnelBars } from '@/components/funil-conversao/FunnelBars';
import { CompositionDonut } from '@/components/funil-conversao/CompositionDonut';
import { DerivedIndicators } from '@/components/funil-conversao/DerivedIndicators';
import { AcolhedorRanking } from '@/components/funil-conversao/AcolhedorRanking';
import { StageTimeTable } from '@/components/funil-conversao/StageTimeTable';
import { StageChangesTable } from '@/components/funil-conversao/StageChangesTable';
import { fmt } from '@/lib/funilFormat';
import { MessageCircle, Ban, Scale } from 'lucide-react';

const STORAGE_KEY = 'funil-conversao:periodo';

export default function FunilConversaoPage() {
  const [periodo, setPeriodoState] = useState<Periodo>('mes');

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'hoje' || saved === 'semana' || saved === 'mes') {
        setPeriodoState(saved);
      }
    } catch {}
  }, []);

  const setPeriodo = (p: Periodo) => {
    setPeriodoState(p);
    try { localStorage.setItem(STORAGE_KEY, p); } catch {}
  };

  const data = FUNIL_DATA[periodo];

  return (
    <div
      className="min-h-screen text-[#f4f5fa]"
      style={{
        background: '#0a0b10',
        fontFamily: 'IBM Plex Sans, system-ui, sans-serif',
      }}
    >
      {/* Glows radiais no topo */}
      <div className="relative">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-[520px]"
          style={{
            background:
              'radial-gradient(60% 80% at 80% 0%, rgba(99,102,241,.16), transparent 60%), radial-gradient(50% 70% at 15% 0%, rgba(52,211,153,.08), transparent 60%)',
          }}
        />
        <div
          key={periodo}
          className="relative mx-auto w-full max-w-[1240px] px-5 py-8 sm:px-7 lg:py-12 animate-in fade-in duration-500"
        >
          <Header periodo={periodo} setPeriodo={setPeriodo} />

          {/* KPIs */}
          <div className="mt-8">
            <KpiStrip data={data} />
          </div>

          {/* Chips */}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Chip icon={<MessageCircle className="h-3.5 w-3.5" />}>
              No WhatsApp <Num>{data.kpis.noWhatsapp}</Num>
            </Chip>
            <Chip icon={<Ban className="h-3.5 w-3.5" />}>
              Inviável <Num>{data.kpis.inviavel}</Num>
            </Chip>
            <Chip icon={<Scale className="h-3.5 w-3.5 text-[#a6a8f0]" />}>
              <Num className="text-[#f4f5fa]">{data.mudancas.total}</Num>
              <span className="ml-1 text-[#8b90a3]">mudanças de etapa no período</span>
            </Chip>
          </div>

          {/* Banner */}
          <div className="mt-6">
            <InsightBanner data={data} />
          </div>

          {/* Grid 1.45fr / 1fr */}
          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1.45fr_1fr]">
            <FunnelBars distribuicao={data.distribuicao} />
            <div className="rounded-[18px]">
              <CompositionDonut distribuicao={data.distribuicao} />
              <div className="px-6">
                <DerivedIndicators distribuicao={data.distribuicao} />
              </div>
            </div>
          </div>

          {/* Ranking */}
          <div className="mt-6">
            <AcolhedorRanking acolhedores={data.acolhedores} />
          </div>

          {/* Tempo na etapa */}
          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
            <StageTimeTable
              title="Procuração Assinada"
              total={data.procuracaoAssinada.total}
              badgeTone="verde"
              rows={data.procuracaoAssinada.leads}
            />
            <StageTimeTable
              title="Documentos p/ Protocolo"
              total={data.documentosProtocolo.total}
              badgeTone="ambar"
              rows={data.documentosProtocolo.leads}
            />
          </div>

          {/* Mudanças */}
          <div className="mt-6">
            <StageChangesTable total={data.mudancas.total} rows={data.mudancas.rows} />
          </div>

          {/* Rodapé */}
          <footer className="mt-10 border-t border-white/[.05] pt-6 text-center">
            <p
              className="text-[12px] text-[#6b7080]"
              style={{ fontFamily: 'Newsreader, serif', fontStyle: 'italic' }}
            >
              Indicadores derivados da tabela leads e do histórico de etapas · horário de Brasília
            </p>
          </footer>
        </div>
      </div>
    </div>
  );
}

function Chip({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/[.07] bg-[#14151d] px-3 py-1.5 text-[12px] text-[#8b90a3]">
      {icon}
      {children}
    </span>
  );
}

function Num({ children, className }: { children: number; className?: string }) {
  return (
    <span
      className={['font-medium tabular-nums', className ?? 'text-[#f4f5fa]'].join(' ')}
      style={{ fontVariantNumeric: 'tabular-nums' }}
    >
      {fmt(children)}
    </span>
  );
}
