import React from 'react';
import { useLeadSources } from '@/hooks/useLeadSources';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Sparkles, User, MapPin, Building, FileText, Briefcase, LocateFixed, Loader2 } from 'lucide-react';
import { useBrazilianLocations } from '@/hooks/useBrazilianLocations';
import { useGeolocation } from '@/hooks/useGeolocation';
import { toast } from 'sonner';

export interface AccidentLeadFormData {
  // Basic info
  lead_name: string;
  lead_phone: string; // kept for backward compat but not shown in form
  lead_email: string; // kept for backward compat but not shown in form
  source: string;
  notes: string;
  
  // Accident specific
  acolhedor: string;
  case_type: string;
  group_link: string;
  
  // Classification & birth
  client_classification: string;
  expected_birth_date: string;
  
  // Visit location
  visit_city: string;
  visit_state: string;
  visit_region: string;
  visit_address: string;
  
  // Accident details
  accident_date: string;
  damage_description: string;
  victim_name: string;
  victim_age: string;
  accident_address: string;
  
  // Companies
  contractor_company: string;
  main_company: string;
  sector: string;
  
  // Legal
  news_link: string;
  company_size_justification: string;
  liability_type: string;
  legal_viability: string;
}

interface AccidentLeadFormProps {
  formData: AccidentLeadFormData;
  onChange: (data: Partial<AccidentLeadFormData>) => void;
  onOpenExtractor: () => void;
  teamMembers?: { id: string; full_name: string | null; email: string | null }[];
  classifications?: { id: string; name: string; color: string }[];
}

const stateToRegion: Record<string, string> = {
  'AC': 'Norte', 'AP': 'Norte', 'AM': 'Norte', 'PA': 'Norte', 'RO': 'Norte', 'RR': 'Norte', 'TO': 'Norte',
  'AL': 'Nordeste', 'BA': 'Nordeste', 'CE': 'Nordeste', 'MA': 'Nordeste', 'PB': 'Nordeste', 'PE': 'Nordeste', 'PI': 'Nordeste', 'RN': 'Nordeste', 'SE': 'Nordeste',
  'DF': 'Centro-Oeste', 'GO': 'Centro-Oeste', 'MT': 'Centro-Oeste', 'MS': 'Centro-Oeste',
  'ES': 'Sudeste', 'MG': 'Sudeste', 'RJ': 'Sudeste', 'SP': 'Sudeste',
  'PR': 'Sul', 'RS': 'Sul', 'SC': 'Sul',
};

const caseTypes = [
  'Queda de Altura',
  'Soterramento',
  'Choque Elétrico',
  'Acidente com Máquinas',
  'Intoxicação',
  'Explosão',
  'Incêndio',
  'Acidente de Trânsito',
  'Esmagamento',
  'Corte/Amputação',
  'Afogamento',
  'Outro',
];

const liabilityTypes = [
  'Solidária',
  'Subsidiária',
  'Objetiva',
  'Subjetiva',
  'A Definir',
];

const sectors = [
  'Construção Civil',
  'Mineração',
  'Agronegócio',
  'Indústria',
  'Energia',
  'Logística',
  'Siderurgia',
  'Petróleo e Gás',
  'Alimentício',
  'Outro',
];

// Sources are now loaded from the database via useLeadSources

export function AccidentLeadForm({ formData, onChange, onOpenExtractor, teamMembers = [], classifications = [] }: AccidentLeadFormProps) {
  const { states, cities, loadingCities, fetchCities } = useBrazilianLocations();
  const { sources: leadSources } = useLeadSources();
  const { loading: geoLoading, fetchLocation } = useGeolocation();

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

  const updateField = (field: keyof AccidentLeadFormData, value: string) => {
    onChange({ [field]: value });
  };

  const handleStateChange = (state: string) => {
    const region = stateToRegion[state] || '';
    onChange({ visit_state: state, visit_region: region, visit_city: '' });
    fetchCities(state);
  };

  // Format date for display (YYYY-MM-DD → DD/MM/YYYY)
  const formatDateBR = (dateStr: string) => {
    if (!dateStr) return '';
    // Handle ISO format YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      const [y, m, d] = dateStr.split('-');
      return `${d}/${m}/${y}`;
    }
    // If already in DD/MM/YYYY format, return as-is
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) {
      return dateStr;
    }
    return dateStr;
  };

  // Parse BR date input (DD/MM/YYYY → YYYY-MM-DD)
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
      // Validate the date is real
      const dateObj = new Date(iso + 'T00:00:00');
      if (!isNaN(dateObj.getTime()) && dateObj.getDate() === parseInt(day) && (dateObj.getMonth() + 1) === parseInt(month)) {
        return { display: formatted, iso };
      }
      return { display: formatted, iso: '' };
    }
    return { display: formatted, iso: '' };
  };

  return (
    <div className="space-y-4">
      {/* AI Extraction Button */}
      <Button 
        type="button" 
        variant="outline" 
        onClick={onOpenExtractor}
        className="w-full gap-2 border-dashed border-primary/50 hover:border-primary"
      >
        <Sparkles className="h-4 w-4 text-primary" />
        Extrair dados de notícia ou documento com IA
      </Button>

      <Tabs defaultValue="basic" className="w-full">
        <TabsList className="grid w-full grid-cols-5 h-auto">
          <TabsTrigger value="basic" className="text-xs py-2">
            <User className="h-3 w-3 mr-1" />
            Básico
          </TabsTrigger>
          <TabsTrigger value="accident" className="text-xs py-2">
            <FileText className="h-3 w-3 mr-1" />
            Acidente
          </TabsTrigger>
          <TabsTrigger value="location" className="text-xs py-2">
            <MapPin className="h-3 w-3 mr-1" />
            Local
          </TabsTrigger>
          <TabsTrigger value="companies" className="text-xs py-2">
            <Building className="h-3 w-3 mr-1" />
            Empresas
          </TabsTrigger>
          <TabsTrigger value="legal" className="text-xs py-2">
            <Briefcase className="h-3 w-3 mr-1" />
            Jurídico
          </TabsTrigger>
        </TabsList>

        {/* Basic Info Tab */}
        <TabsContent value="basic" className="space-y-4 mt-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Label>Nome do Lead *</Label>
              <Input
                value={formData.lead_name}
                onChange={(e) => updateField('lead_name', e.target.value)}
                placeholder="Nome do lead"
              />
            </div>

            <div>
              <Label>Origem</Label>
              <Select value={formData.source} onValueChange={(v) => updateField('source', v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {leadSources.map((s) => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Acolhedor</Label>
              {teamMembers.length > 0 ? (
                <Select value={formData.acolhedor} onValueChange={(v) => updateField('acolhedor', v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione o acolhedor..." />
                  </SelectTrigger>
                  <SelectContent>
                    {teamMembers.map((m) => (
                      <SelectItem key={m.id} value={m.full_name || m.email || m.id}>
                        {m.full_name || m.email || 'Sem nome'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  value={formData.acolhedor}
                  onChange={(e) => updateField('acolhedor', e.target.value)}
                  placeholder="Nome do acolhedor"
                />
              )}
            </div>

            <div className="col-span-2">
              <Label>Link do Grupo (WhatsApp)</Label>
              <Input
                value={formData.group_link}
                onChange={(e) => updateField('group_link', e.target.value)}
                placeholder="https://chat.whatsapp.com/..."
              />
            </div>

            <div className="col-span-2">
              <Label>Link da Notícia</Label>
              <Input
                value={formData.news_link}
                onChange={(e) => updateField('news_link', e.target.value)}
                placeholder="https://..."
              />
            </div>

            <div className="col-span-2">
              <Label>Observações</Label>
              <Textarea
                value={formData.notes}
                onChange={(e) => updateField('notes', e.target.value)}
                placeholder="Notas sobre o lead..."
                rows={2}
              />
            </div>

            {classifications.length > 0 && (
              <div>
                <Label>Classificação</Label>
                <Select 
                  value={formData.client_classification || '__none__'} 
                  onValueChange={(v) => onChange({ client_classification: v === '__none__' ? '' : v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Sem classificação</SelectItem>
                    {classifications.map((c) => (
                      <SelectItem key={c.id} value={c.name}>
                        <div className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full ${c.color}`} />
                          {c.name.replace(/_/g, ' ')}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {formData.client_classification?.toLowerCase().includes('parto') && (
              <div>
                <Label>Previsão do Parto</Label>
                <Input
                  type="date"
                  value={formData.expected_birth_date}
                  onChange={(e) => onChange({ expected_birth_date: e.target.value })}
                />
              </div>
            )}
          </div>
        </TabsContent>

        {/* Accident Details Tab */}
        <TabsContent value="accident" className="space-y-4 mt-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Nome da Vítima</Label>
              <Input
                value={formData.victim_name}
                onChange={(e) => updateField('victim_name', e.target.value)}
                placeholder="Nome completo da vítima"
              />
            </div>

            <div>
              <Label>Idade da Vítima</Label>
              <Input
                type="number"
                value={formData.victim_age}
                onChange={(e) => updateField('victim_age', e.target.value)}
                placeholder="Idade"
              />
            </div>

            <div>
              <Label>Data do Acidente</Label>
              <Input
                value={formatDateBR(formData.accident_date)}
                onChange={(e) => {
                  const result = parseDateBR(e.target.value);
                  if (result.iso) {
                    updateField('accident_date', result.iso);
                  } else {
                    // Store partial display, keep old iso
                    updateField('accident_date', formData.accident_date);
                  }
                }}
                placeholder="DD/MM/AAAA"
                maxLength={10}
              />
            </div>

            <div>
              <Label>Tipo de Caso</Label>
              <Select value={formData.case_type} onValueChange={(v) => updateField('case_type', v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione..." />
                </SelectTrigger>
                <SelectContent>
                  {caseTypes.map((type) => (
                    <SelectItem key={type} value={type}>{type}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="col-span-2">
              <Label>Endereço do Acidente</Label>
              <Input
                value={formData.accident_address}
                onChange={(e) => updateField('accident_address', e.target.value)}
                placeholder="Local onde ocorreu o acidente"
              />
            </div>

            <div className="col-span-2">
              <Label>Descrição do Dano</Label>
              <Textarea
                value={formData.damage_description}
                onChange={(e) => updateField('damage_description', e.target.value)}
                placeholder="Descreva as lesões ou danos sofridos..."
                rows={3}
              />
            </div>
          </div>
        </TabsContent>

        {/* Location Tab */}
        <TabsContent value="location" className="space-y-4 mt-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleAutoLocation}
                disabled={geoLoading}
                className="w-full gap-2 border-dashed"
              >
                {geoLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <LocateFixed className="h-4 w-4" />}
                {geoLoading ? 'Detectando localização...' : 'Usar minha localização atual'}
              </Button>
            </div>
            <div>
              <Label>Estado da Visita</Label>
              <Select value={formData.visit_state} onValueChange={handleStateChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione..." />
                </SelectTrigger>
                <SelectContent>
                  {states.map((state) => (
                    <SelectItem key={state.sigla} value={state.sigla}>{state.sigla} - {state.nome}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Cidade da Visita</Label>
              {formData.visit_state && cities.length > 0 ? (
                <Select 
                  value={cities.some(c => c.nome === formData.visit_city) ? formData.visit_city : ''} 
                  onValueChange={(v) => updateField('visit_city', v)}
                  disabled={loadingCities}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={loadingCities ? 'Carregando...' : (formData.visit_city || 'Selecione...')} />
                  </SelectTrigger>
                  <SelectContent>
                    {cities.map((city) => (
                      <SelectItem key={city.id} value={city.nome}>{city.nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  value={formData.visit_city}
                  onChange={(e) => updateField('visit_city', e.target.value)}
                  placeholder={formData.visit_state ? 'Carregando cidades...' : 'Selecione o estado primeiro'}
                />
              )}
            </div>

            <div>
              <Label>Região da Visita</Label>
              <Input
                value={formData.visit_region}
                readOnly
                className="bg-muted"
                placeholder="Selecione o estado"
              />
            </div>

            <div className="col-span-2">
              <Label>Endereço da Visita</Label>
              <Input
                value={formData.visit_address}
                onChange={(e) => updateField('visit_address', e.target.value)}
                placeholder="Endereço completo para visita"
              />
            </div>
          </div>
        </TabsContent>

        {/* Companies Tab */}
        <TabsContent value="companies" className="space-y-4 mt-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Empresa Terceirizada</Label>
              <Input
                value={formData.contractor_company}
                onChange={(e) => updateField('contractor_company', e.target.value)}
                placeholder="Nome da empresa terceirizada"
              />
            </div>

            <div>
              <Label>Empresa Tomadora</Label>
              <Input
                value={formData.main_company}
                onChange={(e) => updateField('main_company', e.target.value)}
                placeholder="Nome da empresa tomadora"
              />
            </div>

            <div>
              <Label>Setor</Label>
              <Select value={formData.sector} onValueChange={(v) => updateField('sector', v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione..." />
                </SelectTrigger>
                <SelectContent>
                  {sectors.map((sector) => (
                    <SelectItem key={sector} value={sector}>{sector}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="col-span-2">
              <Label>Justificativa do Porte da Empresa</Label>
              <Textarea
                value={formData.company_size_justification}
                onChange={(e) => updateField('company_size_justification', e.target.value)}
                placeholder="Justificativa sobre o porte da empresa..."
                rows={2}
              />
            </div>
          </div>
        </TabsContent>

        {/* Legal Tab */}
        <TabsContent value="legal" className="space-y-4 mt-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Tipo de Responsabilidade</Label>
              <Select value={formData.liability_type} onValueChange={(v) => updateField('liability_type', v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione..." />
                </SelectTrigger>
                <SelectContent>
                  {liabilityTypes.map((type) => (
                    <SelectItem key={type} value={type}>{type}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Link da Notícia</Label>
              <Input
                value={formData.news_link}
                onChange={(e) => updateField('news_link', e.target.value)}
                placeholder="https://..."
              />
            </div>

            <div className="col-span-2">
              <Label>Viabilidade Jurídica</Label>
              <Textarea
                value={formData.legal_viability}
                onChange={(e) => updateField('legal_viability', e.target.value)}
                placeholder="Análise de viabilidade jurídica do caso..."
                rows={3}
              />
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
