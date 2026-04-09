import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, UserPlus, Users, Phone, MapPin, Mail, Briefcase, ChevronDown, ChevronUp, Search } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';
import { toast } from 'sonner';

const BRAZILIAN_STATES = [
  'AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT',
  'PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO'
];

const STATE_IDS: Record<string, number> = {
  AC:12,AL:27,AP:16,AM:13,BA:29,CE:23,DF:53,ES:32,GO:52,MA:21,
  MT:51,MS:50,MG:31,PA:15,PB:25,PR:41,PE:26,PI:22,RJ:33,RN:24,
  RS:43,RO:11,RR:14,SC:42,SP:35,SE:28,TO:17
};

// DDD → State mapping
const DDD_TO_STATE: Record<string, string> = {
  '11':'SP','12':'SP','13':'SP','14':'SP','15':'SP','16':'SP','17':'SP','18':'SP','19':'SP',
  '21':'RJ','22':'RJ','24':'RJ',
  '27':'ES','28':'ES',
  '31':'MG','32':'MG','33':'MG','34':'MG','35':'MG','37':'MG','38':'MG',
  '41':'PR','42':'PR','43':'PR','44':'PR','45':'PR','46':'PR',
  '47':'SC','48':'SC','49':'SC',
  '51':'RS','53':'RS','54':'RS','55':'RS',
  '61':'DF','62':'GO','63':'TO','64':'GO','65':'MT','66':'MT','67':'MS','68':'AC','69':'RO',
  '71':'BA','73':'BA','74':'BA','75':'BA','77':'BA',
  '79':'SE',
  '81':'PE','82':'AL','83':'PB','84':'RN','85':'CE','86':'PI','87':'PE','88':'CE','89':'PI',
  '91':'PA','92':'AM','93':'PA','94':'PA','95':'RR','96':'AP','97':'AM','98':'MA','99':'MA',
};

function getStateFromPhone(phone: string): string {
  // Phone format: 55DDXXXXXXXXX
  const clean = phone.replace(/\D/g, '');
  if (clean.length >= 4 && clean.startsWith('55')) {
    const ddd = clean.substring(2, 4);
    return DDD_TO_STATE[ddd] || '';
  }
  return '';
}

interface ContactSuggestion {
  phone: string;
  suggested_name: string;
  message_count: number;
  instances_seen: string[];
  conversation_preview: string;
  final_name: string;
  should_create: boolean;
  city: string;
  state: string;
  email: string;
  profession: string;
  notes: string;
}

interface SyncResult {
  linked_existing: number;
  already_linked: number;
  needs_creation: { phone: string; jid: string }[];
  skipped_instances: number;
}

interface GroupContactSyncDialogProps {
  open: boolean;
  onClose: () => void;
  leadId: string;
  leadName: string;
  groupJid: string;
  groupName?: string;
  instanceId?: string;
}

// Searchable city input with IBGE API
function CitySearchInput({ state, value, onChange, placeholder }: {
  state: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [cities, setCities] = useState<string[]>([]);
  const [filtered, setFiltered] = useState<string[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [loadingCities, setLoadingCities] = useState(false);

  useEffect(() => {
    if (!state || !STATE_IDS[state]) { setCities([]); return; }
    setLoadingCities(true);
    fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${STATE_IDS[state]}/municipios?orderBy=nome`)
      .then(r => r.json())
      .then((data: { nome: string }[]) => setCities(data.map(c => c.nome)))
      .catch(() => setCities([]))
      .finally(() => setLoadingCities(false));
  }, [state]);

  useEffect(() => {
    if (!value.trim()) { setFiltered(cities.slice(0, 20)); return; }
    const q = value.toLowerCase();
    setFiltered(cities.filter(c => c.toLowerCase().includes(q)).slice(0, 20));
  }, [value, cities]);

  return (
    <div className="relative">
      <Input
        value={value}
        onChange={(e) => { onChange(e.target.value); setShowDropdown(true); }}
        onFocus={() => setShowDropdown(true)}
        onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
        placeholder={loadingCities ? 'Carregando...' : (placeholder || 'Buscar cidade')}
        className="h-8"
        disabled={!state}
      />
      {showDropdown && filtered.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-popover border rounded-md shadow-md max-h-40 overflow-y-auto">
          {filtered.map(c => (
            <button
              key={c}
              type="button"
              className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent truncate"
              onMouseDown={(e) => { e.preventDefault(); onChange(c); setShowDropdown(false); }}
            >
              {c}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Searchable CBO profession input
function ProfessionSearchInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [results, setResults] = useState<{ cbo_code: string; title: string }[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!value || value.length < 2) { setResults([]); return; }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const { data } = await (supabase as any)
          .from('cbo_professions')
          .select('cbo_code, title')
          .or(`title.ilike.%${value}%,cbo_code.ilike.%${value}%`)
          .order('title', { ascending: true })
          .limit(20);
        setResults(data || []);
      } catch { setResults([]); }
      setSearching(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [value]);

  return (
    <div className="relative">
      <Input
        value={value}
        onChange={(e) => { onChange(e.target.value); setShowDropdown(true); }}
        onFocus={() => value.length >= 2 && setShowDropdown(true)}
        onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
        placeholder="Buscar profissão CBO..."
        className="h-8"
      />
      {showDropdown && results.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-popover border rounded-md shadow-md max-h-40 overflow-y-auto">
          {results.map(r => (
            <button
              key={r.cbo_code}
              type="button"
              className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent truncate"
              onMouseDown={(e) => { e.preventDefault(); onChange(r.title); setShowDropdown(false); }}
            >
              <span className="font-mono text-muted-foreground mr-1">{r.cbo_code}</span>
              {r.title}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function GroupContactSyncDialog({
  open, onClose, leadId, leadName: _leadName, groupJid, groupName, instanceId
}: GroupContactSyncDialogProps) {
  const [_loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [suggestions, setSuggestions] = useState<ContactSuggestion[]>([]);
  const [phase, setPhase] = useState<'loading' | 'results' | 'done'>('loading');
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [leadCity, setLeadCity] = useState<string | null>(null);
  const [leadState, setLeadState] = useState<string | null>(null);

  const startSync = async () => {
    setLoading(true);
    setPhase('loading');
    try {
      if (leadId) {
        const { data: leadData } = await supabase
          .from('leads')
          .select('city, state')
          .eq('id', leadId)
          .maybeSingle();
        setLeadCity(leadData?.city || null);
        setLeadState(leadData?.state || null);
      }

      const { data, error } = await cloudFunctions.invoke('sync-group-contacts', {
        body: { group_jid: groupJid, lead_id: leadId, instance_id: instanceId },
      });

      if (error || !data?.success) {
        toast.error('Erro ao sincronizar: ' + (data?.error || error?.message || 'Desconhecido'));
        onClose();
        return;
      }

      setSyncResult(data.results);
      setSuggestions(
        (data.contact_suggestions || []).map((s: any) => ({
          ...s,
          final_name: s.suggested_name || '',
          should_create: true,
          city: '',
          state: '',
          email: '',
          profession: '',
          notes: '',
        }))
      );
      setPhase('results');

      if (data.results.linked_existing > 0) {
        toast.success(`${data.results.linked_existing} contato(s) existente(s) vinculado(s) ao lead`);
      }
    } catch (e: any) {
      toast.error('Erro: ' + (e.message || 'Falha na sincronização'));
      onClose();
    }
    setLoading(false);
  };

  const updateSuggestion = (idx: number, updates: Partial<ContactSuggestion>) => {
    setSuggestions(prev => prev.map((item, i) =>
      i === idx ? { ...item, ...updates } : item
    ));
  };

  const handleCreateContacts = async () => {
    const toCreate = suggestions.filter(s => s.should_create && s.final_name.trim());
    if (toCreate.length === 0) {
      toast.info('Nenhum contato para criar');
      onClose();
      return;
    }

    setSyncing(true);
    let created = 0;
    const { data: { user: authUser } } = await supabase.auth.getUser();

    for (const s of toCreate) {
      try {
        const { data: newContact, error: createError } = await supabase
          .from('contacts')
          .insert({
            full_name: s.final_name.trim(),
            phone: s.phone,
            source: 'whatsapp_group',
            classification: 'prospect',
            whatsapp_group_id: groupJid || null,
            lead_id: leadId || null,
            city: s.city.trim() || leadCity || null,
            state: s.state || leadState || null,
            email: s.email.trim() || null,
            profession: s.profession.trim() || null,
            notes: s.notes.trim() || null,
            created_by: authUser?.id || null,
          })
          .select('id')
          .single();

        if (createError || !newContact) {
          console.error('Error creating contact:', createError);
          continue;
        }

        await supabase
          .from('contact_leads')
          .insert({ contact_id: newContact.id, lead_id: leadId });

        created++;
      } catch (e) {
        console.error('Error creating contact:', e);
      }
    }

    toast.success(`${created} contato(s) criado(s) e vinculado(s) ao lead`);
    setPhase('done');
    setSyncing(false);
    onClose();
  };

  useEffect(() => {
    if (open && groupJid) {
      startSync();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, groupJid]);

  const toggleExpand = (idx: number) => {
    setExpandedIdx(prev => prev === idx ? null : idx);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Sincronizar Contatos do Grupo
            {groupName && <Badge variant="outline" className="text-xs">{groupName}</Badge>}
          </DialogTitle>
        </DialogHeader>

        {phase === 'loading' && (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">
              Buscando participantes do grupo e cruzando com contatos existentes...
            </p>
          </div>
        )}

        {phase === 'results' && syncResult && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="text-center p-3 rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200">
                <p className="text-2xl font-bold text-green-600">{syncResult.linked_existing}</p>
                <p className="text-xs text-muted-foreground">Vinculados</p>
              </div>
              <div className="text-center p-3 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200">
                <p className="text-2xl font-bold text-blue-600">{syncResult.already_linked}</p>
                <p className="text-xs text-muted-foreground">Já vinculados</p>
              </div>
              <div className="text-center p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200">
                <p className="text-2xl font-bold text-amber-600">{suggestions.length}</p>
                <p className="text-xs text-muted-foreground">Novos contatos</p>
              </div>
            </div>

            {suggestions.length > 0 ? (
              <>
                <p className="text-sm font-medium">
                  Novos contatos encontrados — preencha os dados para cadastrar:
                </p>
                <ScrollArea className="max-h-[400px]">
                  <div className="space-y-2">
                    {suggestions.map((s, idx) => (
                      <div
                        key={s.phone}
                        className={`rounded-lg border transition-colors ${
                          s.should_create ? 'bg-background' : 'bg-muted/40 opacity-60'
                        }`}
                      >
                        <div className="flex items-center gap-3 p-3">
                          <Switch
                            checked={s.should_create}
                            onCheckedChange={(v) => updateSuggestion(idx, { should_create: v })}
                          />
                          <div className="flex-1 min-w-0">
                            <Input
                              value={s.final_name}
                              onChange={(e) => updateSuggestion(idx, { final_name: e.target.value })}
                              placeholder="Nome do contato"
                              className="h-8"
                              disabled={!s.should_create}
                            />
                            <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                              <Phone className="h-3 w-3" />
                              <span className="font-mono">{s.phone}</span>
                              {s.message_count > 0 && (
                                <Badge variant="secondary" className="text-[10px]">
                                  {s.message_count} msgs em {s.instances_seen.length} instância(s)
                                </Badge>
                              )}
                              {s.suggested_name && s.suggested_name !== s.final_name && (
                                <Badge
                                  variant="outline"
                                  className="text-[10px] cursor-pointer"
                                  onClick={() => updateSuggestion(idx, { final_name: s.suggested_name })}
                                >
                                  Sugestão: {s.suggested_name}
                                </Badge>
                              )}
                            </div>
                          </div>
                          {s.should_create && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0"
                              onClick={() => toggleExpand(idx)}
                            >
                              {expandedIdx === idx ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                            </Button>
                          )}
                        </div>

                        {s.should_create && expandedIdx === idx && (
                          <div className="px-3 pb-3 pt-1 border-t space-y-2">
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="text-xs text-muted-foreground flex items-center gap-1 mb-1">
                                  <MapPin className="h-3 w-3" /> Estado
                                </label>
                                <Select
                                  value={s.state}
                                  onValueChange={(v) => updateSuggestion(idx, { state: v, city: '' })}
                                >
                                  <SelectTrigger className="h-8">
                                    <SelectValue placeholder={leadState || 'UF'} />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {BRAZILIAN_STATES.map(uf => (
                                      <SelectItem key={uf} value={uf}>{uf}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                              <div>
                                <label className="text-xs text-muted-foreground flex items-center gap-1 mb-1">
                                  <MapPin className="h-3 w-3" /> Cidade
                                </label>
                                <CitySearchInput
                                  state={s.state || leadState || ''}
                                  value={s.city}
                                  onChange={(v) => updateSuggestion(idx, { city: v })}
                                  placeholder={leadCity || 'Buscar cidade'}
                                />
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="text-xs text-muted-foreground flex items-center gap-1 mb-1">
                                  <Mail className="h-3 w-3" /> Email
                                </label>
                                <Input
                                  value={s.email}
                                  onChange={(e) => updateSuggestion(idx, { email: e.target.value })}
                                  placeholder="email@exemplo.com"
                                  className="h-8"
                                  type="email"
                                />
                              </div>
                              <div>
                                <label className="text-xs text-muted-foreground flex items-center gap-1 mb-1">
                                  <Briefcase className="h-3 w-3" /> Profissão
                                </label>
                                <ProfessionSearchInput
                                  value={s.profession}
                                  onChange={(v) => updateSuggestion(idx, { profession: v })}
                                />
                              </div>
                            </div>
                            <div>
                              <label className="text-xs text-muted-foreground mb-1 block">Observações</label>
                              <Input
                                value={s.notes}
                                onChange={(e) => updateSuggestion(idx, { notes: e.target.value })}
                                placeholder="Notas sobre o contato"
                                className="h-8"
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">
                Todos os participantes já são contatos conhecidos! ✅
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {phase === 'results' && suggestions.length > 0 ? 'Pular' : 'Fechar'}
          </Button>
          {phase === 'results' && suggestions.filter(s => s.should_create).length > 0 && (
            <Button onClick={handleCreateContacts} disabled={syncing} className="gap-1">
              {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
              Criar {suggestions.filter(s => s.should_create && s.final_name.trim()).length} contato(s)
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
