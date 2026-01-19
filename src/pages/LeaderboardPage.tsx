import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  Trophy, Medal, Crown, Star, Flame, Sparkles, 
  AtSign, MessageCircle, Calendar, Users
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { format, startOfWeek, endOfWeek, differenceInDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface RankingEntry {
  id: string;
  username: string;
  mentions_count: number;
  comments_count: number;
  total_points: number;
  badge_level: 'bronze' | 'silver' | 'gold' | 'diamond';
  rank_position: number | null;
}

const badgeConfig = {
  bronze: { 
    icon: Medal, 
    color: 'text-amber-700', 
    bg: 'bg-amber-100 dark:bg-amber-900/30',
    gradient: 'from-amber-700 to-amber-500',
    label: 'Bronze'
  },
  silver: { 
    icon: Medal, 
    color: 'text-slate-400', 
    bg: 'bg-slate-100 dark:bg-slate-800',
    gradient: 'from-slate-400 to-slate-300',
    label: 'Prata'
  },
  gold: { 
    icon: Trophy, 
    color: 'text-yellow-500', 
    bg: 'bg-yellow-100 dark:bg-yellow-900/30',
    gradient: 'from-yellow-500 to-yellow-300',
    label: 'Ouro'
  },
  diamond: { 
    icon: Crown, 
    color: 'text-cyan-400', 
    bg: 'bg-cyan-100 dark:bg-cyan-900/20',
    gradient: 'from-cyan-400 to-purple-400',
    label: 'Diamante'
  }
};

const LeaderboardPage: React.FC = () => {
  const [rankings, setRankings] = useState<RankingEntry[]>([]);
  const [loading, setLoading] = useState(true);
  
  const currentWeekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
  const currentWeekEnd = endOfWeek(new Date(), { weekStartsOn: 1 });
  const daysRemaining = differenceInDays(currentWeekEnd, new Date());

  useEffect(() => {
    const fetchRankings = async () => {
      const weekStart = format(currentWeekStart, 'yyyy-MM-dd');
      const { data, error } = await supabase
        .from('engagement_rankings')
        .select('*')
        .eq('week_start', weekStart)
        .order('total_points', { ascending: false });

      if (!error && data) {
        const rankedData = data.map((entry, index) => ({
          ...entry,
          rank_position: index + 1
        })) as RankingEntry[];
        setRankings(rankedData);
      }
      setLoading(false);
    };

    fetchRankings();
  }, [currentWeekStart]);

  const positionConfig: Record<number, { icon: React.ElementType; color: string; bgGradient: string }> = {
    1: { icon: Crown, color: 'text-yellow-500', bgGradient: 'from-yellow-500/20 to-yellow-600/10' },
    2: { icon: Medal, color: 'text-slate-400', bgGradient: 'from-slate-400/20 to-slate-500/10' },
    3: { icon: Medal, color: 'text-amber-600', bgGradient: 'from-amber-500/20 to-amber-600/10' }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 py-8 px-4">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center p-4 rounded-2xl bg-gradient-to-br from-yellow-500 to-orange-500 mb-4 shadow-xl shadow-orange-500/25">
            <Trophy className="w-12 h-12 text-white" />
          </div>
          <h1 className="text-3xl font-bold flex items-center justify-center gap-2">
            Campeonato de Engajamento
            <Sparkles className="w-6 h-6 text-yellow-500" />
          </h1>
          <p className="text-muted-foreground mt-2">
            Ranking semanal dos maiores engajadores
          </p>
        </div>

        {/* Week Info */}
        <Card className="border-2 border-primary/20">
          <CardContent className="pt-4">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2">
                <Calendar className="w-5 h-5 text-primary" />
                <span className="font-medium">
                  {format(currentWeekStart, "dd/MM", { locale: ptBR })} - {format(currentWeekEnd, "dd/MM", { locale: ptBR })}
                </span>
              </div>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2 text-sm">
                  <Flame className="w-4 h-4 text-orange-500" />
                  <span>{daysRemaining} dias restantes</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Users className="w-4 h-4 text-blue-500" />
                  <span>{rankings.length} participantes</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Rankings */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        ) : rankings.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Users className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">Sem participantes ainda</h3>
              <p className="text-muted-foreground">
                O ranking será atualizado em breve!
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {rankings.map((entry, index) => {
              const position = index + 1;
              const badge = badgeConfig[entry.badge_level];
              const BadgeIcon = badge.icon;
              const isTop3 = position <= 3;
              const posConfig = positionConfig[position];

              return (
                <Card 
                  key={entry.id}
                  className={`
                    border-2 overflow-hidden transition-all hover:scale-[1.02]
                    ${position === 1 ? 'border-yellow-400 shadow-lg shadow-yellow-500/20' : 
                      position === 2 ? 'border-slate-400' : 
                      position === 3 ? 'border-amber-600' : 'border-border'}
                  `}
                >
                  {isTop3 && (
                    <div className={`h-1 bg-gradient-to-r ${badge.gradient}`}></div>
                  )}
                  <CardContent className={`pt-4 ${isTop3 ? `bg-gradient-to-r ${posConfig.bgGradient}` : ''}`}>
                    <div className="flex items-center gap-4">
                      {/* Position */}
                      <div className={`
                        flex items-center justify-center w-12 h-12 rounded-full font-bold text-xl
                        ${isTop3 ? 'bg-background shadow-lg' : 'bg-muted'}
                      `}>
                        {posConfig ? (
                          <posConfig.icon className={`w-7 h-7 ${posConfig.color}`} />
                        ) : (
                          <span className="text-muted-foreground">{position}</span>
                        )}
                      </div>

                      {/* Avatar */}
                      <div className="relative">
                        <div className={`
                          w-14 h-14 rounded-full flex items-center justify-center text-white font-bold text-xl
                          bg-gradient-to-br ${badge.gradient}
                        `}>
                          {entry.username.charAt(0).toUpperCase()}
                        </div>
                        <div className={`absolute -bottom-1 -right-1 p-1.5 rounded-full ${badge.bg} border-2 border-background`}>
                          <BadgeIcon className={`w-4 h-4 ${badge.color}`} />
                        </div>
                      </div>

                      {/* User Info */}
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-lg">@{entry.username}</span>
                          <Badge variant="outline" className={`${badge.bg} ${badge.color}`}>
                            {badge.label}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-4 text-sm text-muted-foreground mt-1">
                          <span className="flex items-center gap-1">
                            <AtSign className="w-3.5 h-3.5" />
                            {entry.mentions_count}
                          </span>
                          <span className="flex items-center gap-1">
                            <MessageCircle className="w-3.5 h-3.5" />
                            {entry.comments_count}
                          </span>
                        </div>
                      </div>

                      {/* Points */}
                      <div className="text-right">
                        <div className="flex items-center gap-2">
                          <Flame className={`w-6 h-6 ${position === 1 ? 'text-orange-500 animate-pulse' : 'text-orange-400'}`} />
                          <span className="text-3xl font-black">{entry.total_points}</span>
                        </div>
                        <span className="text-xs text-muted-foreground">pontos</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* Footer */}
        <div className="text-center text-sm text-muted-foreground pt-4">
          <div className="flex justify-center gap-6">
            <span className="flex items-center gap-1">
              <AtSign className="w-4 h-4" /> Menção = 5 pts
            </span>
            <span className="flex items-center gap-1">
              <MessageCircle className="w-4 h-4" /> Comentário = 2 pts
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LeaderboardPage;
