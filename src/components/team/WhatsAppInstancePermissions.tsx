import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { MessageSquare } from 'lucide-react';
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

export function WhatsAppInstancePermissions() {
  const { members, loading: membersLoading } = useTeamMembers();
  const [instances, setInstances] = useState<Instance[]>([]);
  const [instanceUsers, setInstanceUsers] = useState<InstanceUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [instRes, iuRes] = await Promise.all([
        supabase.from('whatsapp_instances').select('id, instance_name').eq('is_active', true).order('instance_name'),
        supabase.from('whatsapp_instance_users').select('id, instance_id, user_id'),
      ]);
      setInstances(instRes.data || []);
      setInstanceUsers(iuRes.data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const hasAccess = (userId: string, instanceId: string) =>
    instanceUsers.some(iu => iu.user_id === userId && iu.instance_id === instanceId);

  const toggleAccess = async (userId: string, instanceId: string) => {
    const key = `${userId}-${instanceId}`;
    setSaving(key);
    try {
      const existing = instanceUsers.find(iu => iu.user_id === userId && iu.instance_id === instanceId);
      if (existing) {
        await supabase.from('whatsapp_instance_users').delete().eq('id', existing.id);
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
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[160px]">Membro</TableHead>
                {instances.map(inst => (
                  <TableHead key={inst.id} className="text-center min-w-[100px]">
                    <span className="text-xs leading-tight">{inst.instance_name}</span>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map(member => (
                <TableRow key={member.user_id}>
                  <TableCell>
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
  );
}
