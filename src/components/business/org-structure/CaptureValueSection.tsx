import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Building2, TrendingUp, Target } from 'lucide-react';
import { Company } from '@/hooks/useCompanies';
import { ProductService } from '@/hooks/useProductsServices';
import { ValueFlowSection } from './ValueFlowSection';

interface CaptureValueSectionProps {
  companies: Company[];
  products: ProductService[];
}

export function CaptureValueSection({ companies, products }: CaptureValueSectionProps) {
  const activeCompanies = companies.filter(c => c.is_active);
  const activeProducts = products.filter(p => p.is_active);

  // Derive ticket tiers and strategy focus
  const ticketTiers = {
    low: activeProducts.filter(p => p.ticket_tier === 'low').length,
    medium: activeProducts.filter(p => p.ticket_tier === 'medium').length,
    high: activeProducts.filter(p => p.ticket_tier === 'high').length,
  };

  const strategyFocus = {
    cash: activeProducts.filter(p => p.strategy_focus === 'cash').length,
    equity: activeProducts.filter(p => p.strategy_focus === 'equity').length,
    hybrid: activeProducts.filter(p => p.strategy_focus === 'hybrid').length,
  };

  return (
    <ValueFlowSection
      color="amber"
      number={3}
      title="Capturar Valor"
      subtitle="Empresas como ativos de Equity — marca forte = premium pricing"
    >
      {/* Empresas como veículos de Equity */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Building2 className="h-4 w-4 text-amber-500" />
            Empresas — Veículos de Equity
            <Badge variant="secondary" className="ml-auto">{activeCompanies.length} empresas</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-3">
            Não são só proteção tributária — são ativos construídos para valer no mercado. Cada empresa carrega uma marca.
          </p>
          {activeCompanies.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-3 italic">Nenhuma empresa cadastrada</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {activeCompanies.map(c => (
                <div key={c.id} className="p-3 rounded-lg border bg-card">
                  <p className="font-medium text-sm">{c.name}</p>
                  {c.trading_name && <p className="text-xs text-muted-foreground">Marca: {c.trading_name}</p>}
                  {c.cnpj && <p className="text-xs text-muted-foreground font-mono">{c.cnpj}</p>}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Foco Estratégico */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-amber-500" />
            Foco Estratégico
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-3">
            Equity {'>'} Cash — construir para valer, não só para faturar.
          </p>
          <div className="grid grid-cols-3 gap-3">
            <div className="p-3 rounded-lg border bg-card text-center">
              <p className="text-2xl font-bold text-emerald-500">{strategyFocus.cash}</p>
              <p className="text-xs text-muted-foreground">Cash</p>
            </div>
            <div className="p-3 rounded-lg border bg-card text-center">
              <p className="text-2xl font-bold text-blue-500">{strategyFocus.equity}</p>
              <p className="text-xs text-muted-foreground">Equity</p>
            </div>
            <div className="p-3 rounded-lg border bg-card text-center">
              <p className="text-2xl font-bold text-amber-500">{strategyFocus.hybrid}</p>
              <p className="text-xs text-muted-foreground">Híbrido</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Ticket Tiers */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Target className="h-4 w-4 text-amber-500" />
            Faixas de Ticket
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-3">
            Posicionamento de valor percebido pela marca — ticket alto requer marca forte.
          </p>
          <div className="grid grid-cols-3 gap-3">
            <div className="p-3 rounded-lg border bg-card text-center">
              <p className="text-2xl font-bold">{ticketTiers.low}</p>
              <p className="text-xs text-muted-foreground">Low Ticket</p>
            </div>
            <div className="p-3 rounded-lg border bg-card text-center">
              <p className="text-2xl font-bold">{ticketTiers.medium}</p>
              <p className="text-xs text-muted-foreground">Medium Ticket</p>
            </div>
            <div className="p-3 rounded-lg border bg-card text-center">
              <p className="text-2xl font-bold">{ticketTiers.high}</p>
              <p className="text-xs text-muted-foreground">High Ticket</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </ValueFlowSection>
  );
}
