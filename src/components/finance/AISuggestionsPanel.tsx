import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Sparkles, Check, X, Building2, Package, Shield, Lightbulb, TrendingUp } from 'lucide-react';
import { Company } from '@/hooks/useCompanies';

interface Props {
  suggestions: {
    analysis?: string;
    suggested_products?: any[];
    suggested_cost_centers?: any[];
    suggested_nuclei?: any[];
    suggested_companies?: any[];
    equity_vs_cash_strategy?: string;
    tax_optimization_tips?: string;
  };
  companies: Company[];
  onApplyProduct: (product: any) => Promise<void>;
  onDismiss: () => void;
}

export function AISuggestionsPanel({ suggestions, companies, onApplyProduct, onDismiss }: Props) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          Sugestões da IA
        </h2>
        <Button variant="ghost" size="sm" onClick={onDismiss}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {suggestions.analysis && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="p-4">
            <p className="text-sm whitespace-pre-wrap">{suggestions.analysis}</p>
          </CardContent>
        </Card>
      )}

      {suggestions.equity_vs_cash_strategy && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4" /> Equity vs Caixa
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm whitespace-pre-wrap">{suggestions.equity_vs_cash_strategy}</p>
          </CardContent>
        </Card>
      )}

      {suggestions.tax_optimization_tips && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Shield className="h-4 w-4" /> Otimização Tributária
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm whitespace-pre-wrap">{suggestions.tax_optimization_tips}</p>
          </CardContent>
        </Card>
      )}

      {suggestions.suggested_products && suggestions.suggested_products.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Package className="h-4 w-4" /> Produtos/Serviços Sugeridos
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {suggestions.suggested_products.map((p: any, i: number) => (
              <div key={i} className="flex items-start justify-between p-3 rounded-lg border bg-card">
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium">{p.name}</p>
                    <Badge variant="outline">{p.ticket_tier}</Badge>
                    <Badge variant="secondary">{p.strategy_focus}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {p.company_name} • {p.rationale}
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={() => onApplyProduct(p)} className="ml-2 shrink-0">
                  <Check className="h-3 w-3 mr-1" /> Aplicar
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {suggestions.suggested_companies && suggestions.suggested_companies.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Building2 className="h-4 w-4" /> Novas Empresas Sugeridas
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {suggestions.suggested_companies.map((c: any, i: number) => (
              <div key={i} className="p-3 rounded-lg border bg-card">
                <p className="font-medium">{c.name}</p>
                <p className="text-xs text-muted-foreground">{c.purpose}</p>
                {c.tax_regime && <Badge variant="outline" className="mt-1">{c.tax_regime}</Badge>}
                <p className="text-xs text-muted-foreground mt-1">{c.rationale}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {suggestions.suggested_nuclei && suggestions.suggested_nuclei.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Lightbulb className="h-4 w-4" /> Núcleos Sugeridos
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {suggestions.suggested_nuclei.map((n: any, i: number) => (
              <div key={i} className="p-3 rounded-lg border bg-card">
                <div className="flex items-center gap-2">
                  <p className="font-medium">{n.name}</p>
                  <Badge variant="outline">{n.prefix}</Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-1">{n.rationale}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
