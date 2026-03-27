import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  User,
  Activity,
  Clock,
  Calendar,
  Save,
  Loader2,
  LogIn,
  LogOut,
  MousePointer,
  FileText,
  MessageSquare,
  UserPlus,
  Phone,
  Smartphone,
  Search,
  Scale,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { format, formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface MemberDetailSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  member: {
    id: string;
    user_id: string;
    role: 'admin' | 'member';
    email: string | null;
    full_name: string | null;
    created_at: string;
  } | null;
  onUpdate: () => void;
}

interface Session {
  id: string;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  end_reason: string | null;
}

interface ActivityLog {
  id: string;
  action_type: string;
  entity_type: string | null;
  created_at: string;
  metadata: any;
}

export function MemberDetailSheet({ open, onOpenChange, member, onUpdate }: MemberDetailSheetProps) {
  const [activeTab, setActiveTab] = useState('profile');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [oabNumber, setOabNumber] = useState('');
  const [oabUf, setOabUf] = useState('');
  const [defaultInstanceId, setDefaultInstanceId] = useState('');
  const [instances, setInstances] = useState<{ id: string; instance_name: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activities, setActivities] = useState<ActivityLog[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  
  // OAB search state
  const [oabSearchQuery, setOabSearchQuery] = useState('');
  const [oabSearchResults, setOabSearchResults] = useState<Array<{ name: string; oab_number: string; oab_uf: string }>>([]);
  const [oabSearching, setOabSearching] = useState(false);
  const [showOabDropdown, setShowOabDropdown] = useState(false);
  const oabSearchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const oabDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Fetch WhatsApp instances once
    const fetchInstances = async () => {
      const { data } = await supabase
        .from('whatsapp_instances')
        .select('id, instance_name')
        .eq('is_active', true)
        .order('instance_name');
      setInstances(data || []);
    };
    fetchInstances();
  }, []);

  useEffect(() => {
    if (member) {
      setFullName(member.full_name || '');
      setEmail(member.email || '');
      fetchProfileExtras();
      fetchMemberData();
    }
  }, [member]);

  const fetchProfileExtras = async () => {
    if (!member) return;
    const { data } = await supabase
      .from('profiles')
      .select('phone, default_instance_id, oab_number, oab_uf')
      .eq('user_id', member.user_id)
      .single();
    setPhone(data?.phone || '');
    setOabNumber((data as any)?.oab_number || '');
    setOabUf((data as any)?.oab_uf || '');
    setDefaultInstanceId(data?.default_instance_id || '');
  };

  const fetchMemberData = async () => {
    if (!member) return;
    
    setLoadingData(true);
    try {
      // Fetch sessions
      const { data: sessionsData } = await supabase
        .from('user_sessions')
        .select('*')
        .eq('user_id', member.user_id)
        .order('started_at', { ascending: false })
        .limit(50);

      setSessions(sessionsData || []);

      // Fetch activity logs
      const { data: activityData } = await supabase
        .from('user_activity_log')
        .select('*')
        .eq('user_id', member.user_id)
        .order('created_at', { ascending: false })
        .limit(100);

      setActivities(activityData || []);
    } catch (error) {
      console.error('Error fetching member data:', error);
    } finally {
      setLoadingData(false);
    }
  };

  const normalizePhone = (raw: string): { digits: string; wasFixed: boolean } => {
    let digits = raw.replace(/\D/g, '');
    if (!digits) return { digits: '', wasFixed: false };
    let wasFixed = false;
    if (digits.length >= 10 && !digits.startsWith('55')) {
      digits = '55' + digits;
      wasFixed = true;
    }
    if (digits.length === 12 && digits.startsWith('55')) {
      const ddd = digits.slice(2, 4);
      const number = digits.slice(4);
      digits = '55' + ddd + '9' + number;
      wasFixed = true;
    }
    return { digits, wasFixed };
  };

  const formatPhoneDisplay = (digits: string): string => {
    if (!digits) return '';
    if (digits.length === 13) {
      return `+${digits.slice(0, 2)} ${digits.slice(2, 4)} ${digits.slice(4, 9)}-${digits.slice(9)}`;
    }
    return digits;
  };

  const handlePhoneBlur = () => {
    const raw = phone.replace(/\D/g, '');
    if (!raw) return;
    const { digits, wasFixed } = normalizePhone(raw);
    const formatted = formatPhoneDisplay(digits);
    setPhone(formatted);
    if (wasFixed) {
      toast.info('Número corrigido automaticamente (código 55 ou dígito 9 adicionado).');
    }
    if (digits.length > 0 && digits.length !== 13) {
      toast.warning('Número parece incompleto. Formato esperado: +55 XX 9XXXX-XXXX');
    }
  };

  const handleSaveProfile = async () => {
    if (!member) return;

    const { digits: normalizedPhone } = normalizePhone(phone);
    
    if (normalizedPhone && normalizedPhone.length !== 13) {
      toast.error('Número inválido. Formato esperado: +55 DDD 9XXXX-XXXX');
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          full_name: fullName.trim(),
          email: email.trim(),
          phone: normalizedPhone || null,
          oab_number: oabNumber.trim() || null,
          oab_uf: oabUf.trim().toUpperCase() || null,
          default_instance_id: defaultInstanceId && defaultInstanceId !== 'none' ? defaultInstanceId : null,
        } as any)
        .eq('user_id', member.user_id);

      if (error) throw error;

      toast.success('Perfil atualizado!');
      onUpdate();
    } catch (error: any) {
      toast.error(error.message || 'Erro ao atualizar perfil');
    } finally {
      setSaving(false);
    }
  };

  const getActivityIcon = (actionType: string) => {
    switch (actionType) {
      case 'page_visit':
        return <MousePointer className="h-4 w-4" />;
      case 'login':
        return <LogIn className="h-4 w-4" />;
      case 'logout':
        return <LogOut className="h-4 w-4" />;
      case 'reply':
        return <MessageSquare className="h-4 w-4" />;
      case 'dm_sent':
        return <MessageSquare className="h-4 w-4" />;
      case 'lead_created':
        return <UserPlus className="h-4 w-4" />;
      case 'contact_registered':
        return <UserPlus className="h-4 w-4" />;
      default:
        return <Activity className="h-4 w-4" />;
    }
  };

  const getActivityLabel = (actionType: string) => {
    const labels: Record<string, string> = {
      page_visit: 'Visitou página',
      login: 'Login',
      logout: 'Logout',
      reply: 'Respondeu comentário',
      dm_sent: 'Enviou DM',
      lead_created: 'Criou lead',
      contact_registered: 'Registrou contato',
      skip: 'Pulou comentário',
      follow_requested: 'Solicitou seguir',
      button_click: 'Clicou em botão',
      form_submit: 'Enviou formulário',
      filter_applied: 'Aplicou filtro',
      export_data: 'Exportou dados',
      search_performed: 'Realizou busca',
    };
    return labels[actionType] || actionType;
  };

  const getEndReasonLabel = (reason: string | null) => {
    if (!reason) return 'Em andamento';
    const labels: Record<string, string> = {
      logout: 'Logout',
      inactivity: 'Inatividade',
      tab_close: 'Fechou aba',
      session_end: 'Sessão encerrada',
    };
    return labels[reason] || reason;
  };

  const formatDuration = (seconds: number | null) => {
    if (!seconds) return '-';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    if (minutes > 0) {
      return `${minutes}m ${secs}s`;
    }
    return `${secs}s`;
  };

  if (!member) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
              <User className="h-5 w-5 text-primary" />
            </div>
            <div>
              <span>{member.full_name || 'Sem nome'}</span>
              <Badge variant={member.role === 'admin' ? 'default' : 'secondary'} className="ml-2">
                {member.role === 'admin' ? 'Admin' : 'Membro'}
              </Badge>
            </div>
          </SheetTitle>
          <SheetDescription>{member.email}</SheetDescription>
        </SheetHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-6">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="profile" className="gap-2">
              <User className="h-4 w-4" />
              Perfil
            </TabsTrigger>
            <TabsTrigger value="sessions" className="gap-2">
              <Clock className="h-4 w-4" />
              Sessões
            </TabsTrigger>
            <TabsTrigger value="activity" className="gap-2">
              <Activity className="h-4 w-4" />
              Atividades
            </TabsTrigger>
          </TabsList>

          <TabsContent value="profile" className="mt-4 space-y-4">
            <div className="space-y-2">
              <Label>Nome completo</Label>
              <Input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Nome do usuário"
              />
            </div>

            <div className="space-y-2">
              <Label>Email</Label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="email@exemplo.com"
              />
            </div>

            <div className="space-y-2">
              <Label className="flex items-center gap-1.5">
                <Phone className="h-3.5 w-3.5" />
                Telefone / WhatsApp
              </Label>
              <Input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                onBlur={handlePhoneBlur}
                placeholder="+55 86 98805-4381"
              />
              <p className="text-xs text-muted-foreground">
                Usado para receber notificações via WhatsApp
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5">
                  <FileText className="h-3.5 w-3.5" />
                  Nº OAB
                </Label>
                <Input
                  value={oabNumber}
                  onChange={(e) => setOabNumber(e.target.value)}
                  placeholder="Ex: 12345"
                />
              </div>
              <div className="space-y-2">
                <Label>UF da OAB</Label>
                <Input
                  value={oabUf}
                  onChange={(e) => setOabUf(e.target.value.toUpperCase())}
                  placeholder="Ex: PI"
                  maxLength={2}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Usado para identificar advogados internos ao importar processos do Escavador
            </p>

            <div className="space-y-2">
              <Label className="flex items-center gap-1.5">
                <Smartphone className="h-3.5 w-3.5" />
                Instância WhatsApp
              </Label>
              <Select value={defaultInstanceId} onValueChange={setDefaultInstanceId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione uma instância" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Nenhuma</SelectItem>
                  {instances.map((inst) => (
                    <SelectItem key={inst.id} value={inst.id}>
                      {inst.instance_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Instância padrão para envio de mensagens
              </p>
            </div>

            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <div className="flex items-center gap-1">
                <Calendar className="h-4 w-4" />
                Membro desde {format(new Date(member.created_at), "dd/MM/yyyy", { locale: ptBR })}
              </div>
            </div>

            <Button onClick={handleSaveProfile} disabled={saving} className="w-full">
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Salvar alterações
            </Button>
          </TabsContent>

          <TabsContent value="sessions" className="mt-4">
            {loadingData ? (
              <div className="flex items-center justify-center p-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : sessions.length === 0 ? (
              <div className="text-center p-8 text-muted-foreground">
                <Clock className="h-12 w-12 mx-auto mb-2 opacity-50" />
                <p>Nenhuma sessão registrada</p>
              </div>
            ) : (
              <ScrollArea className="h-[400px] pr-4">
                <div className="space-y-3">
                  {sessions.map((session) => (
                    <div
                      key={session.id}
                      className="p-3 rounded-lg border bg-card"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <LogIn className="h-4 w-4 text-green-500" />
                          <span className="font-medium text-sm">
                            {format(new Date(session.started_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                          </span>
                        </div>
                        <Badge variant="outline" className="text-xs">
                          {formatDuration(session.duration_seconds)}
                        </Badge>
                      </div>
                      
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        {session.ended_at && (
                          <div className="flex items-center gap-1">
                            <LogOut className="h-3 w-3" />
                            Saída: {format(new Date(session.ended_at), "HH:mm", { locale: ptBR })}
                          </div>
                        )}
                        <div className="flex items-center gap-1">
                          <FileText className="h-3 w-3" />
                          {getEndReasonLabel(session.end_reason)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </TabsContent>

          <TabsContent value="activity" className="mt-4">
            {loadingData ? (
              <div className="flex items-center justify-center p-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : activities.length === 0 ? (
              <div className="text-center p-8 text-muted-foreground">
                <Activity className="h-12 w-12 mx-auto mb-2 opacity-50" />
                <p>Nenhuma atividade registrada</p>
              </div>
            ) : (
              <ScrollArea className="h-[400px] pr-4">
                <div className="space-y-2">
                  {activities.map((activity) => (
                    <div
                      key={activity.id}
                      className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50"
                    >
                      <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                        {getActivityIcon(activity.action_type)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">
                          {getActivityLabel(activity.action_type)}
                        </p>
                        {activity.metadata?.path && (
                          <p className="text-xs text-muted-foreground truncate">
                            {activity.metadata.path}
                          </p>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground whitespace-nowrap">
                        {formatDistanceToNow(new Date(activity.created_at), {
                          addSuffix: true,
                          locale: ptBR,
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
