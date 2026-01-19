import { useMemo, useState, useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, LabelList } from "recharts";
import { format, subDays, startOfDay, eachDayOfInterval, startOfWeek, startOfMonth, startOfQuarter, startOfYear } from "date-fns";
import { ptBR } from "date-fns/locale";
import { TrendingUp, ChevronLeft, ChevronRight } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";

interface Comment {
  id: string;
  comment_type: string;
  created_at: string;
}

interface CommentsEvolutionChartProps {
  comments: Comment[];
}

type PeriodType = 'week' | 'month' | 'quarter' | 'semester' | 'year' | 'custom';

const periodOptions = [
  { value: 'week', label: 'Esta Semana' },
  { value: 'month', label: 'Este Mês' },
  { value: 'quarter', label: 'Este Trimestre' },
  { value: 'semester', label: 'Este Semestre' },
  { value: 'year', label: 'Este Ano' },
  { value: 'custom', label: 'Últimos X dias' },
];

export const CommentsEvolutionChart = ({ comments }: CommentsEvolutionChartProps) => {
  const [period, setPeriod] = useState<PeriodType>('week');
  const [customDays, setCustomDays] = useState(14);
  const [customDaysInput, setCustomDaysInput] = useState("14");
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const chartData = useMemo(() => {
    const endDate = new Date();
    let startDate: Date;

    switch (period) {
      case 'week':
        startDate = startOfWeek(endDate, { weekStartsOn: 1 });
        break;
      case 'month':
        startDate = startOfMonth(endDate);
        break;
      case 'quarter':
        startDate = startOfQuarter(endDate);
        break;
      case 'semester':
        const currentMonth = endDate.getMonth();
        const semesterStart = currentMonth < 6 ? 0 : 6;
        startDate = new Date(endDate.getFullYear(), semesterStart, 1);
        break;
      case 'year':
        startDate = startOfYear(endDate);
        break;
      case 'custom':
        startDate = subDays(endDate, customDays - 1);
        break;
      default:
        startDate = subDays(endDate, 13);
    }
    
    // Generate all days in range
    const days = eachDayOfInterval({ start: startDate, end: endDate });
    
    // Group comments by day
    const commentsByDay = comments.reduce((acc, comment) => {
      const day = format(startOfDay(new Date(comment.created_at)), 'yyyy-MM-dd');
      if (!acc[day]) {
        acc[day] = { received: 0, sent: 0 };
      }
      if (comment.comment_type === 'received') {
        acc[day].received++;
      } else if (comment.comment_type === 'sent') {
        acc[day].sent++;
      }
      return acc;
    }, {} as Record<string, { received: number; sent: number }>);
    
    // Map to chart format
    return days.map(day => {
      const dayKey = format(day, 'yyyy-MM-dd');
      const dayData = commentsByDay[dayKey] || { received: 0, sent: 0 };
      return {
        date: dayKey,
        dateLabel: format(day, 'dd/MM', { locale: ptBR }),
        received: dayData.received,
        sent: dayData.sent,
        total: dayData.received + dayData.sent
      };
    });
  }, [comments, period, customDays]);

  const checkScrollPosition = () => {
    const container = scrollContainerRef.current;
    if (container) {
      setCanScrollLeft(container.scrollLeft > 0);
      setCanScrollRight(container.scrollLeft < container.scrollWidth - container.clientWidth - 1);
    }
  };

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (container) {
      checkScrollPosition();
      container.addEventListener('scroll', checkScrollPosition);
      window.addEventListener('resize', checkScrollPosition);
      return () => {
        container.removeEventListener('scroll', checkScrollPosition);
        window.removeEventListener('resize', checkScrollPosition);
      };
    }
  }, [chartData]);

  const handleScrollTo = (direction: 'left' | 'right') => {
    const container = scrollContainerRef.current;
    if (container) {
      const scrollAmount = container.clientWidth * 0.8;
      container.scrollBy({
        left: direction === 'left' ? -scrollAmount : scrollAmount,
        behavior: 'smooth'
      });
    }
  };

  const totals = useMemo(() => {
    return chartData.reduce(
      (acc, day) => ({
        received: acc.received + day.received,
        sent: acc.sent + day.sent,
        total: acc.total + day.total
      }),
      { received: 0, sent: 0, total: 0 }
    );
  }, [chartData]);

  // Maximum 14 days visible at a time, rest requires scrolling
  const MAX_VISIBLE_DAYS = 14;
  const BAR_WIDTH = 40; // Width per day in pixels
  const chartWidth = Math.max(chartData.length * BAR_WIDTH, 100);
  const needsScroll = chartData.length > MAX_VISIBLE_DAYS;

  const chartConfig = {
    received: {
      label: "Recebidos",
      color: "hsl(var(--primary))"
    },
    sent: {
      label: "Enviados", 
      color: "hsl(142 76% 36%)" // green-600
    }
  };

  return (
    <Card className="mb-6">
      <CardHeader className="pb-2">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg">Evolução Diária</CardTitle>
            </div>
            <div className="flex items-center gap-2">
              <Select value={period} onValueChange={(value) => setPeriod(value as PeriodType)}>
                <SelectTrigger className="w-[160px] h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {periodOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {period === 'custom' && (
                <div className="flex items-center gap-1">
                  <Input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={customDaysInput}
                    onChange={(e) => {
                      const value = e.target.value;
                      // Allow empty string or numbers only
                      if (value === '' || /^\d+$/.test(value)) {
                        setCustomDaysInput(value);
                        const numValue = parseInt(value);
                        if (!isNaN(numValue) && numValue >= 1 && numValue <= 365) {
                          setCustomDays(numValue);
                        }
                      }
                    }}
                    onBlur={() => {
                      // On blur, reset to valid value if empty or invalid
                      const numValue = parseInt(customDaysInput);
                      if (isNaN(numValue) || numValue < 1) {
                        setCustomDaysInput("1");
                        setCustomDays(1);
                      } else if (numValue > 365) {
                        setCustomDaysInput("365");
                        setCustomDays(365);
                      }
                    }}
                    className={`w-16 h-8 ${
                      customDaysInput === '' || 
                      isNaN(parseInt(customDaysInput)) || 
                      parseInt(customDaysInput) < 1 || 
                      parseInt(customDaysInput) > 365 
                        ? 'border-destructive focus-visible:ring-destructive' 
                        : ''
                    }`}
                  />
                  <span className="text-sm text-muted-foreground">dias</span>
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-primary" />
              <span className="text-muted-foreground">Recebidos: <strong className="text-foreground">{totals.received}</strong></span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-green-600" />
              <span className="text-muted-foreground">Enviados: <strong className="text-foreground">{totals.sent}</strong></span>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="relative">
          {/* Left scroll indicator */}
          {needsScroll && canScrollLeft && (
            <button
              onClick={() => handleScrollTo('left')}
              className="absolute left-0 top-1/2 -translate-y-1/2 z-10 w-8 h-16 flex items-center justify-center bg-gradient-to-r from-background via-background/80 to-transparent hover:from-muted transition-colors"
              aria-label="Rolar para esquerda"
            >
              <ChevronLeft className="h-5 w-5 text-muted-foreground" />
            </button>
          )}
          
          {/* Right scroll indicator */}
          {needsScroll && canScrollRight && (
            <button
              onClick={() => handleScrollTo('right')}
              className="absolute right-0 top-1/2 -translate-y-1/2 z-10 w-8 h-16 flex items-center justify-center bg-gradient-to-l from-background via-background/80 to-transparent hover:from-muted transition-colors"
              aria-label="Rolar para direita"
            >
              <ChevronRight className="h-5 w-5 text-muted-foreground" />
            </button>
          )}

          <div 
            ref={scrollContainerRef}
            className={needsScroll ? "overflow-x-auto scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent scroll-smooth" : ""}
            style={{ maxWidth: '100%' }}
          >
            <div style={{ width: needsScroll ? chartWidth : '100%', minWidth: needsScroll ? chartWidth : 'auto' }}>
              <ChartContainer config={chartConfig} className="h-[200px] w-full">
                <BarChart data={chartData} margin={{ top: 20, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis 
                    dataKey="dateLabel" 
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis 
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    allowDecimals={false}
                  />
                  <ChartTooltip 
                    content={
                      <ChartTooltipContent 
                        labelFormatter={(value) => `Data: ${value}`}
                      />
                    }
                  />
                  <Bar
                    dataKey="received"
                    fill="hsl(var(--primary))"
                    radius={[4, 4, 0, 0]}
                    name="Recebidos"
                  >
                    <LabelList dataKey="received" position="top" fontSize={10} fill="hsl(var(--foreground))" formatter={(value: number) => value > 0 ? value : ''} />
                  </Bar>
                  <Bar
                    dataKey="sent"
                    fill="hsl(142 76% 36%)"
                    radius={[4, 4, 0, 0]}
                    name="Enviados"
                  >
                    <LabelList dataKey="sent" position="top" fontSize={10} fill="hsl(var(--foreground))" formatter={(value: number) => value > 0 ? value : ''} />
                  </Bar>
                </BarChart>
              </ChartContainer>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
