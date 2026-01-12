import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Lightbulb, 
  Target, 
  TrendingUp, 
  Clock, 
  Users,
  Zap,
  CheckCircle2,
  AlertCircle,
  Star,
  Calendar,
  Hash,
  MessageSquare,
  Video,
  Image,
  Film,
  Play,
  Instagram,
  Youtube,
  Sparkles
} from "lucide-react";

type Platform = 'instagram' | 'facebook' | 'youtube' | 'tiktok';

interface Strategy {
  id: string;
  title: string;
  description: string;
  tips: string[];
  bestTimes: string[];
  hashtags: string[];
  contentTypes: string[];
  frequency: string;
  priority: 'high' | 'medium' | 'low';
}

const platformStrategies: Record<Platform, Strategy[]> = {
  instagram: [
    {
      id: 'ig-reels',
      title: 'Dominar o Algoritmo dos Reels',
      description: 'Reels são a maior oportunidade de alcance orgânico no Instagram. Foque em conteúdo curto, dinâmico e que capture atenção nos primeiros 3 segundos.',
      tips: [
        'Gancho forte nos primeiros 1-3 segundos',
        'Use músicas em alta do momento',
        'Texto na tela para quem assiste sem som',
        'CTA claro no final (salvar, compartilhar)',
        'Poste entre 4-7 reels por semana',
        'Responda comentários nos primeiros 30 min',
      ],
      bestTimes: ['12:00', '18:00', '21:00'],
      hashtags: ['#reels', '#reelsviral', '#explorepage', '#fyp'],
      contentTypes: ['Tutorial rápido', 'Antes e depois', 'POV', 'Trend adaptada'],
      frequency: '4-7x por semana',
      priority: 'high',
    },
    {
      id: 'ig-stories',
      title: 'Engajamento via Stories',
      description: 'Stories são essenciais para manter sua audiência aquecida e criar conexão diária. Use enquetes, perguntas e bastidores.',
      tips: [
        'Poste stories todos os dias',
        'Use stickers de interação (enquete, quiz, perguntas)',
        'Mostre bastidores e dia a dia',
        'Crie sequências narrativas',
        'Use o Close Friends para conteúdo exclusivo',
        'Responda todas as reações e DMs',
      ],
      bestTimes: ['09:00', '12:00', '19:00', '22:00'],
      hashtags: [],
      contentTypes: ['Bastidores', 'Enquetes', 'Q&A', 'Cotidiano'],
      frequency: 'Diariamente (5-10 stories)',
      priority: 'high',
    },
    {
      id: 'ig-carrossel',
      title: 'Carrosséis Educativos',
      description: 'Carrosséis têm alta taxa de salvamento e compartilhamento. Ideal para conteúdo educativo e informativo.',
      tips: [
        'Primeira slide como "capa" atrativa',
        'Limite de 7-10 slides',
        'Design consistente com sua marca',
        'Última slide com CTA',
        'Misture texto e imagem',
        'Use números e listas',
      ],
      bestTimes: ['11:00', '14:00', '18:00'],
      hashtags: ['#dicas', '#tutorial', '#aprendizado'],
      contentTypes: ['Tutorial passo a passo', 'Lista de dicas', 'Infográfico', 'Mini-curso'],
      frequency: '2-3x por semana',
      priority: 'medium',
    },
  ],
  facebook: [
    {
      id: 'fb-grupos',
      title: 'Estratégia de Grupos',
      description: 'Grupos do Facebook ainda são uma excelente fonte de engajamento orgânico. Participe ativamente e crie comunidade.',
      tips: [
        'Crie um grupo exclusivo para sua audiência',
        'Poste perguntas para gerar discussão',
        'Faça lives semanais no grupo',
        'Modere ativamente spam e negatividade',
        'Destaque membros ativos',
        'Crie eventos e desafios',
      ],
      bestTimes: ['09:00', '13:00', '19:00'],
      hashtags: [],
      contentTypes: ['Perguntas', 'Enquetes', 'Lives', 'Desafios'],
      frequency: 'Diariamente',
      priority: 'high',
    },
    {
      id: 'fb-video',
      title: 'Vídeos Nativos',
      description: 'O Facebook prioriza vídeos nativos no feed. Invista em vídeos mais longos com legendas.',
      tips: [
        'Upload direto no Facebook (não links)',
        'Adicione legendas sempre',
        'Primeiros 3 segundos devem capturar atenção',
        'Vídeos de 3-5 minutos têm bom desempenho',
        'Use thumbnails personalizadas',
        'Responda comentários ativamente',
      ],
      bestTimes: ['12:00', '15:00', '20:00'],
      hashtags: [],
      contentTypes: ['Tutorial', 'Entrevista', 'Behind the scenes', 'Depoimentos'],
      frequency: '2-3x por semana',
      priority: 'medium',
    },
    {
      id: 'fb-reels',
      title: 'Reels no Facebook',
      description: 'Facebook está investindo pesado em Reels. Reaproveite seu conteúdo do Instagram.',
      tips: [
        'Cross-post Reels do Instagram',
        'Adapte formatos para público mais velho',
        'Use humor e entretenimento',
        'Legendas são essenciais',
        'Teste horários diferentes do Instagram',
      ],
      bestTimes: ['10:00', '14:00', '19:00'],
      hashtags: [],
      contentTypes: ['Dicas rápidas', 'Humor', 'Transformações', 'Tendências'],
      frequency: '3-5x por semana',
      priority: 'medium',
    },
  ],
  youtube: [
    {
      id: 'yt-shorts',
      title: 'YouTube Shorts',
      description: 'Shorts são a porta de entrada para novos inscritos. Use para atrair audiência e direcioná-la para vídeos longos.',
      tips: [
        'Gancho irresistível no primeiro segundo',
        'Conteúdo vertical otimizado',
        'Link para vídeos longos relacionados',
        'Use hashtag #Shorts',
        'Poste consistentemente (1x ao dia ideal)',
        'Reaproveite clips de vídeos longos',
      ],
      bestTimes: ['12:00', '17:00', '21:00'],
      hashtags: ['#Shorts', '#YouTubeShorts'],
      contentTypes: ['Clips de vídeos longos', 'Dicas rápidas', 'Bastidores', 'Trends'],
      frequency: 'Diariamente',
      priority: 'high',
    },
    {
      id: 'yt-longo',
      title: 'Vídeos Longos de Valor',
      description: 'Vídeos longos são o core do YouTube. Foque em SEO, retenção e valor genuíno para a audiência.',
      tips: [
        'Pesquise palavras-chave antes de gravar',
        'Thumbnail chamativa (CTR é crucial)',
        'Título otimizado para busca e clique',
        'Primeiros 30 segundos são decisivos',
        'Use chapters para organizar',
        'CTA para inscrição no meio do vídeo',
        'Responda comentários nas primeiras 24h',
      ],
      bestTimes: ['15:00', '17:00'],
      hashtags: [],
      contentTypes: ['Tutorial completo', 'Review', 'Vlog', 'Entrevista', 'Curso'],
      frequency: '1-2x por semana',
      priority: 'high',
    },
    {
      id: 'yt-community',
      title: 'Posts de Comunidade',
      description: 'A aba Comunidade ajuda a manter engajamento entre uploads. Use para enquetes e sneak peeks.',
      tips: [
        'Enquetes sobre próximos vídeos',
        'Prévia de conteúdos',
        'Perguntas para a audiência',
        'Memes relacionados ao nicho',
        'Notificações sobre lives',
      ],
      bestTimes: ['10:00', '18:00'],
      hashtags: [],
      contentTypes: ['Enquetes', 'Imagens', 'Texto', 'GIFs'],
      frequency: '3-4x por semana',
      priority: 'low',
    },
  ],
  tiktok: [
    {
      id: 'tt-trends',
      title: 'Surfar as Trends',
      description: 'TikTok é sobre velocidade e relevância. Adapte trends rapidamente para seu nicho.',
      tips: [
        'Monitore a aba "Para Você" diariamente',
        'Adapte trends para seu nicho em 24-48h',
        'Use sons em alta',
        'Seja autêntico, não force',
        'Teste variações da mesma trend',
        'Analise o que funciona e replique',
      ],
      bestTimes: ['07:00', '12:00', '19:00', '22:00'],
      hashtags: ['#fyp', '#parati', '#viral', '#trend'],
      contentTypes: ['Trend adaptada', 'Dueto', 'Stitch', 'POV'],
      frequency: '1-3x por dia',
      priority: 'high',
    },
    {
      id: 'tt-edu',
      title: 'Conteúdo Educativo Rápido',
      description: 'TikTok adora conteúdo que ensina algo novo. Seja direto e entregue valor em segundos.',
      tips: [
        'Vá direto ao ponto',
        '"Uma coisa que você não sabia..."',
        'Formato de lista funciona bem',
        'Texto na tela é essencial',
        'Mantenha ritmo acelerado',
        'Use exemplos visuais',
      ],
      bestTimes: ['08:00', '12:00', '17:00'],
      hashtags: ['#aprenda', '#dica', '#tutorial', '#hack'],
      contentTypes: ['Dicas rápidas', 'Hacks', 'Curiosidades', 'Mini-tutorial'],
      frequency: 'Diariamente',
      priority: 'high',
    },
    {
      id: 'tt-storytelling',
      title: 'Storytelling em Série',
      description: 'Crie séries de conteúdo que façam as pessoas voltarem. Use ganchos de continuação.',
      tips: [
        'Divida histórias em partes',
        '"Parte 1 de X..."',
        'Use cliffhangers',
        'Fixe vídeos importantes no perfil',
        'Responda perguntas em novos vídeos',
        'Crie personagens recorrentes',
      ],
      bestTimes: ['12:00', '18:00', '21:00'],
      hashtags: ['#historia', '#parte1', '#continuação'],
      contentTypes: ['Story time', 'Série', 'Saga', 'Acompanhe'],
      frequency: '3-5x por semana',
      priority: 'medium',
    },
  ],
};

const platformConfig: Record<Platform, { label: string; icon: React.ReactNode; color: string }> = {
  instagram: { label: 'Instagram', icon: <Instagram className="h-5 w-5" />, color: '#E1306C' },
  facebook: { label: 'Facebook', icon: <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>, color: '#1877F2' },
  youtube: { label: 'YouTube', icon: <Youtube className="h-5 w-5" />, color: '#FF0000' },
  tiktok: { label: 'TikTok', icon: <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24"><path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-5.2 1.74 2.89 2.89 0 012.31-4.64 2.93 2.93 0 01.88.13V9.4a6.84 6.84 0 00-1-.05A6.33 6.33 0 005 20.1a6.34 6.34 0 0010.86-4.43v-7a8.16 8.16 0 004.77 1.52v-3.4a4.85 4.85 0 01-1-.1z"/></svg>, color: '#000000' },
};

export const ContentStrategies = () => {
  const [activePlatform, setActivePlatform] = useState<Platform>('instagram');

  const strategies = platformStrategies[activePlatform];
  const config = platformConfig[activePlatform];

  const priorityConfig = {
    high: { label: 'Alta Prioridade', color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
    medium: { label: 'Média Prioridade', color: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' },
    low: { label: 'Baixa Prioridade', color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xl font-semibold flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Estratégias de Conteúdo
          </h3>
          <p className="text-sm text-muted-foreground">
            Guias práticos para maximizar seu alcance em cada rede social
          </p>
        </div>
      </div>

      {/* Tabs de Plataforma */}
      <Tabs value={activePlatform} onValueChange={(v) => setActivePlatform(v as Platform)}>
        <TabsList className="grid w-full max-w-2xl grid-cols-4">
          {(Object.keys(platformConfig) as Platform[]).map(platform => (
            <TabsTrigger key={platform} value={platform} className="gap-2">
              {platformConfig[platform].icon}
              <span className="hidden sm:inline">{platformConfig[platform].label}</span>
            </TabsTrigger>
          ))}
        </TabsList>

        {(Object.keys(platformConfig) as Platform[]).map(platform => (
          <TabsContent key={platform} value={platform} className="mt-6 space-y-6">
            {/* Estratégias da Plataforma */}
            {platformStrategies[platform].map((strategy, index) => (
              <Card key={strategy.id} className="overflow-hidden">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div 
                        className="p-2 rounded-lg"
                        style={{ backgroundColor: `${platformConfig[platform].color}20` }}
                      >
                        <Target className="h-5 w-5" style={{ color: platformConfig[platform].color }} />
                      </div>
                      <div>
                        <CardTitle className="text-lg">{strategy.title}</CardTitle>
                        <Badge className={priorityConfig[strategy.priority].color}>
                          {priorityConfig[strategy.priority].label}
                        </Badge>
                      </div>
                    </div>
                    <Badge variant="outline" className="gap-1">
                      <Calendar className="h-3 w-3" />
                      {strategy.frequency}
                    </Badge>
                  </div>
                  <CardDescription className="mt-2">
                    {strategy.description}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Dicas */}
                  <div>
                    <h4 className="text-sm font-medium flex items-center gap-2 mb-2">
                      <Lightbulb className="h-4 w-4 text-yellow-500" />
                      Dicas Práticas
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {strategy.tips.map((tip, i) => (
                        <div key={i} className="flex items-start gap-2 text-sm">
                          <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
                          <span>{tip}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Grid de informações */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 border-t">
                    {/* Melhores Horários */}
                    <div className="bg-muted/30 rounded-lg p-3">
                      <h5 className="text-xs font-medium flex items-center gap-1 mb-2 text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        Melhores Horários
                      </h5>
                      <div className="flex flex-wrap gap-1">
                        {strategy.bestTimes.map((time, i) => (
                          <Badge key={i} variant="secondary" className="text-xs">
                            {time}
                          </Badge>
                        ))}
                      </div>
                    </div>

                    {/* Tipos de Conteúdo */}
                    <div className="bg-muted/30 rounded-lg p-3">
                      <h5 className="text-xs font-medium flex items-center gap-1 mb-2 text-muted-foreground">
                        <Video className="h-3 w-3" />
                        Tipos de Conteúdo
                      </h5>
                      <div className="flex flex-wrap gap-1">
                        {strategy.contentTypes.map((type, i) => (
                          <Badge key={i} variant="outline" className="text-xs">
                            {type}
                          </Badge>
                        ))}
                      </div>
                    </div>

                    {/* Hashtags */}
                    {strategy.hashtags.length > 0 && (
                      <div className="bg-muted/30 rounded-lg p-3">
                        <h5 className="text-xs font-medium flex items-center gap-1 mb-2 text-muted-foreground">
                          <Hash className="h-3 w-3" />
                          Hashtags Recomendadas
                        </h5>
                        <div className="flex flex-wrap gap-1">
                          {strategy.hashtags.map((tag, i) => (
                            <Badge key={i} variant="secondary" className="text-xs" style={{ backgroundColor: `${platformConfig[platform].color}20`, color: platformConfig[platform].color }}>
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}

            {/* Card de Resumo */}
            <Card className="bg-gradient-to-br from-primary/5 to-primary/10 border-primary/20">
              <CardContent className="pt-6">
                <div className="flex items-start gap-4">
                  <div className="p-3 bg-primary/10 rounded-full">
                    <Zap className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <h4 className="font-semibold mb-1">Dica Rápida para {platformConfig[platform].label}</h4>
                    <p className="text-sm text-muted-foreground">
                      {platform === 'instagram' && 'Foque 70% da sua energia em Reels. É onde está o maior alcance orgânico atualmente. Stories mantêm engajamento, carrosséis geram salvamentos.'}
                      {platform === 'facebook' && 'Grupos são o novo ouro do Facebook. Crie sua comunidade e nutra ela com conteúdo exclusivo e interação genuína.'}
                      {platform === 'youtube' && 'Shorts atraem, vídeos longos convertem. Use Shorts para trazer novos inscritos e vídeos longos para construir autoridade.'}
                      {platform === 'tiktok' && 'Velocidade é tudo no TikTok. Adapte trends em menos de 48h e poste com frequência alta. A consistência supera a perfeição.'}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
};
