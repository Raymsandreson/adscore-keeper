import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Sparkles, Building2, Package, Target, TrendingUp, Loader2, Plus, Pencil, Trash2, DollarSign, Shield, Lightbulb, Eye, Send, Mic } from 'lucide-react';
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { VoiceInputButton } from '@/components/ui/voice-input-button';
import { useCompanies } from '@/hooks/useCompanies';
import { useProductsServices, ProductService } from '@/hooks/useProductsServices';
import { useCostCenters } from '@/hooks/useCostCenters';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { ProductFormDialog } from '@/components/finance/ProductFormDialog';
import { AISuggestionsPanel } from '@/components/finance/AISuggestionsPanel';

const TIER_CONFIG = {
  low: { label: 'Low Ticket', color: 'bg-emerald-500/10 text-emerald-700 border-emerald-200', icon: '💰', strategy: 'Geração de Caixa' },
  medium: { label: 'Medium Ticket', color: 'bg-amber-500/10 text-amber-700 border-amber-200', icon: '📈', strategy: 'Crescimento' },
  high: { label: 'High Ticket', color: 'bg-purple-500/10 text-purple-700 border-purple-200', icon: '🏗️', strategy: 'Equity / Margem' },
};

const FOCUS_CONFIG = {
  cash: { label: 'Caixa', color: 'text-emerald-600' },
  equity: { label: 'Equity', color: 'text-purple-600' },
  hybrid: { label: 'Híbrido', color: 'text-amber-600' },
};

export default function CostOrganizationPage() {
  const { companies } = useCompanies();
  const { products, addProduct, updateProduct, deleteProduct, loading: productsLoading } = useProductsServices();
  const { costCenters } = useCostCenters();
  const [aiLoading, setAiLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<any>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<ProductService | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [customContext, setCustomContext] = useState(
    'Analise a estrutura atual e sugira a melhor organização completa para o grupo, com foco em otimização tributária, construção de equity e geração de caixa.'
  );

  const suggestionsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!suggestions) return;
    setShowPrompt(false);
    requestAnimationFrame(() => {
      suggestionsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, [suggestions]);

  const requestAISuggestions = async (context?: string) => {
    setAiLoading(true);
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('A sugestão está demorando. Tente novamente.')), 35000);
      });

      const invokePromise = supabase.functions.invoke('suggest-cost-organization', {
        body: { context },
      });

      const { data, error } = await Promise.race([invokePromise, timeoutPromise]) as Awaited<typeof invokePromise>;

      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (!data?.suggestions) throw new Error('A IA não retornou sugestões.');

      setSuggestions(data.suggestions);
      toast.success('Sugestões da IA geradas!');
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || 'Erro ao gerar sugestões');
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      setAiLoading(false);
    }
  };

  const handleEdit = (product: ProductService) => {
    setEditingProduct(product);
    setDialogOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (confirm('Remover este produto/serviço?')) {
      await deleteProduct(id);
    }
  };

  const handleNewProduct = () => {
    setEditingProduct(null);
    setDialogOpen(true);
  };

  // Group products by company
  const productsByCompany = companies.map(company => ({
    company,
    products: products.filter(p => p.company_id === company.id),
  })).filter(g => g.products.length > 0 || true);

  // Calculate profitability summary by tier
  const tierSummary = (['low', 'medium', 'high'] as const).map(tier => ({
    tier,
    ...TIER_CONFIG[tier],
    count: products.filter(p => p.ticket_tier === tier).length,
    companies: [...new Set(products.filter(p => p.ticket_tier === tier).map(p => p.company_id))].length,
  }));

  return (
    <div className="container mx-auto py-6 space-y-6 max-w-7xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Target className="h-6 w-6 text-primary" />
            Organização Estratégica
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Estrutura de centros de custo, produtos e estratégia por faixa de ticket
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleNewProduct}>
            <Plus className="h-4 w-4 mr-2" />
            Novo Produto
          </Button>
          <Button
            variant={showPrompt ? 'default' : 'outline'}
            onClick={() => setShowPrompt(!showPrompt)}
          >
            <Sparkles className="h-4 w-4 mr-2" />
            Sugerir com IA
          </Button>
        </div>
      </div>

      {/* AI Context & Instructions Panel */}
      <Collapsible open={showPrompt} onOpenChange={setShowPrompt}>
        <CollapsibleContent>
          <Card className="border-primary/30 bg-gradient-to-br from-primary/5 to-primary/10">
            <CardContent className="pt-5 space-y-4">
              {/* Current data summary */}
              <div>
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Dados que a IA já conhece</Label>
                <div className="flex flex-wrap gap-2 mt-2">
                  <Badge variant="secondary" className="text-xs">
                    <Building2 className="h-3 w-3 mr-1" />
                    {companies.filter(c => c.is_active).length} empresas
                  </Badge>
                  <Badge variant="secondary" className="text-xs">
                    <Package className="h-3 w-3 mr-1" />
                    {products.length} produtos
                  </Badge>
                  <Badge variant="secondary" className="text-xs">
                    <DollarSign className="h-3 w-3 mr-1" />
                    {costCenters.length} centros de custo
                  </Badge>
                </div>
                {companies.filter(c => c.is_active).length > 0 && (
                  <p className="text-xs text-muted-foreground mt-2">
                    Empresas: {companies.filter(c => c.is_active).map(c => c.trading_name || c.name).join(', ')}
                  </p>
                )}
                {products.length === 0 && (
                  <p className="text-xs text-warning mt-1">
                    ⚠️ Nenhum produto cadastrado — a IA vai sugerir produtos do zero para suas empresas
                  </p>
                )}
              </div>

              {/* Instructions input */}
              <div>
                <Label className="text-sm font-medium flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" />
                  Suas instruções para a IA
                </Label>
                <div className="flex gap-2 mt-2">
                  <Textarea
                    value={customContext}
                    onChange={(e) => setCustomContext(e.target.value)}
                    rows={3}
                    className="text-sm bg-background resize-y flex-1"
                    placeholder="Ex: Quero focar em produtos de recorrência para gerar caixa na PrudenCred, e criar centros de custo para marketing digital na advocacia..."
                  />
                  <div className="flex flex-col gap-1">
                    <VoiceInputButton
                      onResult={(text) => setCustomContext(prev => prev ? prev + ' ' + text : text)}
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  💡 Dê contexto e instruções específicas. A IA vai combinar com os dados das suas empresas, núcleos e produtos já cadastrados.
                </p>
              </div>

              <div className="flex items-center justify-between pt-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setCustomContext('Analise a estrutura atual e sugira a melhor organização completa para o grupo, com foco em otimização tributária, construção de equity e geração de caixa.')}
                  className="text-xs text-muted-foreground"
                >
                  Restaurar padrão
                </Button>
                <Button
                  onClick={() => requestAISuggestions(customContext)}
                  disabled={aiLoading || !customContext.trim()}
                >
                  {aiLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
                  {aiLoading ? 'Analisando...' : 'Gerar Sugestões'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </CollapsibleContent>
      </Collapsible>

      {/* Tier Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {tierSummary.map(t => (
          <Card key={t.tier} className="border">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-2xl font-bold">{t.icon} {t.label}</p>
                  <p className="text-xs text-muted-foreground mt-1">{t.strategy}</p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-semibold">{t.count}</p>
                  <p className="text-xs text-muted-foreground">produtos</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="by-company" className="w-full">
        <TabsList>
          <TabsTrigger value="by-company">
            <Building2 className="h-4 w-4 mr-2" /> Por Empresa
          </TabsTrigger>
          <TabsTrigger value="by-tier">
            <TrendingUp className="h-4 w-4 mr-2" /> Por Ticket
          </TabsTrigger>
          <TabsTrigger value="matrix">
            <Package className="h-4 w-4 mr-2" /> Matriz
          </TabsTrigger>
        </TabsList>

        <TabsContent value="by-company" className="space-y-4">
          {productsByCompany.map(({ company, products: compProducts }) => (
            <Card key={company.id}>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Building2 className="h-5 w-5" />
                  {company.name}
                  {company.trading_name && (
                    <span className="text-sm text-muted-foreground font-normal">({company.trading_name})</span>
                  )}
                  <Badge variant="outline" className="ml-auto">{compProducts.length} produtos</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {compProducts.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    Nenhum produto cadastrado para esta empresa
                  </p>
                ) : (
                  <div className="space-y-2">
                    {compProducts.map(product => (
                      <div key={product.id} className="flex items-center justify-between p-3 rounded-lg border bg-card">
                        <div className="flex items-center gap-3">
                          <span className="text-xl">{TIER_CONFIG[product.ticket_tier]?.icon}</span>
                          <div>
                            <p className="font-medium">{product.name}</p>
                            <div className="flex gap-2 mt-1">
                              <Badge variant="outline" className={TIER_CONFIG[product.ticket_tier]?.color}>
                                {TIER_CONFIG[product.ticket_tier]?.label}
                              </Badge>
                              <Badge variant="secondary" className={FOCUS_CONFIG[product.strategy_focus]?.color}>
                                {FOCUS_CONFIG[product.strategy_focus]?.label}
                              </Badge>
                              {product.product_type && (
                                <Badge variant="secondary">{product.product_type}</Badge>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" onClick={() => handleEdit(product)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => handleDelete(product.id)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="by-tier" className="space-y-4">
          {(['low', 'medium', 'high'] as const).map(tier => {
            const tierProducts = products.filter(p => p.ticket_tier === tier);
            return (
              <Card key={tier}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg flex items-center gap-2">
                    {TIER_CONFIG[tier].icon} {TIER_CONFIG[tier].label}
                    <span className="text-sm font-normal text-muted-foreground">— {TIER_CONFIG[tier].strategy}</span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {tierProducts.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">Nenhum produto nesta faixa</p>
                  ) : (
                    <div className="space-y-2">
                      {tierProducts.map(product => {
                        const company = companies.find(c => c.id === product.company_id);
                        return (
                          <div key={product.id} className="flex items-center justify-between p-3 rounded-lg border bg-card">
                            <div>
                              <p className="font-medium">{product.name}</p>
                              <p className="text-xs text-muted-foreground">{company?.name || 'Sem empresa'}</p>
                            </div>
                            <Badge variant="secondary" className={FOCUS_CONFIG[product.strategy_focus]?.color}>
                              {FOCUS_CONFIG[product.strategy_focus]?.label}
                            </Badge>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        <TabsContent value="matrix">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Matriz Empresa × Ticket × Estratégia</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left p-2">Empresa</th>
                      <th className="text-center p-2">💰 Low Ticket</th>
                      <th className="text-center p-2">📈 Medium Ticket</th>
                      <th className="text-center p-2">🏗️ High Ticket</th>
                      <th className="text-center p-2">Foco</th>
                    </tr>
                  </thead>
                  <tbody>
                    {companies.filter(c => c.is_active).map(company => {
                      const compProducts = products.filter(p => p.company_id === company.id);
                      const low = compProducts.filter(p => p.ticket_tier === 'low');
                      const med = compProducts.filter(p => p.ticket_tier === 'medium');
                      const high = compProducts.filter(p => p.ticket_tier === 'high');
                      const focusCounts = { cash: 0, equity: 0, hybrid: 0 };
                      compProducts.forEach(p => focusCounts[p.strategy_focus]++);
                      const mainFocus = Object.entries(focusCounts).sort((a, b) => b[1] - a[1])[0];
                      return (
                        <tr key={company.id} className="border-b hover:bg-muted/50">
                          <td className="p-2 font-medium">{company.name}</td>
                          <td className="text-center p-2">
                            {low.map(p => <div key={p.id} className="text-xs">{p.name}</div>)}
                            {low.length === 0 && <span className="text-muted-foreground">—</span>}
                          </td>
                          <td className="text-center p-2">
                            {med.map(p => <div key={p.id} className="text-xs">{p.name}</div>)}
                            {med.length === 0 && <span className="text-muted-foreground">—</span>}
                          </td>
                          <td className="text-center p-2">
                            {high.map(p => <div key={p.id} className="text-xs">{p.name}</div>)}
                            {high.length === 0 && <span className="text-muted-foreground">—</span>}
                          </td>
                          <td className="text-center p-2">
                            {mainFocus && mainFocus[1] > 0 ? (
                              <Badge variant="secondary" className={FOCUS_CONFIG[mainFocus[0] as keyof typeof FOCUS_CONFIG]?.color}>
                                {FOCUS_CONFIG[mainFocus[0] as keyof typeof FOCUS_CONFIG]?.label}
                              </Badge>
                            ) : <span className="text-muted-foreground">—</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* AI Suggestions Panel */}
      <div ref={suggestionsRef}>
        {suggestions && (
          <AISuggestionsPanel
            suggestions={suggestions}
            companies={companies}
            onApplyProduct={async (p) => {
              const company = companies.find(c => c.name === p.company_name);
              await addProduct({
                company_id: company?.id || null,
                name: p.name,
                description: p.description || p.rationale,
                ticket_tier: p.ticket_tier,
                product_type: p.product_type || 'service',
                strategy_focus: p.strategy_focus || 'cash',
                area: p.area || null,
              });
            }}
            onDismiss={() => setSuggestions(null)}
          />
        )}
      </div>

      <ProductFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        product={editingProduct}
        companies={companies}
        onSave={async (data) => {
          if (editingProduct) {
            await updateProduct(editingProduct.id, data);
          } else {
            await addProduct(data);
          }
          setDialogOpen(false);
        }}
      />
    </div>
  );
}
