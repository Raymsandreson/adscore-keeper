import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { 
  BarChart3, Save, Clock, Send, Target, Settings2, 
  Plus, Trash2, CheckCircle2 
} from 'lucide-react';
import { toast } from 'sonner';
import { cloudFunctions } from '@/lib/lovableCloudFunctions';

interface Instance {
  id: string;
  instance_name: string;
  owner_phone: string | null;
}

interface ReportConfig {
  id?: string;
  is_active: boolean;
  report_name: string;
  sender_instance_ids: string[];
  target_instance_ids: string[];
  recipient_phones: string[];
  schedule_times: string[];
  include_messages_inbound: boolean;
  include_messages_outbound: boolean;
  include_conversations: boolean;
  include_unread: boolean;
  include_calls: boolean;
  include_new_leads: boolean;
  include_closed_leads: boolean;
  include_new_contacts: boolean;
  include_response_time: boolean;
  include_ai_replies: boolean;
  include_followups: boolean;
}

const defaultConfig: ReportConfig = {
  is_active: true,
  report_name: 'Relatório Padrão',
  sender_instance_ids: [],
  target_instance_ids: [],
  recipient_phones: [],
  schedule_times: ['00:00', '12:00'],
  include_messages_inbound: true,
  include_messages_outbound: true,
  include_conversations: true,
  include_unread: true,
  include_calls: true,
  include_new_leads: true,
  include_closed_leads: true,
  include_new_contacts: true,
  include_response_time: true,
  include_ai_replies: false,
  include_followups: true,
};

const metricOptions = [
  { key: 'include_messages_inbound', label: '📥 Mensagens Recebidas' },
  { key: 'include_messages_outbound', label: '📤 Mensagens Enviadas' },
  { key: 'include_conversations', label: '💬 Conversas Únicas' },
  { key: 'include_unread', label: '🔔 Não Lidas' },
  { key: 'include_calls', label: '📞 Chamadas' },
  { key: 'include_new_leads', label: '🆕 Novos Leads' },
  { key: 'include_closed_leads', label: '✅ Leads Fechados' },
  { key: 'include_new_contacts', label: '👤 Contatos Cadastrados' },
  { key: 'include_response_time', label: '⏱️ Tempo Médio de Resposta' },
  { key: 'include_ai_replies', label: '🤖 Respostas da IA' },
  { key: 'include_followups', label: '📋 Follow-ups (por tipo e resultado)' },
] as const;

export function WhatsAppReportSettings() {
  const [instances, setInstances] = useState<Instance[]>([]);
  const [config, setConfig] = useState<ReportConfig>(defaultConfig);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newPhone, setNewPhone] = useState('');
  const [newTime, setNewTime] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const [instRes, configRes] = await Promise.all([
      supabase
        .from('whatsapp_instances')
        .select('id, instance_name, owner_phone')
        .eq('is_active', true)
        .order('instance_name'),
      supabase
        .from('whatsapp_report_config')
        .select('*')
        .limit(1)
        .maybeSingle(),
    ]);

    if (instRes.data) setInstances(instRes.data);
    if (configRes.data) {
      setConfig({
        id: configRes.data.id,
        is_active: configRes.data.is_active,
        report_name: configRes.data.report_name,
        sender_instance_ids: configRes.data.sender_instance_ids || [],
        target_instance_ids: configRes.data.target_instance_ids || [],
        recipient_phones: configRes.data.recipient_phones || [],
        schedule_times: configRes.data.schedule_times || ['00:00', '12:00'],
        include_messages_inbound: configRes.data.include_messages_inbound,
        include_messages_outbound: configRes.data.include_messages_outbound,
        include_conversations: configRes.data.include_conversations,
        include_unread: configRes.data.include_unread,
        include_calls: configRes.data.include_calls,
        include_new_leads: configRes.data.include_new_leads,
        include_closed_leads: configRes.data.include_closed_leads,
        include_new_contacts: configRes.data.include_new_contacts,
        include_response_time: configRes.data.include_response_time,
        include_ai_replies: configRes.data.include_ai_replies,
        include_followups: configRes.data.include_followups ?? true,
      });
    }
    setLoading(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        is_active: config.is_active,
        report_name: config.report_name,
        sender_instance_ids: config.sender_instance_ids,
        target_instance_ids: config.target_instance_ids,
        recipient_phones: config.recipient_phones,
        schedule_times: config.schedule_times,
        include_messages_inbound: config.include_messages_inbound,
        include_messages_outbound: config.include_messages_outbound,
        include_conversations: config.include_conversations,
        include_unread: config.include_unread,
        include_calls: config.include_calls,
        include_new_leads: config.include_new_leads,
        include_closed_leads: config.include_closed_leads,
        include_new_contacts: config.include_new_contacts,
        include_response_time: config.include_response_time,
        include_ai_replies: config.include_ai_replies,
        include_followups: config.include_followups,
        updated_at: new Date().toISOString(),
      };

      if (config.id) {
        const { error } = await supabase
          .from('whatsapp_report_config')
          .update(payload)
          .eq('id', config.id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from('whatsapp_report_config')
          .insert(payload)
          .select('id')
          .single();
        if (error) throw error;
        setConfig(prev => ({ ...prev, id: data.id }));
      }
      toast.success('Configuração do relatório salva!');
    } catch (e: any) {
      console.error(e);
      toast.error('Erro ao salvar: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  const toggleInstanceInList = (list: 'sender_instance_ids' | 'target_instance_ids', id: string) => {
    setConfig(prev => {
      const current = prev[list];
      return {
        ...prev,
        [list]: current.includes(id) ? current.filter(x => x !== id) : [...current, id],
      };
    });
  };

  const addPhone = () => {
    const cleaned = newPhone.replace(/\D/g, '');
    if (cleaned.length < 10) return toast.error('Número inválido');
    if (config.recipient_phones.includes(cleaned)) return toast.error('Número já adicionado');
    setConfig(prev => ({ ...prev, recipient_phones: [...prev.recipient_phones, cleaned] }));
    setNewPhone('');
  };

  const removePhone = (phone: string) => {
    setConfig(prev => ({ ...prev, recipient_phones: prev.recipient_phones.filter(p => p !== phone) }));
  };

  const addTime = () => {
    if (!newTime || config.schedule_times.includes(newTime)) return;
    setConfig(prev => ({ ...prev, schedule_times: [...prev.schedule_times, newTime].sort() }));
    setNewTime('');
  };

  const removeTime = (time: string) => {
    setConfig(prev => ({ ...prev, schedule_times: prev.schedule_times.filter(t => t !== time) }));
  };

  const toggleMetric = (key: string) => {
    setConfig(prev => ({ ...prev, [key]: !prev[key as keyof ReportConfig] }));
  };

  const sendTestReport = async () => {
    try {
      toast.info('Enviando relatório de teste...');
      const { error } = await cloudFunctions.invoke('whatsapp-instance-report', {
        body: { test: true },
      });
      if (error) throw error;
      toast.success('Relatório de teste enviado!');
    } catch (e: any) {
      toast.error('Erro ao enviar teste: ' + e.message);
    }
  };

  if (loading) {
    return <div className="text-center text-sm text-muted-foreground py-8">Carregando...</div>;
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" />
            Relatório Automático por Instância
          </CardTitle>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Label htmlFor="report-active" className="text-xs">Ativo</Label>
              <Switch
                id="report-active"
                checked={config.is_active}
                onCheckedChange={(v) => setConfig(prev => ({ ...prev, is_active: v }))}
              />
            </div>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Configure o envio automático de relatórios com métricas de cada instância WhatsApp.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Schedule */}
        <div className="space-y-2">
          <Label className="text-sm font-medium flex items-center gap-1.5">
            <Clock className="h-4 w-4" /> Horários de Envio
          </Label>
          <div className="flex flex-wrap gap-2">
            {config.schedule_times.map(time => (
              <Badge key={time} variant="secondary" className="gap-1 text-xs">
                {time}
                <button onClick={() => removeTime(time)} className="ml-1 hover:text-destructive">
                  <Trash2 className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
          <div className="flex gap-2">
            <Input
              type="time"
              value={newTime}
              onChange={(e) => setNewTime(e.target.value)}
              className="h-8 w-32 text-xs"
            />
            <Button size="sm" variant="outline" onClick={addTime} className="h-8 text-xs">
              <Plus className="h-3 w-3 mr-1" /> Adicionar
            </Button>
          </div>
        </div>

        {/* Sender Instances */}
        <div className="space-y-2">
          <Label className="text-sm font-medium flex items-center gap-1.5">
            <Send className="h-4 w-4" /> Instância(s) que Enviam o Relatório
          </Label>
          <p className="text-xs text-muted-foreground">Selecione por qual(is) número(s) o relatório será enviado.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {instances.map(inst => (
              <label
                key={inst.id}
                className={`flex items-center gap-2 p-2.5 border rounded-lg cursor-pointer transition-colors text-sm ${
                  config.sender_instance_ids.includes(inst.id)
                    ? 'border-primary bg-primary/5'
                    : 'hover:bg-muted/50'
                }`}
              >
                <Checkbox
                  checked={config.sender_instance_ids.includes(inst.id)}
                  onCheckedChange={() => toggleInstanceInList('sender_instance_ids', inst.id)}
                />
                <span className="font-medium text-xs">{inst.instance_name}</span>
                {inst.owner_phone && (
                  <Badge variant="outline" className="text-[10px] ml-auto">{inst.owner_phone}</Badge>
                )}
              </label>
            ))}
          </div>
        </div>

        {/* Target Instances */}
        <div className="space-y-2">
          <Label className="text-sm font-medium flex items-center gap-1.5">
            <Target className="h-4 w-4" /> Instâncias no Relatório
          </Label>
          <p className="text-xs text-muted-foreground">Selecione quais instâncias terão dados no relatório. Vazio = todas.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {instances.map(inst => (
              <label
                key={inst.id}
                className={`flex items-center gap-2 p-2.5 border rounded-lg cursor-pointer transition-colors text-sm ${
                  config.target_instance_ids.includes(inst.id)
                    ? 'border-primary bg-primary/5'
                    : 'hover:bg-muted/50'
                }`}
              >
                <Checkbox
                  checked={config.target_instance_ids.includes(inst.id)}
                  onCheckedChange={() => toggleInstanceInList('target_instance_ids', inst.id)}
                />
                <span className="font-medium text-xs">{inst.instance_name}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Recipient Phones */}
        <div className="space-y-2">
          <Label className="text-sm font-medium flex items-center gap-1.5">
            📱 Destinatários do Relatório
          </Label>
          <p className="text-xs text-muted-foreground">
            Números que receberão o relatório. Vazio = donos das instâncias selecionadas.
          </p>
          <div className="flex flex-wrap gap-2">
            {config.recipient_phones.map(phone => (
              <Badge key={phone} variant="secondary" className="gap-1 text-xs">
                {phone}
                <button onClick={() => removePhone(phone)} className="ml-1 hover:text-destructive">
                  <Trash2 className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
          <div className="flex gap-2">
            <Input
              placeholder="5511999999999"
              value={newPhone}
              onChange={(e) => setNewPhone(e.target.value)}
              className="h-8 text-xs flex-1"
            />
            <Button size="sm" variant="outline" onClick={addPhone} className="h-8 text-xs">
              <Plus className="h-3 w-3 mr-1" /> Adicionar
            </Button>
          </div>
        </div>

        {/* Metrics */}
        <div className="space-y-2">
          <Label className="text-sm font-medium flex items-center gap-1.5">
            <Settings2 className="h-4 w-4" /> Métricas do Relatório
          </Label>
          <p className="text-xs text-muted-foreground">Escolha quais dados incluir no relatório.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {metricOptions.map(opt => (
              <label
                key={opt.key}
                className={`flex items-center gap-2 p-2.5 border rounded-lg cursor-pointer transition-colors text-sm ${
                  config[opt.key as keyof ReportConfig] ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'
                }`}
              >
                <Checkbox
                  checked={config[opt.key as keyof ReportConfig] as boolean}
                  onCheckedChange={() => toggleMetric(opt.key)}
                />
                <span className="text-xs">{opt.label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 pt-2 border-t">
          <Button onClick={handleSave} disabled={saving} className="gap-1.5">
            <Save className="h-4 w-4" />
            {saving ? 'Salvando...' : 'Salvar Configuração'}
          </Button>
          <Button variant="outline" onClick={sendTestReport} className="gap-1.5">
            <CheckCircle2 className="h-4 w-4" />
            Enviar Teste Agora
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
