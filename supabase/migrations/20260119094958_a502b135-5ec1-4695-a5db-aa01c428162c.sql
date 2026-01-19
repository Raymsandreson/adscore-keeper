-- Tabela para armazenar pontuação de engajadores
CREATE TABLE public.engagement_rankings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  username TEXT NOT NULL,
  user_id TEXT, -- Instagram user ID se disponível
  profile_picture_url TEXT,
  
  -- Pontuações por tipo de engajamento
  mentions_count INTEGER DEFAULT 0,
  comments_count INTEGER DEFAULT 0,
  total_points INTEGER DEFAULT 0,
  
  -- Período da semana
  week_start DATE NOT NULL,
  week_end DATE NOT NULL,
  
  -- Nível baseado em pontos
  badge_level TEXT DEFAULT 'bronze' CHECK (badge_level IN ('bronze', 'silver', 'gold', 'diamond')),
  
  -- Posição no ranking
  rank_position INTEGER,
  previous_rank_position INTEGER,
  
  ad_account_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  -- Evitar duplicatas por usuário/semana
  UNIQUE(username, week_start, ad_account_id)
);

-- Tabela para histórico de campeões
CREATE TABLE public.engagement_champions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  username TEXT NOT NULL,
  user_id TEXT,
  profile_picture_url TEXT,
  
  -- Dados do período
  week_start DATE NOT NULL,
  week_end DATE NOT NULL,
  
  -- Estatísticas finais
  total_points INTEGER NOT NULL,
  mentions_count INTEGER DEFAULT 0,
  comments_count INTEGER DEFAULT 0,
  badge_level TEXT NOT NULL,
  
  -- Posição (1º, 2º, 3º lugar)
  final_position INTEGER NOT NULL CHECK (final_position BETWEEN 1 AND 3),
  
  ad_account_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Tabela para configurações do campeonato
CREATE TABLE public.engagement_championship_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  
  -- Pontuação por tipo de ação
  points_per_mention INTEGER DEFAULT 5,
  points_per_comment INTEGER DEFAULT 2,
  
  -- Níveis de badge (pontos mínimos)
  bronze_threshold INTEGER DEFAULT 0,
  silver_threshold INTEGER DEFAULT 20,
  gold_threshold INTEGER DEFAULT 50,
  diamond_threshold INTEGER DEFAULT 100,
  
  -- Notificações
  notify_on_rank_change BOOLEAN DEFAULT true,
  notify_on_new_champion BOOLEAN DEFAULT true,
  
  ad_account_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.engagement_rankings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.engagement_champions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.engagement_championship_settings ENABLE ROW LEVEL SECURITY;

-- Políticas de acesso público (para leaderboard público)
CREATE POLICY "Allow all access to engagement_rankings" 
ON public.engagement_rankings FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all access to engagement_champions" 
ON public.engagement_champions FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all access to engagement_championship_settings" 
ON public.engagement_championship_settings FOR ALL USING (true) WITH CHECK (true);

-- Trigger para updated_at
CREATE TRIGGER update_engagement_rankings_updated_at
BEFORE UPDATE ON public.engagement_rankings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_engagement_championship_settings_updated_at
BEFORE UPDATE ON public.engagement_championship_settings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();