import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowLeft, Edit, Users, Briefcase, DollarSign, TrendingUp, TrendingDown } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { db } from '@/integrations/supabase';
import { useCampaign, useCampaignMetrics, type CampaignStatus } from '@/hooks/useCampaigns';
import CampaignForm from '@/components/campaigns/CampaignForm';

const STATUS_META: Record<CampaignStatus, { label: string; color: string }> = {
  draft: { label: 'Rascunho', color: 'bg-slate-500' },
  active: { label: 'Ativa', color: 'bg-emerald-500' },
  paused: { label: 'Pausada', color: 'bg-amber-500' },
  closed: { label: 'Encerrada', color: 'bg-zinc-500' },
};

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const client = db as any;

export default function CampaignDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: campaign, isLoading } = useCampaign(id);
  const { data: metricsList = [] } = useCampaignMetrics(id);
  const metrics = metricsList[0];
  const [editOpen, setEditOpen] = useState(false);

  const { data: leads = [] } = useQuery({
    queryKey: ['campaign_leads', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await client
        .from('leads')
        .select('id, lead_name, lead_phone, lead_status, status, board_id, acolhedor, created_at')
        .eq('crm_campaign_id', id)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: activities = [] } = useQuery({
    queryKey: ['campaign_activities', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await client
        .from('lead_activities')
        .select('id, title, activity_type, status, deadline, assigned_to_name, created_at')
        .eq('crm_campaign_id', id)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });

  if (isLoading) return <div className="p-6">Carregando...</div>;
  if (!campaign) return <div className="p-6">Campanha não encontrada.</div>;

  const roi = metrics?.roi;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <Button variant="ghost" size="sm" onClick={() => navigate('/campanhas')}>
        <ArrowLeft className="h-4 w-4 mr-2" /> Voltar
      </Button>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{campaign.name}</h1>
            <Badge className={`${STATUS_META[campaign.status].color} text-white`}>{STATUS_META[campaign.status].label}</Badge>
          </div>
          {campaign.description && <p className="text-sm text-muted-foreground mt-1">{campaign.description}</p>}
          {(campaign.start_date || campaign.end_date) && (
            <p className="text-xs text-muted-foreground mt-1">
              {campaign.start_date || '—'} → {campaign.end_date || '—'}
            </p>
          )}
        </div>
        <Button variant="outline" onClick={() => setEditOpen(true)}><Edit className="h-4 w-4 mr-2" />Editar</Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground flex items-center gap-1"><Users className="h-3 w-3" />Leads</div><div className="text-xl font-bold">{metrics?.leads_count ?? 0}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground flex items-center gap-1"><Briefcase className="h-3 w-3" />Casos</div><div className="text-xl font-bold">{metrics?.cases_count ?? 0}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Processos</div><div className="text-xl font-bold">{metrics?.processes_count ?? 0}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Investido</div><div className="text-lg font-bold">{brl(Number(campaign.investment_total) || 0)}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Honorários</div><div className="text-lg font-bold text-emerald-600">{brl(Number(metrics?.honorarios_total) || 0)}</div></CardContent></Card>
      </div>

      <Card>
        <CardContent className="p-4 grid grid-cols-2 md:grid-cols-3 gap-4">
          <div>
            <div className="text-xs text-muted-foreground">CAC (custo por lead)</div>
            <div className="text-lg font-bold">{brl(Number(metrics?.cac) || 0)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">LTV por lead</div>
            <div className="text-lg font-bold">{brl(Number(metrics?.ltv_por_lead) || 0)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">ROI</div>
            <div className={`text-lg font-bold flex items-center gap-1 ${roi != null && roi >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
              {roi == null ? '—' : (<>{roi >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}{(roi * 100).toFixed(1)}%</>)}
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="leads">
        <TabsList>
          <TabsTrigger value="leads">Leads ({leads.length})</TabsTrigger>
          <TabsTrigger value="activities">Atividades ({activities.length})</TabsTrigger>
          <TabsTrigger value="workflow">POP</TabsTrigger>
        </TabsList>

        <TabsContent value="leads" className="space-y-2">
          {leads.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground border-2 border-dashed rounded-lg">
              Nenhum lead vinculado ainda. Marque leads como pertencentes a esta campanha na tela do lead.
            </div>
          ) : leads.map((l: any) => (
            <Card key={l.id} className="cursor-pointer hover:shadow" onClick={() => navigate(`/leads?id=${l.id}`)}>
              <CardContent className="p-3 flex items-center justify-between">
                <div>
                  <div className="font-medium">{l.lead_name}</div>
                  <div className="text-xs text-muted-foreground">{l.lead_phone} · {l.acolhedor || 'sem acolhedor'}</div>
                </div>
                <Badge variant="outline">{l.lead_status || '—'}</Badge>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="activities" className="space-y-2">
          {activities.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground border-2 border-dashed rounded-lg">
              Nenhuma atividade vinculada. Crie atividades marcando esta campanha no formulário.
            </div>
          ) : activities.map((a: any) => (
            <Card key={a.id}>
              <CardContent className="p-3 flex items-center justify-between">
                <div>
                  <div className="font-medium">{a.title}</div>
                  <div className="text-xs text-muted-foreground">{a.activity_type} · {a.assigned_to_name || '—'} · prazo: {a.deadline || '—'}</div>
                </div>
                <Badge variant="outline">{a.status}</Badge>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="workflow">
          {campaign.board_id ? (
            <div className="p-4 border rounded-lg">
              <p className="text-sm mb-3">POP vinculado: acompanhe pela página de progresso.</p>
              <Button onClick={() => navigate(`/workflow-progress?board=${campaign.board_id}`)}>Abrir POP</Button>
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground border-2 border-dashed rounded-lg">
              Nenhum fluxo vinculado. Edite a campanha para escolher um.
            </div>
          )}
        </TabsContent>
      </Tabs>

      <CampaignForm open={editOpen} onOpenChange={setEditOpen} campaign={campaign} />
    </div>
  );
}
