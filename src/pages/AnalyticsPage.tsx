import { useState } from "react";
import { usePageState } from "@/hooks/usePageState";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { 
  ArrowLeft, 
  BarChart3, 
  Lightbulb, 
  TrendingUp,
  Instagram,
  LineChart,
  MessageCircle,
  ExternalLink,
  Search,
  DollarSign,
} from "lucide-react";
import { ContentTypeMetrics } from "@/components/analytics/ContentTypeMetrics";
import { ContentStrategies } from "@/components/analytics/ContentStrategies";
import { PlatformEngagement } from "@/components/analytics/PlatformEngagement";
import { InstagramAccountsManager } from "@/components/analytics/InstagramAccountsManager";
import { InstagramMetricsChart } from "@/components/analytics/InstagramMetricsChart";
import { CommentsAdminPanel } from "@/components/instagram/CommentsAdminPanel";
import { ExternalPostsManager } from "@/components/instagram/ExternalPostsManager";
import { CaseSearchEngine } from "@/components/instagram/CaseSearchEngine";
import { FollowerInsightsPanel } from "@/components/analytics/FollowerInsightsPanel";

const AnalyticsPage = () => {
  const [period, setPeriod] = useState("7");
  const [activeTab, setActiveTab] = usePageState<string>('analytics_activeTab', 'accounts');

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card/50 backdrop-blur supports-[backdrop-filter]:bg-card/50 sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link to="/">
                <Button variant="ghost" size="sm" className="gap-2">
                  <ArrowLeft className="h-4 w-4" />
                  Voltar
                </Button>
              </Link>
              <div>
                <h1 className="text-2xl font-bold flex items-center gap-2">
                  <BarChart3 className="h-6 w-6 text-primary" />
                  Analytics de Redes Sociais
                </h1>
                <p className="text-sm text-muted-foreground">
                  Métricas de engajamento por plataforma e tipo de conteúdo
                </p>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="container mx-auto px-4 py-6">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid w-full max-w-5xl grid-cols-9">
            <TabsTrigger value="accounts" className="gap-2">
              <Instagram className="h-4 w-4" />
              <span className="hidden sm:inline">Contas</span>
            </TabsTrigger>
            <TabsTrigger value="search" className="gap-2">
              <Search className="h-4 w-4" />
              <span className="hidden sm:inline">Busca</span>
            </TabsTrigger>
            <TabsTrigger value="comments" className="gap-2">
              <MessageCircle className="h-4 w-4" />
              <span className="hidden sm:inline">Comentários</span>
            </TabsTrigger>
            <TabsTrigger value="external" className="gap-2">
              <ExternalLink className="h-4 w-4" />
              <span className="hidden sm:inline">Externos</span>
            </TabsTrigger>
            <TabsTrigger value="evolution" className="gap-2">
              <LineChart className="h-4 w-4" />
              <span className="hidden sm:inline">Evolução</span>
            </TabsTrigger>
            <TabsTrigger value="dashboard" className="gap-2">
              <BarChart3 className="h-4 w-4" />
              <span className="hidden sm:inline">Dashboard</span>
            </TabsTrigger>
            <TabsTrigger value="platforms" className="gap-2">
              <TrendingUp className="h-4 w-4" />
              <span className="hidden sm:inline">Plataformas</span>
            </TabsTrigger>
            <TabsTrigger value="strategies" className="gap-2">
              <Lightbulb className="h-4 w-4" />
              <span className="hidden sm:inline">Estratégias</span>
            </TabsTrigger>
            <TabsTrigger value="followers" className="gap-2">
              <DollarSign className="h-4 w-4" />
              <span className="hidden sm:inline">Seguidores</span>
            </TabsTrigger>
          </TabsList>

          {/* Accounts Tab */}
          <TabsContent value="accounts" className="space-y-6">
            <InstagramAccountsManager />
          </TabsContent>

          {/* Case Search Tab */}
          <TabsContent value="search" className="space-y-6">
            <CaseSearchEngine />
          </TabsContent>

          {/* Comments Admin Tab */}
          <TabsContent value="comments" className="space-y-6">
            <CommentsAdminPanel />
          </TabsContent>

          {/* External Posts Tab */}
          <TabsContent value="external" className="space-y-6">
            <ExternalPostsManager />
          </TabsContent>

          {/* Evolution Tab */}
          <TabsContent value="evolution" className="space-y-6">
            <InstagramMetricsChart />
          </TabsContent>

          {/* Dashboard Tab */}
          <TabsContent value="dashboard" className="space-y-6">
            <ContentTypeMetrics period={period} onPeriodChange={setPeriod} />
          </TabsContent>

          {/* Platforms Tab */}
          <TabsContent value="platforms" className="space-y-6">
            <PlatformEngagement period={period} onPeriodChange={setPeriod} />
          </TabsContent>

          {/* Strategies Tab */}
          <TabsContent value="strategies" className="space-y-6">
            <ContentStrategies />
          </TabsContent>
          {/* Follower Insights Tab */}
          <TabsContent value="followers" className="space-y-6">
            <FollowerInsightsPanel />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
};

export default AnalyticsPage;
