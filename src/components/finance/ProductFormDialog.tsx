import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ProductService } from '@/hooks/useProductsServices';
import { Company } from '@/hooks/useCompanies';
import { Sparkles, Loader2 } from 'lucide-react';
import { VoiceInputButton } from '@/components/ui/voice-input-button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: ProductService | null;
  companies: Company[];
  onSave: (data: Partial<ProductService>) => Promise<void>;
}

export function ProductFormDialog({ open, onOpenChange, product, companies, onSave }: Props) {
  const [form, setForm] = useState({
    name: '',
    description: '',
    company_id: '',
    ticket_tier: 'medium' as 'low' | 'medium' | 'high',
    product_type: 'service' as 'product' | 'service' | 'subscription' | 'consulting',
    strategy_focus: 'cash' as 'cash' | 'equity' | 'hybrid',
    area: 'operations',
    price_range_min: '',
    price_range_max: '',
  });
  const [aiLoading, setAiLoading] = useState(false);
  const [aiRationale, setAiRationale] = useState<string | null>(null);

  useEffect(() => {
    if (product) {
      setForm({
        name: product.name,
        description: product.description || '',
        company_id: product.company_id || '',
        ticket_tier: product.ticket_tier,
        product_type: product.product_type,
        strategy_focus: product.strategy_focus,
        area: product.area || 'operations',
        price_range_min: product.price_range_min?.toString() || '',
        price_range_max: product.price_range_max?.toString() || '',
      });
    } else {
      setForm({ name: '', description: '', company_id: '', ticket_tier: 'medium', product_type: 'service', strategy_focus: 'cash', area: 'operations', price_range_min: '', price_range_max: '' });
    }
    setAiRationale(null);
  }, [product, open]);

  const handleSubmit = async () => {
    if (!form.name.trim()) return;
    await onSave({
      ...form,
      company_id: form.company_id || null,
      description: form.description || null,
      price_range_min: form.price_range_min ? Number(form.price_range_min) : null,
      price_range_max: form.price_range_max ? Number(form.price_range_max) : null,
    } as any);
  };

  const handleAiSuggest = async () => {
    if (!form.name.trim()) {
      toast.error('Digite o nome do produto/serviço primeiro');
      return;
    }
    setAiLoading(true);
    setAiRationale(null);
    try {
      const activeCompanies = companies.filter(c => c.is_active).map(c => ({ id: c.id, name: c.name }));
      const { data, error } = await cloudFunctions.invoke('suggest-product-fields', {
        body: { name: form.name, description: form.description, companies: activeCompanies },
      });

      if (error) throw error;
      const s = data?.suggestion;
      if (!s) throw new Error('Sem sugestão');

      setForm(prev => ({
        ...prev,
        ticket_tier: s.ticket_tier || prev.ticket_tier,
        product_type: s.product_type || prev.product_type,
        strategy_focus: s.strategy_focus || prev.strategy_focus,
        area: s.area || prev.area,
        price_range_min: s.price_range_min?.toString() || prev.price_range_min,
        price_range_max: s.price_range_max?.toString() || prev.price_range_max,
        company_id: s.company_id || prev.company_id,
        description: prev.description || s.description_suggestion || prev.description,
      }));
      setAiRationale(s.rationale || null);
      toast.success('Campos preenchidos pela IA!');
    } catch (e: any) {
      console.error('AI suggest error:', e);
      toast.error('Erro ao consultar IA');
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{product ? 'Editar Produto/Serviço' : 'Novo Produto/Serviço'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Nome</Label>
            <div className="flex gap-2">
              <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Ex: Consultoria Tributária Premium" className="flex-1" />
              <VoiceInputButton onResult={text => setForm(prev => ({ ...prev, name: prev.name ? prev.name + ' ' + text : text }))} />
            </div>
          </div>
          <div>
            <Label>Descrição</Label>
            <div className="flex gap-2">
              <Input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Descrição breve" className="flex-1" />
              <VoiceInputButton onResult={text => setForm(prev => ({ ...prev, description: prev.description ? prev.description + ' ' + text : text }))} />
            </div>
          </div>

          {/* AI Suggest Button */}
          <Button
            type="button"
            variant="outline"
            className="w-full border-primary/30 text-primary hover:bg-primary/10"
            onClick={handleAiSuggest}
            disabled={aiLoading || !form.name.trim()}
          >
            {aiLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
            {aiLoading ? 'Analisando...' : 'Preencher com IA'}
          </Button>

          {aiRationale && (
            <div className="text-xs text-muted-foreground bg-muted/50 rounded-lg p-3 border">
              <span className="font-medium">💡 IA:</span> {aiRationale}
            </div>
          )}

          <div>
            <Label>Empresa</Label>
            <Select value={form.company_id} onValueChange={v => setForm({ ...form, company_id: v })}>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                {companies.filter(c => c.is_active).map(c => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Faixa de Ticket</Label>
              <Select value={form.ticket_tier} onValueChange={(v: any) => setForm({ ...form, ticket_tier: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">💰 Low Ticket</SelectItem>
                  <SelectItem value="medium">📈 Medium</SelectItem>
                  <SelectItem value="high">🏗️ High Ticket</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Tipo</Label>
              <Select value={form.product_type} onValueChange={(v: any) => setForm({ ...form, product_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="product">Produto</SelectItem>
                  <SelectItem value="service">Serviço</SelectItem>
                  <SelectItem value="subscription">Assinatura</SelectItem>
                  <SelectItem value="consulting">Consultoria</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Foco Estratégico</Label>
              <Select value={form.strategy_focus} onValueChange={(v: any) => setForm({ ...form, strategy_focus: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">💰 Caixa</SelectItem>
                  <SelectItem value="equity">🏗️ Equity</SelectItem>
                  <SelectItem value="hybrid">⚡ Híbrido</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Área</Label>
            <Select value={form.area} onValueChange={v => setForm({ ...form, area: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="marketing">Marketing</SelectItem>
                <SelectItem value="sales">Vendas</SelectItem>
                <SelectItem value="product_engineering">Engenharia de Produto</SelectItem>
                <SelectItem value="tax_planning">Planejamento Tributário</SelectItem>
                <SelectItem value="operations">Operações</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Preço Mín (R$)</Label>
              <Input type="number" value={form.price_range_min} onChange={e => setForm({ ...form, price_range_min: e.target.value })} />
            </div>
            <div>
              <Label>Preço Máx (R$)</Label>
              <Input type="number" value={form.price_range_max} onChange={e => setForm({ ...form, price_range_max: e.target.value })} />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button onClick={handleSubmit} disabled={!form.name.trim()}>{product ? 'Salvar' : 'Criar'}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
