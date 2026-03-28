import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Save, Brain } from 'lucide-react';

export function EnrichmentSettings() {
  const [threshold, setThreshold] = useState('5');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    const { data } = await supabase
      .from('system_settings')
      .select('value')
      .eq('key', 'enrich_message_threshold')
      .single();
    
    if (data?.value) setThreshold(data.value);
    setLoading(false);
  };

  const handleSave = async () => {
    const val = parseInt(threshold, 10);
    if (isNaN(val) || val < 1 || val > 100) {
      toast.error('Informe um valor entre 1 e 100');
      return;
    }

    setSaving(true);
    const { error } = await supabase
      .from('system_settings')
      .upsert({ key: 'enrich_message_threshold', value: String(val), updated_at: new Date().toISOString() });

    if (error) {
      toast.error('Erro ao salvar configuração');
      console.error(error);
    } else {
      toast.success('Configuração salva com sucesso');
    }
    setSaving(false);
  };

  if (loading) return <div className="text-sm text-muted-foreground">Carregando...</div>;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Brain className="h-4 w-4 text-primary" />
          Enriquecimento Automático de Leads
        </CardTitle>
        <CardDescription>
          A IA analisa as conversas do WhatsApp e extrai automaticamente dados como nome, endereço, profissão e outros. 
          Configure a quantidade mínima de mensagens do cliente antes de acionar a extração.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="threshold">Quantidade mínima de mensagens inbound</Label>
          <div className="flex items-center gap-3">
            <Input
              id="threshold"
              type="number"
              min={1}
              max={100}
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              className="w-24"
            />
            <span className="text-sm text-muted-foreground">mensagens do cliente</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Valor menor = extração mais rápida, porém com menos contexto. Valor maior = mais dados disponíveis na conversa.
          </p>
        </div>
        <Button onClick={handleSave} disabled={saving} size="sm" className="gap-2">
          <Save className="h-4 w-4" />
          {saving ? 'Salvando...' : 'Salvar'}
        </Button>
      </CardContent>
    </Card>
  );
}
