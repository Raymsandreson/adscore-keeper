import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  BarChart3, 
  Lightbulb,
  TrendingUp,
  PieChart
} from "lucide-react";
import { ContentTypeMetrics } from "./ContentTypeMetrics";
import { ContentStrategies } from "./ContentStrategies";

interface EngagementDashboardProps {
  isConnected?: boolean;
  pageId?: string;
  accessToken?: string;
}

export const EngagementDashboard = ({ isConnected, pageId, accessToken }: EngagementDashboardProps) => {
  const [period, setPeriod] = useState('7');

  return (
    <div className="space-y-6">
      <Tabs defaultValue="metrics" className="w-full">
        <TabsList className="grid w-full max-w-lg grid-cols-2">
          <TabsTrigger value="metrics" className="gap-2">
            <BarChart3 className="h-4 w-4" />
            Métricas por Formato
          </TabsTrigger>
          <TabsTrigger value="strategies" className="gap-2">
            <Lightbulb className="h-4 w-4" />
            Estratégias
          </TabsTrigger>
        </TabsList>

        <TabsContent value="metrics" className="mt-6">
          <ContentTypeMetrics period={period} onPeriodChange={setPeriod} />
        </TabsContent>

        <TabsContent value="strategies" className="mt-6">
          <ContentStrategies />
        </TabsContent>
      </Tabs>
    </div>
  );
};
