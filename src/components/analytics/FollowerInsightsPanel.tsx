import { useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, Users, DollarSign, TrendingUp, BarChart3, Eye, MousePointerClick, RefreshCw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { getMetaCredentials } from '@/utils/metaCredentials';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface InsightRow {
  campaign_id: string;
  campaign_name: string;
  ad_id: string | null;
  ad_name: string | null;
  spend: number;
  impressions: number;
  reach: number;
  followers: number;
  page_engagement: number;
  post_engagement: number;
  link_clicks: number;
  cps: number | null;
}

const DATE_PRESETS = [
  { value: 'last_7d', label: 'Últimos 7 dias' },
  { value: 'last_14d', label: 'Últimos 14 dias' },
  { value: 'last_30d', label: 'Últimos 30 dias' },
  { value: 'last_90d', label: 'Últimos 90 dias' },
  { value: 'this_month', label: 'Este mês' },
  { value: 'last_month', label: 'Mês passado' },
];

export function FollowerInsightsPanel() {
  const [datePreset, setDatePreset] = useState('last_30d');
  const [level, setLevel] = useState<'campaign' | 'ad'>('campaign');
  const [data, setData] = useState<InsightRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const { accessToken, adAccountId } = await getMetaCredentials();
      if (!accessToken || !adAccountId) {
        toast.error('Conecte sua conta Meta primeiro nas Configurações de Anúncios.');
        return;
      }

      const { data: result, error } = await supabase.functions.invoke('meta-follower-insights', {
        body: {
          access_token: accessToken,
          ad_account_id: adAccountId,
          date_preset: datePreset,
          level,
        },
      });

      if (error) throw error;
      if (result?.error) {
        toast.error(result.error);
        return;
      }

      setData(result?.data || []);
      setLoaded(true);
    } catch (err: any) {
      console.error('Follower insights error:', err);
      toast.error('Erro ao buscar métricas de seguidores');
    } finally {
      setLoading(false);
    }
  }, [datePreset, level]);

  const totalFollowers = data.reduce((s, r) => s + r.followers, 0);
  const totalSpend = data.reduce((s, r) => s + r.spend, 0);
  const avgCps = totalFollowers > 0 ? totalSpend / totalFollowers : 0;
  const totalReach = data.reduce((s, r) => s + r.reach, 0);

  const fmt = (n: number) => n.toLocaleString('pt-BR');
  const fmtCurrency = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={datePreset} onValueChange={setDatePreset}>
          <SelectTrigger className="w-[180px] h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DATE_PRESETS.map(p => (
              <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Tabs value={level} onValueChange={(v) => setLevel(v as 'campaign' | 'ad')} className="h-9">
          <TabsList className="h-9">
            <TabsTrigger value="campaign" className="text-xs h-7">Por Campanha</TabsTrigger>
            <TabsTrigger value="ad" className="text-xs h-7">Por Anúncio</TabsTrigger>
          </TabsList>
        </Tabs>

        <Button onClick={fetchData} disabled={loading} size="sm" className="gap-1.5">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          {loaded ? 'Atualizar' : 'Carregar Métricas'}
        </Button>
      </div>

      {/* Summary Cards */}
      {loaded && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card>
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                <Users className="h-3.5 w-3.5" />
                Total Seguidores
              </div>
              <p className="text-2xl font-bold">{fmt(totalFollowers)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                <DollarSign className="h-3.5 w-3.5" />
                Investimento Total
              </div>
              <p className="text-2xl font-bold">{fmtCurrency(totalSpend)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                <TrendingUp className="h-3.5 w-3.5" />
                CPS Médio
              </div>
              <p className="text-2xl font-bold">{avgCps > 0 ? fmtCurrency(avgCps) : '—'}</p>
              <p className="text-[10px] text-muted-foreground">Custo por Seguidor</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                <Eye className="h-3.5 w-3.5" />
                Alcance Total
              </div>
              <p className="text-2xl font-bold">{fmt(totalReach)}</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Table */}
      {loaded && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              {level === 'campaign' ? 'Total por Campanha' : 'Total por Anúncio'}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {data.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">Nenhum dado encontrado para o período selecionado.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="text-left px-3 py-2 font-medium">{level === 'campaign' ? 'Campanha' : 'Anúncio'}</th>
                      {level === 'ad' && <th className="text-left px-3 py-2 font-medium">Campanha</th>}
                      <th className="text-right px-3 py-2 font-medium">Seguidores</th>
                      <th className="text-right px-3 py-2 font-medium">Engajamento</th>
                      <th className="text-right px-3 py-2 font-medium">Cliques</th>
                      <th className="text-right px-3 py-2 font-medium">Alcance</th>
                      <th className="text-right px-3 py-2 font-medium">Gasto</th>
                      <th className="text-right px-3 py-2 font-medium">CPS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.map((row, i) => (
                      <tr key={row.ad_id || row.campaign_id + '-' + i} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                        <td className="px-3 py-2 max-w-[200px] truncate font-medium">
                          {level === 'ad' ? row.ad_name : row.campaign_name}
                        </td>
                        {level === 'ad' && (
                          <td className="px-3 py-2 max-w-[150px] truncate text-muted-foreground">{row.campaign_name}</td>
                        )}
                        <td className="text-right px-3 py-2">
                          <Badge variant={row.followers > 0 ? 'default' : 'secondary'} className="text-[10px]">
                            {fmt(row.followers)}
                          </Badge>
                        </td>
                        <td className="text-right px-3 py-2">{fmt(row.page_engagement)}</td>
                        <td className="text-right px-3 py-2">{fmt(row.link_clicks)}</td>
                        <td className="text-right px-3 py-2">{fmt(row.reach)}</td>
                        <td className="text-right px-3 py-2">{fmtCurrency(row.spend)}</td>
                        <td className="text-right px-3 py-2 font-medium">
                          <span className={cn(
                            row.cps !== null && row.cps <= 2 ? 'text-green-600 dark:text-green-400' :
                            row.cps !== null && row.cps <= 5 ? 'text-yellow-600 dark:text-yellow-400' :
                            row.cps !== null ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'
                          )}>
                            {row.cps !== null ? fmtCurrency(row.cps) : '—'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Initial state */}
      {!loaded && !loading && (
        <Card>
          <CardContent className="py-12 text-center">
            <Users className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">
              Clique em <strong>Carregar Métricas</strong> para ver os dados de seguidores por {level === 'campaign' ? 'campanha' : 'anúncio'}.
            </p>
            <p className="text-xs text-muted-foreground/70 mt-1">
              Dados obtidos via Meta Marketing API Insights
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}