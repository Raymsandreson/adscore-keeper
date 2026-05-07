import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { LocateFixed, Loader2 } from 'lucide-react';
import type { AccidentLeadFormData } from './leadFormTypes';

export type LeadFieldTab = 'basic' | 'accident' | 'location' | 'companies' | 'legal';

export interface LeadFieldRenderCtx {
  formData: AccidentLeadFormData;
  onChange: (data: Partial<AccidentLeadFormData>) => void;
  teamMembers: { id: string; full_name: string | null; email: string | null }[];
  classifications: { id: string; name: string; color: string }[];
  leadSources: { value: string; label: string }[];
  states: { sigla: string; nome: string }[];
  cities: { id: number | string; nome: string }[];
  loadingCities: boolean;
  geoLoading: boolean;
  onAutoLocation: () => void;
  onStateChange: (state: string) => void;
  formatDateBR: (s: string) => string;
  parseDateBR: (s: string) => { display: string; iso: string };
}

export interface LeadFieldDef {
  key: string;
  label: string;
  defaultTab: LeadFieldTab;
  defaultOrder: number;
  fullWidth?: boolean;
  render: (ctx: LeadFieldRenderCtx) => React.ReactNode;
}

const caseTypes = ['Queda de Altura','Soterramento','Choque Elétrico','Acidente com Máquinas','Intoxicação','Explosão','Incêndio','Acidente de Trânsito','Esmagamento','Corte/Amputação','Afogamento','Outro'];
const liabilityTypes = ['Solidária','Subsidiária','Objetiva','Subjetiva','A Definir'];
const sectors = ['Construção Civil','Mineração','Agronegócio','Indústria','Energia','Logística','Siderurgia','Petróleo e Gás','Alimentício','Outro'];

const u = (key: keyof AccidentLeadFormData, ctx: LeadFieldRenderCtx) =>
  (v: string) => ctx.onChange({ [key]: v } as Partial<AccidentLeadFormData>);

export const LEAD_FIELD_REGISTRY: LeadFieldDef[] = [
  // ===== BASIC =====
  { key: 'lead_name', label: 'Nome do Lead', defaultTab: 'basic', defaultOrder: 1, fullWidth: true,
    render: (c) => (<div><Label>Nome do Lead *</Label><Input value={c.formData.lead_name} onChange={(e) => u('lead_name', c)(e.target.value)} placeholder="Nome do lead"/></div>) },
  { key: 'source', label: 'Origem', defaultTab: 'basic', defaultOrder: 2,
    render: (c) => (<div><Label>Origem</Label><Select value={c.formData.source} onValueChange={u('source', c)}><SelectTrigger><SelectValue/></SelectTrigger><SelectContent>{c.leadSources.map(s=>(<SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>))}</SelectContent></Select></div>) },
  { key: 'acolhedor', label: 'Acolhedor', defaultTab: 'basic', defaultOrder: 3,
    render: (c) => (<div><Label>Acolhedor</Label>{c.teamMembers.length > 0 ? (
      <Select value={c.formData.acolhedor} onValueChange={u('acolhedor', c)}><SelectTrigger><SelectValue placeholder="Selecione o acolhedor..."/></SelectTrigger><SelectContent>{c.teamMembers.map(m=>(<SelectItem key={m.id} value={m.full_name||m.email||m.id}>{m.full_name||m.email||'Sem nome'}</SelectItem>))}</SelectContent></Select>
    ) : (<Input value={c.formData.acolhedor} onChange={(e)=>u('acolhedor',c)(e.target.value)} placeholder="Nome do acolhedor"/>)}</div>) },
  { key: 'group_link', label: 'Link do Grupo (WhatsApp)', defaultTab: 'basic', defaultOrder: 4, fullWidth: true,
    render: (c) => (<div><Label>Link do Grupo (WhatsApp)</Label><Input value={c.formData.group_link} onChange={(e)=>u('group_link',c)(e.target.value)} placeholder="https://chat.whatsapp.com/..."/></div>) },
  { key: 'news_link', label: 'Link da Notícia', defaultTab: 'basic', defaultOrder: 5, fullWidth: true,
    render: (c) => (<div><Label>Link da Notícia</Label><Input value={c.formData.news_link} onChange={(e)=>u('news_link',c)(e.target.value)} placeholder="https://..."/></div>) },
  { key: 'notes', label: 'Observações', defaultTab: 'basic', defaultOrder: 6, fullWidth: true,
    render: (c) => (<div><Label>Observações</Label><Textarea value={c.formData.notes} onChange={(e)=>u('notes',c)(e.target.value)} placeholder="Notas sobre o lead..." rows={2}/></div>) },
  { key: 'client_classification', label: 'Classificação', defaultTab: 'basic', defaultOrder: 7,
    render: (c) => c.classifications.length === 0 ? null : (<div><Label>Classificação</Label>
      <Select value={c.formData.client_classification || '__none__'} onValueChange={(v)=>c.onChange({client_classification: v==='__none__' ? '' : v})}>
        <SelectTrigger><SelectValue placeholder="Selecione..."/></SelectTrigger>
        <SelectContent><SelectItem value="__none__">Sem classificação</SelectItem>{c.classifications.map(cl=>(<SelectItem key={cl.id} value={cl.name}><div className="flex items-center gap-2"><div className={`w-2 h-2 rounded-full ${cl.color}`}/>{cl.name.replace(/_/g,' ')}</div></SelectItem>))}</SelectContent>
      </Select></div>) },
  { key: 'expected_birth_date', label: 'Previsão do Parto', defaultTab: 'basic', defaultOrder: 8,
    render: (c) => !c.formData.client_classification?.toLowerCase().includes('parto') ? null : (<div><Label>Previsão do Parto</Label><Input type="date" value={c.formData.expected_birth_date} onChange={(e)=>c.onChange({expected_birth_date: e.target.value})}/></div>) },

  // ===== ACCIDENT =====
  { key: 'victim_name', label: 'Nome da Vítima', defaultTab: 'accident', defaultOrder: 1,
    render: (c) => (<div><Label>Nome da Vítima</Label><Input value={c.formData.victim_name} onChange={(e)=>u('victim_name',c)(e.target.value)} placeholder="Nome completo da vítima"/></div>) },
  { key: 'victim_age', label: 'Idade da Vítima', defaultTab: 'accident', defaultOrder: 2,
    render: (c) => (<div><Label>Idade da Vítima</Label><Input type="number" value={c.formData.victim_age} onChange={(e)=>u('victim_age',c)(e.target.value)} placeholder="Idade"/></div>) },
  { key: 'accident_date', label: 'Data do Acidente', defaultTab: 'accident', defaultOrder: 3,
    render: (c) => (<div><Label>Data do Acidente</Label><Input value={c.formatDateBR(c.formData.accident_date)} onChange={(e)=>{const r=c.parseDateBR(e.target.value); if(r.iso) u('accident_date',c)(r.iso);}} placeholder="DD/MM/AAAA" maxLength={10}/></div>) },
  { key: 'case_type', label: 'Tipo de Caso', defaultTab: 'accident', defaultOrder: 4,
    render: (c) => (<div><Label>Tipo de Caso</Label><Select value={c.formData.case_type} onValueChange={u('case_type',c)}><SelectTrigger><SelectValue placeholder="Selecione..."/></SelectTrigger><SelectContent>{caseTypes.map(t=>(<SelectItem key={t} value={t}>{t}</SelectItem>))}</SelectContent></Select></div>) },
  { key: 'accident_address', label: 'Endereço do Acidente', defaultTab: 'accident', defaultOrder: 5, fullWidth: true,
    render: (c) => (<div><Label>Endereço do Acidente</Label><Input value={c.formData.accident_address} onChange={(e)=>u('accident_address',c)(e.target.value)} placeholder="Local onde ocorreu o acidente"/></div>) },
  { key: 'damage_description', label: 'Descrição do Dano', defaultTab: 'accident', defaultOrder: 6, fullWidth: true,
    render: (c) => (<div><Label>Descrição do Dano</Label><Textarea value={c.formData.damage_description} onChange={(e)=>u('damage_description',c)(e.target.value)} placeholder="Descreva as lesões ou danos sofridos..." rows={3}/></div>) },

  // ===== LOCATION =====
  { key: '__auto_location', label: 'Botão: Detectar localização', defaultTab: 'location', defaultOrder: 1, fullWidth: true,
    render: (c) => (<Button type="button" variant="outline" size="sm" onClick={c.onAutoLocation} disabled={c.geoLoading} className="w-full gap-2 border-dashed">{c.geoLoading ? <Loader2 className="h-4 w-4 animate-spin"/> : <LocateFixed className="h-4 w-4"/>}{c.geoLoading ? 'Detectando localização...' : 'Usar minha localização atual'}</Button>) },
  { key: 'visit_state', label: 'Estado da Visita', defaultTab: 'location', defaultOrder: 2,
    render: (c) => (<div><Label>Estado da Visita</Label><Select value={c.formData.visit_state} onValueChange={c.onStateChange}><SelectTrigger><SelectValue placeholder="Selecione..."/></SelectTrigger><SelectContent>{c.states.map(s=>(<SelectItem key={s.sigla} value={s.sigla}>{s.sigla} - {s.nome}</SelectItem>))}</SelectContent></Select></div>) },
  { key: 'visit_city', label: 'Cidade da Visita', defaultTab: 'location', defaultOrder: 3,
    render: (c) => (<div><Label>Cidade da Visita</Label>{c.formData.visit_state && c.cities.length > 0 ? (
      <Select value={c.cities.some(x=>x.nome===c.formData.visit_city) ? c.formData.visit_city : ''} onValueChange={u('visit_city',c)} disabled={c.loadingCities}><SelectTrigger><SelectValue placeholder={c.loadingCities ? 'Carregando...' : (c.formData.visit_city||'Selecione...')}/></SelectTrigger><SelectContent>{c.cities.map(ct=>(<SelectItem key={ct.id} value={ct.nome}>{ct.nome}</SelectItem>))}</SelectContent></Select>
    ) : (<Input value={c.formData.visit_city} onChange={(e)=>u('visit_city',c)(e.target.value)} placeholder={c.formData.visit_state ? 'Carregando cidades...' : 'Selecione o estado primeiro'}/>)}</div>) },
  { key: 'visit_region', label: 'Região da Visita', defaultTab: 'location', defaultOrder: 4,
    render: (c) => (<div><Label>Região da Visita</Label><Input value={c.formData.visit_region} readOnly className="bg-muted" placeholder="Selecione o estado"/></div>) },
  { key: 'visit_address', label: 'Endereço da Visita', defaultTab: 'location', defaultOrder: 5, fullWidth: true,
    render: (c) => (<div><Label>Endereço da Visita</Label><Input value={c.formData.visit_address} onChange={(e)=>u('visit_address',c)(e.target.value)} placeholder="Endereço completo para visita"/></div>) },

  // ===== COMPANIES =====
  { key: 'contractor_company', label: 'Empresa Terceirizada', defaultTab: 'companies', defaultOrder: 1,
    render: (c) => (<div><Label>Empresa Terceirizada</Label><Input value={c.formData.contractor_company} onChange={(e)=>u('contractor_company',c)(e.target.value)} placeholder="Nome da empresa terceirizada"/></div>) },
  { key: 'main_company', label: 'Empresa Tomadora', defaultTab: 'companies', defaultOrder: 2,
    render: (c) => (<div><Label>Empresa Tomadora</Label><Input value={c.formData.main_company} onChange={(e)=>u('main_company',c)(e.target.value)} placeholder="Nome da empresa tomadora"/></div>) },
  { key: 'sector', label: 'Setor', defaultTab: 'companies', defaultOrder: 3,
    render: (c) => (<div><Label>Setor</Label><Select value={c.formData.sector} onValueChange={u('sector',c)}><SelectTrigger><SelectValue placeholder="Selecione..."/></SelectTrigger><SelectContent>{sectors.map(s=>(<SelectItem key={s} value={s}>{s}</SelectItem>))}</SelectContent></Select></div>) },
  { key: 'company_size_justification', label: 'Justificativa do Porte', defaultTab: 'companies', defaultOrder: 4, fullWidth: true,
    render: (c) => (<div><Label>Justificativa do Porte da Empresa</Label><Textarea value={c.formData.company_size_justification} onChange={(e)=>u('company_size_justification',c)(e.target.value)} placeholder="Justificativa sobre o porte da empresa..." rows={2}/></div>) },

  // ===== LEGAL =====
  { key: 'liability_type', label: 'Tipo de Responsabilidade', defaultTab: 'legal', defaultOrder: 1,
    render: (c) => (<div><Label>Tipo de Responsabilidade</Label><Select value={c.formData.liability_type} onValueChange={u('liability_type',c)}><SelectTrigger><SelectValue placeholder="Selecione..."/></SelectTrigger><SelectContent>{liabilityTypes.map(t=>(<SelectItem key={t} value={t}>{t}</SelectItem>))}</SelectContent></Select></div>) },
  { key: 'legal_viability', label: 'Viabilidade Jurídica', defaultTab: 'legal', defaultOrder: 3, fullWidth: true,
    render: (c) => (<div><Label>Viabilidade Jurídica</Label><Textarea value={c.formData.legal_viability} onChange={(e)=>u('legal_viability',c)(e.target.value)} placeholder="Análise de viabilidade jurídica do caso..." rows={3}/></div>) },
];

export const TAB_DEFS: { key: LeadFieldTab; label: string }[] = [
  { key: 'basic', label: 'Básico' },
  { key: 'accident', label: 'Acidente' },
  { key: 'location', label: 'Local' },
  { key: 'companies', label: 'Empresas' },
  { key: 'legal', label: 'Jurídico' },
];
