import React from 'react';
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
import { Sparkles, User, MapPin, Building, FileText, Briefcase } from 'lucide-react';

export interface AccidentLeadFormData {
  // Basic info
  lead_name: string;
  lead_phone: string;
  lead_email: string;
  source: string;
  notes: string;
  
  // Accident specific
  acolhedor: string;
  case_type: string;
  group_link: string;
  
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
}

const brazilianStates = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 
  'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 
  'SP', 'SE', 'TO'
];

const regions = ['Norte', 'Nordeste', 'Centro-Oeste', 'Sudeste', 'Sul'];

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

const sources = [
  { value: 'manual', label: 'Manual' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'form', label: 'Formulário' },
  { value: 'referral', label: 'Indicação' },
  { value: 'facebook', label: 'Facebook' },
  { value: 'noticia', label: 'Notícia' },
  { value: 'prospecção', label: 'Prospecção Ativa' },
  { value: 'cat_import', label: 'CAT' },
];

export function AccidentLeadForm({ formData, onChange, onOpenExtractor, teamMembers = [] }: AccidentLeadFormProps) {
  const updateField = (field: keyof AccidentLeadFormData, value: string) => {
    onChange({ [field]: value });
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
              <Label>Telefone</Label>
              <Input
                value={formData.lead_phone}
                onChange={(e) => updateField('lead_phone', e.target.value)}
                placeholder="(00) 00000-0000"
              />
            </div>

            <div>
              <Label>Email</Label>
              <Input
                type="email"
                value={formData.lead_email}
                onChange={(e) => updateField('lead_email', e.target.value)}
                placeholder="email@exemplo.com"
              />
            </div>

            <div>
              <Label>Origem</Label>
              <Select value={formData.source} onValueChange={(v) => updateField('source', v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {sources.map((s) => (
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
              <Label>Link do Grupo</Label>
              <Input
                value={formData.group_link}
                onChange={(e) => updateField('group_link', e.target.value)}
                placeholder="https://chat.whatsapp.com/..."
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
                type="date"
                value={formData.accident_date}
                onChange={(e) => updateField('accident_date', e.target.value)}
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
            <div>
              <Label>Cidade da Visita</Label>
              <Input
                value={formData.visit_city}
                onChange={(e) => updateField('visit_city', e.target.value)}
                placeholder="Cidade"
              />
            </div>

            <div>
              <Label>Estado da Visita</Label>
              <Select value={formData.visit_state} onValueChange={(v) => updateField('visit_state', v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione..." />
                </SelectTrigger>
                <SelectContent>
                  {brazilianStates.map((state) => (
                    <SelectItem key={state} value={state}>{state}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Região da Visita</Label>
              <Select value={formData.visit_region} onValueChange={(v) => updateField('visit_region', v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione..." />
                </SelectTrigger>
                <SelectContent>
                  {regions.map((region) => (
                    <SelectItem key={region} value={region}>{region}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
