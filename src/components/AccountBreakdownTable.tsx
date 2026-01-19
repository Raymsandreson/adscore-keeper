import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Building2, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { MetricData } from "@/hooks/useMetaAPI";
import { SavedAccount } from "@/hooks/useMultiAccountSelection";

interface AccountBreakdownTableProps {
  accountBreakdown: Map<string, MetricData>;
  activeAccounts: SavedAccount[];
  aggregatedMetrics: MetricData;
}

const formatCurrency = (value: number) => `R$ ${(value ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const formatNumber = (value: number) => (value ?? 0).toLocaleString('pt-BR');
const formatPercent = (value: number) => `${(value ?? 0).toFixed(2)}%`;

const getContributionBadge = (accountValue: number, totalValue: number) => {
  if (totalValue === 0) return null;
  const percentage = (accountValue / totalValue) * 100;
  
  if (percentage >= 40) {
    return <Badge variant="default" className="ml-2 text-xs">{percentage.toFixed(0)}%</Badge>;
  } else if (percentage >= 20) {
    return <Badge variant="secondary" className="ml-2 text-xs">{percentage.toFixed(0)}%</Badge>;
  }
  return <Badge variant="outline" className="ml-2 text-xs">{percentage.toFixed(0)}%</Badge>;
};

const getPerformanceIcon = (accountValue: number, avgValue: number, isInverse: boolean = false) => {
  if (avgValue === 0) return <Minus className="h-4 w-4 text-muted-foreground" />;
  
  const diff = ((accountValue - avgValue) / avgValue) * 100;
  const isGood = isInverse ? diff < -10 : diff > 10;
  const isBad = isInverse ? diff > 10 : diff < -10;
  
  if (isGood) return <TrendingUp className="h-4 w-4 text-green-500" />;
  if (isBad) return <TrendingDown className="h-4 w-4 text-red-500" />;
  return <Minus className="h-4 w-4 text-muted-foreground" />;
};

export const AccountBreakdownTable = ({ 
  accountBreakdown, 
  activeAccounts,
  aggregatedMetrics 
}: AccountBreakdownTableProps) => {
  const accounts = activeAccounts.filter(account => accountBreakdown.has(account.id));
  
  if (accounts.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Building2 className="h-5 w-5 text-primary" />
          Breakdown por Conta
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[150px]">Conta</TableHead>
                <TableHead className="text-right">Gasto</TableHead>
                <TableHead className="text-right">Impressões</TableHead>
                <TableHead className="text-right">Cliques</TableHead>
                <TableHead className="text-right">Conversões</TableHead>
                <TableHead className="text-right">CPC</TableHead>
                <TableHead className="text-right">CTR</TableHead>
                <TableHead className="text-right">Conv. Rate</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.map((account) => {
                const metrics = accountBreakdown.get(account.id);
                if (!metrics) return null;
                
                const avgCPC = aggregatedMetrics.cpc;
                const avgCTR = aggregatedMetrics.ctr;
                const avgConvRate = aggregatedMetrics.conversionRate;
                
                return (
                  <TableRow key={account.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <span>{account.name}</span>
                        {getContributionBadge(metrics.spend, aggregatedMetrics.spend)}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatCurrency(metrics.spend)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatNumber(metrics.impressions)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatNumber(metrics.clicks)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatNumber(metrics.conversions)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {getPerformanceIcon(metrics.cpc, avgCPC, true)}
                        <span className="font-mono">{formatCurrency(metrics.cpc)}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {getPerformanceIcon(metrics.ctr, avgCTR)}
                        <span className="font-mono">{formatPercent(metrics.ctr)}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {getPerformanceIcon(metrics.conversionRate, avgConvRate)}
                        <span className="font-mono">{formatPercent(metrics.conversionRate)}</span>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {/* Total Row */}
              <TableRow className="bg-muted/50 font-semibold border-t-2">
                <TableCell>
                  <div className="flex items-center gap-2">
                    <span>Total Combinado</span>
                    <Badge variant="default">100%</Badge>
                  </div>
                </TableCell>
                <TableCell className="text-right font-mono">
                  {formatCurrency(aggregatedMetrics.spend)}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {formatNumber(aggregatedMetrics.impressions)}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {formatNumber(aggregatedMetrics.clicks)}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {formatNumber(aggregatedMetrics.conversions)}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {formatCurrency(aggregatedMetrics.cpc)}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {formatPercent(aggregatedMetrics.ctr)}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {formatPercent(aggregatedMetrics.conversionRate)}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
};
