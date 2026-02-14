import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Shield, Eye, Edit2, Ban, CheckSquare, Users, Calendar, BarChart3, DollarSign, MessageCircle, Phone, MessageSquare, Contact } from 'lucide-react';
import { useModulePermissions, MODULE_DEFINITIONS, AccessLevel } from '@/hooks/useModulePermissions';
import { useTeamMembers } from '@/hooks/useTeamMembers';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

const iconMap: Record<string, React.ElementType> = {
  CheckSquare, Users, Calendar, BarChart3, DollarSign, MessageCircle, Phone, MessageSquare, Contact,
};

const accessLabels: Record<AccessLevel, { label: string; color: string; icon: React.ElementType }> = {
  none: { label: 'Sem Acesso', color: 'text-destructive', icon: Ban },
  view: { label: 'Consulta', color: 'text-amber-600', icon: Eye },
  edit: { label: 'Edição', color: 'text-green-600', icon: Edit2 },
};

export function ModulePermissionsManager() {
  const { loading: permLoading, setPermission, getUserPermissions } = useModulePermissions();
  const { members, loading: membersLoading } = useTeamMembers();
  const [saving, setSaving] = useState<string | null>(null);

  const handleChange = async (userId: string, moduleKey: string, level: AccessLevel) => {
    const key = `${userId}-${moduleKey}`;
    setSaving(key);
    try {
      await setPermission(userId, moduleKey, level);
      toast.success('Permissão atualizada');
    } catch {
      toast.error('Erro ao atualizar permissão');
    } finally {
      setSaving(null);
    }
  };

  if (permLoading || membersLoading) {
    return <div className="space-y-4"><Skeleton className="h-12 w-full" /><Skeleton className="h-64 w-full" /></div>;
  }

  if (members.length === 0) {
    return (
      <Card className="border-0 shadow-card">
        <CardContent className="py-12 text-center">
          <Shield className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
          <p className="text-muted-foreground">Nenhum membro encontrado.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-0 shadow-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="h-5 w-5" />
          Permissões por Módulo
        </CardTitle>
        <CardDescription>
          Configure o nível de acesso de cada membro. Administradores têm acesso total automaticamente.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[160px]">Membro</TableHead>
                {MODULE_DEFINITIONS.map(mod => {
                  const Icon = iconMap[mod.icon] || Shield;
                  return (
                    <TableHead key={mod.key} className="text-center min-w-[120px]">
                      <div className="flex flex-col items-center gap-1">
                        <Icon className="h-4 w-4" />
                        <span className="text-[10px] leading-tight">{mod.label}</span>
                      </div>
                    </TableHead>
                  );
                })}
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map(member => {
                const isAdminMember = member.role === 'admin';
                const perms = getUserPermissions(member.user_id);
                return (
                  <TableRow key={member.user_id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div>
                          <p className="font-medium text-sm">{member.full_name || 'Sem nome'}</p>
                          <p className="text-xs text-muted-foreground">{member.email}</p>
                        </div>
                        {isAdminMember && <Badge variant="secondary" className="text-[10px] h-5">Admin</Badge>}
                      </div>
                    </TableCell>
                    {MODULE_DEFINITIONS.map(mod => {
                      const level = perms[mod.key] || 'edit';
                      const savingKey = `${member.user_id}-${mod.key}`;
                      const isSaving = saving === savingKey;
                      return (
                        <TableCell key={mod.key} className="text-center">
                          <Select
                            value={level}
                            onValueChange={(v) => handleChange(member.user_id, mod.key, v as AccessLevel)}
                            disabled={isSaving}
                          >
                            <SelectTrigger className={cn("h-8 text-xs w-28 mx-auto", accessLabels[level].color)}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="edit">
                                <div className="flex items-center gap-2">
                                  <Edit2 className="h-3 w-3 text-green-600" />
                                  <span>Edição</span>
                                </div>
                              </SelectItem>
                              <SelectItem value="view">
                                <div className="flex items-center gap-2">
                                  <Eye className="h-3 w-3 text-amber-600" />
                                  <span>Consulta</span>
                                </div>
                              </SelectItem>
                              <SelectItem value="none">
                                <div className="flex items-center gap-2">
                                  <Ban className="h-3 w-3 text-destructive" />
                                  <span>Sem Acesso</span>
                                </div>
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                      );
                    })}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
