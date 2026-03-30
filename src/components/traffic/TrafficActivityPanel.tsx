import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuthContext } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { format, subDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  Loader2, Save, RefreshCw, TrendingUp, Users, Image,
  DollarSign, Eye, MousePointer, Calendar, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';

interface MetaDailyMetric {
  id: string;
  user_id: string;
  metric_date: string;
  account_id: string | null;
  leads_received: number;
  leads_qualified: number;
  creatives_active: number;
  spend: number;
  impressions: number;
  clicks: number;
  manual_creatives_uploaded: number;
  notes: string | null;
  what_worked: string | null;
  next_actions: string | null;
}

export function TrafficActivityPanel() {
  const { user } = useAuthContext();
  const [metrics, setMetrics] = useState<MetaDailyMetric[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [editForm, setEditForm] = useState({
    notes: '',
    what_worked: '',
    next_actions: '',
    manual_creatives_uploaded: 0,
  });

  const dateStr = format(selectedDate, 'yyyy-MM-dd');

  const fetchMetrics = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('meta_daily_metrics')
        .select('*')
        .eq('metric_date', dateStr)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setMetrics((data as any[]) || []);

      // Pre-fill edit form with existing data
      if (data && data.length > 0) {
        const first = data[0] as any;
        setEditForm({
          notes: first.notes || '',
          what_worked: first.what_worked || '',
          next_actions: first.next_actions || '',
          manual_creatives_uploaded: first.manual_creatives_uploaded || 0,
        });
      } else {
        setEditForm({ notes: '', what_worked: '', next_actions: '', manual_creatives_uploaded: 0 });
      }
    } catch (err) {
      console.error('Error fetching meta metrics:', err);
    } finally {
      setLoading(false);
    }
  }, [user?.id, dateStr]);

  useEffect(() => { fetchMetrics(); }, [fetchMetrics]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const { data, error } = await cloudFunctions.invoke('meta-daily-sync', {
        body: { date: dateStr, user_id: user?.id },
      });
      if (error) throw error;
      toast.success(`Sincronizado! ${data?.synced || 0} contas processadas.`);
      fetchMetrics();
    } catch (err: any) {
      toast.error('Erro ao sincronizar: ' + (err.message || 'Erro desconhecido'));
    } finally {
      setSyncing(false);
    }
  };

  const handleSave = async () => {
    if (!user?.id) return;
    setSaving(true);
    try {
      if (metrics.length > 0) {
        // Update existing record(s) with editable fields
        for (const m of metrics) {
          const { error } = await supabase
            .from('meta_daily_metrics')
            .update({
              notes: editForm.notes,
              what_worked: editForm.what_worked,
              next_actions: editForm.next_actions,
              manual_creatives_uploaded: editForm.manual_creatives_uploaded,
            })
            .eq('id', m.id);
          if (error) throw error;
        }
      } else {
        // Create new record for today
        const { error } = await supabase
          .from('meta_daily_metrics')
          .insert({
            user_id: user.id,
            metric_date: dateStr,
            notes: editForm.notes,
            what_worked: editForm.what_worked,
            next_actions: editForm.next_actions,
            manual_creatives_uploaded: editForm.manual_creatives_uploaded,
          } as any);
        if (error) throw error;
      }
      toast.success('Salvo com sucesso!');
      fetchMetrics();
    } catch (err: any) {
      toast.error('Erro ao salvar: ' + (err.message || 'Erro desconhecido'));
    } finally {
      setSaving(false);
    }
  };

  // Aggregated metrics
  const totals = metrics.reduce(
    (acc, m) => ({
      leads_received: acc.leads_received + m.leads_received,
      leads_qualified: acc.leads_qualified + m.leads_qualified,
      creatives_active: acc.creatives_active + m.creatives_active,
      spend: acc.spend + Number(m.spend || 0),
      impressions: acc.impressions + m.impressions,
      clicks: acc.clicks + m.clicks,
    }),
    { leads_received: 0, leads_qualified: 0, creatives_active: 0, spend: 0, impressions: 0, clicks: 0 }
  );

  return (
    <div className="space-y-4">
      {/* Date Navigation */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => setSelectedDate(d => subDays(d, 1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-2 px-3 py-1.5 bg-muted rounded-md">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium text-sm">
              {format(selectedDate, "dd 'de' MMMM, yyyy", { locale: ptBR })}
            </span>
          </div>
          <Button variant="outline" size="icon" onClick={() => setSelectedDate(d => subDays(d, -1))}
            disabled={format(selectedDate, 'yyyy-MM-dd') >= format(new Date(), 'yyyy-MM-dd')}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing}>
          {syncing ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RefreshCw className="h-4 w-4 mr-1" />}
          Sincronizar Meta
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <Tabs defaultValue="metrics">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="metrics">📊 Métricas</TabsTrigger>
            <TabsTrigger value="notes">📝 Anotações</TabsTrigger>
          </TabsList>

          <TabsContent value="metrics" className="space-y-4">
            {/* Auto metrics cards */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <MetricCard icon={<Users className="h-4 w-4" />} label="Leads Recebidos" value={totals.leads_received} color="text-blue-500" />
              <MetricCard icon={<TrendingUp className="h-4 w-4" />} label="Leads Qualificados" value={totals.leads_qualified} color="text-green-500" />
              <MetricCard icon={<Image className="h-4 w-4" />} label="Criativos Ativos" value={totals.creatives_active} color="text-purple-500" />
              <MetricCard icon={<DollarSign className="h-4 w-4" />} label="Investimento" value={`R$ ${totals.spend.toFixed(2)}`} color="text-amber-500" />
              <MetricCard icon={<Eye className="h-4 w-4" />} label="Impressões" value={totals.impressions.toLocaleString()} color="text-cyan-500" />
              <MetricCard icon={<MousePointer className="h-4 w-4" />} label="Cliques" value={totals.clicks.toLocaleString()} color="text-orange-500" />
            </div>

            {/* Manual creatives */}
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center gap-3">
                  <label className="text-sm font-medium whitespace-nowrap">Criativos Subidos (manual):</label>
                  <Input
                    type="number"
                    min={0}
                    value={editForm.manual_creatives_uploaded}
                    onChange={e => setEditForm(f => ({ ...f, manual_creatives_uploaded: parseInt(e.target.value) || 0 }))}
                    className="w-24"
                  />
                </div>
              </CardContent>
            </Card>

            {metrics.length === 0 && (
              <div className="text-center py-4 text-sm text-muted-foreground">
                Nenhuma métrica automática para esta data. Clique em "Sincronizar Meta" ou preencha manualmente.
              </div>
            )}
          </TabsContent>

          <TabsContent value="notes" className="space-y-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">📋 O que eu fiz hoje</CardTitle>
              </CardHeader>
              <CardContent>
                <Textarea
                  placeholder="Descreva as ações de tráfego pago realizadas hoje..."
                  value={editForm.notes}
                  onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))}
                  rows={3}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">✅ O que está dando certo</CardTitle>
              </CardHeader>
              <CardContent>
                <Textarea
                  placeholder="Registre insights e estratégias que estão funcionando..."
                  value={editForm.what_worked}
                  onChange={e => setEditForm(f => ({ ...f, what_worked: e.target.value }))}
                  rows={3}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">🎯 Próximos passos</CardTitle>
              </CardHeader>
              <CardContent>
                <Textarea
                  placeholder="O que planejar para os próximos dias..."
                  value={editForm.next_actions}
                  onChange={e => setEditForm(f => ({ ...f, next_actions: e.target.value }))}
                  rows={3}
                />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}

      {/* Save button */}
      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
          Salvar
        </Button>
      </div>
    </div>
  );
}

function MetricCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string | number; color: string }) {
  return (
    <Card>
      <CardContent className="pt-3 pb-3 px-3">
        <div className="flex items-center gap-1.5 mb-1">
          <span className={color}>{icon}</span>
          <span className="text-xs text-muted-foreground truncate">{label}</span>
        </div>
        <p className="text-lg font-bold">{value}</p>
      </CardContent>
    </Card>
  );
}
