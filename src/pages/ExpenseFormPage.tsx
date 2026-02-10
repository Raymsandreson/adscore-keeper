import { useState, useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { 
  CreditCard, CheckCircle2, AlertCircle, Loader2, Send, 
  MapPin, Tag, FileText, ChevronDown, ChevronUp, User
} from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface Transaction {
  id: string;
  pluggy_transaction_id: string;
  description: string;
  amount: number;
  transaction_date: string;
  merchant_name: string | null;
  merchant_city: string | null;
  merchant_state: string | null;
  card_last_digits: string;
  category: string | null;
}

interface Category {
  id: string;
  name: string;
  parent_id: string | null;
  color: string | null;
  icon: string | null;
}

interface FormResponse {
  transaction_id: string;
  description: string;
  category: string;
  city: string;
  state: string;
  lead_name: string;
}

const BRAZILIAN_STATES = [
  'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG',
  'PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'
];

export default function ExpenseFormPage() {
  const { token } = useParams<{ token: string }>();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [cardInfo, setCardInfo] = useState<{ card_last_digits: string; card_name?: string; lead_name?: string } | null>(null);
  const [tokenData, setTokenData] = useState<any>(null);
  const [respondedIds, setRespondedIds] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [responses, setResponses] = useState<Record<string, FormResponse>>({});
  const [batchMode, setBatchMode] = useState(false);
  const [batchData, setBatchData] = useState<Partial<FormResponse>>({});
  const [expandedTx, setExpandedTx] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (token) loadFormData();
  }, [token]);

  const loadFormData = async () => {
    setLoading(true);
    try {
      const { data, error: fnError } = await supabase.functions.invoke('expense-form', {
        body: { action: 'validate', token },
      });

      if (fnError) throw new Error(fnError.message);
      if (data?.error) {
        setError(data.error);
        if (data.already_submitted) setSubmitted(true);
        return;
      }

      setTransactions(data.transactions);
      setCategories(data.categories);
      setTokenData(data.token);
      setRespondedIds(new Set(data.respondedTransactionIds));
      setCardInfo({
        card_last_digits: data.token.card_last_digits,
        card_name: data.cardAssignment?.card_name,
        lead_name: data.cardAssignment?.lead_name,
      });

      // Initialize responses
      const initial: Record<string, FormResponse> = {};
      data.transactions.forEach((tx: Transaction) => {
        const override = data.overrides?.find((o: any) => o.transaction_id === tx.id);
        initial[tx.id] = {
          transaction_id: tx.id,
          description: override?.notes || '',
          category: override?.category_id || '',
          city: override?.manual_city || tx.merchant_city || '',
          state: override?.manual_state || tx.merchant_state || '',
          lead_name: '',
        };
      });
      setResponses(initial);
    } catch (err: any) {
      setError(err.message || 'Erro ao carregar formulário');
    } finally {
      setLoading(false);
    }
  };

  const parentCategories = useMemo(() => categories.filter(c => !c.parent_id), [categories]);
  const childCategories = useMemo(() => {
    const map: Record<string, Category[]> = {};
    categories.filter(c => c.parent_id).forEach(c => {
      if (!map[c.parent_id!]) map[c.parent_id!] = [];
      map[c.parent_id!].push(c);
    });
    return map;
  }, [categories]);

  const selectableCategories = useMemo(() => {
    // Categories that have children are groups; only show children
    const result: { id: string; name: string; groupName?: string }[] = [];
    parentCategories.forEach(parent => {
      const children = childCategories[parent.id];
      if (children && children.length > 0) {
        children.forEach(child => {
          result.push({ id: child.id, name: child.name, groupName: parent.name });
        });
      } else {
        result.push({ id: parent.id, name: parent.name });
      }
    });
    return result;
  }, [parentCategories, childCategories]);

  const pendingTransactions = useMemo(() => 
    transactions.filter(t => !respondedIds.has(t.id)),
    [transactions, respondedIds]
  );

  const updateResponse = (txId: string, field: keyof FormResponse, value: string) => {
    setResponses(prev => ({
      ...prev,
      [txId]: { ...prev[txId], [field]: value },
    }));
  };

  const toggleSelect = (txId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(txId)) next.delete(txId);
      else next.add(txId);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedIds.size === pendingTransactions.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(pendingTransactions.map(t => t.id)));
    }
  };

  const applyBatch = () => {
    setResponses(prev => {
      const next = { ...prev };
      selectedIds.forEach(id => {
        next[id] = {
          ...next[id],
          ...(batchData.description ? { description: batchData.description } : {}),
          ...(batchData.category ? { category: batchData.category } : {}),
          ...(batchData.city ? { city: batchData.city } : {}),
          ...(batchData.state ? { state: batchData.state } : {}),
          ...(batchData.lead_name ? { lead_name: batchData.lead_name } : {}),
        };
      });
      return next;
    });
    toast.success(`Dados aplicados a ${selectedIds.size} transações`);
    setBatchMode(false);
    setBatchData({});
  };

  const toggleExpand = (txId: string) => {
    setExpandedTx(prev => {
      const next = new Set(prev);
      if (next.has(txId)) next.delete(txId);
      else next.add(txId);
      return next;
    });
  };

  const handleSubmit = async () => {
    const toSubmit = pendingTransactions.map(tx => responses[tx.id]).filter(Boolean);
    if (toSubmit.length === 0) {
      toast.error('Nenhuma transação para enviar');
      return;
    }

    setSubmitting(true);
    try {
      const { data, error: fnError } = await supabase.functions.invoke('expense-form', {
        body: { action: 'submit', token, responses: toSubmit },
      });

      if (fnError) throw new Error(fnError.message);
      if (data?.error) throw new Error(data.error);

      setSubmitted(true);
      toast.success('Formulário enviado com sucesso!');
    } catch (err: any) {
      toast.error(err.message || 'Erro ao enviar');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-lg">
          <CardContent className="flex flex-col items-center gap-4 py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-muted-foreground">Carregando formulário...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error || submitted) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-lg">
          <CardContent className="flex flex-col items-center gap-4 py-12">
            {submitted ? (
              <>
                <CheckCircle2 className="h-12 w-12 text-green-500" />
                <h2 className="text-xl font-semibold">Formulário enviado!</h2>
                <p className="text-muted-foreground text-center">
                  Obrigado por preencher as informações dos seus gastos.
                </p>
              </>
            ) : (
              <>
                <AlertCircle className="h-12 w-12 text-destructive" />
                <h2 className="text-xl font-semibold">Ops!</h2>
                <p className="text-muted-foreground text-center">{error}</p>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="max-w-3xl mx-auto space-y-4">
        {/* Header */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-full bg-primary/10">
                <CreditCard className="h-6 w-6 text-primary" />
              </div>
              <div>
                <CardTitle className="text-lg">Justificativa de Gastos</CardTitle>
                <CardDescription>
                  Cartão ****{cardInfo?.card_last_digits}
                  {cardInfo?.card_name && ` • ${cardInfo.card_name}`}
                  {cardInfo?.lead_name && ` • ${cardInfo.lead_name}`}
                </CardDescription>
              </div>
            </div>
            <div className="flex gap-2 mt-2">
              <Badge variant="outline" className="text-xs">
                {format(new Date(tokenData?.date_from), 'dd/MM/yyyy')} - {format(new Date(tokenData?.date_to), 'dd/MM/yyyy')}
              </Badge>
              <Badge variant="secondary" className="text-xs">
                {pendingTransactions.length} transações pendentes
              </Badge>
            </div>
          </CardHeader>
        </Card>

        {/* Batch mode */}
        {pendingTransactions.length > 1 && (
          <Card>
            <CardContent className="py-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={selectedIds.size === pendingTransactions.length && pendingTransactions.length > 0}
                    onCheckedChange={selectAll}
                  />
                  <span className="text-sm font-medium">
                    {selectedIds.size > 0 ? `${selectedIds.size} selecionada(s)` : 'Selecionar todas'}
                  </span>
                </div>
                {selectedIds.size > 1 && (
                  <Button size="sm" variant="outline" onClick={() => setBatchMode(!batchMode)}>
                    {batchMode ? 'Fechar' : 'Preencher em lote'}
                  </Button>
                )}
              </div>

              {batchMode && selectedIds.size > 1 && (
                <div className="mt-3 pt-3 border-t space-y-3">
                  <p className="text-xs text-muted-foreground">
                    Preencha os campos abaixo para aplicar a todas as {selectedIds.size} transações selecionadas:
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Descrição do gasto</Label>
                      <Input
                        placeholder="Ex: Almoço com cliente"
                        value={batchData.description || ''}
                        onChange={e => setBatchData(p => ({ ...p, description: e.target.value }))}
                        className="h-8 text-sm"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Categoria</Label>
                      <Select value={batchData.category || ''} onValueChange={v => setBatchData(p => ({ ...p, category: v }))}>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="Selecione..." />
                        </SelectTrigger>
                        <SelectContent>
                          {selectableCategories.map(c => (
                            <SelectItem key={c.id} value={c.id} className="text-xs">
                              {c.groupName ? `${c.groupName} → ${c.name}` : c.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">Cidade</Label>
                      <Input
                        placeholder="Cidade"
                        value={batchData.city || ''}
                        onChange={e => setBatchData(p => ({ ...p, city: e.target.value }))}
                        className="h-8 text-sm"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Estado</Label>
                      <Select value={batchData.state || ''} onValueChange={v => setBatchData(p => ({ ...p, state: v }))}>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="UF" />
                        </SelectTrigger>
                        <SelectContent>
                          {BRAZILIAN_STATES.map(s => (
                            <SelectItem key={s} value={s}>{s}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="md:col-span-2">
                      <Label className="text-xs">Lead / Cliente</Label>
                      <Input
                        placeholder="Nome do lead ou cliente"
                        value={batchData.lead_name || ''}
                        onChange={e => setBatchData(p => ({ ...p, lead_name: e.target.value }))}
                        className="h-8 text-sm"
                      />
                    </div>
                  </div>
                  <Button size="sm" onClick={applyBatch}>
                    Aplicar a {selectedIds.size} transações
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Transactions list */}
        <ScrollArea className="max-h-[60vh]">
          <div className="space-y-2">
            {pendingTransactions.map(tx => {
              const resp = responses[tx.id];
              const isExpanded = expandedTx.has(tx.id);

              return (
                <Card key={tx.id} className="overflow-hidden">
                  <div className="p-3">
                    <div className="flex items-start gap-2">
                      {pendingTransactions.length > 1 && (
                        <Checkbox
                          checked={selectedIds.has(tx.id)}
                          onCheckedChange={() => toggleSelect(tx.id)}
                          className="mt-1"
                        />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-medium truncate">
                            {tx.merchant_name || tx.description}
                          </p>
                          <span className="text-sm font-bold text-destructive whitespace-nowrap ml-2">
                            R$ {Math.abs(tx.amount).toFixed(2)}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-xs text-muted-foreground">
                            {format(new Date(tx.transaction_date + 'T12:00:00'), 'dd/MM/yyyy', { locale: ptBR })}
                          </span>
                          {tx.merchant_city && (
                            <span className="text-xs text-muted-foreground">
                              • {tx.merchant_city}{tx.merchant_state ? `/${tx.merchant_state}` : ''}
                            </span>
                          )}
                          {tx.category && (
                            <Badge variant="outline" className="text-[10px] h-4">{tx.category}</Badge>
                          )}
                        </div>
                      </div>
                      <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => toggleExpand(tx.id)}>
                        {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </Button>
                    </div>

                    {isExpanded && resp && (
                      <div className="mt-3 pt-3 border-t space-y-3">
                        <div>
                          <Label className="text-xs flex items-center gap-1">
                            <FileText className="h-3 w-3" /> O que foi este gasto?
                          </Label>
                          <Textarea
                            placeholder="Descreva o que foi este gasto..."
                            value={resp.description}
                            onChange={e => updateResponse(tx.id, 'description', e.target.value)}
                            className="text-sm min-h-[60px] mt-1"
                            maxLength={500}
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <Label className="text-xs flex items-center gap-1">
                              <Tag className="h-3 w-3" /> Categoria
                            </Label>
                            <Select value={resp.category} onValueChange={v => updateResponse(tx.id, 'category', v)}>
                              <SelectTrigger className="h-8 text-xs mt-1">
                                <SelectValue placeholder="Selecione..." />
                              </SelectTrigger>
                              <SelectContent>
                                {selectableCategories.map(c => (
                                  <SelectItem key={c.id} value={c.id} className="text-xs">
                                    {c.groupName ? `${c.groupName} → ${c.name}` : c.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label className="text-xs flex items-center gap-1">
                              <User className="h-3 w-3" /> Lead / Cliente
                            </Label>
                            <Input
                              placeholder="Nome"
                              value={resp.lead_name}
                              onChange={e => updateResponse(tx.id, 'lead_name', e.target.value)}
                              className="h-8 text-sm mt-1"
                            />
                          </div>
                          <div>
                            <Label className="text-xs flex items-center gap-1">
                              <MapPin className="h-3 w-3" /> Cidade
                            </Label>
                            <Input
                              placeholder="Cidade"
                              value={resp.city}
                              onChange={e => updateResponse(tx.id, 'city', e.target.value)}
                              className="h-8 text-sm mt-1"
                            />
                          </div>
                          <div>
                            <Label className="text-xs flex items-center gap-1">
                              <MapPin className="h-3 w-3" /> Estado
                            </Label>
                            <Select value={resp.state} onValueChange={v => updateResponse(tx.id, 'state', v)}>
                              <SelectTrigger className="h-8 text-xs mt-1">
                                <SelectValue placeholder="UF" />
                              </SelectTrigger>
                              <SelectContent>
                                {BRAZILIAN_STATES.map(s => (
                                  <SelectItem key={s} value={s}>{s}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        </ScrollArea>

        {/* Submit */}
        <Card>
          <CardContent className="py-4">
            <Button 
              className="w-full" 
              size="lg" 
              onClick={handleSubmit} 
              disabled={submitting || pendingTransactions.length === 0}
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Send className="h-4 w-4 mr-2" />
              )}
              Enviar justificativas ({pendingTransactions.length} transações)
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
