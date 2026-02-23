import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { differenceInHours } from 'date-fns';
import { Link } from 'react-router-dom';
import { InstagramProfileHoverCard } from '@/components/instagram/InstagramProfileHoverCard';
import { 
  User, 
  ChevronRight,
  MessageSquare,
  Send,
  Phone,
  Calendar,
  MapPin,
  CheckCircle2,
  RefreshCw,
  ArrowRight,
  Filter
} from 'lucide-react';

type FunnelStage = 'comment' | 'dm' | 'whatsapp' | 'visit_scheduled' | 'visit_done' | 'closed' | 'post_sale';

interface Prospect {
  id: string;
  author_username: string | null;
  comment_text: string | null;
  created_at: string;
  funnel_stage: FunnelStage;
  prospect_name: string | null;
}

const FUNNEL_STAGES: { key: FunnelStage; label: string; icon: React.ReactNode; color: string; bgColor: string }[] = [
  { key: 'comment', label: 'Comentário', icon: <MessageSquare className="h-3 w-3" />, color: 'text-blue-600', bgColor: 'bg-blue-100 dark:bg-blue-950' },
  { key: 'dm', label: 'DM', icon: <Send className="h-3 w-3" />, color: 'text-purple-600', bgColor: 'bg-purple-100 dark:bg-purple-950' },
  { key: 'whatsapp', label: 'WhatsApp', icon: <Phone className="h-3 w-3" />, color: 'text-green-600', bgColor: 'bg-green-100 dark:bg-green-950' },
  { key: 'visit_scheduled', label: 'Agendada', icon: <Calendar className="h-3 w-3" />, color: 'text-orange-600', bgColor: 'bg-orange-100 dark:bg-orange-950' },
  { key: 'visit_done', label: 'Visitou', icon: <MapPin className="h-3 w-3" />, color: 'text-amber-600', bgColor: 'bg-amber-100 dark:bg-amber-950' },
  { key: 'closed', label: 'Fechado', icon: <CheckCircle2 className="h-3 w-3" />, color: 'text-emerald-600', bgColor: 'bg-emerald-100 dark:bg-emerald-950' },
  { key: 'post_sale', label: 'Pós-venda', icon: <RefreshCw className="h-3 w-3" />, color: 'text-teal-600', bgColor: 'bg-teal-100 dark:bg-teal-950' },
];

const getNextStage = (currentStage: FunnelStage): FunnelStage | null => {
  const stageOrder: FunnelStage[] = ['comment', 'dm', 'whatsapp', 'visit_scheduled', 'visit_done', 'closed', 'post_sale'];
  const currentIndex = stageOrder.indexOf(currentStage);
  return currentIndex < stageOrder.length - 1 ? stageOrder[currentIndex + 1] : null;
};

const getStageConfig = (stage: FunnelStage) => {
  return FUNNEL_STAGES.find(s => s.key === stage) || FUNNEL_STAGES[0];
};

export function RecentProspects() {
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [loading, setLoading] = useState(true);
  const [stageFilter, setStageFilter] = useState<string>('all_active');

  const fetchProspects = async () => {
    try {
      let query = supabase
        .from('instagram_comments')
        .select('id, author_username, comment_text, created_at, funnel_stage, prospect_name')
        .order('created_at', { ascending: false })
        .limit(3);

      if (stageFilter === 'all_active') {
        query = query.not('funnel_stage', 'in', '("closed","post_sale")');
      } else if (stageFilter !== 'all') {
        query = query.eq('funnel_stage', stageFilter);
      }

      const { data, error } = await query;

      if (error) throw error;
      
      setProspects((data || []).map(p => ({
        ...p,
        funnel_stage: (p.funnel_stage as FunnelStage) || 'comment'
      })));
    } catch (error) {
      console.error('Erro ao buscar prospectos:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProspects();

    // Subscribe to realtime changes
    const channel = supabase
      .channel('recent-prospects')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'instagram_comments' },
        () => fetchProspects()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [stageFilter]);

  const handleAdvanceStage = async (prospect: Prospect) => {
    const nextStage = getNextStage(prospect.funnel_stage);
    if (!nextStage) return;

    try {
      const { error } = await supabase
        .from('instagram_comments')
        .update({ funnel_stage: nextStage })
        .eq('id', prospect.id);

      if (error) throw error;

      const stageConfig = getStageConfig(nextStage);
      toast.success(`Avançado para ${stageConfig.label}`);
      fetchProspects();
    } catch (error) {
      console.error('Erro ao avançar estágio:', error);
      toast.error('Erro ao avançar estágio');
    }
  };

  const getTimeAgo = (date: string) => {
    const hours = differenceInHours(new Date(), new Date(date));
    if (hours < 1) return 'Agora mesmo';
    if (hours < 24) return `${hours}h atrás`;
    const days = Math.floor(hours / 24);
    return `${days}d atrás`;
  };

  if (loading) {
    return (
      <Card className="border-border/50">
        <CardContent className="py-8">
          <div className="flex items-center justify-center text-muted-foreground">
            <RefreshCw className="h-4 w-4 animate-spin mr-2" />
            Carregando...
          </div>
        </CardContent>
      </Card>
    );
  }

  if (prospects.length === 0) {
    return null;
  }

  return (
    <Card className="border-border/50 border-l-4 border-l-orange-500">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <User className="h-5 w-5 text-orange-500" />
            Prospectos Recentes
            <Badge variant="outline" className="ml-2">{prospects.length}</Badge>
          </CardTitle>
          <div className="flex items-center gap-2">
            <Select value={stageFilter} onValueChange={setStageFilter}>
              <SelectTrigger className="w-[140px] h-8 text-xs">
                <Filter className="h-3 w-3 mr-1" />
                <SelectValue placeholder="Filtrar" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all_active">Ativos</SelectItem>
                <SelectItem value="all">Todos</SelectItem>
                {FUNNEL_STAGES.map((stage) => (
                  <SelectItem key={stage.key} value={stage.key}>
                    <span className="flex items-center gap-1">
                      {stage.icon}
                      {stage.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Link to="/dashboard?tab=automation&subtab=funnel">
              <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
                Ver todos
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </Link>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {prospects.map((prospect) => {
            const stageConfig = getStageConfig(prospect.funnel_stage);
            const nextStage = getNextStage(prospect.funnel_stage);
            const nextStageConfig = nextStage ? getStageConfig(nextStage) : null;

            return (
              <div 
                key={prospect.id}
                className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors border border-border/50"
              >
                {/* Stage Badge */}
                <Badge 
                  variant="secondary" 
                  className={`${stageConfig.bgColor} ${stageConfig.color} shrink-0`}
                >
                  {stageConfig.icon}
                  <span className="ml-1">{stageConfig.label}</span>
                </Badge>

                {/* User Info */}
                <div className="flex-1 min-w-0">
                  {prospect.author_username ? (
                    <InstagramProfileHoverCard 
                      username={prospect.author_username}
                      className="font-medium text-sm truncate"
                    >
                      <span>{prospect.prospect_name || prospect.author_username}</span>
                    </InstagramProfileHoverCard>
                  ) : (
                    <p className="font-medium text-sm truncate">
                      {prospect.prospect_name || 'Desconhecido'}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground truncate">
                    {prospect.comment_text?.slice(0, 50) || 'Sem comentário'}
                    {prospect.comment_text && prospect.comment_text.length > 50 ? '...' : ''}
                  </p>
                </div>

                {/* Time */}
                <span className="text-xs text-muted-foreground shrink-0">
                  {getTimeAgo(prospect.created_at)}
                </span>

                {/* Quick Action */}
                {nextStageConfig && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleAdvanceStage(prospect)}
                    className={`shrink-0 ${nextStageConfig.color} hover:${nextStageConfig.bgColor}`}
                    title={`Avançar para ${nextStageConfig.label}`}
                  >
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
