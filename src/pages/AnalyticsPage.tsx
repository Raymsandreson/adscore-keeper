import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Link } from "react-router-dom";
import { 
  ArrowLeft, 
  BarChart3, 
  Lightbulb, 
  TrendingUp,
  Calendar,
  Moon,
  Sun,
  Instagram,
  Youtube,
  Film,
  Clock,
  Image,
  Play,
  Video
} from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";
import { ContentTypeMetrics } from "@/components/analytics/ContentTypeMetrics";
import { ContentStrategies } from "@/components/analytics/ContentStrategies";
import { PlatformEngagement } from "@/components/analytics/PlatformEngagement";

const AnalyticsPage = () => {
  const [period, setPeriod] = useState("7");
  const { theme, toggleTheme } = useTheme();

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
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleTheme}
                className="rounded-full"
              >
                {theme === "dark" ? (
                  <Sun className="h-5 w-5" />
                ) : (
                  <Moon className="h-5 w-5" />
                )}
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="container mx-auto px-4 py-6">
        <Tabs defaultValue="dashboard" className="space-y-6">
          <TabsList className="grid w-full max-w-lg grid-cols-3">
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
          </TabsList>

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
        </Tabs>
      </main>
    </div>
  );
};

export default AnalyticsPage;
