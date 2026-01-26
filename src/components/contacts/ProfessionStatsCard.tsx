import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  Briefcase, 
  ChevronDown, 
  ChevronUp,
  TrendingUp
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface ProfessionStat {
  profession: string;
  count: number;
}

interface ProfessionStatsCardProps {
  onProfessionClick?: (profession: string) => void;
  selectedProfessions?: string[];
}

export const ProfessionStatsCard: React.FC<ProfessionStatsCardProps> = ({
  onProfessionClick,
  selectedProfessions = []
}) => {
  const [stats, setStats] = useState<ProfessionStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [totalWithProfession, setTotalWithProfession] = useState(0);

  useEffect(() => {
    fetchProfessionStats();
  }, []);

  const fetchProfessionStats = async () => {
    setLoading(true);
    try {
      // Get profession counts
      const { data, error } = await supabase
        .from('contacts')
        .select('profession')
        .not('profession', 'is', null)
        .neq('profession', '');

      if (error) throw error;

      // Count by profession
      const professionCounts: Record<string, number> = {};
      (data || []).forEach((contact: { profession: string | null }) => {
        if (contact.profession) {
          professionCounts[contact.profession] = (professionCounts[contact.profession] || 0) + 1;
        }
      });

      // Convert to array and sort by count
      const statsArray = Object.entries(professionCounts)
        .map(([profession, count]) => ({ profession, count }))
        .sort((a, b) => b.count - a.count);

      setStats(statsArray);
      setTotalWithProfession(data?.length || 0);
    } catch (error) {
      console.error('Error fetching profession stats:', error);
    } finally {
      setLoading(false);
    }
  };

  const displayedStats = expanded ? stats : stats.slice(0, 5);
  const hasMore = stats.length > 5;

  if (loading) {
    return (
      <Card className="bg-card/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Briefcase className="h-4 w-4 text-amber-500" />
            Profissões
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-6 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (stats.length === 0) {
    return (
      <Card className="bg-card/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Briefcase className="h-4 w-4 text-amber-500" />
            Profissões
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground text-center py-2">
            Nenhuma profissão cadastrada
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-amber-500/10 border-amber-500/30">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Briefcase className="h-4 w-4 text-amber-500" />
            Profissões mais comuns
          </CardTitle>
          <Badge variant="secondary" className="text-xs">
            {totalWithProfession} contatos
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <ScrollArea className={expanded ? "h-[200px]" : ""}>
          <div className="space-y-1.5">
            {displayedStats.map((stat, index) => {
              const isSelected = selectedProfessions.includes(stat.profession);
              const percentage = Math.round((stat.count / totalWithProfession) * 100);
              
              return (
                <button
                  key={stat.profession}
                  type="button"
                  onClick={() => onProfessionClick?.(stat.profession)}
                  className={`w-full flex items-center justify-between p-2 rounded-md transition-colors text-left ${
                    isSelected 
                      ? 'bg-amber-500/20 border border-amber-500/50' 
                      : 'hover:bg-muted/50 border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="text-xs font-medium text-muted-foreground w-4">
                      {index + 1}.
                    </span>
                    <span className="text-sm truncate" title={stat.profession}>
                      {stat.profession}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <div className="w-12 h-1.5 bg-muted rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-amber-500 rounded-full transition-all"
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                    <Badge 
                      variant={isSelected ? "default" : "secondary"} 
                      className={`text-xs min-w-[40px] justify-center ${
                        isSelected ? 'bg-amber-500 hover:bg-amber-600' : ''
                      }`}
                    >
                      {stat.count}
                    </Badge>
                  </div>
                </button>
              );
            })}
          </div>
        </ScrollArea>
        
        {hasMore && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full mt-2 h-7 text-xs text-muted-foreground"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? (
              <>
                <ChevronUp className="h-3 w-3 mr-1" />
                Mostrar menos
              </>
            ) : (
              <>
                <ChevronDown className="h-3 w-3 mr-1" />
                Ver todas ({stats.length} profissões)
              </>
            )}
          </Button>
        )}
      </CardContent>
    </Card>
  );
};
