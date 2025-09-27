import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const BenchmarkTable = () => {
  const benchmarks = [
    {
      metric: "CPC - Custo por Clique",
      good: "Até R$ 1,50",
      average: "R$ 1,50 - R$ 3,00",
      bad: "Acima de R$ 3,00",
      note: "Mercados competitivos podem ir até R$ 2,50"
    },
    {
      metric: "CTR - Taxa de Cliques",
      good: "Acima de 2%",
      average: "1% - 2%",
      bad: "Abaixo de 1%",
      note: "Google Ads: 5-10% na rede de pesquisa"
    },
    {
      metric: "CPM - Custo por Mil",
      good: "R$ 5 - R$ 20",
      average: "R$ 20 - R$ 30",
      bad: "Acima de R$ 30",
      note: "Concorrência alta inflaciona o CPM"
    },
    {
      metric: "Taxa de Conversão",
      good: "E-com: 3%+ | Leads: 20%+",
      average: "E-com: 1-3% | Leads: 10-20%",
      bad: "E-com: <1% | Leads: <10%",
      note: "Varia conforme tipo de negócio"
    },
    {
      metric: "Taxa de Gancho (3s)",
      good: "30% - 35%+",
      average: "20% - 30%",
      bad: "Abaixo de 20%",
      note: "Primeiros 3 segundos são cruciais"
    }
  ];

  return (
    <Card className="bg-gradient-card border-border shadow-card-custom animate-fade-in-up group overflow-hidden relative">
      {/* Efeito de gradiente no fundo */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-accent-bright/5 opacity-0 group-hover:opacity-100 transition-opacity duration-700"></div>
      
      <CardHeader className="relative z-10">
        <CardTitle className="text-2xl font-bold text-center gradient-text">
          📊 Tabela de Benchmarks de Referência
        </CardTitle>
        <div className="w-16 h-1 bg-gradient-primary mx-auto rounded-full animate-bounce-in animation-delay-300"></div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full table-auto">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-3 px-2 font-semibold">Métrica</th>
                <th className="text-center py-3 px-2 font-semibold">
                  <Badge variant="default" className="bg-success text-success-foreground">
                    Bom
                  </Badge>
                </th>
                <th className="text-center py-3 px-2 font-semibold">
                  <Badge variant="default" className="bg-warning text-warning-foreground">
                    Médio
                  </Badge>
                </th>
                <th className="text-center py-3 px-2 font-semibold">
                  <Badge variant="default" className="bg-danger text-danger-foreground">
                    Ruim
                  </Badge>
                </th>
                <th className="text-left py-3 px-2 font-semibold">Observação</th>
              </tr>
            </thead>
            <tbody>
              {benchmarks.map((benchmark, index) => (
                <tr key={index} className="border-b border-border/50 hover:bg-secondary/20 transition-colors">
                  <td className="py-4 px-2 font-medium">{benchmark.metric}</td>
                  <td className="py-4 px-2 text-center text-success font-medium">
                    {benchmark.good}
                  </td>
                  <td className="py-4 px-2 text-center text-warning font-medium">
                    {benchmark.average}
                  </td>
                  <td className="py-4 px-2 text-center text-danger font-medium">
                    {benchmark.bad}
                  </td>
                  <td className="py-4 px-2 text-sm text-muted-foreground">
                    {benchmark.note}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        
        <div className="mt-6 p-6 bg-gradient-to-br from-secondary/20 to-primary/5 rounded-xl border border-border relative overflow-hidden animate-slide-in-right animation-delay-500">
          {/* Efeito de brilho */}
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-primary animate-shimmer"></div>
          
          <h4 className="font-semibold mb-4 text-primary flex items-center gap-2">
            <span className="text-lg">⚡</span>
            Resumo Rápido - Benchmarks Essenciais:
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <div className="flex items-center gap-2 p-2 rounded-lg bg-success/10 hover:bg-success/20 transition-colors duration-300">
              <span className="text-success">💰</span>
              <span><strong>CPC:</strong> até R$ 1,50 bom / acima de R$ 3 ruim</span>
            </div>
            <div className="flex items-center gap-2 p-2 rounded-lg bg-primary/10 hover:bg-primary/20 transition-colors duration-300">
              <span className="text-primary">🎯</span>
              <span><strong>CTR:</strong> 2%+ bom / abaixo de 1% ruim</span>
            </div>
            <div className="flex items-center gap-2 p-2 rounded-lg bg-warning/10 hover:bg-warning/20 transition-colors duration-300">
              <span className="text-warning">👁️</span>
              <span><strong>CPM:</strong> R$ 5-20 bom / acima de R$ 30 ruim</span>
            </div>
            <div className="flex items-center gap-2 p-2 rounded-lg bg-accent-bright/10 hover:bg-accent-bright/20 transition-colors duration-300">
              <span className="text-accent-bright">📈</span>
              <span><strong>Conversão:</strong> Leads 10%+ / E-commerce 1-3%</span>
            </div>
            <div className="flex items-center gap-2 p-2 rounded-lg bg-neon-purple/10 hover:bg-neon-purple/20 transition-colors duration-300 md:col-span-2">
              <span className="text-neon-purple">🚀</span>
              <span><strong>Gancho 3s:</strong> 30%+ bom / abaixo de 20% ruim</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default BenchmarkTable;