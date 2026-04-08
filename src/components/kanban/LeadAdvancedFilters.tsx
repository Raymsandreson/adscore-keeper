import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Filter, X, ChevronDown, ChevronUp, ClipboardList, UserSearch, MapPin, Search } from 'lucide-react';
import { ProfileItem } from '@/hooks/useProfilesList';

export interface LeadFilters {
  searchTerm: string;
  createdBy: string;
  updatedBy: string;
  acolhedor: string;
  createdFrom: string;
  createdTo: string;
  updatedFrom: string;
  updatedTo: string;
  victimName: string;
  ageRange: string;
  caseType: string;
  accidentDateFrom: string;
  accidentDateTo: string;
  visitState: string;
  visitCity: string;
  visitRegion: string;
}

export const emptyFilters: LeadFilters = {
  searchTerm: '',
  createdBy: '',
  updatedBy: '',
  acolhedor: '',
  createdFrom: '',
  createdTo: '',
  updatedFrom: '',
  updatedTo: '',
  victimName: '',
  ageRange: '',
  caseType: '',
  accidentDateFrom: '',
  accidentDateTo: '',
  visitState: '',
  visitCity: '',
  visitRegion: '',
};

const AGE_RANGES = [
  { value: '0-17', label: '0–17 anos', min: 0, max: 17 },
  { value: '18-25', label: '18–25 anos', min: 18, max: 25 },
  { value: '26-35', label: '26–35 anos', min: 26, max: 35 },
  { value: '36-45', label: '36–45 anos', min: 36, max: 45 },
  { value: '46-55', label: '46–55 anos', min: 46, max: 55 },
  { value: '56-65', label: '56–65 anos', min: 56, max: 65 },
  { value: '65+', label: '65+ anos', min: 65, max: 999 },
];

const CASE_TYPE_LABELS: Record<string, string> = {
  acidente_trabalho: 'Acidente de Trabalho',
  acidente_transito: 'Acidente de Trânsito',
  erro_medico: 'Erro Médico',
  queda: 'Queda',
  outro: 'Outro',
};

interface LeadAdvancedFiltersProps {
  filters: LeadFilters;
  onChange: (filters: LeadFilters) => void;
  profiles: ProfileItem[];
  availableStates: string[];
  availableCities: string[];
  availableRegions: string[];
  availableCaseTypes: string[];
  availableAcolhedores: string[];
}

// Map filter keys to human-readable labels
const FILTER_LABELS: Record<keyof LeadFilters, string> = {
  searchTerm: 'Busca',
  createdBy: 'Criado por',
  updatedBy: 'Atualizado por',
  acolhedor: 'Acolhedor',
  createdFrom: 'Criado de',
  createdTo: 'Criado até',
  updatedFrom: 'Atualizado de',
  updatedTo: 'Atualizado até',
  victimName: 'Vítima',
  ageRange: 'Faixa Etária',
  caseType: 'Tipo de Caso',
  accidentDateFrom: 'Acidente de',
  accidentDateTo: 'Acidente até',
  visitState: 'Estado',
  visitCity: 'Cidade',
  visitRegion: 'Região',
};

export function LeadAdvancedFilters({
  filters,
  onChange,
  profiles,
  availableStates,
  availableCities,
  availableRegions,
  availableCaseTypes,
  availableAcolhedores,
}: LeadAdvancedFiltersProps) {
  const [open, setOpen] = useState(false);

  const activeCount = useMemo(() => {
    return Object.values(filters).filter(v => v !== '').length;
  }, [filters]);

  const update = (key: keyof LeadFilters, value: string) => {
    onChange({ ...filters, [key]: value });
  };

  const clearAll = () => {
    onChange(emptyFilters);
  };

  const removeFilter = (key: keyof LeadFilters) => {
    onChange({ ...filters, [key]: '' });
  };

  // Build active filter chips with display values
  const activeFilters = useMemo(() => {
    const chips: { key: keyof LeadFilters; label: string; value: string }[] = [];
    (Object.keys(filters) as (keyof LeadFilters)[]).forEach(key => {
      if (!filters[key]) return;
      let displayValue = filters[key];

      if (key === 'createdBy' || key === 'updatedBy') {
        const profile = profiles.find(p => p.user_id === filters[key]);
        displayValue = profile?.full_name || profile?.email || filters[key].slice(0, 8);
      } else if (key === 'ageRange') {
        const range = AGE_RANGES.find(r => r.value === filters[key]);
        displayValue = range?.label || filters[key];
      } else if (key === 'caseType') {
        displayValue = CASE_TYPE_LABELS[filters[key]] || filters[key];
      }

      chips.push({ key, label: FILTER_LABELS[key], value: displayValue });
    });
    return chips;
  }, [filters, profiles]);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome..."
            className="h-8 w-48 pl-7 text-xs"
            value={filters.searchTerm}
            onChange={e => update('searchTerm', e.target.value)}
          />
        </div>

        <div className="flex items-center gap-1.5">
          <Label className="text-xs text-muted-foreground whitespace-nowrap">Acidente:</Label>
          <Input
            type="date"
            className="h-8 w-[130px] text-xs"
            value={filters.accidentDateFrom}
            onChange={e => update('accidentDateFrom', e.target.value)}
            placeholder="De"
            title="Data do acidente (de)"
          />
          <span className="text-xs text-muted-foreground">até</span>
          <Input
            type="date"
            className="h-8 w-[130px] text-xs"
            value={filters.accidentDateTo}
            onChange={e => update('accidentDateTo', e.target.value)}
            placeholder="Até"
            title="Data do acidente (até)"
          />
        </div>

        <CollapsibleTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2">
            <Filter className="h-4 w-4" />
            Filtros
            {activeCount > 0 && (
              <Badge variant="default" className="h-5 min-w-[20px] px-1.5 text-[10px]">
                {activeCount}
              </Badge>
            )}
            {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </Button>
        </CollapsibleTrigger>

        {/* Active filter chips */}
        {activeFilters.map(f => (
          <Badge
            key={f.key}
            variant="secondary"
            className="gap-1 pl-2 pr-1 py-1 text-xs cursor-pointer hover:bg-destructive/10"
            onClick={() => removeFilter(f.key)}
          >
            <span className="text-muted-foreground">{f.label}:</span> {f.value}
            <X className="h-3 w-3 ml-0.5" />
          </Badge>
        ))}

        {activeCount > 1 && (
          <Button variant="ghost" size="sm" onClick={clearAll} className="h-6 text-xs gap-1 text-muted-foreground">
            <X className="h-3 w-3" /> Limpar todos
          </Button>
        )}
      </div>

      <CollapsibleContent className="mt-3">
        <div className="rounded-lg border bg-muted/30 p-4 space-y-4">
          {/* Section: Auditoria */}
          <div className="rounded-md border bg-background p-3">
            <div className="flex items-center gap-2 mb-3 pb-2 border-b">
              <ClipboardList className="h-4 w-4 text-primary" />
              <h4 className="text-xs font-semibold uppercase tracking-wider">Auditoria</h4>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Criado por</Label>
                <Select value={filters.createdBy || '_all'} onValueChange={v => update('createdBy', v === '_all' ? '' : v)}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Todos" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_all">Todos</SelectItem>
                    {profiles.map(p => (
                      <SelectItem key={p.user_id} value={p.user_id}>{p.full_name || p.email || p.user_id.slice(0, 8)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Atualizado por</Label>
                <Select value={filters.updatedBy || '_all'} onValueChange={v => update('updatedBy', v === '_all' ? '' : v)}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Todos" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_all">Todos</SelectItem>
                    {profiles.map(p => (
                      <SelectItem key={p.user_id} value={p.user_id}>{p.full_name || p.email || p.user_id.slice(0, 8)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Acolhedor</Label>
                <Select value={filters.acolhedor} onValueChange={v => update('acolhedor', v === '_all' ? '' : v)}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Todos" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_all">Todos</SelectItem>
                    {availableAcolhedores.map(name => (
                      <SelectItem key={name} value={name}>{name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Criado de</Label>
                <Input type="date" className="h-8 text-xs" value={filters.createdFrom} onChange={e => update('createdFrom', e.target.value)} />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Criado até</Label>
                <Input type="date" className="h-8 text-xs" value={filters.createdTo} onChange={e => update('createdTo', e.target.value)} />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Atualizado de</Label>
                <Input type="date" className="h-8 text-xs" value={filters.updatedFrom} onChange={e => update('updatedFrom', e.target.value)} />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Atualizado até</Label>
                <Input type="date" className="h-8 text-xs" value={filters.updatedTo} onChange={e => update('updatedTo', e.target.value)} />
              </div>
            </div>
          </div>

          {/* Section: Vítima & Caso */}
          <div className="rounded-md border bg-background p-3">
            <div className="flex items-center gap-2 mb-3 pb-2 border-b">
              <UserSearch className="h-4 w-4 text-primary" />
              <h4 className="text-xs font-semibold uppercase tracking-wider">Vítima & Caso</h4>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Nome da Vítima</Label>
                <Input className="h-8 text-xs" placeholder="Buscar..." value={filters.victimName} onChange={e => update('victimName', e.target.value)} />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Faixa Etária</Label>
                <Select value={filters.ageRange} onValueChange={v => update('ageRange', v === '_all' ? '' : v)}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Todas" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_all">Todas</SelectItem>
                    {AGE_RANGES.map(r => (
                      <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Tipo de Caso</Label>
                <Select value={filters.caseType} onValueChange={v => update('caseType', v === '_all' ? '' : v)}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Todos" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_all">Todos</SelectItem>
                    {availableCaseTypes.map(ct => (
                      <SelectItem key={ct} value={ct}>{CASE_TYPE_LABELS[ct] || ct}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Acidente de</Label>
                <Input type="date" className="h-8 text-xs" value={filters.accidentDateFrom} onChange={e => update('accidentDateFrom', e.target.value)} />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Acidente até</Label>
                <Input type="date" className="h-8 text-xs" value={filters.accidentDateTo} onChange={e => update('accidentDateTo', e.target.value)} />
              </div>
            </div>
          </div>

          {/* Section: Localização */}
          <div className="rounded-md border bg-background p-3">
            <div className="flex items-center gap-2 mb-3 pb-2 border-b">
              <MapPin className="h-4 w-4 text-primary" />
              <h4 className="text-xs font-semibold uppercase tracking-wider">Localização da Visita</h4>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Estado</Label>
                <Select value={filters.visitState} onValueChange={v => update('visitState', v === '_all' ? '' : v)}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Todos" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_all">Todos</SelectItem>
                    {availableStates.map(s => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Cidade</Label>
                <Select value={filters.visitCity} onValueChange={v => update('visitCity', v === '_all' ? '' : v)}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Todas" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_all">Todas</SelectItem>
                    {availableCities.map(c => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Região</Label>
                <Select value={filters.visitRegion} onValueChange={v => update('visitRegion', v === '_all' ? '' : v)}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Todas" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_all">Todas</SelectItem>
                    {availableRegions.map(r => (
                      <SelectItem key={r} value={r}>{r}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// Helper to apply filters to a leads array
export function applyLeadFilters(leads: any[], filters: LeadFilters): any[] {
  return leads.filter(lead => {
    if (filters.searchTerm) {
      const term = filters.searchTerm.toLowerCase();
      const name = (lead.lead_name || '').toLowerCase();
      const desc = (lead.description || '').toLowerCase();
      if (!name.includes(term) && !desc.includes(term)) return false;
    }

    if (filters.createdBy && lead.created_by !== filters.createdBy) return false;
    if (filters.updatedBy && lead.updated_by !== filters.updatedBy) return false;

    if (filters.createdFrom && lead.created_at < filters.createdFrom) return false;
    if (filters.createdTo && lead.created_at > filters.createdTo + 'T23:59:59') return false;

    if (filters.updatedFrom && lead.updated_at < filters.updatedFrom) return false;
    if (filters.updatedTo && lead.updated_at > filters.updatedTo + 'T23:59:59') return false;

    if (filters.victimName) {
      const name = (lead.victim_name || '').toLowerCase();
      if (!name.includes(filters.victimName.toLowerCase())) return false;
    }

    if (filters.ageRange) {
      const age = lead.victim_age;
      if (age == null) return false;
      const range = AGE_RANGES.find(r => r.value === filters.ageRange);
      if (range && (age < range.min || age > range.max)) return false;
    }

    if (filters.caseType && lead.case_type !== filters.caseType) return false;

    if (filters.acolhedor && lead.acolhedor !== filters.acolhedor) return false;

    if (filters.accidentDateFrom) {
      const d = lead.accident_date;
      if (!d || d < filters.accidentDateFrom) return false;
    }
    if (filters.accidentDateTo) {
      const d = lead.accident_date;
      if (!d || d > filters.accidentDateTo) return false;
    }

    if (filters.visitState && lead.visit_state !== filters.visitState) return false;
    if (filters.visitCity && lead.visit_city !== filters.visitCity) return false;
    if (filters.visitRegion && lead.visit_region !== filters.visitRegion) return false;

    return true;
  });
}
