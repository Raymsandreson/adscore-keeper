import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Sparkles, Check, X, Building2, Package, Shield, Lightbulb, TrendingUp, ChevronDown, ChevronRight, Pencil, Send, Loader2, Mic, Landmark } from 'lucide-react';
import { VoiceInputButton } from '@/components/ui/voice-input-button';
import { Company } from '@/hooks/useCompanies';
import { useState, useCallback } from 'react';

interface Props {
  suggestions: {
    analysis?: string;
    suggested_products?: any[];
    suggested_cost_centers?: any[];
    suggested_nuclei?: any[];
    suggested_companies?: any[];
    equity_vs_cash_strategy?: string;
    tax_optimization_tips?: string;
    asset_preservation_strategy?: string;
  };
  companies: Company[];
  onApplyProduct: (product: any) => Promise<void>;
  onApplyCompany?: (company: any) => Promise<void>;
  onApplyNucleus?: (nucleus: any) => Promise<void>;
  onDismiss: () => void;
  onRefine?: (instruction: string) => Promise<void>;
  refining?: boolean;
}

export function AISuggestionsPanel({ suggestions, companies, onApplyProduct, onApplyCompany, onApplyNucleus, onDismiss, onRefine, refining }: Props) {
  const [appliedCompanies, setAppliedCompanies] = useState<Set<number>>(new Set());
  const [appliedNuclei, setAppliedNuclei] = useState<Set<number>>(new Set());
  const [appliedProducts, setAppliedProducts] = useState<Set<number>>(new Set());
  const [expandedCompanies, setExpandedCompanies] = useState<Set<number>>(new Set());
  const [editingItem, setEditingItem] = useState<{ type: string; index: number } | null>(null);
  const [editedSuggestions, setEditedSuggestions] = useState<any>({ ...suggestions });
  const [refineInput, setRefineInput] = useState('');

  // Use edited version of suggestions
  const activeSuggestions = editedSuggestions;

  const updateSuggestedCompany = useCallback((idx: number, field: string, value: string) => {
    setEditedSuggestions((prev: any) => {
      const updated = { ...prev };
      updated.suggested_companies = [...(updated.suggested_companies || [])];
      updated.suggested_companies[idx] = { ...updated.suggested_companies[idx], [field]: value };
      return updated;
    });
  }, []);

  const updateSuggestedNucleus = useCallback((idx: number, field: string, value: string) => {
    setEditedSuggestions((prev: any) => {
      const updated = { ...prev };
      updated.suggested_nuclei = [...(updated.suggested_nuclei || [])];
      updated.suggested_nuclei[idx] = { ...updated.suggested_nuclei[idx], [field]: value };
      return updated;
    });
  }, []);

  const updateSuggestedProduct = useCallback((idx: number, field: string, value: string) => {
    setEditedSuggestions((prev: any) => {
      const updated = { ...prev };
      updated.suggested_products = [...(updated.suggested_products || [])];
      updated.suggested_products[idx] = { ...updated.suggested_products[idx], [field]: value };
      return updated;
    });
  }, []);

  const isEditing = (type: string, index: number) =>
    editingItem?.type === type && editingItem?.index === index;

  const toggleEdit = (type: string, index: number) => {
    if (isEditing(type, index)) {
      setEditingItem(null);
    } else {
      setEditingItem({ type, index });
    }
  };

  // Group products by company for hierarchical view
  const productsByCompany = (activeSuggestions.suggested_products || []).reduce((acc: Record<string, any[]>, p: any, i: number) => {
    const key = p.company_name || 'Sem Empresa';
    if (!acc[key]) acc[key] = [];
    acc[key].push({ ...p, _index: i });
    return acc;
  }, {});

  const nucleiByCompany = (activeSuggestions.suggested_nuclei || []).reduce((acc: Record<string, any[]>, n: any, i: number) => {
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

  const handleRefine = async () => {
    if (!refineInput.trim() || !onRefine) return;
    await onRefine(refineInput);
    setRefineInput('');
  };

  const EditButton = ({ type, index }: { type: string; index: number }) => (
    <Button
      variant="ghost"
      size="icon"
      className="h-6 w-6 shrink-0"
      onClick={() => toggleEdit(type, index)}
      title="Editar"
    >
      <Pencil className="h-3 w-3" />
    </Button>
  );

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

      {activeSuggestions.analysis && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="p-4">
            <p className="text-sm whitespace-pre-wrap">{activeSuggestions.analysis}</p>
          </CardContent>
        </Card>
      )}

      {activeSuggestions.equity_vs_cash_strategy && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4" /> Equity vs Caixa
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm whitespace-pre-wrap">{activeSuggestions.equity_vs_cash_strategy}</p>
          </CardContent>
        </Card>
      )}

      {activeSuggestions.tax_optimization_tips && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Shield className="h-4 w-4" /> Planejamento Tributário
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm whitespace-pre-wrap">{activeSuggestions.tax_optimization_tips}</p>
          </CardContent>
        </Card>
      )}

      {activeSuggestions.asset_preservation_strategy && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Landmark className="h-4 w-4" /> Preservação Patrimonial & Holdings
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm whitespace-pre-wrap">{activeSuggestions.asset_preservation_strategy}</p>
          </CardContent>
        </Card>
      )}

      {/* Hierarchical: Companies → Nuclei → Products */}
      {activeSuggestions.suggested_companies && activeSuggestions.suggested_companies.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Building2 className="h-4 w-4" /> Estrutura Sugerida (Empresa → Núcleo → Produtos)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {activeSuggestions.suggested_companies.map((c: any, i: number) => {
              const isExpanded = expandedCompanies.has(i);
              const companyNuclei = nucleiByCompany[c.name] || [];
              const companyProducts = productsByCompany[c.name] || [];
              const isApplied = appliedCompanies.has(i);
              const editing = isEditing('company', i);

              return (
                <div key={i} className="rounded-lg border bg-card overflow-hidden">
                  {/* Company Header */}
                  <div className="p-3 flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 cursor-pointer" onClick={() => toggleExpand(i)}>
                        {(companyNuclei.length > 0 || companyProducts.length > 0) ? (
                          isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        ) : null}
                        <Building2 className="h-4 w-4 text-muted-foreground" />
                        {editing ? (
                          <Input
                            value={c.name}
                            onChange={e => updateSuggestedCompany(i, 'name', e.target.value)}
                            className="h-7 text-sm font-semibold"
                            onClick={e => e.stopPropagation()}
                          />
                        ) : (
                          <p className="font-semibold">{c.name}</p>
                        )}
                        <EditButton type="company" index={i} />
                      </div>
                      {editing ? (
                        <div className="ml-6 mt-2 space-y-2">
                          <Input
                            value={c.purpose || ''}
                            onChange={e => updateSuggestedCompany(i, 'purpose', e.target.value)}
                            placeholder="Propósito"
                            className="h-7 text-xs"
                          />
                          <Input
                            value={c.tax_regime || ''}
                            onChange={e => updateSuggestedCompany(i, 'tax_regime', e.target.value)}
                            placeholder="Regime tributário"
                            className="h-7 text-xs"
                          />
                          <Input
                            value={c.rationale || ''}
                            onChange={e => updateSuggestedCompany(i, 'rationale', e.target.value)}
                            placeholder="Justificativa"
                            className="h-7 text-xs"
                          />
                        </div>
                      ) : (
                        <>
                          <p className="text-xs text-muted-foreground mt-1 ml-6">{c.purpose}</p>
                          {c.tax_regime && <Badge variant="outline" className="mt-1 ml-6">{c.tax_regime}</Badge>}
                          <p className="text-xs text-muted-foreground mt-1 ml-6">{c.rationale}</p>
                        </>
                      )}
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
                      {companyNuclei.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-xs font-medium text-muted-foreground flex items-center gap-1 ml-2">
                            <Lightbulb className="h-3 w-3" /> Núcleos
                          </p>
                          {companyNuclei.map((n: any) => {
                            const nApplied = appliedNuclei.has(n._index);
                            const nEditing = isEditing('nucleus', n._index);
                            return (
                              <div key={n._index} className="flex items-start justify-between p-2 rounded-md border bg-card ml-4">
                                <div className="flex-1">
                                  {nEditing ? (
                                    <div className="space-y-2">
                                      <div className="flex gap-2">
                                        <Input value={n.name} onChange={e => updateSuggestedNucleus(n._index, 'name', e.target.value)} placeholder="Nome" className="h-7 text-sm" />
                                        <Input value={n.prefix} onChange={e => updateSuggestedNucleus(n._index, 'prefix', e.target.value)} placeholder="Prefixo" className="h-7 text-sm w-24" />
                                      </div>
                                      <Input value={n.rationale || ''} onChange={e => updateSuggestedNucleus(n._index, 'rationale', e.target.value)} placeholder="Justificativa" className="h-7 text-xs" />
                                    </div>
                                  ) : (
                                    <>
                                      <div className="flex items-center gap-2">
                                        <p className="font-medium text-sm">{n.name}</p>
                                        <Badge variant="outline" className="text-xs">{n.prefix}</Badge>
                                        <EditButton type="nucleus" index={n._index} />
                                      </div>
                                      <p className="text-xs text-muted-foreground mt-1">{n.rationale}</p>
                                    </>
                                  )}
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

                      {companyProducts.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-xs font-medium text-muted-foreground flex items-center gap-1 ml-2">
                            <Package className="h-3 w-3" /> Produtos/Serviços
                          </p>
                          {companyProducts.map((p: any) => {
                            const pApplied = appliedProducts.has(p._index);
                            const pEditing = isEditing('product', p._index);
                            return (
                              <div key={p._index} className="flex items-start justify-between p-2 rounded-md border bg-card ml-4">
                                <div className="flex-1">
                                  {pEditing ? (
                                    <div className="space-y-2">
                                      <Input value={p.name} onChange={e => updateSuggestedProduct(p._index, 'name', e.target.value)} placeholder="Nome" className="h-7 text-sm" />
                                      <div className="flex gap-2">
                                        <select value={p.ticket_tier || 'medium'} onChange={e => updateSuggestedProduct(p._index, 'ticket_tier', e.target.value)} className="h-7 text-xs rounded border bg-background px-2">
                                          <option value="low">Low</option>
                                          <option value="medium">Medium</option>
                                          <option value="high">High</option>
                                        </select>
                                        <select value={p.strategy_focus || 'cash'} onChange={e => updateSuggestedProduct(p._index, 'strategy_focus', e.target.value)} className="h-7 text-xs rounded border bg-background px-2">
                                          <option value="cash">Caixa</option>
                                          <option value="equity">Equity</option>
                                          <option value="hybrid">Híbrido</option>
                                        </select>
                                      </div>
                                      <Input value={p.rationale || ''} onChange={e => updateSuggestedProduct(p._index, 'rationale', e.target.value)} placeholder="Justificativa" className="h-7 text-xs" />
                                    </div>
                                  ) : (
                                    <>
                                      <div className="flex items-center gap-2 flex-wrap">
                                        <p className="font-medium text-sm">{p.name}</p>
                                        <Badge variant="outline" className="text-xs">{p.ticket_tier}</Badge>
                                        <Badge variant="secondary" className="text-xs">{p.strategy_focus}</Badge>
                                        <EditButton type="product" index={p._index} />
                                      </div>
                                      <p className="text-xs text-muted-foreground mt-1">{p.rationale}</p>
                                    </>
                                  )}
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
        const suggestedCompanyNames = new Set((activeSuggestions.suggested_companies || []).map((c: any) => c.name));
        const standaloneProducts = (activeSuggestions.suggested_products || []).filter((p: any) => !suggestedCompanyNames.has(p.company_name));
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
                const idx = (activeSuggestions.suggested_products || []).indexOf(p);
                const pApplied = appliedProducts.has(idx);
                const pEditing = isEditing('product', idx);
                return (
                  <div key={i} className="flex items-start justify-between p-3 rounded-lg border bg-card">
                    <div className="flex-1">
                      {pEditing ? (
                        <div className="space-y-2">
                          <Input value={p.name} onChange={e => updateSuggestedProduct(idx, 'name', e.target.value)} placeholder="Nome" className="h-7 text-sm" />
                          <div className="flex gap-2">
                            <select value={p.ticket_tier || 'medium'} onChange={e => updateSuggestedProduct(idx, 'ticket_tier', e.target.value)} className="h-7 text-xs rounded border bg-background px-2">
                              <option value="low">Low</option>
                              <option value="medium">Medium</option>
                              <option value="high">High</option>
                            </select>
                            <select value={p.strategy_focus || 'cash'} onChange={e => updateSuggestedProduct(idx, 'strategy_focus', e.target.value)} className="h-7 text-xs rounded border bg-background px-2">
                              <option value="cash">Caixa</option>
                              <option value="equity">Equity</option>
                              <option value="hybrid">Híbrido</option>
                            </select>
                          </div>
                          <Input value={p.rationale || ''} onChange={e => updateSuggestedProduct(idx, 'rationale', e.target.value)} placeholder="Justificativa" className="h-7 text-xs" />
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-medium">{p.name}</p>
                            <Badge variant="outline">{p.ticket_tier}</Badge>
                            <Badge variant="secondary">{p.strategy_focus}</Badge>
                            <EditButton type="product" index={idx} />
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">
                            {p.company_name} • {p.rationale}
                          </p>
                        </>
                      )}
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

      {/* Standalone nuclei */}
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

      {/* Iterative chat to refine suggestions */}
      {onRefine && (
        <Card className="border-primary/30">
          <CardContent className="p-4 space-y-3">
            <p className="text-sm font-medium flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              Refinar sugestões
            </p>
            <p className="text-xs text-muted-foreground">
              Peça alterações, inclusões ou ajustes. Ex: "Adicione um produto de consultoria tributária na empresa X" ou "Mude o ticket do produto Y para high"
            </p>
            <div className="flex gap-2">
              <Textarea
                value={refineInput}
                onChange={e => setRefineInput(e.target.value)}
                placeholder="Ex: Inclua um produto inspirado no modelo da XP Investimentos..."
                rows={2}
                className="text-sm flex-1 resize-none"
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleRefine();
                  }
                }}
              />
              <div className="flex flex-col gap-1">
                <VoiceInputButton onResult={text => setRefineInput(prev => prev ? prev + ' ' + text : text)} />
                <Button
                  size="icon"
                  className="h-8 w-8"
                  disabled={!refineInput.trim() || refining}
                  onClick={handleRefine}
                >
                  {refining ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
