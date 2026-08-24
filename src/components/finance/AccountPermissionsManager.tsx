import { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Shield, Landmark, User, Check, X, Loader2, Eye, EyeOff, Settings, Save } from 'lucide-react';
import { cloudFunctions } from '@/lib/functionRouter';
import { useAuth } from '@/hooks/useAuth';
import { useFinanceAccess } from '@/hooks/useFinanceAccess';
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
  // `isAdmin` do Externo, o mesmo que a edge usa para gatear estas ações.
  // `useUserRole` lê o Cloud, e os dois conjuntos não coincidem.
  const { isAdmin, loading: roleLoading } = useFinanceAccess();
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [permissions, setPermissions] = useState<AccountPermission[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [pendingChanges, setPendingChanges] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);

  /**
   * Tudo numa chamada só, pela edge.
   *
   * A versão anterior lia `bank_transactions`, `pluggy_connections`,
   * `user_account_permissions`, `user_roles` e `profiles` do cliente
   * `supabase` — que é o Cloud. Duas coisas quebravam ao mesmo tempo:
   * as permissões que valem são as do Externo, e a lista de pessoas vinha com
   * `user_id` do Cloud, que era o que acabava gravado. Como as tabelas de
   * permissão são indexadas por uuid do Externo (26 dos 52 usuários têm número
   * diferente nos dois bancos), conceder acesso por esta tela gravava um
   * identificador que a leitura nunca encontraria — sem erro nenhum.
   */
  const carregar = useCallback(async () => {
    try {
      const { data, error } = await cloudFunctions.invoke('celcoin-open-finance', {
        body: { action: 'list_finance_permissions' },
      });
      if (error) throw error;
      if (data?.success === false) throw new Error(data?.error || 'Falha ao carregar permissões');
      setAccounts((data?.accounts as BankAccount[]) || []);
      setPermissions((data?.account_permissions as AccountPermission[]) || []);
      setTeamMembers((data?.team as TeamMember[]) || []);
    } catch (err) {
      console.error('Error fetching account permissions:', err);
      setAccounts([]);
      setPermissions([]);
      setTeamMembers([]);
    }
  }, []);

  useEffect(() => {
    if (!roleLoading && user) {
      carregar().finally(() => setLoading(false));
    }
  }, [roleLoading, user, carregar]);

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
      // Manda o CONJUNTO final, não uma sequência de grant e revoke. A versão
      // anterior revogava num laço depois de conceder: se um DELETE falhasse no
      // meio, a pessoa ficava com permissão pela metade e a tela dizia que deu
      // erro sem dizer o que sobrou. `granted_by` quem carimba é a edge, com o
      // uuid do Externo — o do Cloud viola a FK da tabela.
      const desejados = accounts
        .filter(acc => pendingChanges[acc.pluggy_account_id])
        .map(acc => acc.pluggy_account_id);

      const { data, error } = await cloudFunctions.invoke('celcoin-open-finance', {
        body: { action: 'set_account_permissions', target_user_id: selectedUser, accounts: desejados },
      });
      if (error) throw error;
      if (data?.success === false) throw new Error(data?.error || 'Falha ao salvar permissões');

      await carregar();
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
