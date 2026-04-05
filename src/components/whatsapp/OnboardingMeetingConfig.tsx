import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Loader2, Video, Calendar, Clock, Users, Copy, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  boardId: string;
}

interface MeetingConfig {
  id?: string;
  is_active: boolean;
  activity_type: string;
  host_user_id: string;
  meeting_duration_minutes: number;
  buffer_minutes: number;
  available_days: number[];
  start_hour: number;
  end_hour: number;
  meeting_type: string;
  auto_send_after_signature: boolean;
  message_template: string;
}

interface TeamMember {
  user_id: string;
  full_name: string;
}

const DAY_LABELS: Record<number, string> = {
  0: 'Dom', 1: 'Seg', 2: 'Ter', 3: 'Qua', 4: 'Qui', 5: 'Sex', 6: 'Sáb',
};

const DEFAULT_TEMPLATE = `🤝 *Reunião de Boas-Vindas!*

Parabéns por assinar o documento! Agora vamos agendar sua reunião de onboarding.

👉 Escolha o melhor horário: {{booking_link}}

⏱ Duração: {{duration}} minutos
📹 Via chamada de vídeo no WhatsApp`;

const DEFAULT_CONFIG: MeetingConfig = {
  is_active: false,
  activity_type: 'reuniao',
  host_user_id: '',
  meeting_duration_minutes: 30,
  buffer_minutes: 15,
  available_days: [1, 2, 3, 4, 5],
  start_hour: 8,
  end_hour: 18,
  meeting_type: 'video_whatsapp',
  auto_send_after_signature: true,
  message_template: DEFAULT_TEMPLATE,
};

export function OnboardingMeetingConfig({ boardId }: Props) {
  const [config, setConfig] = useState<MeetingConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [activityTypes, setActivityTypes] = useState<{ key: string; label: string }[]>([]);

  useEffect(() => {
    if (boardId) {
      fetchConfig();
      fetchMembers();
      fetchActivityTypes();
    }
  }, [boardId]);

  const fetchConfig = async () => {
    setLoading(true);
    const { data } = await (supabase as any)
      .from('onboarding_meeting_configs')
      .select('*')
      .eq('board_id', boardId)
      .maybeSingle();
    if (data) {
      setConfig({
        id: data.id,
        is_active: data.is_active,
        activity_type: data.activity_type,
        host_user_id: data.host_user_id || '',
        meeting_duration_minutes: data.meeting_duration_minutes,
        buffer_minutes: data.buffer_minutes,
        available_days: data.available_days || [1, 2, 3, 4, 5],
        start_hour: data.start_hour,
        end_hour: data.end_hour,
        meeting_type: data.meeting_type,
        auto_send_after_signature: data.auto_send_after_signature,
        message_template: data.message_template || DEFAULT_TEMPLATE,
      });
    }
    setLoading(false);
  };

  const fetchMembers = async () => {
    const { data } = await supabase.from('profiles').select('user_id, full_name');
    setMembers((data || []).filter(m => m.full_name));
  };

  const fetchActivityTypes = async () => {
    const { data } = await supabase.from('activity_types').select('key, label').eq('is_active', true);
    setActivityTypes(data || []);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        board_id: boardId,
        is_active: config.is_active,
        activity_type: config.activity_type,
        host_user_id: config.host_user_id || null,
        meeting_duration_minutes: config.meeting_duration_minutes,
        buffer_minutes: config.buffer_minutes,
        available_days: config.available_days,
        start_hour: config.start_hour,
        end_hour: config.end_hour,
        meeting_type: config.meeting_type,
        auto_send_after_signature: config.auto_send_after_signature,
        message_template: config.message_template,
      };

      if (config.id) {
        await (supabase as any).from('onboarding_meeting_configs').update(payload).eq('id', config.id);
      } else {
        const { data } = await (supabase as any).from('onboarding_meeting_configs').insert(payload).select().single();
        if (data) setConfig(prev => ({ ...prev, id: data.id }));
      }
      toast.success('Configuração de reunião salva!');
    } catch (err) {
      toast.error('Erro ao salvar configuração');
    }
    setSaving(false);
  };

  const toggleDay = (day: number) => {
    setConfig(prev => ({
      ...prev,
      available_days: prev.available_days.includes(day)
        ? prev.available_days.filter(d => d !== day)
        : [...prev.available_days, day].sort(),
    }));
  };

  const bookingUrl = config.id
    ? `${window.location.origin}/booking/${config.id}`
    : null;

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-4 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Carregando...</span>
      </div>
    );
  }

  return (
    <div className="border rounded-lg p-4 space-y-4 bg-muted/20">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Video className="h-4 w-4 text-primary" />
          <Label className="text-sm font-semibold">📹 Reunião de Onboarding</Label>
        </div>
        <Switch
          checked={config.is_active}
          onCheckedChange={v => setConfig(prev => ({ ...prev, is_active: v }))}
        />
      </div>

      {config.is_active && (
        <div className="space-y-4 pt-2">
          {/* Host */}
          <div className="space-y-1.5">
            <Label className="text-xs">👤 Responsável pela reunião</Label>
            <Select value={config.host_user_id} onValueChange={v => setConfig(prev => ({ ...prev, host_user_id: v }))}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Selecione..." />
              </SelectTrigger>
              <SelectContent>
                {members.map(m => (
                  <SelectItem key={m.user_id} value={m.user_id}>
                    {m.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Activity type */}
          <div className="space-y-1.5">
            <Label className="text-xs">📋 Tipo de atividade criada</Label>
            <Select value={config.activity_type} onValueChange={v => setConfig(prev => ({ ...prev, activity_type: v }))}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="reuniao">Reunião</SelectItem>
                <SelectItem value="onboarding">Onboarding</SelectItem>
                {activityTypes.filter(t => !['reuniao', 'onboarding'].includes(t.key)).map(t => (
                  <SelectItem key={t.key} value={t.key}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Duration & Buffer */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">⏱ Duração (min)</Label>
              <Input
                type="number"
                min={10}
                max={120}
                value={config.meeting_duration_minutes}
                onChange={e => setConfig(prev => ({ ...prev, meeting_duration_minutes: parseInt(e.target.value) || 30 }))}
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">🔄 Intervalo entre reuniões (min)</Label>
              <Input
                type="number"
                min={0}
                max={60}
                value={config.buffer_minutes}
                onChange={e => setConfig(prev => ({ ...prev, buffer_minutes: parseInt(e.target.value) || 15 }))}
                className="h-8 text-xs"
              />
            </div>
          </div>

          {/* Available days */}
          <div className="space-y-1.5">
            <Label className="text-xs">📅 Dias disponíveis</Label>
            <div className="flex gap-1">
              {[0, 1, 2, 3, 4, 5, 6].map(day => (
                <Badge
                  key={day}
                  variant={config.available_days.includes(day) ? 'default' : 'outline'}
                  className="cursor-pointer text-[10px] px-2 py-1"
                  onClick={() => toggleDay(day)}
                >
                  {DAY_LABELS[day]}
                </Badge>
              ))}
            </div>
          </div>

          {/* Hours */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">🕐 Início</Label>
              <Select value={String(config.start_hour)} onValueChange={v => setConfig(prev => ({ ...prev, start_hour: parseInt(v) }))}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 16 }, (_, i) => i + 6).map(h => (
                    <SelectItem key={h} value={String(h)}>{String(h).padStart(2, '0')}:00</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">🕐 Fim</Label>
              <Select value={String(config.end_hour)} onValueChange={v => setConfig(prev => ({ ...prev, end_hour: parseInt(v) }))}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 16 }, (_, i) => i + 6).map(h => (
                    <SelectItem key={h} value={String(h)}>{String(h).padStart(2, '0')}:00</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Auto send */}
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-xs font-medium">📲 Enviar automaticamente após assinatura</Label>
              <p className="text-[10px] text-muted-foreground">Envia o link de agendamento via WhatsApp assim que o documento é assinado</p>
            </div>
            <Switch
              checked={config.auto_send_after_signature}
              onCheckedChange={v => setConfig(prev => ({ ...prev, auto_send_after_signature: v }))}
            />
          </div>

          {/* Message template */}
          <div className="space-y-1.5">
            <Label className="text-xs">💬 Mensagem de convite</Label>
            <Textarea
              value={config.message_template}
              onChange={e => setConfig(prev => ({ ...prev, message_template: e.target.value }))}
              className="text-xs min-h-[120px] resize-none"
              placeholder="Use {{booking_link}} e {{duration}} como variáveis"
            />
            <p className="text-[10px] text-muted-foreground">
              Variáveis: <code className="bg-muted px-1 rounded">{'{{booking_link}}'}</code> <code className="bg-muted px-1 rounded">{'{{duration}}'}</code> <code className="bg-muted px-1 rounded">{'{{contact_name}}'}</code>
            </p>
          </div>

          {/* Booking URL preview */}
          {bookingUrl && (
            <div className="flex items-center gap-2 p-2 bg-muted rounded-md">
              <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0" />
              <span className="text-[10px] text-muted-foreground truncate">{bookingUrl}</span>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0"
                onClick={() => {
                  navigator.clipboard.writeText(bookingUrl);
                  toast.success('Link copiado!');
                }}
              >
                <Copy className="h-3 w-3" />
              </Button>
            </div>
          )}

          <Button onClick={handleSave} disabled={saving} className="w-full" size="sm">
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Salvar Configuração de Reunião
          </Button>
        </div>
      )}
    </div>
  );
}
