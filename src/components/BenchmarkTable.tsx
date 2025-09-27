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
    <Card className="bg-gradient-card border-border shadow-card-custom">
      <CardHeader>
        <CardTitle className="text-2xl font-semibold text-center">
          Tabela de Benchmarks de Referência
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full table-auto">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-3 px-2 font-medium text-foreground">Métrica</th>
                <th className="text-center py-3 px-2 font-medium">
                  <Badge className="status-success">
                    Bom
                  </Badge>
                </th>
                <th className="text-center py-3 px-2 font-medium">
                  <Badge className="status-warning">
                    Médio
                  </Badge>
                </th>
                <th className="text-center py-3 px-2 font-medium">
                  <Badge className="status-danger">
                    Ruim
                  </Badge>
                </th>
                <th className="text-left py-3 px-2 font-medium text-foreground">Observação</th>
              </tr>
            </thead>
            <tbody>
              {benchmarks.map((benchmark, index) => (
                <tr key={index} className="border-b border-border/50 hover:bg-muted/50 transition-colors">
                  <td className="py-4 px-2 font-medium text-foreground">{benchmark.metric}</td>
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
        
        <div className="mt-6 p-4 bg-muted/30 rounded-lg border border-border">
          <h4 className="font-medium mb-3 text-foreground">
            Resumo dos Benchmarks Essenciais:
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-success font-medium">CPC:</span>
              <span className="text-muted-foreground">até R$ 1,50 (bom) | R$ 3,00+ (ruim)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-primary font-medium">CTR:</span>
              <span className="text-muted-foreground">2%+ (bom) | abaixo de 1% (ruim)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-warning font-medium">CPM:</span>
              <span className="text-muted-foreground">R$ 5-20 (bom) | R$ 30+ (ruim)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-success font-medium">Conversão:</span>
              <span className="text-muted-foreground">Leads 10%+ | E-commerce 1-3%</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default BenchmarkTable;