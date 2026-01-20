import React, { forwardRef } from 'react';
import { Badge } from '@/components/ui/badge';
import { 
  Trophy, Medal, Crown, AtSign, MessageCircle, Flame, Sparkles 
} from 'lucide-react';
import { format } from 'date-fns';
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

interface ChampionshipSettings {
  points_per_mention: number;
  points_per_comment: number;
}

interface RankingExportCardProps {
  rankings: RankingEntry[];
  weekStart: Date;
  weekEnd: Date;
  settings: ChampionshipSettings;
}

const badgeConfig = {
  bronze: { 
    icon: Medal, 
    color: '#B45309',
    bg: '#FEF3C7',
    gradient: 'linear-gradient(135deg, #B45309, #F59E0B)',
    label: 'Bronze'
  },
  silver: { 
    icon: Medal, 
    color: '#94A3B8',
    bg: '#F1F5F9',
    gradient: 'linear-gradient(135deg, #94A3B8, #CBD5E1)',
    label: 'Prata'
  },
  gold: { 
    icon: Trophy, 
    color: '#EAB308',
    bg: '#FEF9C3',
    gradient: 'linear-gradient(135deg, #EAB308, #FDE047)',
    label: 'Ouro'
  },
  diamond: { 
    icon: Crown, 
    color: '#22D3EE',
    bg: '#CFFAFE',
    gradient: 'linear-gradient(135deg, #22D3EE, #A855F7)',
    label: 'Diamante'
  }
};

export const RankingExportCard = forwardRef<HTMLDivElement, RankingExportCardProps>(
  ({ rankings, weekStart, weekEnd, settings }, ref) => {
    const top5 = rankings.slice(0, 5);

    return (
      <div 
        ref={ref}
        style={{
          width: '600px',
          padding: '32px',
          background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
          borderRadius: '24px',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          color: 'white',
        }}
      >
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <div 
            style={{ 
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '64px',
              height: '64px',
              background: 'linear-gradient(135deg, #EAB308, #F97316)',
              borderRadius: '16px',
              marginBottom: '16px',
              boxShadow: '0 8px 32px rgba(234, 179, 8, 0.3)',
            }}
          >
            <Trophy style={{ width: '36px', height: '36px', color: 'white' }} />
          </div>
          <h1 style={{ 
            fontSize: '28px', 
            fontWeight: 'bold', 
            margin: '0 0 8px 0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
          }}>
            Campeonato de Engajamento
            <Sparkles style={{ width: '24px', height: '24px', color: '#EAB308' }} />
          </h1>
          <p style={{ 
            fontSize: '14px', 
            color: '#94A3B8',
            margin: 0,
          }}>
            Ranking Semanal: {format(weekStart, "dd/MM", { locale: ptBR })} - {format(weekEnd, "dd/MM/yyyy", { locale: ptBR })}
          </p>
        </div>

        {/* Rankings */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {top5.map((entry, index) => {
            const position = index + 1;
            const badge = badgeConfig[entry.badge_level];
            const isTop3 = position <= 3;

            return (
              <div 
                key={entry.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '16px',
                  padding: '16px',
                  background: isTop3 
                    ? 'rgba(255, 255, 255, 0.1)' 
                    : 'rgba(255, 255, 255, 0.05)',
                  borderRadius: '16px',
                  border: position === 1 
                    ? '2px solid #EAB308' 
                    : position === 2 
                    ? '2px solid #94A3B8' 
                    : position === 3 
                    ? '2px solid #B45309' 
                    : '1px solid rgba(255, 255, 255, 0.1)',
                }}
              >
                {/* Position */}
                <div 
                  style={{
                    width: '40px',
                    height: '40px',
                    borderRadius: '50%',
                    background: 'rgba(255, 255, 255, 0.1)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 'bold',
                    fontSize: '18px',
                  }}
                >
                  {position === 1 ? (
                    <Crown style={{ width: '24px', height: '24px', color: '#EAB308' }} />
                  ) : position === 2 ? (
                    <Medal style={{ width: '24px', height: '24px', color: '#94A3B8' }} />
                  ) : position === 3 ? (
                    <Medal style={{ width: '24px', height: '24px', color: '#B45309' }} />
                  ) : (
                    <span style={{ color: '#94A3B8' }}>{position}</span>
                  )}
                </div>

                {/* Avatar */}
                <div 
                  style={{
                    width: '48px',
                    height: '48px',
                    borderRadius: '50%',
                    background: badge.gradient,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 'bold',
                    fontSize: '20px',
                    color: 'white',
                  }}
                >
                  {entry.username.charAt(0).toUpperCase()}
                </div>

                {/* User Info */}
                <div style={{ flex: 1 }}>
                  <div style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '8px',
                    marginBottom: '4px',
                  }}>
                    <span style={{ fontWeight: '600', fontSize: '16px' }}>
                      @{entry.username}
                    </span>
                    <span 
                      style={{
                        padding: '2px 8px',
                        borderRadius: '9999px',
                        fontSize: '10px',
                        fontWeight: '600',
                        background: badge.bg,
                        color: badge.color,
                      }}
                    >
                      {badge.label}
                    </span>
                  </div>
                  <div style={{ 
                    display: 'flex', 
                    gap: '16px', 
                    fontSize: '12px',
                    color: '#94A3B8',
                  }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <AtSign style={{ width: '12px', height: '12px' }} />
                      {entry.mentions_count ?? 0}
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <MessageCircle style={{ width: '12px', height: '12px' }} />
                      {entry.comments_count ?? 0}
                    </span>
                  </div>
                </div>

                {/* Points */}
                <div style={{ textAlign: 'right' }}>
                  <div style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '4px',
                    justifyContent: 'flex-end',
                  }}>
                    <Flame style={{ 
                      width: '20px', 
                      height: '20px', 
                      color: '#F97316',
                    }} />
                    <span style={{ 
                      fontSize: '24px', 
                      fontWeight: 'bold',
                    }}>
                      {(entry.total_points ?? 0).toLocaleString('pt-BR')}
                    </span>
                  </div>
                  <span style={{ fontSize: '10px', color: '#94A3B8' }}>pontos</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div style={{ 
          marginTop: '24px', 
          textAlign: 'center',
          padding: '16px',
          background: 'rgba(255, 255, 255, 0.05)',
          borderRadius: '12px',
        }}>
          <div style={{ 
            display: 'flex', 
            justifyContent: 'center', 
            gap: '32px',
            fontSize: '12px',
            color: '#94A3B8',
          }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <AtSign style={{ width: '14px', height: '14px' }} />
              Menção = {settings.points_per_mention} pts
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <MessageCircle style={{ width: '14px', height: '14px' }} />
              Comentário = {settings.points_per_comment} pts
            </span>
          </div>
        </div>
      </div>
    );
  }
);

RankingExportCard.displayName = 'RankingExportCard';
