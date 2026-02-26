import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';

import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { MessageSquare, Smartphone } from 'lucide-react';
import { useTeamMembers } from '@/hooks/useTeamMembers';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface Instance {
  id: string;
  instance_name: string;
}

interface InstanceUser {
  id: string;
  instance_id: string;
  user_id: string;
}

interface MemberDefaultInstance {
  user_id: string;
  default_instance_id: string | null;
}

export function WhatsAppInstancePermissions() {
  const { members, loading: membersLoading } = useTeamMembers();
  const [instances, setInstances] = useState<Instance[]>([]);
  const [instanceUsers, setInstanceUsers] = useState<InstanceUser[]>([]);
  const [memberDefaults, setMemberDefaults] = useState<MemberDefaultInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [instRes, iuRes, profilesRes] = await Promise.all([
        supabase.from('whatsapp_instances').select('id, instance_name').eq('is_active', true).order('instance_name'),
        supabase.from('whatsapp_instance_users').select('id, instance_id, user_id'),
        supabase.from('profiles').select('user_id, default_instance_id'),
      ]);
      setInstances(instRes.data || []);
      setInstanceUsers(iuRes.data || []);
      setMemberDefaults((profilesRes.data || []).map((p: any) => ({ user_id: p.user_id, default_instance_id: p.default_instance_id })));
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const hasAccess = (userId: string, instanceId: string) =>
    instanceUsers.some(iu => iu.user_id === userId && iu.instance_id === instanceId);

  const getDefaultInstance = (userId: string) =>
    memberDefaults.find(m => m.user_id === userId)?.default_instance_id || null;

  const toggleAccess = async (userId: string, instanceId: string) => {
    const key = `${userId}-${instanceId}`;
    setSaving(key);
    try {
      const existing = instanceUsers.find(iu => iu.user_id === userId && iu.instance_id === instanceId);
      if (existing) {
        await supabase.from('whatsapp_instance_users').delete().eq('id', existing.id);
        // If this was their default, clear it
        if (getDefaultInstance(userId) === instanceId) {
          await supabase.from('profiles').update({ default_instance_id: null } as any).eq('user_id', userId);
        }
        toast.success('Acesso removido');
      } else {
        await supabase.from('whatsapp_instance_users').insert({ user_id: userId, instance_id: instanceId });
        toast.success('Acesso concedido');
      }
      await fetchData();
    } catch {
      toast.error('Erro ao atualizar acesso');
    } finally {
      setSaving(null);
    }
  };

  const setDefaultInstance = async (userId: string, instanceId: string | null) => {
    const key = `default-${userId}`;
    setSaving(key);
    try {
      await supabase.from('profiles').update({ default_instance_id: instanceId } as any).eq('user_id', userId);
      setMemberDefaults(prev => prev.map(m => m.user_id === userId ? { ...m, default_instance_id: instanceId } : m));
      toast.success(instanceId ? 'Instância principal definida' : 'Instância principal removida');
    } catch {
      toast.error('Erro ao definir instância principal');
    } finally {
      setSaving(null);
    }
  };


  if (loading || membersLoading) {
    return <div className="space-y-4"><Skeleton className="h-12 w-full" /><Skeleton className="h-64 w-full" /></div>;
  }

  if (instances.length === 0) {
    return (
      <Card className="border-0 shadow-card">
        <CardContent className="py-12 text-center">
          <MessageSquare className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
          <p className="text-muted-foreground">Nenhuma instância WhatsApp configurada.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Access Matrix */}
      <Card className="border-0 shadow-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            Acesso às Instâncias WhatsApp
          </CardTitle>
          <CardDescription>
            Selecione quais instâncias cada membro pode acessar no Inbox.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-auto max-h-[70vh] relative">
            <Table>
              <TableHeader className="sticky top-0 z-30 bg-card">
                <TableRow>
                  <TableHead className="min-w-[200px] sticky left-0 z-40 bg-card">Membro</TableHead>
                  {instances.map(inst => (
                    <TableHead key={inst.id} className="text-center min-w-[100px] bg-card">
                      <span className="text-xs leading-tight">{inst.instance_name}</span>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map(member => (
                  <TableRow key={member.user_id}>
                    <TableCell className="sticky left-0 z-10 bg-card">
                      <div>
                        <p className="font-medium text-sm">{member.full_name || 'Sem nome'}</p>
                        <p className="text-xs text-muted-foreground">{member.email}</p>
                      </div>
                    </TableCell>
                    {instances.map(inst => {
                      const checked = hasAccess(member.user_id, inst.id);
                      const isSaving = saving === `${member.user_id}-${inst.id}`;
                      return (
                        <TableCell key={inst.id} className="text-center">
                          <Checkbox
                            checked={checked}
                            disabled={isSaving}
                            onCheckedChange={() => toggleAccess(member.user_id, inst.id)}
                            className="mx-auto"
                          />
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Default Instance per Member */}
      <Card className="border-0 shadow-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Smartphone className="h-5 w-5" />
            Instância Principal por Membro
          </CardTitle>
          <CardDescription>
            Define de qual instância cada membro faz ligações e envia mensagens por padrão.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {members.map(member => {
              const memberInstances = instances.filter(i => hasAccess(member.user_id, i.id));
              const currentDefault = getDefaultInstance(member.user_id);
              const isSaving = saving === `default-${member.user_id}`;
              return (
                <div key={member.user_id} className="flex items-center justify-between py-2 px-3 rounded-lg border">
                  <div>
                    <p className="text-sm font-medium">{member.full_name || 'Sem nome'}</p>
                    <p className="text-xs text-muted-foreground">{member.email}</p>
                  </div>
                  <Select
                    value={currentDefault || 'none'}
                    onValueChange={v => setDefaultInstance(member.user_id, v === 'none' ? null : v)}
                    disabled={isSaving || memberInstances.length === 0}
                  >
                    <SelectTrigger className="w-48 h-8 text-xs">
                      <SelectValue placeholder="Sem instância" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Sem instância principal</SelectItem>
                      {memberInstances.map(inst => (
                        <SelectItem key={inst.id} value={inst.id}>{inst.instance_name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

    </div>
  );
}
