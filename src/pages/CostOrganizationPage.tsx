import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Sparkles, Building2, Package, Target, TrendingUp, Loader2, Plus, Pencil, Trash2, DollarSign, Shield, Lightbulb, Send, Users, Gem, Truck, HandCoins, FolderTree, Settings2 } from 'lucide-react';
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { VoiceInputButton } from '@/components/ui/voice-input-button';
import { useCompanies } from '@/hooks/useCompanies';
import { useProductsServices, ProductService } from '@/hooks/useProductsServices';
import { useCostCenters } from '@/hooks/useCostCenters';
import { useSpecializedNuclei } from '@/hooks/useSpecializedNuclei';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { ProductFormDialog } from '@/components/finance/ProductFormDialog';
import { AISuggestionsPanel } from '@/components/finance/AISuggestionsPanel';
import { FinancialConfigManager } from '@/components/finance/FinancialConfigManager';
import { BusinessModelTranslation, TranslationAction } from '@/components/business/BusinessModelTranslation';
import { OrganizationalStructureTab } from '@/components/business/OrganizationalStructureTab';
import { useNavigate } from 'react-router-dom';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';

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
  const { companies, addCompany } = useCompanies();
  const { products, addProduct, updateProduct, deleteProduct, loading: productsLoading } = useProductsServices();
  const { costCenters } = useCostCenters();
  const { nuclei, addNucleus } = useSpecializedNuclei();
  const [aiLoading, setAiLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<any>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [configDialogOpen, setConfigDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<ProductService | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [customContext, setCustomContext] = useState(
    'Analise a estrutura atual e sugira a melhor organização completa para o grupo, com foco em otimização tributária, construção de equity e geração de caixa.'
  );
  const [references, setReferences] = useState('');
  const [refining, setRefining] = useState(false);
  const [mainTab, setMainTab] = useState('modelo');
  const navigate = useNavigate();

  const suggestionsRef = useRef<HTMLDivElement | null>(null);
  const promptPanelRef = useRef<HTMLDivElement | null>(null);

  const openAIPanel = useCallback(() => {
    setMainTab('modelo');
    setShowPrompt(true);
    requestAnimationFrame(() => {
      promptPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, []);

  const handleTranslationAction = useCallback((action: TranslationAction) => {
    try {
      switch (action.type) {
        case 'tab':
          setMainTab(action.tab);
          if (action.section) {
            setTimeout(() => {
              const el = document.getElementById(action.section!);
              el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 200);
          }
          break;
        case 'route': {
          const previousPath = window.location.pathname;
          navigate(action.route);
          setTimeout(() => {
            if (window.location.pathname === previousPath) {
              window.location.assign(action.route);
            }
          }, 250);
          break;
        }
        case 'dialog':
          if (action.dialog === 'newProduct') {
            setMainTab('modelo');
            setTimeout(() => {
              setEditingProduct(null);
              setDialogOpen(true);
            }, 100);
          }
          break;
      }
    } catch (error) {
      console.error('Erro ao executar ação:', error);
      toast.error('Não foi possível executar essa ação agora.');
    }
  }, [navigate]);

  useEffect(() => {
    if (!suggestions) return;
    setShowPrompt(false);
    requestAnimationFrame(() => {
      suggestionsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, [suggestions]);

  const requestAISuggestions = async (context?: string, refinement?: string, previousSuggestions?: any) => {
    if (refinement) {
      setRefining(true);
    } else {
      setAiLoading(true);
    }
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('A sugestão está demorando. Tente novamente.')), 35000);
      });

      const invokePromise = cloudFunctions.invoke('suggest-cost-organization', {
        body: {
          context,
          references: references || undefined,
          refinement: refinement || undefined,
          previousSuggestions: previousSuggestions || undefined,
        },
      });

      const { data, error } = await Promise.race([invokePromise, timeoutPromise]) as Awaited<typeof invokePromise>;

      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (!data?.suggestions) throw new Error('A IA não retornou sugestões.');

      setSuggestions(data.suggestions);
      toast.success(refinement ? 'Sugestões refinadas!' : 'Sugestões da IA geradas!');
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || 'Erro ao gerar sugestões');
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      setAiLoading(false);
      setRefining(false);
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

  const productsByCompany = companies.map(company => ({
    company,
    products: products.filter(p => p.company_id === company.id),
  })).filter(g => g.products.length > 0 || true);

  const tierSummary = (['low', 'medium', 'high'] as const).map(tier => ({
    tier,
    ...TIER_CONFIG[tier],
    count: products.filter(p => p.ticket_tier === tier).length,
    companies: [...new Set(products.filter(p => p.ticket_tier === tier).map(p => p.company_id))].length,
  }));

  return (
    <div className="container mx-auto py-6 space-y-6 max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Target className="h-6 w-6 text-primary" />
            Ecossistema do Grupo
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Modelo de Negócios + Estrutura Organizacional
          </p>
        </div>
        <div className="flex gap-2">
          <Dialog open={configDialogOpen} onOpenChange={setConfigDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">
                <Settings2 className="h-4 w-4 mr-2" />
                Gerenciar Estrutura
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Settings2 className="h-5 w-5" />
                  Gerenciar Estrutura
                </DialogTitle>
              </DialogHeader>
              <FinancialConfigManager />
            </DialogContent>
          </Dialog>
          {mainTab === 'modelo' && (
            <>
              <Button variant="outline" onClick={handleNewProduct}>
                <Plus className="h-4 w-4 mr-2" />
                Novo Produto
              </Button>
              <Button
                variant={showPrompt ? 'default' : 'outline'}
                onClick={openAIPanel}
                disabled={aiLoading}
              >
                <Sparkles className="h-4 w-4 mr-2" />
                Sugerir com IA
              </Button>
            </>
          )}
          {mainTab === 'estrutura' && (
            <Button variant="outline" onClick={openAIPanel}>
              <Sparkles className="h-4 w-4 mr-2" />
              Sugerir com IA
            </Button>
          )}
        </div>
      </div>

      {/* Translation Card */}
      <BusinessModelTranslation onAction={handleTranslationAction} />

      {/* Main Tabs: Modelo de Negócios vs Estrutura Organizacional */}
      <Tabs value={mainTab} onValueChange={setMainTab} className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="modelo" className="gap-2">
            <Target className="h-4 w-4" />
            Modelo de Negócios
          </TabsTrigger>
          <TabsTrigger value="estrutura" className="gap-2">
            <Users className="h-4 w-4" />
            Estrutura Organizacional
          </TabsTrigger>
        </TabsList>

        {/* ===== MODELO DE NEGÓCIOS TAB ===== */}
        <TabsContent value="modelo" className="space-y-6">
          {/* AI Context Panel */}
          <div ref={promptPanelRef}>
            <Collapsible open={showPrompt} onOpenChange={setShowPrompt}>
            <CollapsibleContent>
              <Card className="border-primary/30 bg-gradient-to-br from-primary/5 to-primary/10">
                <CardContent className="pt-5 space-y-4">
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
                  </div>

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
                        placeholder="Ex: Quero focar em produtos de recorrência para gerar caixa..."
                      />
                      <VoiceInputButton onResult={(text) => setCustomContext(prev => prev ? prev + ' ' + text : text)} />
                    </div>
                  </div>

                  <div>
                    <Label className="text-sm font-medium flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-primary" />
                      Referências de empresários/empresas (opcional)
                    </Label>
                    <div className="flex gap-2 mt-2">
                      <Textarea
                        value={references}
                        onChange={(e) => setReferences(e.target.value)}
                        rows={2}
                        className="text-sm bg-background resize-y flex-1"
                        placeholder="Ex: XP Investimentos, G4 Educação, Havan..."
                      />
                      <VoiceInputButton onResult={(text) => setReferences(prev => prev ? prev + ' ' + text : text)} />
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      💡 Deixe vazio para a IA sugerir referências automaticamente.
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
          </div>

          {/* 1. VALOR - Como criamos, entregamos e capturamos valor */}
          <Card className="border-primary/20">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <span className="text-lg font-bold text-primary">1.</span>
                <Lightbulb className="h-4 w-4 text-amber-500" />
                Valor
                <span className="text-sm font-normal text-muted-foreground">— Como criamos, entregamos e capturamos valor</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 rounded-lg border bg-muted/30">
                  <div className="flex items-center gap-2 mb-2">
                    <Gem className="h-4 w-4 text-primary" />
                    <p className="font-semibold text-sm">Criação de Valor</p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {nuclei.filter(n => n.is_active).length > 0
                      ? `${nuclei.filter(n => n.is_active).length} núcleos especializados gerando valor através de expertise`
                      : 'Defina os núcleos especializados que criam valor para seus clientes'}
                  </p>
                </div>
                <div className="p-4 rounded-lg border bg-muted/30">
                  <div className="flex items-center gap-2 mb-2">
                    <Truck className="h-4 w-4 text-blue-500" />
                    <p className="font-semibold text-sm">Entrega de Valor</p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {products.length > 0
                      ? `${products.length} produtos/serviços em ${tierSummary.filter(t => t.count > 0).length} faixas de ticket`
                      : 'Cadastre produtos/serviços que entregam valor ao mercado'}
                  </p>
                </div>
                <div className="p-4 rounded-lg border bg-muted/30">
                  <div className="flex items-center gap-2 mb-2">
                    <HandCoins className="h-4 w-4 text-emerald-500" />
                    <p className="font-semibold text-sm">Captura de Valor</p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {companies.filter(c => c.is_active).length > 0
                      ? `${companies.filter(c => c.is_active).length} empresas com eficiência tributária e proteção patrimonial`
                      : 'Estruture empresas para capturar valor com eficiência'}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 2. NÚCLEOS */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <span className="text-lg font-bold text-amber-500">2.</span>
                <FolderTree className="h-4 w-4 text-amber-500" />
                Núcleos Especializados
                <Badge variant="secondary" className="ml-auto">{nuclei.filter(n => n.is_active).length} núcleos</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {nuclei.filter(n => n.is_active).length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  Nenhum núcleo cadastrado. Use a IA para sugerir ou cadastre manualmente.
                </p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {nuclei.filter(n => n.is_active).map(nucleus => (
                    <div key={nucleus.id} className="p-3 rounded-lg border bg-card flex items-center gap-3">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: nucleus.color }} />
                      <div>
                        <p className="font-medium text-sm">{nucleus.name}</p>
                        <p className="text-xs text-muted-foreground">{nucleus.prefix}{nucleus.description ? ` · ${nucleus.description}` : ''}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* 3. PRODUTOS - Tier Summary */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <span className="text-lg font-bold text-emerald-500">3.</span>
                <Package className="h-4 w-4 text-emerald-500" />
                Produtos & Serviços
                <Badge variant="secondary" className="ml-auto">{products.length} produtos</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {tierSummary.map(t => (
                  <div key={t.tier} className="p-4 rounded-lg border bg-card">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-lg font-bold">{t.icon} {t.label}</p>
                        <p className="text-xs text-muted-foreground mt-1">{t.strategy}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-semibold">{t.count}</p>
                        <p className="text-xs text-muted-foreground">produtos</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* 4. EMPRESAS - Sub-tabs */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <span className="text-lg font-bold text-blue-500">4.</span>
                <Building2 className="h-4 w-4 text-blue-500" />
                Empresas
                <Badge variant="secondary" className="ml-auto">{companies.filter(c => c.is_active).length} empresas</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
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
              {(() => {
                const unlinked = products.filter(p => !p.company_id);
                if (unlinked.length === 0) return null;
                return (
                  <Card className="border-warning/50">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-lg flex items-center gap-2 text-warning">
                        ⚠️ Produtos sem empresa vinculada
                        <Badge variant="outline" className="ml-auto">{unlinked.length} produtos</Badge>
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {unlinked.map(product => (
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
                                </div>
                              </div>
                            </div>
                            <div className="flex gap-1">
                              <Button variant="ghost" size="icon" onClick={() => handleEdit(product)}><Pencil className="h-4 w-4" /></Button>
                              <Button variant="ghost" size="icon" onClick={() => handleDelete(product.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                );
              })()}
              {productsByCompany.map(({ company, products: compProducts }) => (
                <Card key={company.id}>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Building2 className="h-5 w-5" />
                      {company.name}
                      {company.trading_name && <span className="text-sm text-muted-foreground font-normal">({company.trading_name})</span>}
                      <Badge variant="outline" className="ml-auto">{compProducts.length} produtos</Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {compProducts.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-4">Nenhum produto cadastrado</p>
                    ) : (
                      <div className="space-y-2">
                        {compProducts.map(product => (
                          <div key={product.id} className="flex items-center justify-between p-3 rounded-lg border bg-card">
                            <div className="flex items-center gap-3">
                              <span className="text-xl">{TIER_CONFIG[product.ticket_tier]?.icon}</span>
                              <div>
                                <p className="font-medium">{product.name}</p>
                                <div className="flex gap-2 mt-1">
                                  <Badge variant="outline" className={TIER_CONFIG[product.ticket_tier]?.color}>{TIER_CONFIG[product.ticket_tier]?.label}</Badge>
                                  <Badge variant="secondary" className={FOCUS_CONFIG[product.strategy_focus]?.color}>{FOCUS_CONFIG[product.strategy_focus]?.label}</Badge>
                                  {product.product_type && <Badge variant="secondary">{product.product_type}</Badge>}
                                </div>
                              </div>
                            </div>
                            <div className="flex gap-1">
                              <Button variant="ghost" size="icon" onClick={() => handleEdit(product)}><Pencil className="h-4 w-4" /></Button>
                              <Button variant="ghost" size="icon" onClick={() => handleDelete(product.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
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
                  <CardTitle className="text-lg">Matriz Empresa × Ticket × Modelo de Negócios</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left p-2">Empresa</th>
                          <th className="text-center p-2">💰 Low</th>
                          <th className="text-center p-2">📈 Medium</th>
                          <th className="text-center p-2">🏗️ High</th>
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
            </CardContent>
          </Card>

          {/* AI Suggestions */}
          <div ref={suggestionsRef}>
            {suggestions && (
              <AISuggestionsPanel
                suggestions={suggestions}
                companies={companies}
                onApplyProduct={async (p) => {
                  let company = companies.find(c => c.name === p.company_name);
                  if (!company && p.company_name) {
                    const { data: freshCompanies } = await supabase
                      .from('companies').select('*').ilike('name', `%${p.company_name}%`).limit(1);
                    if (freshCompanies && freshCompanies.length > 0) company = freshCompanies[0] as any;
                  }
                  await addProduct({
                    company_id: company?.id || null,
                    name: p.name,
                    description: p.description || p.rationale,
                    ticket_tier: p.ticket_tier,
                    product_type: p.product_type || 'service',
                    strategy_focus: p.strategy_focus || 'cash',
                    area: p.area || null,
                  });
                  if (company) {
                    toast.success(`"${p.name}" cadastrado em "${company.name}"`);
                  } else {
                    toast.warning(`"${p.name}" cadastrado sem empresa. Crie "${p.company_name}" primeiro.`);
                  }
                }}
                onApplyCompany={async (c) => {
                  await addCompany({ name: c.name, trading_name: c.purpose || null });
                  toast.success(`Empresa "${c.name}" criada!`);
                }}
                onApplyNucleus={async (n) => {
                  await addNucleus({ name: n.name, prefix: n.prefix, description: n.description || n.rationale || null, is_active: true });
                  toast.success(`Núcleo "${n.name}" (${n.prefix}) criado!`);
                }}
                onDismiss={() => setSuggestions(null)}
                onRefine={async (instruction) => {
                  await requestAISuggestions(customContext, instruction, suggestions);
                }}
                refining={refining}
              />
            )}
          </div>
        </TabsContent>

        {/* ===== ESTRUTURA ORGANIZACIONAL TAB ===== */}
        <TabsContent value="estrutura">
          <OrganizationalStructureTab />
        </TabsContent>
      </Tabs>

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
