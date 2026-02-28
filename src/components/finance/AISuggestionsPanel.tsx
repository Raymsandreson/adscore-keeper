import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Sparkles, Check, X, Building2, Package, Shield, Lightbulb, TrendingUp, ChevronDown, ChevronRight } from 'lucide-react';
import { Company } from '@/hooks/useCompanies';
import { useState } from 'react';

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
  onApplyCompany?: (company: any) => Promise<void>;
  onApplyNucleus?: (nucleus: any) => Promise<void>;
  onDismiss: () => void;
}

export function AISuggestionsPanel({ suggestions, companies, onApplyProduct, onApplyCompany, onApplyNucleus, onDismiss }: Props) {
  const [appliedCompanies, setAppliedCompanies] = useState<Set<number>>(new Set());
  const [appliedNuclei, setAppliedNuclei] = useState<Set<number>>(new Set());
  const [appliedProducts, setAppliedProducts] = useState<Set<number>>(new Set());
  const [expandedCompanies, setExpandedCompanies] = useState<Set<number>>(new Set());

  // Group products by company for hierarchical view
  const productsByCompany = (suggestions.suggested_products || []).reduce((acc: Record<string, any[]>, p: any, i: number) => {
    const key = p.company_name || 'Sem Empresa';
    if (!acc[key]) acc[key] = [];
    acc[key].push({ ...p, _index: i });
    return acc;
  }, {});

  // Group nuclei by company if they have company_name
  const nucleiByCompany = (suggestions.suggested_nuclei || []).reduce((acc: Record<string, any[]>, n: any, i: number) => {
    const key = n.company_name || '_general';
    if (!acc[key]) acc[key] = [];
    acc[key].push({ ...n, _index: i });
    return acc;
  }, {});

  const toggleExpand = (idx: number) => {
    setExpandedCompanies(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

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

      {/* Hierarchical: Companies → Nuclei → Products */}
      {suggestions.suggested_companies && suggestions.suggested_companies.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Building2 className="h-4 w-4" /> Estrutura Sugerida (Empresa → Núcleo → Produtos)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {suggestions.suggested_companies.map((c: any, i: number) => {
              const isExpanded = expandedCompanies.has(i);
              const companyNuclei = nucleiByCompany[c.name] || [];
              const companyProducts = productsByCompany[c.name] || [];
              const isApplied = appliedCompanies.has(i);

              return (
                <div key={i} className="rounded-lg border bg-card overflow-hidden">
                  {/* Company Header */}
                  <div className="p-3 flex items-start justify-between">
                    <div className="flex-1 cursor-pointer" onClick={() => toggleExpand(i)}>
                      <div className="flex items-center gap-2">
                        {(companyNuclei.length > 0 || companyProducts.length > 0) ? (
                          isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        ) : null}
                        <Building2 className="h-4 w-4 text-muted-foreground" />
                        <p className="font-semibold">{c.name}</p>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 ml-6">{c.purpose}</p>
                      {c.tax_regime && <Badge variant="outline" className="mt-1 ml-6">{c.tax_regime}</Badge>}
                      <p className="text-xs text-muted-foreground mt-1 ml-6">{c.rationale}</p>
                    </div>
                    {onApplyCompany && (
                      <Button
                        size="sm"
                        variant={isApplied ? "secondary" : "outline"}
                        disabled={isApplied}
                        onClick={async () => {
                          await onApplyCompany(c);
                          setAppliedCompanies(prev => new Set(prev).add(i));
                        }}
                        className="ml-2 shrink-0"
                      >
                        <Check className="h-3 w-3 mr-1" /> {isApplied ? 'Aplicado' : 'Aplicar'}
                      </Button>
                    )}
                  </div>

                  {/* Nested Nuclei & Products */}
                  {isExpanded && (
                    <div className="border-t bg-muted/30 p-3 space-y-2">
                      {/* Nuclei for this company */}
                      {companyNuclei.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-xs font-medium text-muted-foreground flex items-center gap-1 ml-2">
                            <Lightbulb className="h-3 w-3" /> Núcleos
                          </p>
                          {companyNuclei.map((n: any) => {
                            const nApplied = appliedNuclei.has(n._index);
                            return (
                              <div key={n._index} className="flex items-start justify-between p-2 rounded-md border bg-card ml-4">
                                <div className="flex-1">
                                  <div className="flex items-center gap-2">
                                    <p className="font-medium text-sm">{n.name}</p>
                                    <Badge variant="outline" className="text-xs">{n.prefix}</Badge>
                                  </div>
                                  <p className="text-xs text-muted-foreground mt-1">{n.rationale}</p>
                                </div>
                                {onApplyNucleus && (
                                  <Button
                                    size="sm"
                                    variant={nApplied ? "secondary" : "outline"}
                                    disabled={nApplied}
                                    onClick={async () => {
                                      await onApplyNucleus(n);
                                      setAppliedNuclei(prev => new Set(prev).add(n._index));
                                    }}
                                    className="ml-2 shrink-0"
                                  >
                                    <Check className="h-3 w-3 mr-1" /> {nApplied ? 'Aplicado' : 'Aplicar'}
                                  </Button>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* Products for this company */}
                      {companyProducts.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-xs font-medium text-muted-foreground flex items-center gap-1 ml-2">
                            <Package className="h-3 w-3" /> Produtos/Serviços
                          </p>
                          {companyProducts.map((p: any) => {
                            const pApplied = appliedProducts.has(p._index);
                            return (
                              <div key={p._index} className="flex items-start justify-between p-2 rounded-md border bg-card ml-4">
                                <div className="flex-1">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <p className="font-medium text-sm">{p.name}</p>
                                    <Badge variant="outline" className="text-xs">{p.ticket_tier}</Badge>
                                    <Badge variant="secondary" className="text-xs">{p.strategy_focus}</Badge>
                                  </div>
                                  <p className="text-xs text-muted-foreground mt-1">{p.rationale}</p>
                                </div>
                                <Button
                                  size="sm"
                                  variant={pApplied ? "secondary" : "outline"}
                                  disabled={pApplied}
                                  onClick={async () => {
                                    await onApplyProduct(p);
                                    setAppliedProducts(prev => new Set(prev).add(p._index));
                                  }}
                                  className="ml-2 shrink-0"
                                >
                                  <Check className="h-3 w-3 mr-1" /> {pApplied ? 'Aplicado' : 'Aplicar'}
                                </Button>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {companyNuclei.length === 0 && companyProducts.length === 0 && (
                        <p className="text-xs text-muted-foreground ml-4 italic">Nenhum núcleo ou produto sugerido para esta empresa</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Standalone products not tied to suggested companies */}
      {(() => {
        const suggestedCompanyNames = new Set((suggestions.suggested_companies || []).map((c: any) => c.name));
        const standaloneProducts = (suggestions.suggested_products || []).filter((p: any) => !suggestedCompanyNames.has(p.company_name));
        if (standaloneProducts.length === 0) return null;
        return (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Package className="h-4 w-4" /> Produtos/Serviços para Empresas Existentes
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {standaloneProducts.map((p: any, i: number) => {
                const idx = (suggestions.suggested_products || []).indexOf(p);
                const pApplied = appliedProducts.has(idx);
                return (
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
                    <Button
                      size="sm"
                      variant={pApplied ? "secondary" : "outline"}
                      disabled={pApplied}
                      onClick={async () => {
                        await onApplyProduct(p);
                        setAppliedProducts(prev => new Set(prev).add(idx));
                      }}
                      className="ml-2 shrink-0"
                    >
                      <Check className="h-3 w-3 mr-1" /> {pApplied ? 'Aplicado' : 'Aplicar'}
                    </Button>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        );
      })()}

      {/* Standalone nuclei not tied to suggested companies */}
      {(() => {
        const generalNuclei = nucleiByCompany['_general'] || [];
        if (generalNuclei.length === 0) return null;
        return (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Lightbulb className="h-4 w-4" /> Núcleos Sugeridos (Geral)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {generalNuclei.map((n: any) => {
                const nApplied = appliedNuclei.has(n._index);
                return (
                  <div key={n._index} className="flex items-start justify-between p-3 rounded-lg border bg-card">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-medium">{n.name}</p>
                        <Badge variant="outline">{n.prefix}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">{n.rationale}</p>
                    </div>
                    {onApplyNucleus && (
                      <Button
                        size="sm"
                        variant={nApplied ? "secondary" : "outline"}
                        disabled={nApplied}
                        onClick={async () => {
                          await onApplyNucleus(n);
                          setAppliedNuclei(prev => new Set(prev).add(n._index));
                        }}
                        className="ml-2 shrink-0"
                      >
                        <Check className="h-3 w-3 mr-1" /> {nApplied ? 'Aplicado' : 'Aplicar'}
                      </Button>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        );
      })()}
    </div>
  );
}
