import { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MessageSquare, Smartphone, Search, X } from 'lucide-react';
import { useTeamMembers } from '@/hooks/useTeamMembers';
import { supabase } from '@/integrations/supabase/client';
import { externalSupabase } from '@/integrations/supabase/external-client';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

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
  const [memberSearch, setMemberSearch] = useState('');
  const [instanceSearch, setInstanceSearch] = useState('');
  const [hoverCol, setHoverCol] = useState<string | null>(null);
  const [hoverRow, setHoverRow] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [instRes, iuRes, profilesRes] = await Promise.all([
        externalSupabase.from('whatsapp_instances').select('id, instance_name').eq('is_active', true).order('instance_name'),
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

  const filteredMembers = useMemo(() => {
    const q = memberSearch.trim().toLowerCase();
    if (!q) return members;
    return members.filter(m =>
      (m.full_name || '').toLowerCase().includes(q) ||
      (m.email || '').toLowerCase().includes(q)
    );
  }, [members, memberSearch]);

  const filteredInstances = useMemo(() => {
    const q = instanceSearch.trim().toLowerCase();
    if (!q) return instances;
    return instances.filter(i => i.instance_name.toLowerCase().includes(q));
  }, [instances, instanceSearch]);

  const countByMember = useMemo(() => {
    const map = new Map<string, number>();
    instanceUsers.forEach(iu => map.set(iu.user_id, (map.get(iu.user_id) || 0) + 1));
    return map;
  }, [instanceUsers]);

  const countByInstance = useMemo(() => {
    const map = new Map<string, number>();
    instanceUsers.forEach(iu => map.set(iu.instance_id, (map.get(iu.instance_id) || 0) + 1));
    return map;
  }, [instanceUsers]);

  const toggleAccess = async (userId: string, instanceId: string) => {
    const key = `${userId}-${instanceId}`;
    setSaving(key);
    try {
      const existing = instanceUsers.find(iu => iu.user_id === userId && iu.instance_id === instanceId);
      if (existing) {
        await supabase.from('whatsapp_instance_users').delete().eq('id', existing.id);
        if (getDefaultInstance(userId) === instanceId) {
          await supabase.from('profiles').update({ default_instance_id: null } as any).eq('user_id', userId);
        }
        setInstanceUsers(prev => prev.filter(iu => iu.id !== existing.id));
      } else {
        const { data } = await supabase.from('whatsapp_instance_users').insert({ user_id: userId, instance_id: instanceId }).select('id, instance_id, user_id').single();
        if (data) setInstanceUsers(prev => [...prev, data as InstanceUser]);
      }
    } catch {
      toast.error('Erro ao atualizar acesso');
    } finally {
      setSaving(null);
    }
  };

  const bulkSetRow = async (userId: string, grant: boolean) => {
    setSaving(`row-${userId}`);
    try {
      const targets = filteredInstances;
      if (grant) {
        const missing = targets.filter(t => !hasAccess(userId, t.id));
        if (missing.length === 0) return;
        const rows = missing.map(t => ({ user_id: userId, instance_id: t.id }));
        const { data } = await supabase.from('whatsapp_instance_users').insert(rows).select('id, instance_id, user_id');
        if (data) setInstanceUsers(prev => [...prev, ...(data as InstanceUser[])]);
        toast.success(`${missing.length} acesso(s) concedido(s)`);
      } else {
        const toRemove = instanceUsers.filter(iu => iu.user_id === userId && targets.some(t => t.id === iu.instance_id));
        if (toRemove.length === 0) return;
        await supabase.from('whatsapp_instance_users').delete().in('id', toRemove.map(r => r.id));
        setInstanceUsers(prev => prev.filter(iu => !toRemove.some(r => r.id === iu.id)));
        toast.success(`${toRemove.length} acesso(s) removido(s)`);
      }
    } catch {
      toast.error('Erro na operação em lote');
    } finally {
      setSaving(null);
    }
  };

  const bulkSetColumn = async (instanceId: string, grant: boolean) => {
    setSaving(`col-${instanceId}`);
    try {
      const targets = filteredMembers;
      if (grant) {
        const missing = targets.filter(m => !hasAccess(m.user_id, instanceId));
        if (missing.length === 0) return;
        const rows = missing.map(m => ({ user_id: m.user_id, instance_id: instanceId }));
        const { data } = await supabase.from('whatsapp_instance_users').insert(rows).select('id, instance_id, user_id');
        if (data) setInstanceUsers(prev => [...prev, ...(data as InstanceUser[])]);
        toast.success(`${missing.length} acesso(s) concedido(s)`);
      } else {
        const toRemove = instanceUsers.filter(iu => iu.instance_id === instanceId && targets.some(m => m.user_id === iu.user_id));
        if (toRemove.length === 0) return;
        await supabase.from('whatsapp_instance_users').delete().in('id', toRemove.map(r => r.id));
        setInstanceUsers(prev => prev.filter(iu => !toRemove.some(r => r.id === iu.id)));
        toast.success(`${toRemove.length} acesso(s) removido(s)`);
      }
    } catch {
      toast.error('Erro na operação em lote');
    } finally {
      setSaving(null);
    }
  };

  const setDefaultInstance = async (userId: string, instanceId: string | null) => {
    const key = `default-${userId}`;
    setSaving(key);
    try {
      await supabase.from('profiles').update({ default_instance_id: instanceId } as any).eq('user_id', userId);
      setMemberDefaults(prev => {
        const exists = prev.some(m => m.user_id === userId);
        if (exists) return prev.map(m => m.user_id === userId ? { ...m, default_instance_id: instanceId } : m);
        return [...prev, { user_id: userId, default_instance_id: instanceId }];
      });
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

  const COL_W = 88; // px per instance column
  const ROW_H = 56;

  return (
    <div className="space-y-6">
      <Card className="border-0 shadow-card">
        <CardHeader>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <CardTitle className="flex items-center gap-2">
                <MessageSquare className="h-5 w-5" />
                Acesso às Instâncias WhatsApp
              </CardTitle>
              <CardDescription>
                Clique para conceder/revogar. Use os botões "Tudo / Nada" para ações em lote nos resultados filtrados.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={memberSearch}
                  onChange={e => setMemberSearch(e.target.value)}
                  placeholder="Buscar membro..."
                  className="pl-7 h-8 w-48 text-xs"
                />
                {memberSearch && (
                  <button onClick={() => setMemberSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2">
                    <X className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                )}
              </div>
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={instanceSearch}
                  onChange={e => setInstanceSearch(e.target.value)}
                  placeholder="Buscar instância..."
                  className="pl-7 h-8 w-48 text-xs"
                />
                {instanceSearch && (
                  <button onClick={() => setInstanceSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2">
                    <X className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
            <span>{filteredMembers.length} membro(s)</span>
            <span>•</span>
            <span>{filteredInstances.length} instância(s)</span>
            <span>•</span>
            <span>{instanceUsers.length} acessos totais</span>
          </div>
        </CardHeader>
        <CardContent>
          <div
            className="overflow-auto max-h-[70vh] relative border rounded-md"
            style={{ scrollBehavior: 'smooth' }}
          >
            <table className="border-collapse" style={{ minWidth: 280 + filteredInstances.length * COL_W }}>
              <thead>
                <tr>
                  <th
                    className="sticky top-0 left-0 z-40 bg-card border-b border-r text-left px-3 py-2 text-xs font-medium"
                    style={{ width: 280, minWidth: 280 }}
                  >
                    Membro
                  </th>
                  {filteredInstances.map(inst => {
                    const isHover = hoverCol === inst.id;
                    return (
                      <th
                        key={inst.id}
                        onMouseEnter={() => setHoverCol(inst.id)}
                        onMouseLeave={() => setHoverCol(null)}
                        className={cn(
                          'sticky top-0 z-30 border-b border-r bg-card px-1 py-2 align-bottom',
                          isHover && 'bg-accent'
                        )}
                        style={{ width: COL_W, minWidth: COL_W, height: 120 }}
                      >
                        <div className="flex flex-col items-center gap-1">
                          <div
                            className="text-[11px] font-medium leading-tight text-center break-words max-w-[80px]"
                            title={inst.instance_name}
                          >
                            {inst.instance_name}
                          </div>
                          <Badge variant="secondary" className="h-4 px-1 text-[9px]">
                            {countByInstance.get(inst.id) || 0}
                          </Badge>
                          <div className="flex gap-0.5">
                            <button
                              onClick={() => bulkSetColumn(inst.id, true)}
                              disabled={saving === `col-${inst.id}`}
                              className="text-[9px] px-1 rounded hover:bg-emerald-100 dark:hover:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400"
                              title="Conceder a todos os membros filtrados"
                            >
                              Tudo
                            </button>
                            <button
                              onClick={() => bulkSetColumn(inst.id, false)}
                              disabled={saving === `col-${inst.id}`}
                              className="text-[9px] px-1 rounded hover:bg-rose-100 dark:hover:bg-rose-900/30 text-rose-700 dark:text-rose-400"
                              title="Remover de todos os membros filtrados"
                            >
                              Nada
                            </button>
                          </div>
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {filteredMembers.map(member => {
                  const isRowHover = hoverRow === member.user_id;
                  return (
                    <tr
                      key={member.user_id}
                      onMouseEnter={() => setHoverRow(member.user_id)}
                      onMouseLeave={() => setHoverRow(null)}
                      className={cn(isRowHover && 'bg-accent/40')}
                    >
                      <td
                        className={cn(
                          'sticky left-0 z-20 bg-card border-b border-r px-3 py-2',
                          isRowHover && 'bg-accent'
                        )}
                        style={{ width: 280, minWidth: 280, height: ROW_H }}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-medium text-sm truncate">{member.full_name || 'Sem nome'}</p>
                            <p className="text-xs text-muted-foreground truncate">{member.email}</p>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <Badge variant="secondary" className="h-4 px-1 text-[9px]">
                              {countByMember.get(member.user_id) || 0}
                            </Badge>
                            <button
                              onClick={() => bulkSetRow(member.user_id, true)}
                              disabled={saving === `row-${member.user_id}`}
                              className="text-[9px] px-1 rounded hover:bg-emerald-100 dark:hover:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400"
                              title="Conceder todas as instâncias filtradas"
                            >
                              Tudo
                            </button>
                            <button
                              onClick={() => bulkSetRow(member.user_id, false)}
                              disabled={saving === `row-${member.user_id}`}
                              className="text-[9px] px-1 rounded hover:bg-rose-100 dark:hover:bg-rose-900/30 text-rose-700 dark:text-rose-400"
                              title="Remover todas as instâncias filtradas"
                            >
                              Nada
                            </button>
                          </div>
                        </div>
                      </td>
                      {filteredInstances.map(inst => {
                        const checked = hasAccess(member.user_id, inst.id);
                        const isSaving = saving === `${member.user_id}-${inst.id}`;
                        const isColHover = hoverCol === inst.id;
                        return (
                          <td
                            key={inst.id}
                            onClick={() => !isSaving && toggleAccess(member.user_id, inst.id)}
                            className={cn(
                              'border-b border-r text-center cursor-pointer transition-colors',
                              (isColHover || isRowHover) && 'bg-accent/40',
                              isColHover && isRowHover && 'bg-accent',
                              checked && 'bg-emerald-50 dark:bg-emerald-950/20',
                              isSaving && 'opacity-50'
                            )}
                            style={{ width: COL_W, minWidth: COL_W, height: ROW_H }}
                          >
                            <Checkbox
                              checked={checked}
                              disabled={isSaving}
                              onCheckedChange={() => toggleAccess(member.user_id, inst.id)}
                              className="mx-auto pointer-events-none"
                            />
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
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
            {filteredMembers.map(member => {
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
