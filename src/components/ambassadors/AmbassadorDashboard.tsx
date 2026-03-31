import { useMemo } from 'react';
import { useAmbassadors } from '@/hooks/useAmbassadors';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Users, Trophy, TrendingUp, Target } from 'lucide-react';
import { Loader2 } from 'lucide-react';
import { Progress } from '@/components/ui/progress';

export function AmbassadorDashboard() {
  const { ambassadors, campaigns, referrals, loading } = useAmbassadors();

  const stats = useMemo(() => {
    const totalAmbassadors = ambassadors.length;
    const activeCampaigns = campaigns.filter(c => c.is_active).length;
    const totalReferrals = referrals.length;
    const convertedReferrals = referrals.filter(r => r.status === 'converted').length;
    const conversionRate = totalReferrals > 0 ? Math.round((convertedReferrals / totalReferrals) * 100) : 0;

    return { totalAmbassadors, activeCampaigns, totalReferrals, convertedReferrals, conversionRate };
  }, [ambassadors, campaigns, referrals]);

  const campaignProgress = useMemo(() => {
    return campaigns.filter(c => c.is_active).map(campaign => {
      const campaignReferrals = referrals.filter(r => r.campaign_id === campaign.id);
      const captured = campaignReferrals.length;
      const converted = campaignReferrals.filter(r => r.status === 'converted').length;
      const metricValue = campaign.metric_key === 'leads_converted' ? converted : captured;
      const progress = campaign.target_value > 0 ? Math.round((metricValue / campaign.target_value) * 100) : 0;
      const aboveThreshold = progress >= campaign.min_threshold_percent;

      let reward = 0;
      if (aboveThreshold) {
        if (progress >= 100 && campaign.accelerator_multiplier) {
          const excess = metricValue - campaign.target_value;
          reward = campaign.reward_value + (excess * (campaign.reward_value / campaign.target_value) * campaign.accelerator_multiplier);
          if (campaign.cap_percent) {
            reward = Math.min(reward, campaign.reward_value * (campaign.cap_percent / 100));
          }
        } else {
          reward = campaign.reward_value * (progress / 100);
        }
      }

      return { campaign, captured, converted, progress, reward: Math.round(reward * 100) / 100, aboveThreshold };
    });
  }, [campaigns, referrals]);

  if (loading) {
    return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center gap-2 mb-1">
              <Users className="h-4 w-4 text-primary" />
              <span className="text-xs text-muted-foreground">Embaixadores</span>
            </div>
            <p className="text-2xl font-bold">{stats.totalAmbassadors}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center gap-2 mb-1">
              <Trophy className="h-4 w-4 text-amber-500" />
              <span className="text-xs text-muted-foreground">Campanhas Ativas</span>
            </div>
            <p className="text-2xl font-bold">{stats.activeCampaigns}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="h-4 w-4 text-green-500" />
              <span className="text-xs text-muted-foreground">Total Indicações</span>
            </div>
            <p className="text-2xl font-bold">{stats.totalReferrals}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-center gap-2 mb-1">
              <Target className="h-4 w-4 text-blue-500" />
              <span className="text-xs text-muted-foreground">Taxa Conversão</span>
            </div>
            <p className="text-2xl font-bold">{stats.conversionRate}%</p>
          </CardContent>
        </Card>
      </div>

      {/* Campaign progress */}
      {campaignProgress.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Progresso das Campanhas</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {campaignProgress.map(({ campaign, captured, converted, progress, reward, aboveThreshold }) => (
              <div key={campaign.id} className="space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">{campaign.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {captured} captados · {converted} convertidos · Meta: {campaign.target_value}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className={`text-sm font-bold ${aboveThreshold ? 'text-green-600' : 'text-muted-foreground'}`}>
                      R$ {reward.toFixed(2)}
                    </p>
                    <p className="text-xs text-muted-foreground">{progress}%</p>
                  </div>
                </div>
                <Progress value={Math.min(progress, 100)} className="h-2" />
                {!aboveThreshold && progress > 0 && (
                  <p className="text-xs text-amber-600">
                    Mínimo de {campaign.min_threshold_percent}% para receber recompensa
                  </p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {campaignProgress.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground text-sm">
            Nenhuma campanha ativa. Crie uma campanha na aba "Campanhas & Metas".
          </CardContent>
        </Card>
      )}
    </div>
  );
}
