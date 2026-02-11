import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { 
  MapPin, 
  Users, 
  TrendingUp, 
  Building2, 
  ChevronRight,
  Globe,
  BarChart3,
  Award,
  Filter,
  X
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  ResponsiveContainer,
  Cell,
  Tooltip
} from 'recharts';

interface StateData {
  sigla: string;
  nome: string;
  count: number;
  cities: CityData[];
  classifications: Record<string, number>;
}

interface CityData {
  name: string;
  count: number;
  classifications: Record<string, number>;
}

interface ContactGeoData {
  state: string | null;
  city: string | null;
  classifications: string[] | null;
  classification: string | null;
  follower_status: string | null;
  profession: string | null;
  tags: string[] | null;
}

interface GeoFilters {
  classification: string;
  followerStatus: string;
  professions: string[];
  classifications: string[];
}

// Brazilian states with coordinates for visual positioning
const BRAZILIAN_STATES_MAP: Record<string, { nome: string; x: number; y: number; region: string }> = {
  'AC': { nome: 'Acre', x: 8, y: 35, region: 'Norte' },
  'AL': { nome: 'Alagoas', x: 88, y: 45, region: 'Nordeste' },
  'AP': { nome: 'Amapá', x: 52, y: 12, region: 'Norte' },
  'AM': { nome: 'Amazonas', x: 25, y: 28, region: 'Norte' },
  'BA': { nome: 'Bahia', x: 75, y: 52, region: 'Nordeste' },
  'CE': { nome: 'Ceará', x: 78, y: 32, region: 'Nordeste' },
  'DF': { nome: 'Distrito Federal', x: 60, y: 58, region: 'Centro-Oeste' },
  'ES': { nome: 'Espírito Santo', x: 78, y: 68, region: 'Sudeste' },
  'GO': { nome: 'Goiás', x: 55, y: 58, region: 'Centro-Oeste' },
  'MA': { nome: 'Maranhão', x: 62, y: 30, region: 'Nordeste' },
  'MT': { nome: 'Mato Grosso', x: 38, y: 52, region: 'Centro-Oeste' },
  'MS': { nome: 'Mato Grosso do Sul', x: 42, y: 72, region: 'Centro-Oeste' },
  'MG': { nome: 'Minas Gerais', x: 65, y: 65, region: 'Sudeste' },
  'PA': { nome: 'Pará', x: 45, y: 25, region: 'Norte' },
  'PB': { nome: 'Paraíba', x: 85, y: 38, region: 'Nordeste' },
  'PR': { nome: 'Paraná', x: 52, y: 78, region: 'Sul' },
  'PE': { nome: 'Pernambuco', x: 82, y: 40, region: 'Nordeste' },
  'PI': { nome: 'Piauí', x: 70, y: 35, region: 'Nordeste' },
  'RJ': { nome: 'Rio de Janeiro', x: 72, y: 75, region: 'Sudeste' },
  'RN': { nome: 'Rio Grande do Norte', x: 85, y: 34, region: 'Nordeste' },
  'RS': { nome: 'Rio Grande do Sul', x: 48, y: 92, region: 'Sul' },
  'RO': { nome: 'Rondônia', x: 22, y: 45, region: 'Norte' },
  'RR': { nome: 'Roraima', x: 28, y: 10, region: 'Norte' },
  'SC': { nome: 'Santa Catarina', x: 52, y: 85, region: 'Sul' },
  'SP': { nome: 'São Paulo', x: 58, y: 75, region: 'Sudeste' },
  'SE': { nome: 'Sergipe', x: 85, y: 48, region: 'Nordeste' },
  'TO': { nome: 'Tocantins', x: 55, y: 42, region: 'Norte' },
};

const REGION_COLORS: Record<string, string> = {
  'Norte': 'hsl(142 71% 45%)',
  'Nordeste': 'hsl(38 92% 50%)',
  'Centro-Oeste': 'hsl(215 89% 53%)',
  'Sudeste': 'hsl(280 65% 60%)',
  'Sul': 'hsl(0 84% 60%)',
};

export function GeographicDistributionMap() {
  const [loading, setLoading] = useState(true);
  const [statesData, setStatesData] = useState<StateData[]>([]);
  const [selectedState, setSelectedState] = useState<StateData | null>(null);
  const [selectedCity, setSelectedCity] = useState<CityData | null>(null);
  const [allContacts, setAllContacts] = useState<ContactGeoData[]>([]);
  const [availableClassifications, setAvailableClassifications] = useState<string[]>([]);
  const [availableProfessions, setAvailableProfessions] = useState<string[]>([]);
  const [filters, setFilters] = useState<GeoFilters>({
    classification: 'all',
    followerStatus: 'all',
    professions: [],
    classifications: [],
  });

  useEffect(() => {
    fetchGeographicData();
    fetchFilterOptions();
  }, []);

  // Re-process data when filters change
  useEffect(() => {
    processContactsData(allContacts);
  }, [filters]);

  const fetchFilterOptions = async () => {
    try {
      const [classRes, profRes] = await Promise.all([
        supabase.from('contact_classifications').select('name').order('display_order'),
        supabase.from('contacts').select('profession').not('profession', 'is', null),
      ]);
      
      setAvailableClassifications((classRes.data || []).map((c: any) => c.name));
      const uniqueProfs = [...new Set((profRes.data || []).map((p: any) => p.profession).filter(Boolean))];
      setAvailableProfessions(uniqueProfs.sort());
    } catch (error) {
      console.error('Error fetching filter options:', error);
    }
  };

  const fetchGeographicData = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('contacts')
        .select('state, city, classifications, classification, follower_status, profession, tags')
        .not('state', 'is', null);

      if (error) throw error;

      const contacts = (data || []) as ContactGeoData[];
      setAllContacts(contacts);
      processContactsData(contacts);
    } catch (error) {
      console.error('Error fetching geographic data:', error);
    } finally {
      setLoading(false);
    }
  };

  const processContactsData = (contacts: ContactGeoData[]) => {
    // Apply filters
    let filtered = contacts;

    if (filters.classification !== 'all') {
      filtered = filtered.filter(c => c.classification === filters.classification);
    }

    if (filters.followerStatus !== 'all') {
      if (filters.followerStatus === 'mutual') {
        filtered = filtered.filter(c => c.follower_status === 'mutual');
      } else if (filters.followerStatus === 'follower') {
        filtered = filtered.filter(c => c.follower_status === 'follower' || c.follower_status === 'mutual');
      } else if (filters.followerStatus === 'following') {
        filtered = filtered.filter(c => c.follower_status === 'following' || c.follower_status === 'mutual');
      }
    }

    if (filters.professions.length > 0) {
      filtered = filtered.filter(c => c.profession && filters.professions.includes(c.profession));
    }

    if (filters.classifications.length > 0) {
      filtered = filtered.filter(c => {
        const contactClassifications = c.classifications || [];
        return filters.classifications.some(fc => contactClassifications.includes(fc));
      });
    }

    // Build state map
    const stateMap = new Map<string, StateData>();

    filtered.forEach((contact) => {
      if (!contact.state) return;

      const stateSigla = contact.state.toUpperCase();
      const stateInfo = BRAZILIAN_STATES_MAP[stateSigla];
      if (!stateInfo) return;

      if (!stateMap.has(stateSigla)) {
        stateMap.set(stateSigla, {
          sigla: stateSigla,
          nome: stateInfo.nome,
          count: 0,
          cities: [],
          classifications: {},
        });
      }

      const stateData = stateMap.get(stateSigla)!;
      stateData.count++;

      const allClassifications = [
        ...(contact.classifications || []),
        contact.classification,
      ].filter(Boolean) as string[];
      
      allClassifications.forEach((cls) => {
        stateData.classifications[cls] = (stateData.classifications[cls] || 0) + 1;
      });

      if (contact.city) {
        let cityData = stateData.cities.find(
          (c) => c.name.toLowerCase() === contact.city!.toLowerCase()
        );
        if (!cityData) {
          cityData = { name: contact.city, count: 0, classifications: {} };
          stateData.cities.push(cityData);
        }
        cityData.count++;
        allClassifications.forEach((cls) => {
          cityData!.classifications[cls] = (cityData!.classifications[cls] || 0) + 1;
        });
      }
    });

    stateMap.forEach((state) => {
      state.cities.sort((a, b) => b.count - a.count);
    });

    const sortedStates = Array.from(stateMap.values()).sort((a, b) => b.count - a.count);
    setStatesData(sortedStates);
    setSelectedState(null);
    setSelectedCity(null);
  };

  const totalContacts = useMemo(() => 
    statesData.reduce((sum, s) => sum + s.count, 0), 
    [statesData]
  );

  const topStates = useMemo(() => statesData.slice(0, 5), [statesData]);

  const regionStats = useMemo(() => {
    const regions: Record<string, number> = {};
    statesData.forEach((state) => {
      const region = BRAZILIAN_STATES_MAP[state.sigla]?.region || 'Outros';
      regions[region] = (regions[region] || 0) + state.count;
    });
    return Object.entries(regions)
      .map(([name, value]) => ({ name, value, color: REGION_COLORS[name] || 'hsl(0 0% 50%)' }))
      .sort((a, b) => b.value - a.value);
  }, [statesData]);

  const getHeatColor = (count: number, max: number) => {
    if (count === 0) return 'hsl(var(--muted))';
    const intensity = Math.min(count / max, 1);
    if (intensity > 0.7) return 'hsl(var(--success))';
    if (intensity > 0.4) return 'hsl(var(--warning))';
    return 'hsl(var(--primary))';
  };

  const getHeatSize = (count: number, max: number) => {
    if (count === 0) return 16;
    const intensity = Math.min(count / max, 1);
    return 16 + intensity * 32;
  };

  const maxCount = useMemo(() => 
    Math.max(...statesData.map((s) => s.count), 1), 
    [statesData]
  );

  if (loading) {
    return (
      <Card>
        <CardContent className="p-8">
          <div className="flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        </CardContent>
      </Card>
    );
  }

  const activeFilterCount = [
    filters.classification !== 'all' ? 1 : 0,
    filters.followerStatus !== 'all' ? 1 : 0,
    filters.professions.length > 0 ? 1 : 0,
    filters.classifications.length > 0 ? 1 : 0,
  ].reduce((a, b) => a + b, 0);

  const clearFilters = () => {
    setFilters({
      classification: 'all',
      followerStatus: 'all',
      professions: [],
      classifications: [],
    });
  };

  const toggleProfession = (prof: string) => {
    setFilters(prev => ({
      ...prev,
      professions: prev.professions.includes(prof)
        ? prev.professions.filter(p => p !== prof)
        : [...prev.professions, prof],
    }));
  };

  const toggleClassificationFilter = (cls: string) => {
    setFilters(prev => ({
      ...prev,
      classifications: prev.classifications.includes(cls)
        ? prev.classifications.filter(c => c !== cls)
        : [...prev.classifications, cls],
    }));
  };

  return (
    <div className="space-y-6">
      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Filter className="h-4 w-4" />
              Filtros
            </div>

            <Select
              value={filters.classification}
              onValueChange={(val) => setFilters(prev => ({ ...prev, classification: val }))}
            >
              <SelectTrigger className="w-[160px] h-8 text-xs">
                <SelectValue placeholder="Tipo de contato" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os tipos</SelectItem>
                <SelectItem value="client">Cliente</SelectItem>
                <SelectItem value="non_client">Não-Cliente</SelectItem>
                <SelectItem value="prospect">Prospect</SelectItem>
                <SelectItem value="partner">Parceiro</SelectItem>
                <SelectItem value="supplier">Fornecedor</SelectItem>
              </SelectContent>
            </Select>

            <Select
              value={filters.followerStatus}
              onValueChange={(val) => setFilters(prev => ({ ...prev, followerStatus: val }))}
            >
              <SelectTrigger className="w-[160px] h-8 text-xs">
                <SelectValue placeholder="Status Instagram" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="follower">Seguidores</SelectItem>
                <SelectItem value="following">Seguindo</SelectItem>
                <SelectItem value="mutual">Mútuos</SelectItem>
              </SelectContent>
            </Select>

            {availableClassifications.length > 0 && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 text-xs">
                    Classificações {filters.classifications.length > 0 && `(${filters.classifications.length})`}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-56" align="start">
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Classificações</p>
                    <ScrollArea className="max-h-48">
                      {availableClassifications.map(cls => (
                        <label key={cls} className="flex items-center gap-2 p-1 cursor-pointer hover:bg-muted/50 rounded">
                          <Checkbox
                            checked={filters.classifications.includes(cls)}
                            onCheckedChange={() => toggleClassificationFilter(cls)}
                          />
                          <span className="text-sm">{cls}</span>
                        </label>
                      ))}
                    </ScrollArea>
                  </div>
                </PopoverContent>
              </Popover>
            )}

            {availableProfessions.length > 0 && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 text-xs">
                    Profissões {filters.professions.length > 0 && `(${filters.professions.length})`}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-56" align="start">
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Profissões</p>
                    <ScrollArea className="max-h-48">
                      {availableProfessions.map(prof => (
                        <label key={prof} className="flex items-center gap-2 p-1 cursor-pointer hover:bg-muted/50 rounded">
                          <Checkbox
                            checked={filters.professions.includes(prof)}
                            onCheckedChange={() => toggleProfession(prof)}
                          />
                          <span className="text-sm truncate">{prof}</span>
                        </label>
                      ))}
                    </ScrollArea>
                  </div>
                </PopoverContent>
              </Popover>
            )}

            {activeFilterCount > 0 && (
              <Button variant="ghost" size="sm" className="h-8 text-xs gap-1" onClick={clearFilters}>
                <X className="h-3 w-3" />
                Limpar ({activeFilterCount})
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Header Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Globe className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold">{totalContacts}</p>
                <p className="text-xs text-muted-foreground">Contatos Mapeados</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-success/10">
                <MapPin className="h-5 w-5 text-success" />
              </div>
              <div>
                <p className="text-2xl font-bold">{statesData.length}</p>
                <p className="text-xs text-muted-foreground">Estados com Presença</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-warning/10">
                <Building2 className="h-5 w-5 text-warning" />
              </div>
              <div>
                <p className="text-2xl font-bold">
                  {statesData.reduce((sum, s) => sum + s.cities.length, 0)}
                </p>
                <p className="text-xs text-muted-foreground">Cidades Alcançadas</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-accent/10">
                <Award className="h-5 w-5 text-accent" />
              </div>
              <div>
                <p className="text-2xl font-bold">{topStates[0]?.sigla || '-'}</p>
                <p className="text-xs text-muted-foreground">Estado Líder</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Visual Map */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MapPin className="h-5 w-5" />
              Mapa de Capilaridade
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="relative bg-muted/30 rounded-lg p-4" style={{ minHeight: '400px' }}>
              {/* Brazil Map Visualization */}
              <div className="relative w-full h-[400px]">
                {Object.entries(BRAZILIAN_STATES_MAP).map(([sigla, info]) => {
                  const stateData = statesData.find((s) => s.sigla === sigla);
                  const count = stateData?.count || 0;
                  const size = getHeatSize(count, maxCount);
                  const isSelected = selectedState?.sigla === sigla;

                  return (
                    <button
                      key={sigla}
                      className={`absolute transform -translate-x-1/2 -translate-y-1/2 rounded-full transition-all duration-200 flex items-center justify-center text-xs font-bold hover:scale-110 ${
                        isSelected ? 'ring-2 ring-foreground ring-offset-2' : ''
                      }`}
                      style={{
                        left: `${info.x}%`,
                        top: `${info.y}%`,
                        width: `${size}px`,
                        height: `${size}px`,
                        backgroundColor: count > 0 ? getHeatColor(count, maxCount) : 'hsl(var(--muted))',
                        color: count > 0 ? 'white' : 'hsl(var(--muted-foreground))',
                        opacity: count > 0 ? 1 : 0.5,
                      }}
                      onClick={() => setSelectedState(stateData || null)}
                      title={`${info.nome}: ${count} contatos`}
                    >
                      {count > 0 ? count : sigla}
                    </button>
                  );
                })}
              </div>

              {/* Legend */}
              <div className="absolute bottom-4 left-4 flex items-center gap-4 bg-background/80 rounded-lg p-2">
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded-full bg-primary" />
                  <span className="text-xs">Baixo</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded-full bg-warning" />
                  <span className="text-xs">Médio</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded-full bg-success" />
                  <span className="text-xs">Alto</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* State Details */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              {selectedState ? selectedState.nome : 'Ranking por Estado'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {selectedState ? (
              <div className="space-y-4">
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={() => {
                    setSelectedState(null);
                    setSelectedCity(null);
                  }}
                  className="mb-2"
                >
                  ← Voltar ao ranking
                </Button>

                <div className="flex items-center gap-3 p-3 bg-primary/5 rounded-lg">
                  <div className="p-2 rounded-lg bg-primary/10">
                    <Users className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{selectedState.count}</p>
                    <p className="text-xs text-muted-foreground">Total de Contatos</p>
                  </div>
                </div>

                {/* Classifications breakdown */}
                {Object.keys(selectedState.classifications).length > 0 && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Classificações</p>
                    <div className="flex flex-wrap gap-1">
                      {Object.entries(selectedState.classifications)
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 5)
                        .map(([cls, count]) => (
                          <Badge key={cls} variant="secondary" className="text-xs">
                            {cls}: {count}
                          </Badge>
                        ))}
                    </div>
                  </div>
                )}

                {/* Cities list */}
                <div className="space-y-2">
                  <p className="text-sm font-medium">Cidades ({selectedState.cities.length})</p>
                  <ScrollArea className="h-[200px]">
                    <div className="space-y-1">
                      {selectedState.cities.map((city) => (
                        <button
                          key={city.name}
                          className={`w-full flex items-center justify-between p-2 rounded-lg hover:bg-muted/50 transition-colors text-left ${
                            selectedCity?.name === city.name ? 'bg-muted' : ''
                          }`}
                          onClick={() => setSelectedCity(city)}
                        >
                          <span className="text-sm">{city.name}</span>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline">{city.count}</Badge>
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          </div>
                        </button>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              </div>
            ) : (
              <ScrollArea className="h-[400px]">
                <div className="space-y-2">
                  {statesData.map((state, index) => (
                    <button
                      key={state.sigla}
                      className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-muted/50 transition-colors text-left"
                      onClick={() => setSelectedState(state)}
                    >
                      <div 
                        className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold"
                        style={{
                          backgroundColor: getHeatColor(state.count, maxCount),
                          color: 'white',
                        }}
                      >
                        {index + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{state.nome}</p>
                        <p className="text-xs text-muted-foreground">
                          {state.cities.length} cidades
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge>{state.count}</Badge>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </button>
                  ))}

                  {statesData.length === 0 && (
                    <div className="text-center py-8 text-muted-foreground">
                      <MapPin className="h-8 w-8 mx-auto mb-2 opacity-50" />
                      <p>Nenhum contato com localização cadastrada</p>
                    </div>
                  )}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Region & Chart Analysis */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Análise por Região
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="chart">
            <TabsList className="mb-4">
              <TabsTrigger value="chart">Gráfico</TabsTrigger>
              <TabsTrigger value="top-cities">Top Cidades</TabsTrigger>
            </TabsList>

            <TabsContent value="chart">
              <div className="h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={regionStats} layout="vertical">
                    <XAxis type="number" />
                    <YAxis type="category" dataKey="name" width={100} />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'hsl(var(--background))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                      }}
                    />
                    <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                      {regionStats.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </TabsContent>

            <TabsContent value="top-cities">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {statesData
                  .flatMap((state) =>
                    state.cities.map((city) => ({
                      city: city.name,
                      state: state.sigla,
                      count: city.count,
                    }))
                  )
                  .sort((a, b) => b.count - a.count)
                  .slice(0, 12)
                  .map((item, index) => (
                    <div
                      key={`${item.state}-${item.city}`}
                      className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg"
                    >
                      <div 
                        className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold bg-primary text-primary-foreground"
                      >
                        {index + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{item.city}</p>
                        <p className="text-xs text-muted-foreground">{item.state}</p>
                      </div>
                      <Badge variant="secondary">{item.count}</Badge>
                    </div>
                  ))}
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
