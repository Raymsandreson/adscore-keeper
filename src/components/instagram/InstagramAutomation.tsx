import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Bot, 
  MessageCircle, 
  Target, 
  TrendingUp,
  Settings,
  Plus,
  RefreshCw,
  BarChart3,
  Filter,
  Trophy
} from "lucide-react";
import { EngagementGoals } from "./EngagementGoals";
import { AutoReplyRules } from "./AutoReplyRules";
import { CommentsTracker } from "./CommentsTracker";
import { EngagementStats } from "./EngagementStats";
import { CommentsDashboard } from "./CommentsDashboard";
import { ProspectingFunnel } from "./ProspectingFunnel";
import { EngagementChampionship } from "./EngagementChampionship";
interface InstagramAutomationProps {
  isConnected: boolean;
  pageId?: string;
  accessToken?: string;
  initialTab?: string;
}

const InstagramAutomation = ({ isConnected, pageId, accessToken, initialTab }: InstagramAutomationProps) => {
  const [activeTab, setActiveTab] = useState(initialTab || "funnel");

  // Sync activeTab with initialTab prop changes (from URL)
  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Bot className="h-6 w-6 text-primary" />
            Automação Instagram
          </h2>
          <p className="text-muted-foreground">
            Gerencie respostas automáticas, metas de engajamento e acompanhe seus comentários
          </p>
        </div>
        <Badge variant={isConnected ? "default" : "secondary"} className={isConnected ? "bg-green-500" : ""}>
          {isConnected ? "Conectado" : "Desconectado"}
        </Badge>
      </div>

      {/* Main Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-7">
          <TabsTrigger value="funnel" className="gap-2">
            <Filter className="h-4 w-4" />
            Funil
          </TabsTrigger>
          <TabsTrigger value="championship" className="gap-2">
            <Trophy className="h-4 w-4" />
            Campeonato
          </TabsTrigger>
          <TabsTrigger value="dashboard" className="gap-2">
            <BarChart3 className="h-4 w-4" />
            Dashboard
          </TabsTrigger>
          <TabsTrigger value="goals" className="gap-2">
            <Target className="h-4 w-4" />
            Metas
          </TabsTrigger>
          <TabsTrigger value="comments" className="gap-2">
            <MessageCircle className="h-4 w-4" />
            Comentários
          </TabsTrigger>
          <TabsTrigger value="automation" className="gap-2">
            <Bot className="h-4 w-4" />
            Automação
          </TabsTrigger>
          <TabsTrigger value="stats" className="gap-2">
            <TrendingUp className="h-4 w-4" />
            Estatísticas
          </TabsTrigger>
        </TabsList>

        <TabsContent value="funnel" className="mt-6">
          <ProspectingFunnel />
        </TabsContent>

        <TabsContent value="championship" className="mt-6">
          <EngagementChampionship />
        </TabsContent>

        <TabsContent value="dashboard" className="mt-6">
          <CommentsDashboard />
        </TabsContent>

        <TabsContent value="goals" className="mt-6">
          <EngagementGoals />
        </TabsContent>

        <TabsContent value="comments" className="mt-6">
          <CommentsTracker pageId={pageId} accessToken={accessToken} isConnected={isConnected} />
        </TabsContent>

        <TabsContent value="automation" className="mt-6">
          <AutoReplyRules />
        </TabsContent>

        <TabsContent value="stats" className="mt-6">
          <EngagementStats />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default InstagramAutomation;
