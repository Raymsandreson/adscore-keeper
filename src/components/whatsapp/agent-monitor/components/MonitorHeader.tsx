import { Bot, CalendarIcon, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { format, subDays, startOfWeek, startOfMonth, startOfYear } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useState } from 'react';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

interface MonitorHeaderProps {
  dateRange: { from: Date; to: Date };
  setDateRange: (range: { from: Date; to: Date }) => void;
  loading: boolean;
  onRefresh: () => void;
  selectedPeriod: string;
  setSelectedPeriod: (period: string) => void;
}

export function MonitorHeader({ dateRange, setDateRange, loading, onRefresh, selectedPeriod, setSelectedPeriod }: MonitorHeaderProps) {
  const [datePickerOpen, setDatePickerOpen] = useState(false);

  return (
    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Bot className="h-6 w-6 text-primary" />
          Monitor de IA
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">Monitore agentes, fila de casos e indicações em tempo real</p>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <ToggleGroup type="single" value={selectedPeriod} onValueChange={(v) => { if (v) setSelectedPeriod(v); }} className="border rounded-md">
          <ToggleGroupItem value="today" className="text-xs h-8 px-3">Hoje</ToggleGroupItem>
          <ToggleGroupItem value="7d" className="text-xs h-8 px-3">7 dias</ToggleGroupItem>
          <ToggleGroupItem value="30d" className="text-xs h-8 px-3">30 dias</ToggleGroupItem>
        </ToggleGroup>
        <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5 min-w-[180px] justify-start">
              <CalendarIcon className="h-3.5 w-3.5" />
              {format(dateRange.from, 'dd/MM/yy')} — {format(dateRange.to, 'dd/MM/yy')}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="end">
            <div className="flex">
              <div className="border-r p-2 space-y-1 min-w-[130px]">
                <p className="text-xs font-semibold text-muted-foreground px-2 pb-1">Atalhos</p>
                {[
                  { label: 'Hoje', from: new Date(), to: new Date() },
                  { label: 'Últimas 24h', from: subDays(new Date(), 1), to: new Date() },
                  { label: 'Últimos 7 dias', from: subDays(new Date(), 7), to: new Date() },
                  { label: 'Últimos 30 dias', from: subDays(new Date(), 30), to: new Date() },
                  { label: 'Esta semana', from: startOfWeek(new Date(), { weekStartsOn: 1 }), to: new Date() },
                  { label: 'Este mês', from: startOfMonth(new Date()), to: new Date() },
                  { label: 'Este ano', from: startOfYear(new Date()), to: new Date() },
                ].map(preset => (
                  <Button key={preset.label} variant="ghost" size="sm" className="w-full justify-start text-xs h-7"
                    onClick={() => { setDateRange({ from: preset.from, to: preset.to }); setDatePickerOpen(false); }}>
                    {preset.label}
                  </Button>
                ))}
              </div>
              <div className="p-2">
                <Calendar mode="range" selected={{ from: dateRange.from, to: dateRange.to }}
                  onSelect={(range) => {
                    if (range?.from && range?.to) { setDateRange({ from: range.from, to: range.to }); setDatePickerOpen(false); }
                    else if (range?.from) { setDateRange({ ...dateRange, from: range.from }); }
                  }}
                  numberOfMonths={2} className="pointer-events-auto" locale={ptBR} />
              </div>
            </div>
          </PopoverContent>
        </Popover>
        <Button variant="outline" size="sm" className="h-8" onClick={onRefresh} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>
    </div>
  );
}
