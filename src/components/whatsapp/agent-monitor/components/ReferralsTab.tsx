import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Heart, Clock, Phone, CheckCircle, XCircle } from 'lucide-react';
import { format } from 'date-fns';
import type { ReferralData } from '../types';

interface ReferralsTabProps {
  referrals: ReferralData[];
  loading: boolean;
}

export function ReferralsTab({ referrals, loading }: ReferralsTabProps) {
  const stats = useMemo(() => ({
    total: referrals.length,
    pending: referrals.filter(r => r.status === 'pending').length,
    contacted: referrals.filter(r => r.status === 'contacted').length,
    converted: referrals.filter(r => r.status === 'converted').length,
    lost: referrals.filter(r => r.status === 'lost').length,
  }), [referrals]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { icon: Heart, color: 'text-primary', value: stats.total, label: 'Total Indicações' },
          { icon: Clock, color: 'text-amber-500', value: stats.pending, label: 'Pendentes', valueColor: 'text-amber-600' },
          { icon: Phone, color: 'text-blue-500', value: stats.contacted, label: 'Contatados', valueColor: 'text-blue-600' },
          { icon: CheckCircle, color: 'text-green-500', value: stats.converted, label: 'Convertidos', valueColor: 'text-green-600' },
          { icon: XCircle, color: 'text-red-500', value: stats.lost, label: 'Perdidos', valueColor: 'text-red-600' },
        ].map(({ icon: Icon, color, value, label, valueColor }) => (
          <Card key={label}>
            <CardContent className="p-3 text-center">
              <Icon className={`h-4 w-4 mx-auto mb-1 ${color}`} />
              <p className={`text-xl font-bold ${valueColor || ''}`}>{value}</p>
              <p className="text-[10px] text-muted-foreground">{label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {stats.total > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Funil de Indicações</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {[
              { label: 'Pendentes', value: stats.pending, color: 'bg-amber-500' },
              { label: 'Contatados', value: stats.contacted, color: 'bg-blue-500' },
              { label: 'Convertidos', value: stats.converted, color: 'bg-green-500' },
              { label: 'Perdidos', value: stats.lost, color: 'bg-red-500' },
            ].map(({ label, value, color }) => (
              <div key={label} className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span>{label}</span>
                  <span className="text-muted-foreground">{value} ({stats.total > 0 ? Math.round((value / stats.total) * 100) : 0}%)</span>
                </div>
                <div className="w-full bg-muted rounded-full h-2">
                  <div className={`${color} h-2 rounded-full transition-all`} style={{ width: `${stats.total > 0 ? (value / stats.total) * 100 : 0}%` }} />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <ScrollArea className="h-[calc(100vh-550px)]">
        <div className="space-y-2">
          {referrals.map(r => (
            <Card key={r.id}>
              <CardContent className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">{r.contact_name || r.lead_name || 'Indicação'}</span>
                      <Badge className={`text-[9px] h-4 ${r.status === 'converted' ? 'bg-green-100 text-green-700' : r.status === 'contacted' ? 'bg-blue-100 text-blue-700' : r.status === 'lost' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                        {r.status === 'pending' ? 'Pendente' : r.status === 'contacted' ? 'Contatado' : r.status === 'converted' ? 'Convertido' : 'Perdido'}
                      </Badge>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      Indicado por: <span className="font-medium">{r.ambassador_name}</span>
                      {r.campaign_name && <> · Campanha: {r.campaign_name}</>}
                    </p>
                  </div>
                  <p className="text-[10px] text-muted-foreground shrink-0">{format(new Date(r.created_at), 'dd/MM HH:mm')}</p>
                </div>
              </CardContent>
            </Card>
          ))}
          {referrals.length === 0 && !loading && (
            <div className="text-center py-12 text-muted-foreground">
              <Heart className="h-10 w-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm">Nenhuma indicação no período</p>
              <p className="text-[10px] mt-1">Configure os agentes pós-fechamento para pedir indicações automaticamente</p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
