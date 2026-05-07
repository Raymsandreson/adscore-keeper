import React, { useMemo, useState } from 'react';
import { useLeadSources } from '@/hooks/useLeadSources';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Sparkles, User, MapPin, Building, FileText, Briefcase, Settings2 } from 'lucide-react';
import { useBrazilianLocations } from '@/hooks/useBrazilianLocations';
import { useGeolocation } from '@/hooks/useGeolocation';
import { toast } from 'sonner';
import { LEAD_FIELD_REGISTRY, TAB_DEFS, type LeadFieldRenderCtx, type LeadFieldTab } from './leadFormFields';
import { useLeadFieldLayout } from '@/hooks/useLeadFieldLayout';
import { LeadFormLayoutEditor } from './LeadFormLayoutEditor';
import type { AccidentLeadFormData } from './leadFormTypes';

export type { AccidentLeadFormData } from './leadFormTypes';

interface AccidentLeadFormProps {
  formData: AccidentLeadFormData;
  onChange: (data: Partial<AccidentLeadFormData>) => void;
  onOpenExtractor: () => void;
  teamMembers?: { id: string; full_name: string | null; email: string | null }[];
  classifications?: { id: string; name: string; color: string }[];
  /** Funil corrente — habilita personalização de layout por funil */
  boardId?: string | null;
  boardName?: string;
}

const stateToRegion: Record<string, string> = {
  'AC': 'Norte', 'AP': 'Norte', 'AM': 'Norte', 'PA': 'Norte', 'RO': 'Norte', 'RR': 'Norte', 'TO': 'Norte',
  'AL': 'Nordeste', 'BA': 'Nordeste', 'CE': 'Nordeste', 'MA': 'Nordeste', 'PB': 'Nordeste', 'PE': 'Nordeste', 'PI': 'Nordeste', 'RN': 'Nordeste', 'SE': 'Nordeste',
  'DF': 'Centro-Oeste', 'GO': 'Centro-Oeste', 'MT': 'Centro-Oeste', 'MS': 'Centro-Oeste',
  'ES': 'Sudeste', 'MG': 'Sudeste', 'RJ': 'Sudeste', 'SP': 'Sudeste',
  'PR': 'Sul', 'RS': 'Sul', 'SC': 'Sul',
};

const TAB_ICONS: Record<LeadFieldTab, React.ComponentType<{ className?: string }>> = {
  basic: User, accident: FileText, location: MapPin, companies: Building, legal: Briefcase,
};

export function AccidentLeadForm({ formData, onChange, onOpenExtractor, teamMembers = [], classifications = [], boardId, boardName }: AccidentLeadFormProps) {
  const { states, cities, loadingCities, fetchCities } = useBrazilianLocations();
  const { sources: leadSources } = useLeadSources();
  const { loading: geoLoading, fetchLocation } = useGeolocation();
  const { resolved, fieldsByTab, saveLayout } = useLeadFieldLayout(boardId);
  const [layoutOpen, setLayoutOpen] = useState(false);

  const handleAutoLocation = async () => {
    const loc = await fetchLocation();
    if (loc) {
      const region = stateToRegion[loc.state] || '';
      onChange({ visit_state: loc.state, visit_city: loc.city, visit_region: region });
      fetchCities(loc.state);
      toast.success(`Localização detectada: ${loc.city}/${loc.state}`);
    } else {
      toast.error('Não foi possível detectar a localização');
    }
  };

  const handleStateChange = (state: string) => {
    const region = stateToRegion[state] || '';
    onChange({ visit_state: state, visit_region: region, visit_city: '' });
    fetchCities(state);
  };

  const formatDateBR = (dateStr: string) => {
    if (!dateStr) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      const [y, m, d] = dateStr.split('-');
      return `${d}/${m}/${y}`;
    }
    return dateStr;
  };

  const parseDateBR = (input: string) => {
    const clean = input.replace(/\D/g, '');
    let formatted = '';
    if (clean.length <= 2) formatted = clean;
    else if (clean.length <= 4) formatted = clean.slice(0, 2) + '/' + clean.slice(2);
    else formatted = clean.slice(0, 2) + '/' + clean.slice(2, 4) + '/' + clean.slice(4, 8);
    if (clean.length === 8) {
      const day = clean.slice(0, 2);
      const month = clean.slice(2, 4);
      const year = clean.slice(4, 8);
      const iso = `${year}-${month}-${day}`;
      const dateObj = new Date(iso + 'T00:00:00');
      if (!isNaN(dateObj.getTime()) && dateObj.getDate() === parseInt(day) && (dateObj.getMonth() + 1) === parseInt(month)) {
        return { display: formatted, iso };
      }
      return { display: formatted, iso: '' };
    }
    return { display: formatted, iso: '' };
  };

  const ctx: LeadFieldRenderCtx = {
    formData, onChange, teamMembers, classifications, leadSources,
    states, cities, loadingCities, geoLoading,
    onAutoLocation: handleAutoLocation, onStateChange: handleStateChange,
    formatDateBR, parseDateBR,
  };

  const registryByKey = useMemo(() => {
    const m = new Map<string, typeof LEAD_FIELD_REGISTRY[number]>();
    LEAD_FIELD_REGISTRY.forEach(d => m.set(d.key, d));
    return m;
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-2">
        <Button
          type="button" variant="outline" onClick={onOpenExtractor}
          className="flex-1 gap-2 border-dashed border-primary/50 hover:border-primary"
        >
          <Sparkles className="h-4 w-4 text-primary" />
          Extrair dados de notícia ou documento com IA
        </Button>
        {boardId && (
          <Button type="button" variant="outline" onClick={() => setLayoutOpen(true)} className="gap-2" title="Personalizar layout">
            <Settings2 className="h-4 w-4" />
            Personalizar layout
          </Button>
        )}
      </div>

      <Tabs defaultValue="basic" className="w-full">
        <TabsList className="grid w-full grid-cols-5 h-auto">
          {TAB_DEFS.map(t => {
            const Icon = TAB_ICONS[t.key];
            return (
              <TabsTrigger key={t.key} value={t.key} className="text-xs py-2">
                <Icon className="h-3 w-3 mr-1" />
                {t.label}
              </TabsTrigger>
            );
          })}
        </TabsList>

        {TAB_DEFS.map(t => {
          const items = fieldsByTab(t.key);
          return (
            <TabsContent key={t.key} value={t.key} className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                {items.map(f => {
                  const def = registryByKey.get(f.field_key);
                  if (!def) return null;
                  const node = def.render(ctx);
                  if (node === null) return null;
                  return (
                    <div key={f.field_key} className={def.fullWidth ? 'col-span-2' : ''}>
                      {node}
                    </div>
                  );
                })}
                {items.length === 0 && (
                  <div className="col-span-2 text-center text-xs text-muted-foreground italic py-6">
                    Nenhum campo nesta aba. Use "Personalizar layout" para adicionar.
                  </div>
                )}
              </div>
            </TabsContent>
          );
        })}
      </Tabs>

      {boardId && (
        <LeadFormLayoutEditor
          open={layoutOpen}
          onOpenChange={setLayoutOpen}
          resolved={resolved}
          onSave={saveLayout}
          boardName={boardName}
        />
      )}
    </div>
  );
}
