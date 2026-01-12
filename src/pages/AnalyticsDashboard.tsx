import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, BarChart3, TrendingUp, Lightbulb, PieChart } from "lucide-react";
import { EngagementDashboard } from "@/components/analytics/EngagementDashboard";

export default function AnalyticsDashboard() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/20 p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link to="/">
              <Button variant="ghost" size="icon">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2">
                <BarChart3 className="h-7 w-7 text-primary" />
                Dashboard de Engajamento
              </h1>
              <p className="text-muted-foreground">
                Métricas detalhadas por rede social, formato de conteúdo e estratégias
              </p>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <EngagementDashboard />
      </div>
    </div>
  );
}
