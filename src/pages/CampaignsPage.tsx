import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Plus, TrendingUp, TrendingDown, Users, Briefcase, DollarSign, Search } from 'lucide-react';
import { useCampaigns, useCampaignMetrics, type CampaignStatus } from '@/hooks/useCampaigns';
import CampaignForm from '@/components/campaigns/CampaignForm';

const STATUS_META: Record<CampaignStatus, { label: string; color: string }> = {
  draft: { label: 'Rascunho', color: 'bg-slate-500' },
  active: { label: 'Ativa', color: 'bg-emerald-500' },
  paused: { label: 'Pausada', color: 'bg-amber-500' },
  closed: { label: 'Encerrada', color: 'bg-zinc-500' },
};

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function CampaignsPage() {
  const navigate = useNavigate();
  const { data: campaigns = [], isLoading } = useCampaigns();
  const { data: metrics = [] } = useCampaignMetrics();
  const [openForm, setOpenForm] = useState(false);
  const [search, setSearch] = useState('');

  const metricsById = useMemo(() => {
    const m = new Map<string, typeof metrics[number]>();
    metrics.forEach((x) => m.set(x.campaign_id, x));
    return m;
  }, [metrics]);

  const filtered = campaigns.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()));

  const totals = useMemo(() => {
    let inv = 0, hon = 0, leads = 0;
    metrics.forEach((m) => { inv += Number(m.investment_total) || 0; hon += Number(m.honorarios_total) || 0; leads += Number(m.leads_count) || 0; });
    return { inv, hon, leads, roi: inv > 0 ? (hon - inv) / inv : null };
  }, [metrics]);

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Campanhas</h1>
          <p className="text-sm text-muted-foreground">Redes de pesca: quanto custa, quantos leads traz e quanto rende.</p>
        </div>
        <Button onClick={() => setOpenForm(true)}>
          <Plus className="h-4 w-4 mr-2" /> Nova campanha
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Investido</div><div className="text-xl font-bold">{brl(totals.inv)}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Honorários</div><div className="text-xl font-bold text-emerald-600">{brl(totals.hon)}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Leads</div><div className="text-xl font-bold">{totals.leads}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">ROI geral</div><div className={`text-xl font-bold ${totals.roi != null && totals.roi >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{totals.roi == null ? '—' : `${(totals.roi * 100).toFixed(0)}%`}</div></CardContent></Card>
      </div>

      <div className="relative max-w-md">
        <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-9" placeholder="Buscar campanha..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Carregando...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground border-2 border-dashed rounded-lg">
          Nenhuma campanha ainda. Crie a primeira acima.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((c) => {
            const m = metricsById.get(c.id);
            const roi = m?.roi;
            return (
              <Card key={c.id} className="cursor-pointer hover:shadow-md transition" onClick={() => navigate(`/campanhas/${c.id}`)}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base">{c.name}</CardTitle>
                    <Badge className={`${STATUS_META[c.status].color} text-white`}>{STATUS_META[c.status].label}</Badge>
                  </div>
                  {c.description && <p className="text-xs text-muted-foreground line-clamp-2">{c.description}</p>}
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div>
                      <div className="text-lg font-bold flex items-center justify-center gap-1"><Users className="h-3 w-3" />{m?.leads_count ?? 0}</div>
                      <div className="text-[10px] text-muted-foreground">Leads</div>
                    </div>
                    <div>
                      <div className="text-lg font-bold flex items-center justify-center gap-1"><Briefcase className="h-3 w-3" />{m?.cases_count ?? 0}</div>
                      <div className="text-[10px] text-muted-foreground">Casos</div>
                    </div>
                    <div>
                      <div className="text-lg font-bold flex items-center justify-center gap-1 text-emerald-600"><DollarSign className="h-3 w-3" />{m?.processes_count ?? 0}</div>
                      <div className="text-[10px] text-muted-foreground">Processos</div>
                    </div>
                  </div>
                  <div className="pt-2 border-t space-y-1 text-xs">
                    <div className="flex justify-between"><span className="text-muted-foreground">Investido</span><span className="font-medium">{brl(Number(c.investment_total) || 0)}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Honorários</span><span className="font-medium text-emerald-600">{brl(Number(m?.honorarios_total) || 0)}</span></div>
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">ROI</span>
                      <span className={`font-bold flex items-center gap-1 ${roi != null && roi >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {roi == null ? '—' : (<>{roi >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}{(roi * 100).toFixed(0)}%</>)}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <CampaignForm open={openForm} onOpenChange={setOpenForm} />
    </div>
  );
}
