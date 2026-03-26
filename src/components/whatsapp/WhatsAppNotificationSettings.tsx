import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Save, Plus, X, Bell, Clock, Target, AlertTriangle, CalendarDays, UserPlus, User, Send } from 'lucide-react';

const DAYS_OF_WEEK = [
  { value: 0, label: 'Dom' },
  { value: 1, label: 'Seg' },
  { value: 2, label: 'Ter' },
  { value: 3, label: 'Qua' },
  { value: 4, label: 'Qui' },
  { value: 5, label: 'Sex' },
  { value: 6, label: 'Sáb' },
];

interface UserProfile {
  id: string;
  user_id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
}

interface NotificationConfig {
  id?: string;
  is_active: boolean;
  name: string;
  instance_name: string;
  recipient_phones: string[];
  recipient_user_ids: string[];
  notify_overdue_tasks: boolean;
  notify_goal_progress: boolean;
  notify_daily_summary: boolean;
  notify_weekly_summary: boolean;
  notify_session_reminder: boolean;
  notify_whatsapp_dashboard: boolean;
  dashboard_instance_names: string[];
  dashboard_schedule_times: string[];
  dashboard_schedule_days: number[];
  schedule_times: string[];
  schedule_days: number[];
  overdue_threshold_hours: number;
  goal_alert_percent: number;
}

const DEFAULT_CONFIG: NotificationConfig = {
  is_active: true,
  name: 'Notificações Gerais',
  instance_name: '',
  recipient_phones: [],
  recipient_user_ids: [],
  notify_overdue_tasks: true,
  notify_goal_progress: true,
  notify_daily_summary: true,
  notify_weekly_summary: false,
  notify_session_reminder: false,
  notify_whatsapp_dashboard: false,
  dashboard_instance_names: [],
  dashboard_schedule_times: ['08:00', '18:00'],
  dashboard_schedule_days: [1, 2, 3, 4, 5],
  schedule_times: ['08:00', '18:00'],
  schedule_days: [1, 2, 3, 4, 5],
  overdue_threshold_hours: 24,
  goal_alert_percent: 50,
};

export function WhatsAppNotificationSettings() {
  const [config, setConfig] = useState<NotificationConfig>(DEFAULT_CONFIG);
  const [instances, setInstances] = useState<any[]>([]);
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendingUserId, setSendingUserId] = useState<string | null>(null);
  const [newTime, setNewTime] = useState('');
  const [selectedUserId, setSelectedUserId] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    const [instRes, configRes, profilesRes] = await Promise.all([
      supabase.from('whatsapp_instances').select('instance_name').order('instance_name'),
      supabase.from('whatsapp_notification_config').select('*').limit(1).maybeSingle(),
      supabase.from('profiles').select('id, user_id, full_name, email, phone').order('full_name'),
    ]);
    setInstances(instRes.data || []);
    setProfiles((profilesRes.data as UserProfile[]) || []);
    if (configRes.data) {
      const d = configRes.data as any;
      setConfig({
        id: d.id,
        is_active: d.is_active ?? true,
        name: d.name || 'Notificações Gerais',
        instance_name: d.instance_name || '',
        recipient_phones: d.recipient_phones || [],
        recipient_user_ids: d.recipient_user_ids || [],
        notify_overdue_tasks: d.notify_overdue_tasks ?? true,
        notify_goal_progress: d.notify_goal_progress ?? true,
        notify_daily_summary: d.notify_daily_summary ?? true,
        notify_weekly_summary: d.notify_weekly_summary ?? false,
        notify_session_reminder: d.notify_session_reminder ?? false,
        notify_whatsapp_dashboard: d.notify_whatsapp_dashboard ?? false,
        dashboard_instance_names: d.dashboard_instance_names || [],
        dashboard_schedule_times: d.dashboard_schedule_times || ['08:00', '18:00'],
        dashboard_schedule_days: d.dashboard_schedule_days || [1, 2, 3, 4, 5],
        schedule_times: d.schedule_times || ['08:00', '18:00'],
        schedule_days: d.schedule_days || [1, 2, 3, 4, 5],
        overdue_threshold_hours: d.overdue_threshold_hours ?? 24,
        goal_alert_percent: d.goal_alert_percent ?? 50,
      });
    }
    setLoading(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Build recipient_phones from selected user profiles
      const phonesFromUsers = profiles
        .filter(p => config.recipient_user_ids.includes(p.user_id))
        .map(p => p.phone)
        .filter(Boolean) as string[];

      const payload = {
        is_active: config.is_active,
        name: config.name,
        instance_name: config.instance_name || null,
        recipient_phones: phonesFromUsers,
        recipient_user_ids: config.recipient_user_ids,
        notify_overdue_tasks: config.notify_overdue_tasks,
        notify_goal_progress: config.notify_goal_progress,
        notify_daily_summary: config.notify_daily_summary,
        notify_weekly_summary: config.notify_weekly_summary,
        notify_session_reminder: config.notify_session_reminder,
        notify_whatsapp_dashboard: config.notify_whatsapp_dashboard,
        dashboard_instance_names: config.dashboard_instance_names,
        dashboard_schedule_times: config.dashboard_schedule_times,
        dashboard_schedule_days: config.dashboard_schedule_days,
        schedule_times: config.schedule_times,
        schedule_days: config.schedule_days,
        overdue_threshold_hours: config.overdue_threshold_hours,
        goal_alert_percent: config.goal_alert_percent,
        updated_at: new Date().toISOString(),
      };

      if (config.id) {
        const { error } = await supabase.from('whatsapp_notification_config').update(payload as any).eq('id', config.id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from('whatsapp_notification_config').insert(payload as any).select('id').single();
        if (error) throw error;
        setConfig(prev => ({ ...prev, id: data.id }));
      }
      toast.success('Configurações salvas!');
    } catch (e: any) {
      toast.error('Erro ao salvar: ' + e.message);
    } finally {
      setSaving(false);
    }
  };
  const handleSendNow = async (targetUserId?: string) => {
    if (targetUserId) {
      setSendingUserId(targetUserId);
    } else {
      setSending(true);
    }
    try {
      const { data, error } = await supabase.functions.invoke('trigger-whatsapp-notifications', {
        body: targetUserId ? { target_user_id: targetUserId } : {},
      });
      if (error) throw error;
      if (data?.success) {
        const profile = targetUserId ? getProfileByUserId(targetUserId) : null;
        const label = profile ? profile.full_name || profile.email || 'Usuário' : `${data.sent}/${data.total} destinatários`;
        toast.success(`Notificação enviada para ${label}`);
      } else {
        toast.error(data?.error || 'Erro ao enviar notificação');
      }
    } catch (e: any) {
      toast.error('Erro ao enviar: ' + e.message);
    } finally {
      setSending(false);
      setSendingUserId(null);
    }
  };

  const addUser = () => {
    if (selectedUserId && !config.recipient_user_ids.includes(selectedUserId)) {
      setConfig(prev => ({ ...prev, recipient_user_ids: [...prev.recipient_user_ids, selectedUserId] }));
      setSelectedUserId('');
    }
  };

  const removeUser = (userId: string) => {
    setConfig(prev => ({ ...prev, recipient_user_ids: prev.recipient_user_ids.filter(id => id !== userId) }));
  };

  const addTime = () => {
    if (newTime && !config.schedule_times.includes(newTime)) {
      setConfig(prev => ({ ...prev, schedule_times: [...prev.schedule_times, newTime].sort() }));
      setNewTime('');
    }
  };

  const removeTime = (time: string) => {
    setConfig(prev => ({ ...prev, schedule_times: prev.schedule_times.filter(t => t !== time) }));
  };

  const toggleDay = (day: number) => {
    setConfig(prev => ({
      ...prev,
      schedule_days: prev.schedule_days.includes(day)
        ? prev.schedule_days.filter(d => d !== day)
        : [...prev.schedule_days, day].sort(),
    }));
  };

  const getProfileByUserId = (userId: string) => profiles.find(p => p.user_id === userId);
  const availableUsers = profiles.filter(p => !config.recipient_user_ids.includes(p.user_id));

  if (loading) {
    return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-6">
      {/* Master toggle */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Bell className="h-5 w-5" />
                Notificações Ativas
              </CardTitle>
              <CardDescription>Ative para receber notificações automáticas via WhatsApp</CardDescription>
            </div>
            <Switch
              checked={config.is_active}
              onCheckedChange={(v) => setConfig(prev => ({ ...prev, is_active: v }))}
            />
          </div>
        </CardHeader>
      </Card>

      {/* Instance & Recipients */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">📱 Instância e Destinatários</CardTitle>
          <CardDescription>Escolha qual instância enviará as notificações e para quais usuários</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Instância de envio</Label>
            <Select value={config.instance_name} onValueChange={(v) => setConfig(prev => ({ ...prev, instance_name: v }))}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione uma instância..." />
              </SelectTrigger>
              <SelectContent>
                {instances.map((inst) => (
                  <SelectItem key={inst.instance_name} value={inst.instance_name}>
                    {inst.instance_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Usuários destinatários</Label>
            <div className="flex gap-2">
              <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Selecione um usuário..." />
                </SelectTrigger>
                <SelectContent>
                  {availableUsers.map((profile) => (
                    <SelectItem key={profile.user_id} value={profile.user_id}>
                      <div className="flex items-center gap-2">
                        <User className="h-3 w-3" />
                        <span>{profile.full_name || profile.email || 'Sem nome'}</span>
                        {profile.phone && <span className="text-muted-foreground text-xs">({profile.phone})</span>}
                        {!profile.phone && <span className="text-destructive text-xs">(sem telefone)</span>}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" variant="outline" onClick={addUser} disabled={!selectedUserId}>
                <UserPlus className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {config.recipient_user_ids.map((userId) => {
                const profile = getProfileByUserId(userId);
                return (
                  <Badge key={userId} variant="secondary" className="gap-1 py-1 pr-1">
                    <User className="h-3 w-3" />
                    {profile?.full_name || profile?.email || 'Usuário'}
                    {profile?.phone ? (
                      <span className="text-[10px] text-muted-foreground ml-0.5">({profile.phone})</span>
                    ) : (
                      <span className="text-[10px] text-destructive ml-0.5">(sem tel.)</span>
                    )}
                    {profile?.phone && (
                      <Send
                        className={`h-3 w-3 cursor-pointer ml-1 ${sendingUserId === userId ? 'animate-spin' : 'hover:text-primary'}`}
                        onClick={(e) => { e.stopPropagation(); handleSendNow(userId); }}
                      />
                    )}
                    <X className="h-3 w-3 cursor-pointer ml-0.5" onClick={() => removeUser(userId)} />
                  </Badge>
                );
              })}
              {config.recipient_user_ids.length === 0 && (
                <p className="text-xs text-muted-foreground">Nenhum destinatário adicionado</p>
              )}
            </div>
            {config.recipient_user_ids.some(uid => !getProfileByUserId(uid)?.phone) && (
              <p className="text-xs text-destructive flex items-center gap-1 mt-1">
                <AlertTriangle className="h-3 w-3" />
                Alguns usuários não possuem telefone cadastrado no perfil. Cadastre o número na página de perfil.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Notification Types */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">📋 Tipos de Notificação</CardTitle>
          <CardDescription>Selecione quais notificações deseja receber</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {[
            { key: 'notify_overdue_tasks', icon: <AlertTriangle className="h-4 w-4 text-red-500" />, label: 'Tarefas Atrasadas', desc: 'Aviso quando há atividades vencidas' },
            { key: 'notify_goal_progress', icon: <Target className="h-4 w-4 text-blue-500" />, label: 'Progresso de Metas', desc: 'Acompanhamento de metas diárias e mensais' },
            { key: 'notify_daily_summary', icon: <CalendarDays className="h-4 w-4 text-green-500" />, label: 'Resumo Diário', desc: 'Relatório com produtividade do dia' },
            { key: 'notify_weekly_summary', icon: <CalendarDays className="h-4 w-4 text-purple-500" />, label: 'Resumo Semanal', desc: 'Relatório consolidado da semana' },
            { key: 'notify_session_reminder', icon: <Clock className="h-4 w-4 text-orange-500" />, label: 'Lembrete de Sessão', desc: 'Aviso quando trabalhador está offline há muito tempo' },
            { key: 'notify_whatsapp_dashboard', icon: <Bell className="h-4 w-4 text-teal-500" />, label: 'Relatório Dashboard WhatsApp', desc: 'Métricas automáticas das instâncias de WhatsApp' },
          ].map(({ key, icon, label, desc }) => (
            <div key={key} className="flex items-center justify-between gap-4 py-2 border-b last:border-0">
              <div className="flex items-center gap-3">
                {icon}
                <div>
                  <p className="text-sm font-medium">{label}</p>
                  <p className="text-xs text-muted-foreground">{desc}</p>
                </div>
              </div>
              <Switch
                checked={(config as any)[key]}
                onCheckedChange={(v) => setConfig(prev => ({ ...prev, [key]: v }))}
              />
            </div>
          ))}

          {/* Dashboard WhatsApp config details - shown inline when enabled */}
          {config.notify_whatsapp_dashboard && (
            <div className="ml-7 pl-4 border-l-2 border-teal-200 space-y-4 pt-2">
              <div className="space-y-2">
                <Label className="text-sm">Instâncias a monitorar</Label>
                <div className="flex flex-wrap gap-2">
                  {instances.map((inst) => {
                    const isSelected = config.dashboard_instance_names.includes(inst.instance_name);
                    return (
                      <label key={inst.instance_name} className="flex items-center gap-1.5 cursor-pointer">
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={(checked) => {
                            setConfig(prev => ({
                              ...prev,
                              dashboard_instance_names: checked
                                ? [...prev.dashboard_instance_names, inst.instance_name]
                                : prev.dashboard_instance_names.filter((n: string) => n !== inst.instance_name),
                            }));
                          }}
                        />
                        <span className="text-sm">{inst.instance_name}</span>
                      </label>
                    );
                  })}
                </div>
                {config.dashboard_instance_names.length === 0 && (
                  <p className="text-xs text-amber-600">⚠️ Nenhuma instância selecionada — o relatório incluirá todas.</p>
                )}
              </div>

              <div className="space-y-2">
                <Label className="text-sm">Horários do relatório</Label>
                <div className="flex gap-2">
                  <Input
                    type="time"
                    value={newTime}
                    onChange={(e) => setNewTime(e.target.value)}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      if (newTime && !config.dashboard_schedule_times.includes(newTime)) {
                        setConfig(prev => ({ ...prev, dashboard_schedule_times: [...prev.dashboard_schedule_times, newTime].sort() }));
                        setNewTime('');
                      }
                    }}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {config.dashboard_schedule_times.map((time) => (
                    <Badge key={time} variant="outline" className="gap-1 text-sm">
                      🕐 {time}
                      <X className="h-3 w-3 cursor-pointer" onClick={() => setConfig(prev => ({ ...prev, dashboard_schedule_times: prev.dashboard_schedule_times.filter(t => t !== time) }))} />
                    </Badge>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-sm">Dias da semana</Label>
                <div className="flex gap-1.5">
                  {DAYS_OF_WEEK.map(({ value, label }) => (
                    <Button
                      key={value}
                      size="sm"
                      variant={config.dashboard_schedule_days.includes(value) ? 'default' : 'outline'}
                      className="h-8 w-10 text-xs"
                      onClick={() => setConfig(prev => ({
                        ...prev,
                        dashboard_schedule_days: prev.dashboard_schedule_days.includes(value)
                          ? prev.dashboard_schedule_days.filter(d => d !== value)
                          : [...prev.dashboard_schedule_days, value].sort(),
                      }))}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Schedule */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">⏰ Horários de Envio</CardTitle>
          <CardDescription>Defina quando as notificações serão enviadas</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Horários</Label>
            <div className="flex gap-2">
              <Input type="time" value={newTime} onChange={(e) => setNewTime(e.target.value)} />
              <Button size="sm" variant="outline" onClick={addTime}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {config.schedule_times.map((time) => (
                <Badge key={time} variant="outline" className="gap-1 text-sm">
                  🕐 {time}
                  <X className="h-3 w-3 cursor-pointer" onClick={() => removeTime(time)} />
                </Badge>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Dias da semana</Label>
            <div className="flex gap-1.5">
              {DAYS_OF_WEEK.map(({ value, label }) => (
                <Button
                  key={value}
                  size="sm"
                  variant={config.schedule_days.includes(value) ? 'default' : 'outline'}
                  className="h-9 w-11 text-xs"
                  onClick={() => toggleDay(value)}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Thresholds */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">⚙️ Parâmetros</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Atraso mínimo para alerta (horas)</Label>
              <Input
                type="number"
                min={1}
                value={config.overdue_threshold_hours}
                onChange={(e) => setConfig(prev => ({ ...prev, overdue_threshold_hours: parseInt(e.target.value) || 24 }))}
              />
              <p className="text-xs text-muted-foreground">Notificar quando tarefa estiver atrasada há mais de X horas</p>
            </div>
            <div className="space-y-2">
              <Label>Alerta de meta abaixo de (%)</Label>
              <Input
                type="number"
                min={0}
                max={100}
                value={config.goal_alert_percent}
                onChange={(e) => setConfig(prev => ({ ...prev, goal_alert_percent: parseInt(e.target.value) || 50 }))}
              />
              <p className="text-xs text-muted-foreground">Alertar quando progresso da meta estiver abaixo deste percentual</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* WhatsApp Dashboard Report */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                📊 Relatório do Dashboard WhatsApp
              </CardTitle>
              <CardDescription>Receba um relatório automático com as métricas do dashboard de WhatsApp</CardDescription>
            </div>
            <Switch
              checked={config.notify_whatsapp_dashboard}
              onCheckedChange={(v) => setConfig(prev => ({ ...prev, notify_whatsapp_dashboard: v }))}
            />
          </div>
        </CardHeader>
        {config.notify_whatsapp_dashboard && (
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Instâncias a monitorar</Label>
              <p className="text-xs text-muted-foreground">Selecione quais instâncias serão incluídas no relatório</p>
              <div className="flex flex-wrap gap-2 mt-1">
                {instances.map((inst) => {
                  const isSelected = config.dashboard_instance_names.includes(inst.instance_name);
                  return (
                    <label
                      key={inst.instance_name}
                      className="flex items-center gap-1.5 cursor-pointer"
                    >
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={(checked) => {
                          setConfig(prev => ({
                            ...prev,
                            dashboard_instance_names: checked
                              ? [...prev.dashboard_instance_names, inst.instance_name]
                              : prev.dashboard_instance_names.filter((n: string) => n !== inst.instance_name),
                          }));
                        }}
                      />
                      <span className="text-sm">{inst.instance_name}</span>
                    </label>
                  );
                })}
              </div>
              {config.dashboard_instance_names.length === 0 && (
                <p className="text-xs text-amber-600">⚠️ Nenhuma instância selecionada — o relatório incluirá todas.</p>
              )}
            </div>

            <div className="space-y-2">
              <Label>Horários de envio do relatório</Label>
              <div className="flex gap-2">
                <Input
                  type="time"
                  value={newTime}
                  onChange={(e) => setNewTime(e.target.value)}
                  placeholder="Ex: 08:00"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (newTime && !config.dashboard_schedule_times.includes(newTime)) {
                      setConfig(prev => ({ ...prev, dashboard_schedule_times: [...prev.dashboard_schedule_times, newTime].sort() }));
                      setNewTime('');
                    }
                  }}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {config.dashboard_schedule_times.map((time) => (
                  <Badge key={time} variant="outline" className="gap-1 text-sm">
                    🕐 {time}
                    <X
                      className="h-3 w-3 cursor-pointer"
                      onClick={() => setConfig(prev => ({ ...prev, dashboard_schedule_times: prev.dashboard_schedule_times.filter(t => t !== time) }))}
                    />
                  </Badge>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Dias da semana</Label>
              <div className="flex gap-1.5">
                {DAYS_OF_WEEK.map(({ value, label }) => (
                  <Button
                    key={value}
                    size="sm"
                    variant={config.dashboard_schedule_days.includes(value) ? 'default' : 'outline'}
                    className="h-9 w-11 text-xs"
                    onClick={() => setConfig(prev => ({
                      ...prev,
                      dashboard_schedule_days: prev.dashboard_schedule_days.includes(value)
                        ? prev.dashboard_schedule_days.filter(d => d !== value)
                        : [...prev.dashboard_schedule_days, value].sort(),
                    }))}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      <div className="flex justify-between gap-3">
        <Button
          variant="outline"
          onClick={() => handleSendNow()}
          disabled={sending || !config.is_active || !config.recipient_user_ids.length}
          className="gap-2"
        >
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Enviar para todos agora
        </Button>
        <Button onClick={handleSave} disabled={saving} className="gap-2">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Salvar Configurações
        </Button>
      </div>
    </div>
  );
}
