import { useState, useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  CreditCard, CheckCircle2, AlertCircle, Loader2, Send, 
  MapPin, Tag, FileText, ChevronDown, ChevronUp, User, Building, UserCheck, Search, LocateFixed
} from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useGeolocation } from '@/hooks/useGeolocation';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';

interface Transaction {
  id: string;
  pluggy_transaction_id: string;
  description: string;
  amount: number;
  transaction_date: string;
  transaction_time: string | null;
  merchant_name: string | null;
  merchant_city: string | null;
  merchant_state: string | null;
  card_last_digits: string;
  category: string | null;
}

interface Category {
  id: string;
  name: string;
  parent_id: string | null;
  color: string | null;
  icon: string | null;
}

interface LeadOption {
  id: string;
  lead_name: string | null;
  lead_email: string | null;
  instagram_username: string | null;
  city: string | null;
  state: string | null;
}

interface ContactOption {
  id: string;
  full_name: string;
  instagram_username: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
}

interface FormResponse {
  transaction_id: string;
  description: string;
  category: string;
  city: string;
  state: string;
  lead_name: string;
}

interface IBGEState {
  id: number;
  sigla: string;
  nome: string;
}

interface IBGECity {
  id: number;
  nome: string;
}

const BRAZILIAN_STATES = [
  'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG',
  'PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'
];

export default function ExpenseFormPage() {
  const { token } = useParams<{ token: string }>();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [leads, setLeads] = useState<LeadOption[]>([]);
  const [contacts, setContacts] = useState<ContactOption[]>([]);
  const [cardInfo, setCardInfo] = useState<{ card_last_digits: string; card_name?: string; lead_name?: string } | null>(null);
  const [tokenData, setTokenData] = useState<any>(null);
  const [respondedIds, setRespondedIds] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [responses, setResponses] = useState<Record<string, FormResponse>>({});
  const [batchMode, setBatchMode] = useState(false);
  const [batchData, setBatchData] = useState<Partial<FormResponse>>({});
  const [expandedTx, setExpandedTx] = useState<Set<string>>(new Set());
  
  // City loading per state
  const [citiesCache, setCitiesCache] = useState<Record<string, IBGECity[]>>({});
  const [loadingCities, setLoadingCities] = useState<Record<string, boolean>>({});
  const [batchCities, setBatchCities] = useState<IBGECity[]>([]);
  const [batchLoadingCities, setBatchLoadingCities] = useState(false);

  // Search terms for lead/contact
  const [leadSearchTerms, setLeadSearchTerms] = useState<Record<string, string>>({});
  const [contactSearchTerms, setContactSearchTerms] = useState<Record<string, string>>({});
  const [batchLeadSearch, setBatchLeadSearch] = useState('');
  const [batchContactSearch, setBatchContactSearch] = useState('');
  const [linkTabs, setLinkTabs] = useState<Record<string, 'lead' | 'contact'>>({});
  const [batchLinkTab, setBatchLinkTab] = useState<'lead' | 'contact'>('lead');
  const { loading: geoLoading, fetchLocation } = useGeolocation();

  const handleAutoLocationForTx = async (txId: string) => {
    const loc = await fetchLocation();
    if (loc) {
      updateResponse(txId, 'state', loc.state);
      updateResponse(txId, 'city', loc.city);
      fetchCitiesForState(loc.state, txId);
      toast.success(`Localização: ${loc.city}/${loc.state}`);
    } else {
      toast.error('Não foi possível detectar a localização');
    }
  };

  const handleAutoLocationBatch = async () => {
    const loc = await fetchLocation();
    if (loc) {
      setBatchData(prev => ({ ...prev, state: loc.state, city: loc.city }));
      fetchCitiesForState(loc.state, 'batch');
      toast.success(`Localização: ${loc.city}/${loc.state}`);
    } else {
      toast.error('Não foi possível detectar a localização');
    }
  };

  useEffect(() => {
    if (token) loadFormData();
  }, [token]);

  const fetchCitiesForState = async (uf: string, target: 'batch' | string) => {
    if (citiesCache[uf]) {
      if (target === 'batch') setBatchCities(citiesCache[uf]);
      return;
    }
    
    if (target === 'batch') setBatchLoadingCities(true);
    else setLoadingCities(prev => ({ ...prev, [target]: true }));
    
    try {
      const res = await fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${uf}/municipios?orderBy=nome`);
      const data: IBGECity[] = await res.json();
      setCitiesCache(prev => ({ ...prev, [uf]: data }));
      if (target === 'batch') setBatchCities(data);
    } catch {
      // fallback
    } finally {
      if (target === 'batch') setBatchLoadingCities(false);
      else setLoadingCities(prev => ({ ...prev, [target]: false }));
    }
  };

  const getCitiesForTx = (txId: string): IBGECity[] => {
    const state = responses[txId]?.state;
    if (!state) return [];
    return citiesCache[state] || [];
  };

  const loadFormData = async () => {
    setLoading(true);
    try {
      const { data, error: fnError } = await cloudFunctions.invoke('expense-form', {
        body: { action: 'validate', token },
      });

      // The edge function returns non-2xx for validation errors (expired, already submitted, etc.)
      // supabase SDK wraps these as fnError, but the actual error details are in data
      if (data?.error) {
        setError(data.error);
        if (data.already_submitted) setSubmitted(true);
        return;
      }
      if (fnError) throw new Error(fnError.message);

      setTransactions(data.transactions);
      setCategories(data.categories);
      setLeads(data.leads || []);
      setContacts(data.contacts || []);
      setTokenData(data.token);
      setRespondedIds(new Set(data.respondedTransactionIds));
      setCardInfo({
        card_last_digits: data.token.card_last_digits,
        card_name: data.cardAssignment?.card_name,
        lead_name: data.cardAssignment?.lead_name,
      });

      const initial: Record<string, FormResponse> = {};
      data.transactions.forEach((tx: Transaction) => {
        const override = data.overrides?.find((o: any) => o.transaction_id === tx.id);
        initial[tx.id] = {
          transaction_id: tx.id,
          description: override?.notes || '',
          category: override?.category_id || '',
          city: override?.manual_city || tx.merchant_city || '',
          state: override?.manual_state || tx.merchant_state || '',
          lead_name: '',
        };
      });
      setResponses(initial);

      // Pre-fetch cities for states that exist
      const states = new Set<string>();
      data.transactions.forEach((tx: Transaction) => {
        const override = data.overrides?.find((o: any) => o.transaction_id === tx.id);
        const st = override?.manual_state || tx.merchant_state;
        if (st) states.add(st);
      });
      states.forEach(st => fetchCitiesForState(st, 'preload'));
    } catch (err: any) {
      setError(err.message || 'Erro ao carregar formulário');
    } finally {
      setLoading(false);
    }
  };

  const parentCategories = useMemo(() => categories.filter(c => !c.parent_id), [categories]);
  const childCategories = useMemo(() => {
    const map: Record<string, Category[]> = {};
    categories.filter(c => c.parent_id).forEach(c => {
      if (!map[c.parent_id!]) map[c.parent_id!] = [];
      map[c.parent_id!].push(c);
    });
    return map;
  }, [categories]);

  const selectableCategories = useMemo(() => {
    const result: { id: string; name: string; groupName?: string }[] = [];
    parentCategories.forEach(parent => {
      const children = childCategories[parent.id];
      if (children && children.length > 0) {
        children.forEach(child => {
          result.push({ id: child.id, name: child.name, groupName: parent.name });
        });
      } else {
        result.push({ id: parent.id, name: parent.name });
      }
    });
    return result;
  }, [parentCategories, childCategories]);

  const pendingTransactions = useMemo(() => 
    transactions.filter(t => !respondedIds.has(t.id)),
    [transactions, respondedIds]
  );

  const updateResponse = (txId: string, field: keyof FormResponse, value: string) => {
    setResponses(prev => ({
      ...prev,
      [txId]: { ...prev[txId], [field]: value },
    }));
  };

  const toggleSelect = (txId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(txId)) next.delete(txId);
      else next.add(txId);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedIds.size === pendingTransactions.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(pendingTransactions.map(t => t.id)));
    }
  };

  const applyBatch = () => {
    setResponses(prev => {
      const next = { ...prev };
      selectedIds.forEach(id => {
        next[id] = {
          ...next[id],
          ...(batchData.description ? { description: batchData.description } : {}),
          ...(batchData.category ? { category: batchData.category } : {}),
          ...(batchData.city ? { city: batchData.city } : {}),
          ...(batchData.state ? { state: batchData.state } : {}),
          ...(batchData.lead_name ? { lead_name: batchData.lead_name } : {}),
        };
      });
      return next;
    });
    toast.success(`Dados aplicados a ${selectedIds.size} transações`);
    setBatchMode(false);
    setBatchData({});
  };

  const toggleExpand = (txId: string) => {
    setExpandedTx(prev => {
      const next = new Set(prev);
      if (next.has(txId)) next.delete(txId);
      else next.add(txId);
      return next;
    });
  };

  const handleSubmit = async () => {
    const toSubmit = pendingTransactions.map(tx => responses[tx.id]).filter(Boolean);
    if (toSubmit.length === 0) {
      toast.error('Nenhuma transação para enviar');
      return;
    }

    setSubmitting(true);
    try {
      const { data, error: fnError } = await cloudFunctions.invoke('expense-form', {
        body: { action: 'submit', token, responses: toSubmit },
      });

      if (data?.error) throw new Error(data.error);
      if (fnError) throw new Error(fnError.message);

      setSubmitted(true);
      toast.success('Formulário enviado com sucesso!');
    } catch (err: any) {
      toast.error(err.message || 'Erro ao enviar');
    } finally {
      setSubmitting(false);
    }
  };

  const getLeadDisplay = (lead: LeadOption) => lead.lead_name || lead.lead_email || lead.instagram_username || 'Sem nome';
  const getContactDisplay = (contact: ContactOption) => contact.full_name || contact.instagram_username || 'Sem nome';

  const getFilteredLeads = (search: string) => {
    if (!search) return leads;
    const s = search.toLowerCase();
    return leads.filter(l => 
      l.lead_name?.toLowerCase().includes(s) ||
      l.lead_email?.toLowerCase().includes(s) ||
      l.instagram_username?.toLowerCase().includes(s)
    );
  };

  const getFilteredContacts = (search: string) => {
    if (!search) return contacts;
    const s = search.toLowerCase();
    return contacts.filter(c => 
      c.full_name?.toLowerCase().includes(s) ||
      c.instagram_username?.toLowerCase().includes(s) ||
      c.phone?.includes(s)
    );
  };

  // Render location selectors (state → city)
  const renderLocationSelectors = (
    stateValue: string,
    cityValue: string,
    onStateChange: (v: string) => void,
    onCityChange: (v: string) => void,
    cities: IBGECity[],
    isLoadingCities: boolean,
    onAutoLocation?: () => void,
  ) => (
    <div className="space-y-2">
      {onAutoLocation && (
        <button
          type="button"
          onClick={onAutoLocation}
          disabled={geoLoading}
          className="w-full flex items-center justify-center gap-1.5 text-xs border border-dashed rounded-md py-1.5 hover:bg-muted transition-colors disabled:opacity-50"
        >
          {geoLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <LocateFixed className="h-3 w-3" />}
          {geoLoading ? 'Detectando...' : 'Usar minha localização'}
        </button>
      )}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-xs flex items-center gap-1">
            <MapPin className="h-3 w-3" /> Estado
          </Label>
          <Select value={stateValue} onValueChange={onStateChange}>
            <SelectTrigger className="h-8 text-xs mt-1">
              <SelectValue placeholder="UF" />
            </SelectTrigger>
            <SelectContent>
              {BRAZILIAN_STATES.map(s => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs flex items-center gap-1">
            <MapPin className="h-3 w-3" /> Cidade
          </Label>
          <Select value={cityValue} onValueChange={onCityChange} disabled={!stateValue || isLoadingCities}>
            <SelectTrigger className="h-8 text-xs mt-1">
              <SelectValue placeholder={isLoadingCities ? "Carregando..." : "Selecione"} />
            </SelectTrigger>
            <SelectContent>
              {cities.map(c => (
                <SelectItem key={c.id} value={c.nome}>{c.nome}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );

  // Render lead/contact link selector
  const renderLinkSelector = (
    txId: string,
    leadNameValue: string,
    onSelect: (displayName: string) => void,
    activeTab: 'lead' | 'contact',
    onTabChange: (v: 'lead' | 'contact') => void,
    leadSearch: string,
    onLeadSearch: (v: string) => void,
    contactSearch: string,
    onContactSearch: (v: string) => void,
  ) => (
    <div>
      <Label className="text-xs flex items-center gap-1 mb-1">
        <User className="h-3 w-3" /> Vincular a Lead ou Contato
      </Label>
      <Tabs value={activeTab} onValueChange={(v) => onTabChange(v as 'lead' | 'contact')}>
        <TabsList className="grid w-full grid-cols-2 h-7">
          <TabsTrigger value="lead" className="text-xs gap-1 h-6">
            <Building className="h-3 w-3" /> Lead
          </TabsTrigger>
          <TabsTrigger value="contact" className="text-xs gap-1 h-6">
            <UserCheck className="h-3 w-3" /> Contato
          </TabsTrigger>
        </TabsList>
        <TabsContent value="lead" className="mt-2">
          <div className="relative mb-1">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
            <Input
              placeholder="Buscar lead..."
              value={leadSearch}
              onChange={e => onLeadSearch(e.target.value)}
              className="h-7 text-xs pl-7"
            />
          </div>
          <div className="border rounded-md md:h-[42vh] md:min-h-[320px] md:overflow-y-auto">
            <div className="p-1 space-y-0.5">
              <button
                type="button"
                className={`w-full text-left px-2 py-1 rounded text-xs transition-colors text-muted-foreground italic ${!leadNameValue ? 'bg-muted font-medium' : 'hover:bg-muted'}`}
                onClick={() => onSelect('')}
              >
                Nenhum
              </button>
              {getFilteredLeads(leadSearch).map(lead => (
                <button
                  key={lead.id}
                  type="button"
                  className={`w-full text-left px-2 py-1 rounded text-xs transition-colors ${
                    leadNameValue === getLeadDisplay(lead) ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
                  }`}
                  onClick={() => onSelect(getLeadDisplay(lead))}
                >
                  <span className="font-medium">{getLeadDisplay(lead)}</span>
                  {lead.city && <span className="text-[10px] opacity-70 ml-1">• {lead.city}/{lead.state}</span>}
                </button>
              ))}
            </div>
          </div>
        </TabsContent>
        <TabsContent value="contact" className="mt-2">
          <div className="relative mb-1">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
            <Input
              placeholder="Buscar contato..."
              value={contactSearch}
              onChange={e => onContactSearch(e.target.value)}
              className="h-7 text-xs pl-7"
            />
          </div>
          <div className="border rounded-md md:h-[42vh] md:min-h-[320px] md:overflow-y-auto">
            <div className="p-1 space-y-0.5">
              <button
                type="button"
                className={`w-full text-left px-2 py-1 rounded text-xs transition-colors text-muted-foreground italic ${!leadNameValue ? 'bg-muted font-medium' : 'hover:bg-muted'}`}
                onClick={() => onSelect('')}
              >
                Nenhum
              </button>
              {getFilteredContacts(contactSearch).map(contact => (
                <button
                  key={contact.id}
                  type="button"
                  className={`w-full text-left px-2 py-1 rounded text-xs transition-colors ${
                    leadNameValue === getContactDisplay(contact) ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
                  }`}
                  onClick={() => onSelect(getContactDisplay(contact))}
                >
                  <span className="font-medium">{getContactDisplay(contact)}</span>
                  {contact.city && <span className="text-[10px] opacity-70 ml-1">• {contact.city}/{contact.state}</span>}
                </button>
              ))}
            </div>
          </div>
        </TabsContent>
      </Tabs>
      {leadNameValue && (
        <div className="mt-1 px-2 py-1 bg-muted/50 rounded text-xs text-muted-foreground">
          Vinculado: <span className="font-medium">{leadNameValue}</span>
        </div>
      )}
    </div>
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-lg">
          <CardContent className="flex flex-col items-center gap-4 py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-muted-foreground">Carregando formulário...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error || submitted) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-lg">
          <CardContent className="flex flex-col items-center gap-4 py-12">
            {submitted ? (
              <>
                <CheckCircle2 className="h-12 w-12 text-green-500" />
                <h2 className="text-xl font-semibold">Formulário enviado!</h2>
                <p className="text-muted-foreground text-center">
                  Obrigado por preencher as informações dos seus gastos.
                </p>
              </>
            ) : (
              <>
                <AlertCircle className="h-12 w-12 text-destructive" />
                <h2 className="text-xl font-semibold">Ops!</h2>
                <p className="text-muted-foreground text-center">{error}</p>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen min-h-[100dvh] bg-background p-4 pb-28 md:p-8 md:pb-10">
      <div className="max-w-3xl mx-auto space-y-4">
        {/* Header */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-full bg-primary/10">
                <CreditCard className="h-6 w-6 text-primary" />
              </div>
              <div>
                <CardTitle className="text-lg">Justificativa de Gastos</CardTitle>
                <CardDescription>
                  Cartão ****{cardInfo?.card_last_digits}
                  {cardInfo?.card_name && ` • ${cardInfo.card_name}`}
                  {cardInfo?.lead_name && ` • ${cardInfo.lead_name}`}
                </CardDescription>
              </div>
            </div>
            <div className="flex gap-2 mt-2">
              <Badge variant="outline" className="text-xs">
                {format(new Date(tokenData?.date_from), 'dd/MM/yyyy')} - {format(new Date(tokenData?.date_to), 'dd/MM/yyyy')}
              </Badge>
              <Badge variant="secondary" className="text-xs">
                {pendingTransactions.length} transações pendentes
              </Badge>
            </div>
          </CardHeader>
        </Card>

        {/* Batch mode */}
        {pendingTransactions.length > 1 && (
          <Card>
            <CardContent className="py-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={selectedIds.size === pendingTransactions.length && pendingTransactions.length > 0}
                    onCheckedChange={selectAll}
                  />
                  <span className="text-sm font-medium">
                    {selectedIds.size > 0 ? `${selectedIds.size} selecionada(s)` : 'Selecionar todas'}
                  </span>
                </div>
                {selectedIds.size > 1 && (
                  <Button size="sm" variant="outline" onClick={() => setBatchMode(!batchMode)}>
                    {batchMode ? 'Fechar' : 'Preencher em lote'}
                  </Button>
                )}
              </div>

              {batchMode && selectedIds.size > 1 && (
                <div className="mt-3 pt-3 border-t space-y-3">
                  <p className="text-xs text-muted-foreground">
                    Preencha os campos abaixo para aplicar a todas as {selectedIds.size} transações selecionadas:
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Descrição do gasto</Label>
                      <Input
                        placeholder="Ex: Almoço com cliente"
                        value={batchData.description || ''}
                        onChange={e => setBatchData(p => ({ ...p, description: e.target.value }))}
                        className="h-8 text-sm"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Categoria</Label>
                      <Select value={batchData.category || ''} onValueChange={v => setBatchData(p => ({ ...p, category: v }))}>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="Selecione..." />
                        </SelectTrigger>
                        <SelectContent>
                          {selectableCategories.map(c => (
                            <SelectItem key={c.id} value={c.id} className="text-xs">
                              {c.groupName ? `${c.groupName} → ${c.name}` : c.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  
                  {renderLocationSelectors(
                    batchData.state || '',
                    batchData.city || '',
                    (v) => {
                      setBatchData(p => ({ ...p, state: v, city: '' }));
                      fetchCitiesForState(v, 'batch');
                    },
                    (v) => setBatchData(p => ({ ...p, city: v })),
                    batchCities,
                    batchLoadingCities,
                    handleAutoLocationBatch,
                  )}

                  <div>
                    {renderLinkSelector(
                      'batch',
                      batchData.lead_name || '',
                      (name) => setBatchData(p => ({ ...p, lead_name: name })),
                      batchLinkTab,
                      setBatchLinkTab,
                      batchLeadSearch,
                      setBatchLeadSearch,
                      batchContactSearch,
                      setBatchContactSearch,
                    )}
                  </div>

                  <Button size="sm" onClick={applyBatch}>
                    Aplicar a {selectedIds.size} transações
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Transactions list */}
        <div className="space-y-2 pb-20">
            {pendingTransactions.map(tx => {
              const resp = responses[tx.id];
              const isExpanded = expandedTx.has(tx.id);
              const txCities = getCitiesForTx(tx.id);
              const isLoadingTxCities = loadingCities[tx.id] || false;

              return (
                <Card key={tx.id} className="overflow-hidden">
                  <div className="p-3">
                    <div className="flex items-start gap-2">
                      {pendingTransactions.length > 1 && (
                        <Checkbox
                          checked={selectedIds.has(tx.id)}
                          onCheckedChange={() => toggleSelect(tx.id)}
                          className="mt-1"
                        />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-medium truncate">
                            {tx.merchant_name || tx.description}
                          </p>
                          <span className="text-sm font-bold text-destructive whitespace-nowrap ml-2">
                            R$ {Math.abs(tx.amount).toFixed(2)}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs text-muted-foreground">
                            {format(new Date(tx.transaction_date + 'T12:00:00'), 'dd/MM/yyyy', { locale: ptBR })}
                            {tx.transaction_time && ` • ${tx.transaction_time.substring(0, 5)}`}
                          </span>
                          {tx.merchant_city && (
                            <span className="text-xs text-muted-foreground">
                              • {tx.merchant_city}{tx.merchant_state ? `/${tx.merchant_state}` : ''}
                            </span>
                          )}
                          {tx.category && (
                            <Badge variant="outline" className="text-[10px] h-4">{tx.category}</Badge>
                          )}
                        </div>
                      </div>
                      <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => toggleExpand(tx.id)}>
                        {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </Button>
                    </div>

                    {isExpanded && resp && (
                      <div className="mt-3 pt-3 border-t space-y-3">
                        <div>
                          <Label className="text-xs flex items-center gap-1">
                             <FileText className="h-3 w-3" /> Descrição
                           </Label>
                          <Textarea
                            placeholder="Descreva o que foi este gasto..."
                            value={resp.description}
                            onChange={e => updateResponse(tx.id, 'description', e.target.value)}
                            className="text-sm min-h-[60px] mt-1"
                            maxLength={500}
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <Label className="text-xs flex items-center gap-1">
                              <Tag className="h-3 w-3" /> Categoria
                            </Label>
                            <Select value={resp.category} onValueChange={v => updateResponse(tx.id, 'category', v)}>
                              <SelectTrigger className="h-8 text-xs mt-1">
                                <SelectValue placeholder="Selecione..." />
                              </SelectTrigger>
                              <SelectContent>
                                {selectableCategories.map(c => (
                                  <SelectItem key={c.id} value={c.id} className="text-xs">
                                    {c.groupName ? `${c.groupName} → ${c.name}` : c.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>

                        {renderLocationSelectors(
                          resp.state,
                          resp.city,
                          (v) => {
                            updateResponse(tx.id, 'state', v);
                            updateResponse(tx.id, 'city', '');
                            fetchCitiesForState(v, tx.id);
                          },
                          (v) => updateResponse(tx.id, 'city', v),
                          txCities,
                          isLoadingTxCities,
                          () => handleAutoLocationForTx(tx.id),
                        )}

                        {renderLinkSelector(
                          tx.id,
                          resp.lead_name,
                          (name) => updateResponse(tx.id, 'lead_name', name),
                          linkTabs[tx.id] || 'lead',
                          (v) => setLinkTabs(prev => ({ ...prev, [tx.id]: v })),
                          leadSearchTerms[tx.id] || '',
                          (v) => setLeadSearchTerms(prev => ({ ...prev, [tx.id]: v })),
                          contactSearchTerms[tx.id] || '',
                          (v) => setContactSearchTerms(prev => ({ ...prev, [tx.id]: v })),
                        )}
                      </div>
                    )}
                  </div>
                </Card>
              );
            })}
        </div>

        {/* Submit */}
        <Card>
          <CardContent className="py-4">
            <Button 
              className="w-full" 
              size="lg" 
              onClick={handleSubmit} 
              disabled={submitting || pendingTransactions.length === 0}
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Send className="h-4 w-4 mr-2" />
              )}
              Enviar justificativas ({pendingTransactions.length} transações)
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
