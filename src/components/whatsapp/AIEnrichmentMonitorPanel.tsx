import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import {
  UserPlus, Sparkles, Search, RefreshCw, Phone, User, MapPin,
  Briefcase, Clock, ChevronRight, FileText
} from 'lucide-react';
import { format, subDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface EnrichmentLog {
  id: string;
  phone: string;
  instance_name: string;
  lead_id: string | null;
  contact_id: string | null;
  fields_updated: Record<string, any>;
  created_at: string;
}

interface CreatedRecord {
  id: string;
  name: string;
  type: 'lead' | 'contact';
  phone: string | null;
  city: string | null;
  state: string | null;
  action_source_detail: string | null;
  created_at: string;
}

export function AIEnrichmentMonitorPanel() {
  const [enrichments, setEnrichments] = useState<EnrichmentLog[]>([]);
  const [createdRecords, setCreatedRecords] = useState<CreatedRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [periodDays, setPeriodDays] = useState(7);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLog, setSelectedLog] = useState<EnrichmentLog | null>(null);
  const [viewMode, setViewMode] = useState<'all' | 'created' | 'enriched'>('all');

  const fetchData = async () => {
    setLoading(true);
    const startDate = subDays(new Date(), periodDays).toISOString();

    const [enrichRes, leadsRes, contactsRes] = await Promise.all([
      supabase
        .from('lead_enrichment_log')
        .select('*')
        .gte('created_at', startDate)
        .order('created_at', { ascending: false })
        .limit(500),
      supabase
        .from('leads')
        .select('id, lead_name, lead_phone, city, state, action_source, action_source_detail, created_at')
        .eq('action_source', 'system')
        .gte('created_at', startDate)
        .order('created_at', { ascending: false })
        .limit(200),
      supabase
        .from('contacts')
        .select('id, full_name, phone, city, state, action_source, action_source_detail, created_at')
        .eq('action_source', 'system')
        .gte('created_at', startDate)
        .order('created_at', { ascending: false })
        .limit(200),
    ]);

    setEnrichments(enrichRes.data || []);

    const records: CreatedRecord[] = [
      ...(leadsRes.data || []).map((l: any) => ({
        id: l.id,
        name: l.lead_name,
        type: 'lead' as const,
        phone: l.lead_phone,
        city: l.city,
        state: l.state,
        action_source_detail: l.action_source_detail,
        created_at: l.created_at,
      })),
      ...(contactsRes.data || []).map((c: any) => ({
        id: c.id,
        name: c.full_name,
        type: 'contact' as const,
        phone: c.phone,
        city: c.city,
        state: c.state,
        action_source_detail: c.action_source_detail,
        created_at: c.created_at,
      })),
    ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    setCreatedRecords(records);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [periodDays]);

  const stats = useMemo(() => {
    const leadsCreated = createdRecords.filter(r => r.type === 'lead').length;
    const contactsCreated = createdRecords.filter(r => r.type === 'contact').length;
    const enriched = enrichments.length;
    const uniquePhones = new Set(enrichments.map(e => e.phone)).size;
    const fieldsTotal = enrichments.reduce((sum, e) => sum + Object.keys(e.fields_updated || {}).length, 0);
    return { leadsCreated, contactsCreated, enriched, uniquePhones, fieldsTotal };
  }, [createdRecords, enrichments]);

  const filteredItems = useMemo(() => {
    const q = searchQuery.toLowerCase();
    if (viewMode === 'created' || viewMode === 'all') {
      const created = createdRecords.filter(r =>
        !q || r.name?.toLowerCase().includes(q) || r.phone?.includes(q)
      );
      if (viewMode === 'created') return { created, enriched: [] };
    }
    if (viewMode === 'enriched' || viewMode === 'all') {
      const enriched = enrichments.filter(e =>
        !q || e.phone?.includes(q) || JSON.stringify(e.fields_updated).toLowerCase().includes(q)
      );
      if (viewMode === 'enriched') return { created: [], enriched };
    }
    return {
      created: createdRecords.filter(r => !q || r.name?.toLowerCase().includes(q) || r.phone?.includes(q)),
      enriched: enrichments.filter(e => !q || e.phone?.includes(q)),
    };
  }, [createdRecords, enrichments, searchQuery, viewMode]);

  const fieldLabels: Record<string, string> = {
    full_name: 'Nome', email: 'E-mail', city: 'Cidade', state: 'Estado',
    neighborhood: 'Bairro', street: 'Logradouro', cep: 'CEP', profession: 'Profissão',
    instagram_url: 'Instagram', victim_name: 'Vítima', main_company: 'Empresa',
    contractor_company: 'Terceirizada', damage_description: 'Dano/Lesão',
    accident_date: 'Data Acidente', accident_address: 'Endereço Acidente',
    sector: 'Setor', case_type: 'Tipo Caso', liability_type: 'Responsabilidade',
    notes: 'Notas', phone: 'Telefone',
  };

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="border-primary/20">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <UserPlus className="h-3.5 w-3.5 text-green-500" />
              Leads Criados (IA)
            </div>
            <p className="text-2xl font-bold text-green-600">{stats.leadsCreated}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <User className="h-3.5 w-3.5 text-blue-500" />
              Contatos Criados (IA)
            </div>
            <p className="text-2xl font-bold text-blue-600">{stats.contactsCreated}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Sparkles className="h-3.5 w-3.5 text-amber-500" />
              Enriquecimentos
            </div>
            <p className="text-2xl font-bold text-amber-600">{stats.enriched}</p>
            <p className="text-[10px] text-muted-foreground">{stats.uniquePhones} telefones únicos</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <FileText className="h-3.5 w-3.5 text-purple-500" />
              Campos Extraídos
            </div>
            <p className="text-2xl font-bold text-purple-600">{stats.fieldsTotal}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome ou telefone..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="pl-9 h-9 text-sm"
          />
        </div>
        <Select value={viewMode} onValueChange={(v: any) => setViewMode(v)}>
          <SelectTrigger className="w-[150px] h-9 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="created">Criados pela IA</SelectItem>
            <SelectItem value="enriched">Enriquecidos</SelectItem>
          </SelectContent>
        </Select>
        <Select value={String(periodDays)} onValueChange={v => setPeriodDays(Number(v))}>
          <SelectTrigger className="w-[130px] h-9 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1">Últimas 24h</SelectItem>
            <SelectItem value="7">Últimos 7 dias</SelectItem>
            <SelectItem value="15">Últimos 15 dias</SelectItem>
            <SelectItem value="30">Últimos 30 dias</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={fetchData} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {/* Created Records */}
      {(viewMode === 'all' || viewMode === 'created') && filteredItems.created.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <UserPlus className="h-4 w-4 text-green-500" />
            Leads e Contatos criados pela IA ({filteredItems.created.length})
          </h3>
          <ScrollArea className="max-h-[400px]">
            <div className="space-y-1.5">
              {filteredItems.created.map(r => (
                <Card key={`${r.type}-${r.id}`} className="hover:shadow-sm transition-shadow">
                  <CardContent className="p-3 flex items-center gap-3">
                    <div className={`p-1.5 rounded-full ${r.type === 'lead' ? 'bg-green-100 dark:bg-green-950/40' : 'bg-blue-100 dark:bg-blue-950/40'}`}>
                      {r.type === 'lead' ? <Briefcase className="h-3.5 w-3.5 text-green-600" /> : <User className="h-3.5 w-3.5 text-blue-600" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm truncate">{r.name}</span>
                        <Badge variant={r.type === 'lead' ? 'default' : 'secondary'} className="text-[9px] shrink-0">
                          {r.type === 'lead' ? 'Lead' : 'Contato'}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 text-[10px] text-muted-foreground mt-0.5">
                        {r.phone && (
                          <span className="flex items-center gap-0.5">
                            <Phone className="h-2.5 w-2.5" /> {r.phone}
                          </span>
                        )}
                        {(r.city || r.state) && (
                          <span className="flex items-center gap-0.5">
                            <MapPin className="h-2.5 w-2.5" /> {[r.city, r.state].filter(Boolean).join('/')}
                          </span>
                        )}
                        {r.action_source_detail && (
                          <span className="text-primary">{r.action_source_detail}</span>
                        )}
                      </div>
                    </div>
                    <div className="text-[10px] text-muted-foreground whitespace-nowrap flex items-center gap-1">
                      <Clock className="h-2.5 w-2.5" />
                      {format(new Date(r.created_at), "dd/MM HH:mm", { locale: ptBR })}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </ScrollArea>
        </div>
      )}

      {/* Enrichment Logs */}
      {(viewMode === 'all' || viewMode === 'enriched') && filteredItems.enriched.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-amber-500" />
            Enriquecimentos pela IA ({filteredItems.enriched.length})
          </h3>
          <ScrollArea className="max-h-[400px]">
            <div className="space-y-1.5">
              {filteredItems.enriched.map(e => {
                const fields = Object.keys(e.fields_updated || {});
                return (
                  <Card
                    key={e.id}
                    className="hover:shadow-sm transition-shadow cursor-pointer"
                    onClick={() => setSelectedLog(e)}
                  >
                    <CardContent className="p-3 flex items-center gap-3">
                      <div className="p-1.5 rounded-full bg-amber-100 dark:bg-amber-950/40">
                        <Sparkles className="h-3.5 w-3.5 text-amber-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">{e.phone}</span>
                          <Badge variant="outline" className="text-[9px]">{e.instance_name}</Badge>
                        </div>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {fields.slice(0, 5).map(f => (
                            <Badge key={f} variant="secondary" className="text-[8px] py-0">
                              {fieldLabels[f] || f}
                            </Badge>
                          ))}
                          {fields.length > 5 && (
                            <Badge variant="secondary" className="text-[8px] py-0">+{fields.length - 5}</Badge>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="text-right">
                          <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                            <Clock className="h-2.5 w-2.5" />
                            {format(new Date(e.created_at), "dd/MM HH:mm", { locale: ptBR })}
                          </p>
                          <p className="text-[10px] font-medium text-amber-600">{fields.length} campos</p>
                        </div>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </ScrollArea>
        </div>
      )}

      {filteredItems.created.length === 0 && filteredItems.enriched.length === 0 && !loading && (
        <div className="text-center py-12 text-muted-foreground">
          <Sparkles className="h-8 w-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm">Nenhum registro de IA encontrado neste período</p>
        </div>
      )}

      {/* Detail Dialog */}
      <Dialog open={!!selectedLog} onOpenChange={open => { if (!open) setSelectedLog(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-amber-500" />
              Dados Extraídos
            </DialogTitle>
          </DialogHeader>
          {selectedLog && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Phone className="h-3.5 w-3.5" /> {selectedLog.phone}
                <Badge variant="outline" className="text-[9px]">{selectedLog.instance_name}</Badge>
                <span className="ml-auto text-xs">
                  {format(new Date(selectedLog.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                </span>
              </div>
              <div className="grid gap-2">
                {Object.entries(selectedLog.fields_updated || {}).map(([key, value]) => (
                  <div key={key} className="flex items-start gap-2 text-sm border-b border-border/50 pb-1.5">
                    <span className="text-muted-foreground min-w-[110px] text-xs font-medium">
                      {fieldLabels[key] || key}
                    </span>
                    <span className="text-foreground text-xs break-all">{String(value)}</span>
                  </div>
                ))}
              </div>
              <div className="flex gap-2 text-[10px] text-muted-foreground pt-1">
                {selectedLog.lead_id && <Badge variant="default" className="text-[9px]">Lead vinculado</Badge>}
                {selectedLog.contact_id && <Badge variant="secondary" className="text-[9px]">Contato vinculado</Badge>}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
