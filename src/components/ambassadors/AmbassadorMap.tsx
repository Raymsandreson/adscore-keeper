import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Navigation, MapPin, ExternalLink, Search, Loader2, Users, Target, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import { ContactDetailSheet } from '@/components/contacts/ContactDetailSheet';
import type { Contact } from '@/hooks/useContacts';

interface MapPoint {
  id: string;
  name: string;
  type: 'ambassador' | 'lead';
  city: string;
  state: string;
  phone?: string;
  classification?: string;
}

const STATE_NAMES: Record<string, string> = {
  AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia',
  CE: 'Ceará', DF: 'Distrito Federal', ES: 'Espírito Santo', GO: 'Goiás',
  MA: 'Maranhão', MT: 'Mato Grosso', MS: 'Mato Grosso do Sul', MG: 'Minas Gerais',
  PA: 'Pará', PB: 'Paraíba', PR: 'Paraná', PE: 'Pernambuco', PI: 'Piauí',
  RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte', RS: 'Rio Grande do Sul',
  RO: 'Rondônia', RR: 'Roraima', SC: 'Santa Catarina', SP: 'São Paulo',
  SE: 'Sergipe', TO: 'Tocantins',
};

function getGoogleMapsSearchUrl(point: MapPoint) {
  const q = [point.city, point.state].filter(Boolean).join(', ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

function getGoogleMapsRouteUrl(from: MapPoint, to: MapPoint) {
  const origin = [from.city, from.state].filter(Boolean).join(', ');
  const dest = [to.city, to.state].filter(Boolean).join(', ');
  return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(dest)}&travelmode=driving`;
}

export function AmbassadorMap() {
  const [points, setPoints] = useState<MapPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedFrom, setSelectedFrom] = useState<MapPoint | null>(null);
  const [filterState, setFilterState] = useState('');
  const [filterClassification, setFilterClassification] = useState('');
  const [classifications, setClassifications] = useState<string[]>([]);
  
  // Contact detail sheet state
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [contactSheetOpen, setContactSheetOpen] = useState(false);

  useEffect(() => {
    fetchMapData();
    fetchClassifications();
  }, []);

  async function fetchClassifications() {
    const { data } = await supabase
      .from('contact_classifications')
      .select('name')
      .order('display_order');
    if (data) {
      setClassifications(data.map(c => c.name));
    }
  }

  async function fetchMapData() {
    setLoading(true);
    try {
      const [{ data: contacts }, { data: leads }] = await Promise.all([
        supabase
          .from('contacts')
          .select('id, full_name, city, state, phone, classification')
          .not('state', 'is', null),
        supabase
          .from('leads')
          .select('id, lead_name, city, state, lead_phone')
          .not('state', 'is', null),
      ]);

      const mapPoints: MapPoint[] = [];

      contacts?.forEach(a => {
        if (a.state) {
          mapPoints.push({
            id: a.id, name: a.full_name, type: 'ambassador',
            city: a.city || '', state: a.state, phone: a.phone || undefined,
            classification: a.classification || undefined,
          });
        }
      });

      leads?.forEach(l => {
        if (l.state) {
          mapPoints.push({
            id: l.id, name: l.lead_name || 'Lead', type: 'lead',
            city: l.city || '', state: l.state, phone: l.lead_phone || undefined,
          });
        }
      });

      setPoints(mapPoints);
    } catch (e) {
      console.error('Error fetching map data:', e);
    } finally {
      setLoading(false);
    }
  }

  const filteredPoints = useMemo(() => {
    let result = points;
    if (filterClassification) {
      result = result.filter(p => {
        if (p.type === 'lead') return filterClassification === 'lead';
        return p.classification === filterClassification;
      });
    }
    if (search) {
      const s = search.toLowerCase();
      result = result.filter(p => p.name.toLowerCase().includes(s) || p.city.toLowerCase().includes(s) || p.phone?.includes(s));
    }
    return result;
  }, [points, search, filterClassification]);

  const states = useMemo(() => {
    const stateMap = new Map<string, MapPoint[]>();
    filteredPoints.forEach(p => {
      if (!stateMap.has(p.state)) stateMap.set(p.state, []);
      stateMap.get(p.state)!.push(p);
    });
    return Array.from(stateMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .filter(([state]) => !filterState || state === filterState);
  }, [filteredPoints, filterState]);

  const ambassadorCount = filteredPoints.filter(p => p.type === 'ambassador').length;
  const leadCount = filteredPoints.filter(p => p.type === 'lead').length;
  const uniqueStates = [...new Set(filteredPoints.map(p => p.state))].sort();

  async function handlePointClick(point: MapPoint) {
    if (point.type !== 'ambassador') return;
    try {
      const { data } = await supabase
        .from('contacts')
        .select('*')
        .eq('id', point.id)
        .single();
      if (data) {
        setSelectedContact(data as unknown as Contact);
        setContactSheetOpen(true);
      }
    } catch (e) {
      console.error('Error fetching contact:', e);
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <Card><CardContent className="py-3 text-center">
          <p className="text-2xl font-bold text-amber-600">{ambassadorCount}</p>
          <p className="text-xs text-muted-foreground">Contatos</p>
        </CardContent></Card>
        <Card><CardContent className="py-3 text-center">
          <p className="text-2xl font-bold text-blue-600">{leadCount}</p>
          <p className="text-xs text-muted-foreground">Leads</p>
        </CardContent></Card>
        <Card><CardContent className="py-3 text-center">
          <p className="text-2xl font-bold text-primary">{uniqueStates.length}</p>
          <p className="text-xs text-muted-foreground">Estados</p>
        </CardContent></Card>
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar por nome, cidade..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <select
          value={filterState}
          onChange={e => setFilterState(e.target.value)}
          className="border rounded-md px-3 py-2 text-sm bg-background"
        >
          <option value="">Todos os estados</option>
          {[...new Set(points.map(p => p.state))].sort().map(s => <option key={s} value={s}>{s} - {STATE_NAMES[s] || s}</option>)}
        </select>
        <select
          value={filterClassification}
          onChange={e => setFilterClassification(e.target.value)}
          className="border rounded-md px-3 py-2 text-sm bg-background"
        >
          <option value="">Todos os relacionamentos</option>
          {classifications.map(c => <option key={c} value={c}>{c}</option>)}
          <option value="lead">Lead</option>
        </select>
        {selectedFrom && (
          <Button variant="outline" size="sm" onClick={() => setSelectedFrom(null)}>
            ✕ Limpar origem
          </Button>
        )}
      </div>

      {selectedFrom && (
        <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-sm">
          <strong>Origem da rota:</strong> {selectedFrom.name} ({selectedFrom.city}, {selectedFrom.state}) — clique em "Traçar rota" em qualquer outro ponto.
        </div>
      )}

      {/* State groups with city accordions */}
      {states.map(([state, statePoints]) => {
        // Group by city
        const cityMap = new Map<string, MapPoint[]>();
        statePoints.forEach(p => {
          const city = p.city || 'Sem cidade';
          if (!cityMap.has(city)) cityMap.set(city, []);
          cityMap.get(city)!.push(p);
        });
        const cities = Array.from(cityMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));
        const stateAmbassadors = statePoints.filter(p => p.type === 'ambassador').length;
        const stateLeads = statePoints.filter(p => p.type === 'lead').length;

        return (
          <Card key={state}>
            <CardHeader className="pb-2 pt-3 px-4">
              <CardTitle className="text-sm flex items-center gap-2">
                <MapPin className="h-4 w-4" />
                {state} - {STATE_NAMES[state] || state}
                <Badge variant="outline" className="ml-auto text-amber-600">{stateAmbassadors} cont.</Badge>
                <Badge variant="outline" className="text-blue-600">{stateLeads} leads</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              <Accordion type="multiple" className="space-y-0">
                {cities.map(([city, cityPoints]) => (
                  <AccordionItem key={city} value={city} className="border-b-0">
                    <AccordionTrigger className="py-2 text-xs hover:no-underline">
                      <span className="flex items-center gap-2">
                        <span className="font-medium">{city}</span>
                        <Badge variant="secondary" className="text-[10px] h-4 px-1.5">{cityPoints.length}</Badge>
                      </span>
                    </AccordionTrigger>
                    <AccordionContent className="pb-1 pt-0">
                      <div className="space-y-1">
                        {cityPoints.map(p => (
                          <PointRow
                            key={p.id}
                            point={p}
                            selectedFrom={selectedFrom}
                            onSelectFrom={setSelectedFrom}
                            onClickPoint={handlePointClick}
                          />
                        ))}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </CardContent>
          </Card>
        );
      })}

      {states.length === 0 && (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">
          Nenhum contato ou lead com localização cadastrada.
        </CardContent></Card>
      )}

      {/* Contact Detail Sheet */}
      <ContactDetailSheet
        contact={selectedContact}
        open={contactSheetOpen}
        onOpenChange={(open) => {
          setContactSheetOpen(open);
          if (!open) setSelectedContact(null);
        }}
        onContactUpdated={() => fetchMapData()}
      />
    </div>
  );
}

function PointRow({ point, selectedFrom, onSelectFrom, onClickPoint }: {
  point: MapPoint;
  selectedFrom: MapPoint | null;
  onSelectFrom: (p: MapPoint) => void;
  onClickPoint: (p: MapPoint) => void;
}) {
  const isAmbassador = point.type === 'ambassador';
  return (
    <div
      className={`flex items-center gap-2 text-xs p-2 rounded-md hover:bg-muted/50 group ${isAmbassador ? 'cursor-pointer' : ''}`}
      onClick={() => onClickPoint(point)}
    >
      <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${isAmbassador ? 'bg-amber-500' : 'bg-blue-500'}`} />
      <span className="font-medium flex-1">{point.name}</span>
      {point.phone && <span className="text-muted-foreground">{point.phone}</span>}

      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
        <a
          href={getGoogleMapsSearchUrl(point)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 hover:underline"
          title="Ver no Maps"
        >
          <MapPin className="h-3.5 w-3.5" />
        </a>

        {selectedFrom && selectedFrom.id !== point.id ? (
          <>
            <a
              href={getGoogleMapsRouteUrl(selectedFrom, point)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-green-600 hover:underline"
              title="Rota Google Maps"
            >
              <Navigation className="h-3.5 w-3.5" />
            </a>
            <button
              onClick={() => {
                navigator.clipboard.writeText(getGoogleMapsRouteUrl(selectedFrom, point));
                toast.success('Link da rota copiado!');
              }}
              className="text-purple-600 hover:underline"
              title="Copiar link da rota"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </button>
          </>
        ) : (
          <button onClick={() => { onSelectFrom(point); toast.info(`Origem: ${point.name}`); }} className="text-amber-600" title="Definir como origem">
            <Target className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
