import { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Shield, Landmark, User, Check, X, Loader2, Eye, EyeOff, Settings, Save } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useUserRole } from '@/hooks/useUserRole';
import { toast } from 'sonner';

interface BankAccount {
  pluggy_account_id: string;
  connector_name: string;
  custom_name: string | null;
}

interface AccountPermission {
  id: string;
  user_id: string;
  pluggy_account_id: string;
}

interface TeamMember {
  id: string;
  user_id: string;
  role: string;
  email: string | null;
  full_name: string | null;
}

export function AccountPermissionsManager() {
  const { user } = useAuth();
  const { isAdmin, loading: roleLoading } = useUserRole();
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [permissions, setPermissions] = useState<AccountPermission[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [pendingChanges, setPendingChanges] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);

  const fetchAccounts = useCallback(async () => {
    try {
      // Get distinct bank accounts from connections + transactions
      const { data, error } = await supabase
        .from('bank_transactions')
        .select('pluggy_account_id, pluggy_item_id')
        .not('pluggy_account_id', 'is', null);

      if (error) throw error;

      // Get unique account IDs
      const accountMap = new Map<string, { pluggy_account_id: string; pluggy_item_id: string | null }>();
      (data || []).forEach(t => {
        if (t.pluggy_account_id && !accountMap.has(t.pluggy_account_id)) {
          accountMap.set(t.pluggy_account_id, { pluggy_account_id: t.pluggy_account_id, pluggy_item_id: t.pluggy_item_id });
        }
      });

      // Get connection names
      const itemIds = [...new Set([...accountMap.values()].map(a => a.pluggy_item_id).filter(Boolean))] as string[];
      let connMap = new Map<string, { connector_name: string; custom_name: string | null }>();
      
      if (itemIds.length > 0) {
        const { data: conns } = await supabase
          .from('pluggy_connections')
          .select('pluggy_item_id, connector_name, custom_name')
          .in('pluggy_item_id', itemIds);
        
        (conns || []).forEach(c => {
          connMap.set(c.pluggy_item_id, { connector_name: c.connector_name || 'Conta', custom_name: c.custom_name });
        });
      }

      const result: BankAccount[] = [...accountMap.values()].map(a => {
        const conn = a.pluggy_item_id ? connMap.get(a.pluggy_item_id) : null;
        return {
          pluggy_account_id: a.pluggy_account_id,
          connector_name: conn?.connector_name || 'Conta',
          custom_name: conn?.custom_name || null,
        };
      });

      setAccounts(result);
    } catch (err) {
      console.error('Error fetching accounts:', err);
    }
  }, []);

  const fetchPermissions = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('user_account_permissions')
        .select('id, user_id, pluggy_account_id');
      if (error) throw error;
      setPermissions(data || []);
    } catch (err) {
      console.error('Error fetching account permissions:', err);
    }
  }, []);

  const fetchTeamMembers = useCallback(async () => {
    try {
      const { data: roles, error } = await supabase
        .from('user_roles')
        .select('id, user_id, role');
      if (error) throw error;

      const userIds = (roles || []).map(r => r.user_id);
      if (userIds.length === 0) { setTeamMembers([]); return; }

      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, full_name, email')
        .in('user_id', userIds);

      const profileMap = new Map((profiles || []).map(p => [p.user_id, p]));
      setTeamMembers((roles || []).map(r => ({
        id: r.id,
        user_id: r.user_id,
        role: r.role,
        email: profileMap.get(r.user_id)?.email || null,
        full_name: profileMap.get(r.user_id)?.full_name || null,
      })));
    } catch (err) {
      console.error('Error fetching team members:', err);
    }
  }, []);

  useEffect(() => {
    if (!roleLoading && user) {
      Promise.all([fetchAccounts(), fetchPermissions(), fetchTeamMembers()]).finally(() => setLoading(false));
    }
  }, [roleLoading, user, fetchAccounts, fetchPermissions, fetchTeamMembers]);

  const getPermissionsForUser = useCallback((userId: string) => {
    return permissions.filter(p => p.user_id === userId);
  }, [permissions]);

  const getAccountLabel = (account: BankAccount) => {
    return account.custom_name || account.connector_name;
  };

  const openUserDialog = (userId: string) => {
    setSelectedUser(userId);
    const userPerms = getPermissionsForUser(userId).map(p => p.pluggy_account_id);
    const initialState: Record<string, boolean> = {};
    accounts.forEach(acc => {
      initialState[acc.pluggy_account_id] = userPerms.includes(acc.pluggy_account_id);
    });
    setPendingChanges(initialState);
    setIsDialogOpen(true);
  };

  const handleSaveChanges = async () => {
    if (!selectedUser || !user) return;
    setSaving(true);
    try {
      const currentPerms = getPermissionsForUser(selectedUser).map(p => p.pluggy_account_id);
      
      const toGrant = accounts
        .filter(acc => pendingChanges[acc.pluggy_account_id] && !currentPerms.includes(acc.pluggy_account_id))
        .map(acc => acc.pluggy_account_id);
      
      const toRevoke = currentPerms.filter(id => !pendingChanges[id]);

      if (toGrant.length > 0) {
        const { error } = await supabase
          .from('user_account_permissions')
          .upsert(toGrant.map(id => ({ user_id: selectedUser, pluggy_account_id: id, granted_by: user.id })), { onConflict: 'user_id,pluggy_account_id' });
        if (error) throw error;
      }

      if (toRevoke.length > 0) {
        for (const id of toRevoke) {
          const { error } = await supabase
            .from('user_account_permissions')
            .delete()
            .eq('user_id', selectedUser)
            .eq('pluggy_account_id', id);
          if (error) throw error;
        }
      }

      await fetchPermissions();
      toast.success('Permissões de contas atualizadas!');
      setIsDialogOpen(false);
    } catch (err: any) {
      toast.error(err.message || 'Erro ao salvar permissões');
    } finally {
      setSaving(false);
    }
  };

  const selectedMember = useMemo(() => teamMembers.find(m => m.user_id === selectedUser), [teamMembers, selectedUser]);

  if (roleLoading || loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (!isAdmin) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <Shield className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <p className="text-muted-foreground">Apenas administradores podem gerenciar permissões de contas</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Landmark className="h-5 w-5" />
          Permissões de Contas Bancárias
        </CardTitle>
        <CardDescription>
          Defina quais contas correntes, investimentos e empréstimos cada membro pode visualizar
        </CardDescription>
      </CardHeader>
      <CardContent>
        {accounts.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            Nenhuma conta bancária conectada. Sincronize as transações primeiro.
          </p>
        ) : teamMembers.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            Nenhum membro na equipe ainda
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Membro</TableHead>
                <TableHead>Contas Visíveis</TableHead>
                <TableHead className="w-24"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {teamMembers.map((member) => {
                const memberPerms = getPermissionsForUser(member.user_id);
                const permCount = memberPerms.length;
                
                return (
                  <TableRow key={member.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                          <User className="h-4 w-4 text-primary" />
                        </div>
                        <div>
                          <p className="font-medium">{member.full_name || 'Sem nome'}</p>
                          <p className="text-xs text-muted-foreground">{member.email}</p>
                        </div>
                        {member.role === 'admin' && (
                          <Badge variant="outline" className="text-xs">Admin</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {permCount === 0 ? (
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <EyeOff className="h-4 w-4" />
                          <span className="text-sm">Nenhuma</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <Eye className="h-4 w-4 text-green-600" />
                          <span className="text-sm">{permCount} conta(s)</span>
                          <div className="flex gap-1 ml-2 flex-wrap">
                            {memberPerms.slice(0, 3).map(p => {
                              const acc = accounts.find(a => a.pluggy_account_id === p.pluggy_account_id);
                              return (
                                <Badge key={p.id} variant="secondary" className="text-xs">
                                  {acc ? getAccountLabel(acc) : p.pluggy_account_id.slice(0, 8)}
                                </Badge>
                              );
                            })}
                            {permCount > 3 && (
                              <Badge variant="secondary" className="text-xs">+{permCount - 3}</Badge>
                            )}
                          </div>
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" onClick={() => openUserDialog(member.user_id)}>
                        <Settings className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}

        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Landmark className="h-5 w-5" />
                Editar Permissões de Contas
              </DialogTitle>
            </DialogHeader>
            
            <div className="space-y-4">
              {selectedMember && (
                <div className="flex items-center gap-3 p-3 bg-muted rounded-lg">
                  <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <User className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium">{selectedMember.full_name || 'Sem nome'}</p>
                    <p className="text-sm text-muted-foreground">{selectedMember.email}</p>
                  </div>
                </div>
              )}

              <div>
                <p className="text-sm font-medium mb-3">
                  Selecione as contas que este usuário pode visualizar:
                </p>
                <p className="text-xs text-muted-foreground mb-3">
                  O acesso inclui transações, investimentos e empréstimos vinculados à conta.
                </p>

                <ScrollArea className="h-64 border rounded-lg">
                  <div className="p-3 space-y-2">
                    {accounts.map((acc) => (
                      <label
                        key={acc.pluggy_account_id}
                        className="flex items-center justify-between p-3 rounded-lg hover:bg-muted cursor-pointer transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <Landmark className="h-4 w-4 text-muted-foreground" />
                          <div className="flex flex-col">
                            <span className="font-medium">{getAccountLabel(acc)}</span>
                            <span className="text-xs text-muted-foreground">{acc.connector_name}</span>
                          </div>
                        </div>
                        <Checkbox
                          checked={pendingChanges[acc.pluggy_account_id] || false}
                          onCheckedChange={() => setPendingChanges(prev => ({ ...prev, [acc.pluggy_account_id]: !prev[acc.pluggy_account_id] }))}
                        />
                      </label>
                    ))}
                  </div>
                </ScrollArea>
              </div>

              <div className="flex justify-between items-center pt-4 border-t">
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => {
                    const all: Record<string, boolean> = {};
                    accounts.forEach(acc => { all[acc.pluggy_account_id] = true; });
                    setPendingChanges(all);
                  }}>
                    <Check className="h-4 w-4 mr-1" />
                    Todas
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => {
                    const none: Record<string, boolean> = {};
                    accounts.forEach(acc => { none[acc.pluggy_account_id] = false; });
                    setPendingChanges(none);
                  }}>
                    <X className="h-4 w-4 mr-1" />
                    Nenhuma
                  </Button>
                </div>
                
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setIsDialogOpen(false)}>Cancelar</Button>
                  <Button onClick={handleSaveChanges} disabled={saving}>
                    {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                    Salvar
                  </Button>
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
