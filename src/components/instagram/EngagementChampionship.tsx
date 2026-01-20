import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { 
  Trophy, Medal, Crown, Star, TrendingUp, TrendingDown, Minus,
  RefreshCw, Settings, Share2, Bell, Users, MessageCircle, AtSign,
  Award, Flame, Sparkles, ChevronUp, ChevronDown, Calendar, History
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { format, startOfWeek, endOfWeek, subWeeks, differenceInDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ChampionshipSettingsDialog } from './ChampionshipSettingsDialog';
import { EngagementEvolutionChart } from './EngagementEvolutionChart';

interface RankingEntry {
  id: string;
  username: string;
  user_id: string | null;
  profile_picture_url: string | null;
  mentions_count: number;
  comments_count: number;
  total_points: number;
  badge_level: 'bronze' | 'silver' | 'gold' | 'diamond';
  rank_position: number | null;
  previous_rank_position: number | null;
  week_start: string;
  week_end: string;
}

interface Champion {
  id: string;
  username: string;
  profile_picture_url: string | null;
  week_start: string;
  week_end: string;
  total_points: number;
  mentions_count: number;
  comments_count: number;
  badge_level: string;
  final_position: number;
}

interface ChampionshipSettings {
  id?: string;
  points_per_mention: number;
  points_per_comment: number;
  bronze_threshold: number;
  silver_threshold: number;
  gold_threshold: number;
  diamond_threshold: number;
  notify_on_rank_change: boolean;
  notify_on_new_champion: boolean;
}

const DEFAULT_SETTINGS: ChampionshipSettings = {
  points_per_mention: 5,
  points_per_comment: 2,
  bronze_threshold: 0,
  silver_threshold: 20,
  gold_threshold: 50,
  diamond_threshold: 100,
  notify_on_rank_change: true,
  notify_on_new_champion: true
};

const badgeConfig = {
  bronze: { 
    icon: Medal, 
    color: 'text-amber-700', 
    bg: 'bg-amber-100 dark:bg-amber-900/30',
    border: 'border-amber-400',
    gradient: 'from-amber-700 to-amber-500',
    label: 'Bronze'
  },
  silver: { 
    icon: Medal, 
    color: 'text-slate-400', 
    bg: 'bg-slate-100 dark:bg-slate-800',
    border: 'border-slate-400',
    gradient: 'from-slate-400 to-slate-300',
    label: 'Prata'
  },
  gold: { 
    icon: Trophy, 
    color: 'text-yellow-500', 
    bg: 'bg-yellow-100 dark:bg-yellow-900/30',
    border: 'border-yellow-400',
    gradient: 'from-yellow-500 to-yellow-300',
    label: 'Ouro'
  },
  diamond: { 
    icon: Crown, 
    color: 'text-cyan-400', 
    bg: 'bg-cyan-100 dark:bg-cyan-900/20',
    border: 'border-cyan-400',
    gradient: 'from-cyan-400 to-purple-400',
    label: 'Diamante'
  }
};

const positionConfig: Record<number, { icon: React.ElementType; color: string; label: string }> = {
  1: { icon: Crown, color: 'text-yellow-500', label: '1º' },
  2: { icon: Medal, color: 'text-slate-400', label: '2º' },
  3: { icon: Award, color: 'text-amber-600', label: '3º' }
};

export const EngagementChampionship: React.FC = () => {
  const [rankings, setRankings] = useState<RankingEntry[]>([]);
  const [champions, setChampions] = useState<Champion[]>([]);
  const [settings, setSettings] = useState<ChampionshipSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [activeTab, setActiveTab] = useState('ranking');
  const hasFetched = useRef(false);
  
  // Memoize dates to prevent infinite re-renders
  const currentWeekStart = useMemo(() => startOfWeek(new Date(), { weekStartsOn: 1 }), []);
  const currentWeekEnd = useMemo(() => endOfWeek(new Date(), { weekStartsOn: 1 }), []);
  const daysRemaining = useMemo(() => differenceInDays(currentWeekEnd, new Date()), [currentWeekEnd]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch current week rankings
      const weekStart = format(currentWeekStart, 'yyyy-MM-dd');
      const { data: rankingsData, error: rankingsError } = await supabase
        .from('engagement_rankings')
        .select('*')
        .eq('week_start', weekStart)
        .order('total_points', { ascending: false });

      if (rankingsError) throw rankingsError;
      
      // Add rank positions
      const rankedData = (rankingsData || []).map((entry, index) => ({
        ...entry,
        rank_position: index + 1
      })) as RankingEntry[];
      
      setRankings(rankedData);

      // Fetch champions history
      const { data: championsData, error: championsError } = await supabase
        .from('engagement_champions')
        .select('*')
        .order('week_start', { ascending: false })
        .limit(30);

      if (championsError) throw championsError;
      setChampions(championsData || []);

      // Fetch settings - use maybeSingle to handle empty table
      const { data: settingsData, error: settingsError } = await supabase
        .from('engagement_championship_settings')
        .select('*')
        .limit(1)
        .maybeSingle();

      if (settingsData && !settingsError) {
        setSettings({ ...settingsData, id: settingsData.id } as unknown as ChampionshipSettings);
      } else if (!settingsData && !settingsError) {
        // No settings exist - create default settings automatically
        const { data: newSettings, error: insertError } = await supabase
          .from('engagement_championship_settings')
          .insert({
            points_per_mention: DEFAULT_SETTINGS.points_per_mention,
            points_per_comment: DEFAULT_SETTINGS.points_per_comment,
            bronze_threshold: DEFAULT_SETTINGS.bronze_threshold,
            silver_threshold: DEFAULT_SETTINGS.silver_threshold,
            gold_threshold: DEFAULT_SETTINGS.gold_threshold,
            diamond_threshold: DEFAULT_SETTINGS.diamond_threshold,
            notify_on_rank_change: DEFAULT_SETTINGS.notify_on_rank_change,
            notify_on_new_champion: DEFAULT_SETTINGS.notify_on_new_champion
          })
          .select()
          .single();

        if (newSettings && !insertError) {
          setSettings({ ...newSettings, id: newSettings.id } as unknown as ChampionshipSettings);
          console.log('Configurações padrão criadas automaticamente');
        }
      }
    } catch (error) {
      console.error('Erro ao carregar dados:', error);
      toast.error('Erro ao carregar ranking');
    } finally {
      setLoading(false);
    }
  }, [currentWeekStart]);

  const calculateRankings = useCallback(async () => {
    setSyncing(true);
    try {
      const weekStart = format(currentWeekStart, 'yyyy-MM-dd');
      const weekEnd = format(currentWeekEnd, 'yyyy-MM-dd');

      // Store previous rankings for comparison
      const previousRankings = new Map(
        rankings.map(r => [r.username, r.rank_position])
      );

      // Fetch all comments from this week
      const { data: comments, error: commentsError } = await supabase
        .from('instagram_comments')
        .select('author_username, comment_type, created_at')
        .gte('created_at', currentWeekStart.toISOString())
        .lte('created_at', currentWeekEnd.toISOString())
        .in('comment_type', ['received', 'mention']);

      if (commentsError) throw commentsError;

      // Aggregate by username
      const userStats: Record<string, { mentions: number; comments: number }> = {};
      
      for (const comment of comments || []) {
        const username = comment.author_username;
        if (!username) continue;
        
        if (!userStats[username]) {
          userStats[username] = { mentions: 0, comments: 0 };
        }
        
        if (comment.comment_type === 'mention') {
          userStats[username].mentions++;
        } else {
          userStats[username].comments++;
        }
      }

      // Calculate points and badges
      const entries = Object.entries(userStats).map(([username, stats]) => {
        const totalPoints = 
          (stats.mentions * settings.points_per_mention) + 
          (stats.comments * settings.points_per_comment);
        
        let badgeLevel: 'bronze' | 'silver' | 'gold' | 'diamond' = 'bronze';
        if (totalPoints >= settings.diamond_threshold) badgeLevel = 'diamond';
        else if (totalPoints >= settings.gold_threshold) badgeLevel = 'gold';
        else if (totalPoints >= settings.silver_threshold) badgeLevel = 'silver';
        
        return {
          username,
          mentions_count: stats.mentions,
          comments_count: stats.comments,
          total_points: totalPoints,
          badge_level: badgeLevel,
          week_start: weekStart,
          week_end: weekEnd
        };
      });

      // Sort by points to get new positions
      const sortedEntries = [...entries].sort((a, b) => b.total_points - a.total_points);

      // Track position changes for notifications
      const positionChanges: { username: string; oldPos: number; newPos: number; direction: 'up' | 'down' }[] = [];

      // Upsert rankings with previous position tracking
      for (let i = 0; i < sortedEntries.length; i++) {
        const entry = sortedEntries[i];
        const newPosition = i + 1;
        const previousPosition = previousRankings.get(entry.username);

        // Track significant position changes
        if (previousPosition && previousPosition !== newPosition && settings.notify_on_rank_change) {
          positionChanges.push({
            username: entry.username,
            oldPos: previousPosition,
            newPos: newPosition,
            direction: newPosition < previousPosition ? 'up' : 'down'
          });
        }

        await supabase
          .from('engagement_rankings')
          .upsert({
            ...entry,
            rank_position: newPosition,
            previous_rank_position: previousPosition || null
          }, { onConflict: 'username,week_start,ad_account_id' });
      }

      // Show notifications for position changes
      if (positionChanges.length > 0 && settings.notify_on_rank_change) {
        const movedUp = positionChanges.filter(c => c.direction === 'up');
        const movedDown = positionChanges.filter(c => c.direction === 'down');

        if (movedUp.length > 0) {
          const topMover = movedUp.reduce((a, b) => 
            (a.oldPos - a.newPos) > (b.oldPos - b.newPos) ? a : b
          );
          toast.success(
            `🚀 @${topMover.username} subiu ${topMover.oldPos - topMover.newPos} posição(ões)!`,
            { description: `Agora está em ${topMover.newPos}º lugar` }
          );
        }

        if (movedDown.length > 0) {
          const topFaller = movedDown.reduce((a, b) => 
            (a.newPos - a.oldPos) > (b.newPos - b.oldPos) ? a : b
          );
          toast.info(
            `📉 @${topFaller.username} desceu ${topFaller.newPos - topFaller.oldPos} posição(ões)`,
            { description: `Agora está em ${topFaller.newPos}º lugar` }
          );
        }

        // Check for new leader
        const newLeader = sortedEntries[0];
        const previousLeaderUsername = rankings[0]?.username;
        if (newLeader && previousLeaderUsername && newLeader.username !== previousLeaderUsername) {
          toast.success(
            `👑 Novo líder: @${newLeader.username}!`,
            { description: `Com ${newLeader.total_points} pontos`, duration: 5000 }
          );
        }
      }

      toast.success(`Ranking atualizado! ${entries.length} engajadores encontrados`);
      await fetchData();
    } catch (error) {
      console.error('Erro ao calcular rankings:', error);
      toast.error('Erro ao sincronizar dados');
    } finally {
      setSyncing(false);
    }
  }, [currentWeekStart, currentWeekEnd, settings, fetchData, rankings]);

  const finalizeWeek = async () => {
    try {
      const weekStart = format(subWeeks(currentWeekStart, 1), 'yyyy-MM-dd');
      
      // Get last week's rankings
      const { data: lastWeekRankings, error } = await supabase
        .from('engagement_rankings')
        .select('*')
        .eq('week_start', weekStart)
        .order('total_points', { ascending: false })
        .limit(3);

      if (error) throw error;

      // Save top 3 as champions
      for (let i = 0; i < Math.min(3, lastWeekRankings?.length || 0); i++) {
        const entry = lastWeekRankings![i];
        await supabase
          .from('engagement_champions')
          .insert({
            username: entry.username,
            user_id: entry.user_id,
            profile_picture_url: entry.profile_picture_url,
            week_start: entry.week_start,
            week_end: entry.week_end,
            total_points: entry.total_points,
            mentions_count: entry.mentions_count,
            comments_count: entry.comments_count,
            badge_level: entry.badge_level,
            final_position: i + 1
          });
      }

      toast.success('Semana finalizada! Campeões registrados.');
      await fetchData();
    } catch (error) {
      console.error('Erro ao finalizar semana:', error);
      toast.error('Erro ao registrar campeões');
    }
  };

  const shareLeaderboard = () => {
    const url = `${window.location.origin}/leaderboard`;
    navigator.clipboard.writeText(url);
    toast.success('Link do leaderboard copiado!');
  };

  useEffect(() => {
    // Prevent multiple initial fetches
    if (hasFetched.current) return;
    hasFetched.current = true;
    fetchData();
  }, []);

  const RankChangeIndicator: React.FC<{ current: number | null; previous: number | null }> = ({ current, previous }) => {
    if (!current || !previous || current === previous) {
      return <Minus className="w-4 h-4 text-muted-foreground" />;
    }
    if (current < previous) {
      return (
        <div className="flex items-center text-green-500">
          <ChevronUp className="w-4 h-4" />
          <span className="text-xs">{previous - current}</span>
        </div>
      );
    }
    return (
      <div className="flex items-center text-red-500">
        <ChevronDown className="w-4 h-4" />
        <span className="text-xs">{current - previous}</span>
      </div>
    );
  };

  const RankingCard: React.FC<{ entry: RankingEntry; position: number }> = ({ entry, position }) => {
    const badge = badgeConfig[entry.badge_level];
    const BadgeIcon = badge.icon;
    const isTop3 = position <= 3;
    const posConfig = positionConfig[position];

    return (
      <div 
        className={`
          relative p-4 rounded-xl border-2 transition-all
          ${isTop3 ? 'bg-gradient-to-r ' + badge.gradient + ' bg-opacity-10' : 'bg-card'}
          ${position === 1 ? 'border-yellow-400 shadow-lg shadow-yellow-500/20' : 
            position === 2 ? 'border-slate-400' : 
            position === 3 ? 'border-amber-600' : 'border-border'}
        `}
      >
        <div className="flex items-center gap-4">
          {/* Position */}
          <div className={`
            flex items-center justify-center w-10 h-10 rounded-full font-bold text-lg
            ${isTop3 ? 'bg-background/80' : 'bg-muted'}
          `}>
            {posConfig ? (
              <posConfig.icon className={`w-6 h-6 ${posConfig.color}`} />
            ) : (
              <span className="text-muted-foreground">{position}</span>
            )}
          </div>

          {/* Avatar */}
          <div className="relative">
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-primary to-purple-500 flex items-center justify-center text-white font-bold text-lg">
              {entry.username.charAt(0).toUpperCase()}
            </div>
            <div className={`absolute -bottom-1 -right-1 p-1 rounded-full ${badge.bg}`}>
              <BadgeIcon className={`w-4 h-4 ${badge.color}`} />
            </div>
          </div>

          {/* User Info */}
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="font-semibold">@{entry.username}</span>
              <Badge variant="outline" className={`${badge.bg} ${badge.color} text-xs`}>
                {badge.label}
              </Badge>
            </div>
            <div className="flex items-center gap-4 text-sm text-muted-foreground mt-1">
              <span className="flex items-center gap-1">
                <AtSign className="w-3 h-3" />
                {entry.mentions_count} menções
              </span>
              <span className="flex items-center gap-1">
                <MessageCircle className="w-3 h-3" />
                {entry.comments_count} comentários
              </span>
            </div>
          </div>

          {/* Points & Rank Change */}
          <div className="text-right">
            <div className="flex items-center gap-2">
              <Flame className="w-5 h-5 text-orange-500" />
              <span className="text-2xl font-bold">{entry.total_points}</span>
            </div>
            <div className="flex items-center justify-end gap-1 mt-1">
              <RankChangeIndicator current={entry.rank_position} previous={entry.previous_rank_position} />
            </div>
          </div>
        </div>

        {/* Progress to next level */}
        {entry.badge_level !== 'diamond' && (
          <div className="mt-3">
            <div className="flex justify-between text-xs text-muted-foreground mb-1">
              <span>{badge.label}</span>
              <span>
                {entry.badge_level === 'bronze' ? settings.silver_threshold :
                 entry.badge_level === 'silver' ? settings.gold_threshold : settings.diamond_threshold} pts
              </span>
            </div>
            <Progress 
              value={
                entry.badge_level === 'bronze' 
                  ? (entry.total_points / settings.silver_threshold) * 100
                  : entry.badge_level === 'silver'
                  ? ((entry.total_points - settings.silver_threshold) / (settings.gold_threshold - settings.silver_threshold)) * 100
                  : ((entry.total_points - settings.gold_threshold) / (settings.diamond_threshold - settings.gold_threshold)) * 100
              } 
              className="h-2" 
            />
          </div>
        )}
      </div>
    );
  };

  const ChampionCard: React.FC<{ champion: Champion }> = ({ champion }) => {
    const posConfig = positionConfig[champion.final_position];
    const badge = badgeConfig[champion.badge_level as keyof typeof badgeConfig] || badgeConfig.bronze;
    
    return (
      <div className={`
        p-4 rounded-xl border-2 
        ${champion.final_position === 1 ? 'border-yellow-400 bg-gradient-to-br from-yellow-500/10 to-transparent' :
          champion.final_position === 2 ? 'border-slate-400 bg-slate-500/5' :
          'border-amber-600 bg-amber-500/5'}
      `}>
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-full bg-background">
            {posConfig && <posConfig.icon className={`w-6 h-6 ${posConfig.color}`} />}
          </div>
          <div className="flex-1">
            <div className="font-semibold">@{champion.username}</div>
            <div className="text-xs text-muted-foreground">
              {format(new Date(champion.week_start), "dd 'de' MMM", { locale: ptBR })} - 
              {format(new Date(champion.week_end), " dd 'de' MMM", { locale: ptBR })}
            </div>
          </div>
          <div className="text-right">
            <div className="flex items-center gap-1 text-lg font-bold">
              <Flame className="w-4 h-4 text-orange-500" />
              {champion.total_points}
            </div>
            <Badge variant="outline" className={`${badge.bg} ${badge.color} text-xs`}>
              {badge.label}
            </Badge>
          </div>
        </div>
      </div>
    );
  };

  // Group champions by week
  const champsByWeek = champions.reduce((acc, champ) => {
    const key = champ.week_start;
    if (!acc[key]) acc[key] = [];
    acc[key].push(champ);
    return acc;
  }, {} as Record<string, Champion[]>);

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card className="border-2 border-primary/20 bg-gradient-to-r from-primary/5 to-purple-500/5">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-xl bg-gradient-to-br from-yellow-500 to-orange-500">
                <Trophy className="w-8 h-8 text-white" />
              </div>
              <div>
                <CardTitle className="text-2xl flex items-center gap-2">
                  Campeonato de Engajamento
                  <Sparkles className="w-5 h-5 text-yellow-500" />
                </CardTitle>
                <CardDescription>
                  Ranking semanal dos maiores engajadores da sua conta
                </CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <ChampionshipSettingsDialog 
                settings={settings} 
                onSettingsUpdate={(newSettings) => {
                  setSettings(newSettings);
                  calculateRankings();
                }} 
              />
              <Button variant="outline" size="sm" onClick={shareLeaderboard}>
                <Share2 className="w-4 h-4 mr-2" />
                Compartilhar
              </Button>
              <Button variant="outline" size="sm" onClick={calculateRankings} disabled={syncing}>
                <RefreshCw className={`w-4 h-4 mr-2 ${syncing ? 'animate-spin' : ''}`} />
                Atualizar
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Week Info */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <Calendar className="w-5 h-5 text-primary" />
              <div>
                <p className="text-sm text-muted-foreground">Semana atual</p>
                <p className="font-semibold">
                  {format(currentWeekStart, "dd/MM", { locale: ptBR })} - {format(currentWeekEnd, "dd/MM", { locale: ptBR })}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <Flame className="w-5 h-5 text-orange-500" />
              <div>
                <p className="text-sm text-muted-foreground">Dias restantes</p>
                <p className="font-semibold">{daysRemaining} dias</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <Users className="w-5 h-5 text-blue-500" />
              <div>
                <p className="text-sm text-muted-foreground">Participantes</p>
                <p className="font-semibold">{rankings.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <Star className="w-5 h-5 text-yellow-500" />
              <div>
                <p className="text-sm text-muted-foreground">Líder</p>
                <p className="font-semibold">
                  {rankings[0] ? `@${rankings[0].username}` : 'Nenhum ainda'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Evolution Chart */}
      <EngagementEvolutionChart weeksToShow={8} />

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="ranking" className="flex items-center gap-2">
            <Trophy className="w-4 h-4" />
            Ranking Atual
          </TabsTrigger>
          <TabsTrigger value="champions" className="flex items-center gap-2">
            <Crown className="w-4 h-4" />
            Hall da Fama
          </TabsTrigger>
          <TabsTrigger value="rules" className="flex items-center gap-2">
            <Settings className="w-4 h-4" />
            Regras
          </TabsTrigger>
        </TabsList>

        <TabsContent value="ranking" className="mt-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          ) : rankings.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Users className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold mb-2">Nenhum engajador ainda</h3>
                <p className="text-muted-foreground mb-4">
                  Clique em "Atualizar" para sincronizar os dados de menções e comentários
                </p>
                <Button onClick={calculateRankings} disabled={syncing}>
                  <RefreshCw className={`w-4 h-4 mr-2 ${syncing ? 'animate-spin' : ''}`} />
                  Sincronizar Agora
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {rankings.map((entry, index) => (
                <RankingCard key={entry.id} entry={entry} position={index + 1} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="champions" className="mt-6">
          {Object.keys(champsByWeek).length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Crown className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold mb-2">Nenhum campeão ainda</h3>
                <p className="text-muted-foreground">
                  Os campeões semanais aparecerão aqui após a primeira semana completa
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-6">
              {Object.entries(champsByWeek).map(([weekStart, weekChamps]) => (
                <div key={weekStart}>
                  <h3 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
                    <History className="w-4 h-4" />
                    Semana de {format(new Date(weekStart), "dd 'de' MMMM", { locale: ptBR })}
                  </h3>
                  <div className="grid gap-3">
                    {weekChamps
                      .sort((a, b) => a.final_position - b.final_position)
                      .map(champion => (
                        <ChampionCard key={champion.id} champion={champion} />
                      ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="rules" className="mt-6">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Star className="w-5 h-5 text-yellow-500" />
                  Sistema de Pontos
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between items-center p-3 bg-muted rounded-lg">
                  <span className="flex items-center gap-2">
                    <AtSign className="w-4 h-4 text-primary" />
                    Menção em post de terceiros
                  </span>
                  <Badge variant="secondary">+{settings.points_per_mention} pts</Badge>
                </div>
                <div className="flex justify-between items-center p-3 bg-muted rounded-lg">
                  <span className="flex items-center gap-2">
                    <MessageCircle className="w-4 h-4 text-blue-500" />
                    Comentário em seus posts
                  </span>
                  <Badge variant="secondary">+{settings.points_per_comment} pts</Badge>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Medal className="w-5 h-5" />
                  Níveis de Badge
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {Object.entries(badgeConfig).map(([level, config]) => {
                  const threshold = 
                    level === 'bronze' ? settings.bronze_threshold :
                    level === 'silver' ? settings.silver_threshold :
                    level === 'gold' ? settings.gold_threshold : settings.diamond_threshold;
                  
                  return (
                    <div key={level} className={`flex justify-between items-center p-3 rounded-lg ${config.bg}`}>
                      <span className="flex items-center gap-2">
                        <config.icon className={`w-4 h-4 ${config.color}`} />
                        {config.label}
                      </span>
                      <Badge variant="outline" className={config.color}>
                        {threshold}+ pts
                      </Badge>
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            <Card className="md:col-span-2">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Bell className="w-5 h-5 text-blue-500" />
                  Notificações
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-4">
                  <Badge variant={settings.notify_on_rank_change ? "default" : "secondary"}>
                    {settings.notify_on_rank_change ? "✓" : "✗"} Mudança de posição
                  </Badge>
                  <Badge variant={settings.notify_on_new_champion ? "default" : "secondary"}>
                    {settings.notify_on_new_champion ? "✓" : "✗"} Novo campeão semanal
                  </Badge>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};
