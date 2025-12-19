import { useState, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Plus, 
  Users, 
  DollarSign, 
  TrendingUp, 
  Phone,
  Mail,
  Edit2,
  Trash2,
  CheckCircle2,
  XCircle,
  Clock,
  MessageSquare,
  Target,
  AlertCircle,
  LayoutGrid,
  TableIcon,
  Download,
  Loader2,
  Facebook,
  Upload,
  FileSpreadsheet
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useLeads, Lead, LeadStatus } from '@/hooks/useLeads';
import { CampaignInsight } from '@/services/metaAPI';
import LeadsPipeline from './LeadsPipeline';

interface LeadManagerProps {
  adAccountId?: string;
  campaigns?: CampaignInsight[];
  totalSpend?: number;
}

const statusConfig: Record<LeadStatus, { label: string; color: string; icon: React.ReactNode }> = {
  new: { label: 'Novo', color: 'bg-blue-500', icon: <Clock className="h-3 w-3" /> },
  contacted: { label: 'Contatado', color: 'bg-yellow-500', icon: <MessageSquare className="h-3 w-3" /> },
  qualified: { label: 'Qualificado', color: 'bg-green-500', icon: <Target className="h-3 w-3" /> },
  not_qualified: { label: 'Não Qualificado', color: 'bg-gray-500', icon: <XCircle className="h-3 w-3" /> },
  converted: { label: 'Convertido', color: 'bg-emerald-600', icon: <CheckCircle2 className="h-3 w-3" /> },
  lost: { label: 'Perdido', color: 'bg-red-500', icon: <XCircle className="h-3 w-3" /> },
};

const LeadManager = ({ adAccountId, campaigns = [], totalSpend = 0 }: LeadManagerProps) => {
  const { leads, stats, loading, addLead, updateLead, deleteLead, updateLeadStatus, fetchLeads } = useLeads(adAccountId);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [editingLead, setEditingLead] = useState<Lead | null>(null);
  const [viewMode, setViewMode] = useState<'pipeline' | 'table'>('pipeline');
  const [isImporting, setIsImporting] = useState(false);
  const [csvPreview, setCsvPreview] = useState<any[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [newLead, setNewLead] = useState({
    lead_name: '',
    lead_phone: '',
    lead_email: '',
    campaign_id: '',
    campaign_name: '',
    notes: '',
    ad_spend_at_conversion: 0,
  });
  const [testEventCode, setTestEventCode] = useState('');

  const handleImportFacebookLeads = async () => {
    if (!adAccountId) {
      toast.error('Ad Account ID não configurado. Vá em Configurações para conectar sua conta do Meta.');
      return;
    }

    setIsImporting(true);
    try {
      const { data, error } = await supabase.functions.invoke('fetch-facebook-leads', {
        body: { adAccountId }
      });

      if (error) {
        console.error('Error importing leads:', error);
        toast.error('Erro ao importar leads do Facebook');
        return;
      }

      if (data.error) {
        console.error('API error:', data.error);
        toast.error(`Erro: ${data.error}`);
        return;
      }

      toast.success(`Importação concluída! ${data.imported} novos leads, ${data.duplicates} já existentes.`);
      fetchLeads();
    } catch (error) {
      console.error('Error:', error);
      toast.error('Erro ao importar leads');
    } finally {
      setIsImporting(false);
    }
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const lines = text.split('\n').filter(line => line.trim());
        
        if (lines.length < 2) {
          toast.error('O arquivo CSV precisa ter pelo menos uma linha de dados além do cabeçalho');
          return;
        }

        // Parse header
        const header = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/"/g, ''));
        
        // Find column indices - support multiple column name variations
        const findColumn = (names: string[]) => {
          return header.findIndex(h => names.some(n => h.includes(n)));
        };

        const nameIdx = findColumn(['full_name', 'full name', 'nome', 'name', 'lead_name']);
        const emailIdx = findColumn(['email', 'e-mail', 'lead_email']);
        const phoneIdx = findColumn(['phone', 'phone_number', 'telefone', 'lead_phone', 'whatsapp']);
        const campaignIdx = findColumn(['campaign', 'campanha', 'campaign_name']);
        const adsetIdx = findColumn(['adset', 'ad set', 'conjunto', 'adset_name']);
        const leadIdIdx = findColumn(['lead_id', 'facebook_lead_id', 'id']);

        // Parse data rows
        const parsedLeads = lines.slice(1).map(line => {
          // Handle CSV with quoted values
          const values: string[] = [];
          let current = '';
          let inQuotes = false;
          
          for (const char of line) {
            if (char === '"') {
              inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
              values.push(current.trim());
              current = '';
            } else {
              current += char;
            }
          }
          values.push(current.trim());

          return {
            lead_name: nameIdx >= 0 ? values[nameIdx]?.replace(/"/g, '') : '',
            lead_email: emailIdx >= 0 ? values[emailIdx]?.replace(/"/g, '') : '',
            lead_phone: phoneIdx >= 0 ? values[phoneIdx]?.replace(/"/g, '') : '',
            campaign_name: campaignIdx >= 0 ? values[campaignIdx]?.replace(/"/g, '') : '',
            adset_name: adsetIdx >= 0 ? values[adsetIdx]?.replace(/"/g, '') : '',
            facebook_lead_id: leadIdIdx >= 0 ? values[leadIdIdx]?.replace(/"/g, '') : '',
          };
        }).filter(lead => lead.lead_name || lead.lead_email || lead.lead_phone);

        if (parsedLeads.length === 0) {
          toast.error('Nenhum lead válido encontrado no arquivo. Verifique as colunas.');
          return;
        }

        setCsvPreview(parsedLeads);
        setIsImportDialogOpen(true);
        toast.success(`${parsedLeads.length} leads encontrados no arquivo`);
      } catch (error) {
        console.error('Error parsing CSV:', error);
        toast.error('Erro ao processar o arquivo CSV');
      }
    };
    reader.readAsText(file);
    
    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleImportCSV = async () => {
    if (csvPreview.length === 0) return;

    setIsImporting(true);
    let imported = 0;
    let errors = 0;

    for (const lead of csvPreview) {
      try {
        const { error } = await supabase
          .from('leads')
          .insert({
            ...lead,
            ad_account_id: adAccountId,
            source: 'facebook',
            status: 'new',
            sync_status: 'synced',
          });

        if (error) {
          console.error('Error inserting lead:', error);
          errors++;
        } else {
          imported++;
        }
      } catch (error) {
        console.error('Error:', error);
        errors++;
      }
    }

    setIsImporting(false);
    setCsvPreview([]);
    setIsImportDialogOpen(false);
    fetchLeads();

    if (errors > 0) {
      toast.warning(`Importação concluída: ${imported} leads importados, ${errors} erros`);
    } else {
      toast.success(`${imported} leads importados com sucesso!`);
    }
  };

  const handleAddLead = async () => {
    if (!newLead.lead_name && !newLead.lead_phone) {
      return;
    }

    await addLead({
      ...newLead,
      source: 'whatsapp',
      status: 'new',
    }, testEventCode || undefined);

    setNewLead({
      lead_name: '',
      lead_phone: '',
      lead_email: '',
      campaign_id: '',
      campaign_name: '',
      notes: '',
      ad_spend_at_conversion: 0,
    });
    setIsAddDialogOpen(false);
  };

  const handleStatusChange = async (leadId: string, status: LeadStatus) => {
    if (status === 'converted') {
      const value = prompt('Qual foi o valor da conversão? (R$)');
      if (value) {
        await updateLeadStatus(leadId, status, parseFloat(value));
      }
    } else {
      await updateLeadStatus(leadId, status);
    }
  };

  const handleDeleteLead = async (id: string) => {
    if (confirm('Tem certeza que deseja remover este lead?')) {
      await deleteLead(id);
    }
  };

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Total</span>
            </div>
            <div className="text-2xl font-bold">{stats.total}</div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4 text-green-500" />
              <span className="text-xs text-muted-foreground">Qualificados</span>
            </div>
            <div className="text-2xl font-bold text-green-500">{stats.qualified}</div>
            <div className="text-xs text-muted-foreground">{stats.qualificationRate.toFixed(1)}%</div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              <span className="text-xs text-muted-foreground">Convertidos</span>
            </div>
            <div className="text-2xl font-bold text-emerald-600">{stats.converted}</div>
            <div className="text-xs text-muted-foreground">{stats.conversionRate.toFixed(1)}%</div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-primary" />
              <span className="text-xs text-muted-foreground">CPL</span>
            </div>
            <div className="text-2xl font-bold">R$ {stats.costPerLead.toFixed(2)}</div>
            <div className="text-xs text-muted-foreground">por lead</div>
          </CardContent>
        </Card>
        
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              <span className="text-xs text-muted-foreground">CPL Convertido</span>
            </div>
            <div className="text-2xl font-bold text-primary">
              R$ {stats.costPerConvertedLead > 0 ? stats.costPerConvertedLead.toFixed(2) : '—'}
            </div>
            <div className="text-xs text-muted-foreground">custo real por venda</div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-green-500" />
              <span className="text-xs text-muted-foreground">Receita</span>
            </div>
            <div className="text-2xl font-bold text-green-500">
              R$ {stats.totalRevenue.toLocaleString('pt-BR')}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Info Card */}
      <Card className="border-blue-500/30 bg-blue-500/5">
        <CardContent className="pt-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-blue-500 mt-0.5" />
            <div>
              <p className="font-medium text-sm">Custo por Lead Convertido (CPL Real)</p>
              <p className="text-xs text-muted-foreground mt-1">
                Este é o custo real por venda/conversão. Diferente do custo por clique ou lead do Facebook, 
                este valor considera apenas os leads que realmente compraram. 
                Use este número para calcular seu ROAS real e decidir se deve escalar campanhas.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Leads Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Leads do WhatsApp
              </CardTitle>
              <CardDescription>
                Registre e acompanhe seus leads para calcular o custo real por conversão
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {/* View Toggle */}
              <div className="flex items-center border rounded-lg p-1">
                <Button
                  variant={viewMode === 'pipeline' ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => setViewMode('pipeline')}
                  className="gap-1"
                >
                  <LayoutGrid className="h-4 w-4" />
                  Pipeline
                </Button>
                <Button
                  variant={viewMode === 'table' ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => setViewMode('table')}
                  className="gap-1"
                >
                  <TableIcon className="h-4 w-4" />
                  Tabela
                </Button>
              </div>

              {/* CSV Import */}
              <input
                type="file"
                accept=".csv"
                onChange={handleFileUpload}
                ref={fileInputRef}
                className="hidden"
              />
              <Button
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                className="gap-2"
              >
                <FileSpreadsheet className="h-4 w-4" />
                Importar CSV
              </Button>
              
              <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
                <DialogTrigger asChild>
                  <Button>
                    <Plus className="h-4 w-4 mr-2" />
                    Adicionar Lead
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Adicionar Novo Lead</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div>
                      <Label>Nome</Label>
                      <Input
                        placeholder="Nome do lead"
                        value={newLead.lead_name}
                        onChange={(e) => setNewLead({ ...newLead, lead_name: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label>Telefone (WhatsApp)</Label>
                      <Input
                        placeholder="(11) 99999-9999"
                        value={newLead.lead_phone}
                        onChange={(e) => setNewLead({ ...newLead, lead_phone: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label>Email (opcional)</Label>
                      <Input
                        type="email"
                        placeholder="email@exemplo.com"
                        value={newLead.lead_email}
                        onChange={(e) => setNewLead({ ...newLead, lead_email: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label>Campanha</Label>
                      <Select
                        value={newLead.campaign_id}
                        onValueChange={(value) => {
                          const campaign = campaigns.find(c => c.id === value);
                          setNewLead({ 
                            ...newLead, 
                            campaign_id: value,
                            campaign_name: campaign?.name || ''
                          });
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione a campanha" />
                        </SelectTrigger>
                        <SelectContent>
                          {campaigns.map((campaign) => (
                            <SelectItem key={campaign.id} value={campaign.id}>
                              {campaign.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Gasto em Ads (estimado)</Label>
                      <Input
                        type="number"
                        placeholder="0.00"
                        value={newLead.ad_spend_at_conversion}
                        onChange={(e) => setNewLead({ ...newLead, ad_spend_at_conversion: parseFloat(e.target.value) || 0 })}
                      />
                    </div>
                    <div>
                      <Label>Código de Teste (Facebook Events Manager)</Label>
                      <Input
                        placeholder="TEST12345"
                        value={testEventCode}
                        onChange={(e) => setTestEventCode(e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        Encontre em Events Manager → Test Events → Código de Teste
                      </p>
                    </div>
                    <div>
                      <Label>Observações</Label>
                      <Textarea
                        placeholder="Notas sobre o lead..."
                        value={newLead.notes}
                        onChange={(e) => setNewLead({ ...newLead, notes: e.target.value })}
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
                      Cancelar
                    </Button>
                    <Button onClick={handleAddLead}>
                      Adicionar
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              {/* CSV Import Preview Dialog */}
              <Dialog open={isImportDialogOpen} onOpenChange={setIsImportDialogOpen}>
                <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden flex flex-col">
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                      <FileSpreadsheet className="h-5 w-5" />
                      Importar Leads do CSV
                    </DialogTitle>
                  </DialogHeader>
                  <div className="flex-1 overflow-auto">
                    <p className="text-sm text-muted-foreground mb-4">
                      {csvPreview.length} leads encontrados. Confira os dados antes de importar:
                    </p>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Nome</TableHead>
                          <TableHead>Email</TableHead>
                          <TableHead>Telefone</TableHead>
                          <TableHead>Campanha</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {csvPreview.slice(0, 10).map((lead, idx) => (
                          <TableRow key={idx}>
                            <TableCell>{lead.lead_name || '—'}</TableCell>
                            <TableCell>{lead.lead_email || '—'}</TableCell>
                            <TableCell>{lead.lead_phone || '—'}</TableCell>
                            <TableCell>{lead.campaign_name || '—'}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    {csvPreview.length > 10 && (
                      <p className="text-xs text-muted-foreground mt-2 text-center">
                        ...e mais {csvPreview.length - 10} leads
                      </p>
                    )}
                  </div>
                  <DialogFooter className="mt-4">
                    <Button 
                      variant="outline" 
                      onClick={() => {
                        setIsImportDialogOpen(false);
                        setCsvPreview([]);
                      }}
                    >
                      Cancelar
                    </Button>
                    <Button onClick={handleImportCSV} disabled={isImporting}>
                      {isImporting ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Importando...
                        </>
                      ) : (
                        <>
                          <Upload className="h-4 w-4 mr-2" />
                          Importar {csvPreview.length} leads
                        </>
                      )}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {viewMode === 'pipeline' ? (
            <LeadsPipeline
              leads={leads}
              loading={loading}
              onStatusChange={handleStatusChange}
              onDeleteLead={handleDeleteLead}
            />
          ) : (
            <>
              {loading ? (
                <div className="text-center py-8 text-muted-foreground">Carregando leads...</div>
              ) : leads.length === 0 ? (
                <div className="text-center py-8">
                  <Users className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">Nenhum lead registrado ainda</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Adicione leads do WhatsApp para calcular seu custo real por conversão
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Lead</TableHead>
                        <TableHead>Contato</TableHead>
                        <TableHead>Campanha</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Valor</TableHead>
                        <TableHead>Data</TableHead>
                        <TableHead className="text-right">Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {leads.map((lead) => (
                        <TableRow key={lead.id}>
                          <TableCell>
                            <div className="font-medium">{lead.lead_name || 'Sem nome'}</div>
                            {lead.notes && (
                              <div className="text-xs text-muted-foreground truncate max-w-[150px]">
                                {lead.notes}
                              </div>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="space-y-1">
                              {lead.lead_phone && (
                                <div className="flex items-center gap-1 text-xs">
                                  <Phone className="h-3 w-3" />
                                  {lead.lead_phone}
                                </div>
                              )}
                              {lead.lead_email && (
                                <div className="flex items-center gap-1 text-xs">
                                  <Mail className="h-3 w-3" />
                                  {lead.lead_email}
                                </div>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <span className="text-xs">{lead.campaign_name || '—'}</span>
                          </TableCell>
                          <TableCell>
                            <Select
                              value={lead.status}
                              onValueChange={(value) => handleStatusChange(lead.id, value as LeadStatus)}
                            >
                              <SelectTrigger className="h-8 w-[140px]">
                                <SelectValue>
                                  <Badge className={`${statusConfig[lead.status].color} text-white`}>
                                    <span className="flex items-center gap-1">
                                      {statusConfig[lead.status].icon}
                                      {statusConfig[lead.status].label}
                                    </span>
                                  </Badge>
                                </SelectValue>
                              </SelectTrigger>
                              <SelectContent>
                                {Object.entries(statusConfig).map(([key, config]) => (
                                  <SelectItem key={key} value={key}>
                                    <span className="flex items-center gap-2">
                                      {config.icon}
                                      {config.label}
                                    </span>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell>
                            {lead.status === 'converted' && lead.conversion_value > 0 ? (
                              <span className="text-green-500 font-medium">
                                R$ {lead.conversion_value.toLocaleString('pt-BR')}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <span className="text-xs text-muted-foreground">
                              {new Date(lead.created_at).toLocaleDateString('pt-BR')}
                            </span>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleDeleteLead(lead.id)}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default LeadManager;
