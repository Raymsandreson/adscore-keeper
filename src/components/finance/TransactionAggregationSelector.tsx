import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  Users, 
  MapPin, 
  Map, 
  CalendarDays, 
  Calendar, 
  Tag,
  CreditCard,
  LayoutGrid
} from 'lucide-react';

export type AggregationType = 'card' | 'lead' | 'city' | 'state' | 'day' | 'month' | 'category';

interface TransactionAggregationSelectorProps {
  value: AggregationType;
  onChange: (value: AggregationType) => void;
}

const aggregationOptions: { value: AggregationType; label: string; icon: React.ReactNode }[] = [
  { value: 'card', label: 'Por Final do Cartão', icon: <CreditCard className="h-4 w-4" /> },
  { value: 'lead', label: 'Por Lead/Acolhedor', icon: <Users className="h-4 w-4" /> },
  { value: 'city', label: 'Por Cidade', icon: <MapPin className="h-4 w-4" /> },
  { value: 'state', label: 'Por Estado', icon: <Map className="h-4 w-4" /> },
  { value: 'day', label: 'Por Dia', icon: <CalendarDays className="h-4 w-4" /> },
  { value: 'month', label: 'Por Mês', icon: <Calendar className="h-4 w-4" /> },
  { value: 'category', label: 'Por Categoria', icon: <Tag className="h-4 w-4" /> },
];

export function TransactionAggregationSelector({ value, onChange }: TransactionAggregationSelectorProps) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as AggregationType)}>
      <SelectTrigger className="w-[180px]">
        <div className="flex items-center gap-2">
          <LayoutGrid className="h-4 w-4" />
          <SelectValue placeholder="Agrupar por..." />
        </div>
      </SelectTrigger>
      <SelectContent>
        {aggregationOptions.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            <div className="flex items-center gap-2">
              {option.icon}
              <span>{option.label}</span>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
