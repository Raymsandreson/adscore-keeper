import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { 
  Shield, 
  CreditCard, 
  User, 
  Check, 
  X, 
  Loader2,
  Eye,
  EyeOff,
  Settings,
  Save
} from 'lucide-react';
import { useCardPermissions } from '@/hooks/useCardPermissions';
import { useUserRole } from '@/hooks/useUserRole';
import { toast } from 'sonner';

interface CardPermissionsManagerProps {
  availableCards: string[];
}

export function CardPermissionsManager({ availableCards }: CardPermissionsManagerProps) {
  const { isAdmin, loading: roleLoading } = useUserRole();
  const { 
    permissions, 
    teamMembers, 
    loading,
    grantPermission,
    revokePermission,
    getPermissionsForUser,
  } = useCardPermissions();

  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [pendingChanges, setPendingChanges] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);

  // Get the selected user's current permissions
  const selectedUserPermissions = useMemo(() => {
    if (!selectedUser) return [];
    return getPermissionsForUser(selectedUser).map(p => p.card_last_digits);
  }, [selectedUser, getPermissionsForUser]);

  // Initialize pending changes when dialog opens
  const openUserDialog = (userId: string) => {
    setSelectedUser(userId);
    const userPerms = getPermissionsForUser(userId).map(p => p.card_last_digits);
    const initialState: Record<string, boolean> = {};
    availableCards.forEach(card => {
      initialState[card] = userPerms.includes(card);
    });
    setPendingChanges(initialState);
    setIsDialogOpen(true);
  };

  const handleToggleCard = (card: string) => {
    setPendingChanges(prev => ({
      ...prev,
      [card]: !prev[card],
    }));
  };

  const handleSaveChanges = async () => {
    if (!selectedUser) return;

    setSaving(true);
    try {
      const currentPerms = selectedUserPermissions;
      
      // Find cards to grant (not in current, but checked in pending)
      const toGrant = availableCards.filter(
        card => pendingChanges[card] && !currentPerms.includes(card)
      );
      
      // Find cards to revoke (in current, but not checked in pending)
      const toRevoke = currentPerms.filter(
        card => !pendingChanges[card]
      );

      // Apply changes
      for (const card of toGrant) {
        await grantPermission(selectedUser, card);
      }
      
      for (const card of toRevoke) {
        await revokePermission(selectedUser, card);
      }

      toast.success('Permissões atualizadas com sucesso!');
      setIsDialogOpen(false);
    } catch (error: any) {
      toast.error(error.message || 'Erro ao salvar permissões');
    } finally {
      setSaving(false);
    }
  };

  const getSelectedMember = () => {
    return teamMembers.find(m => m.user_id === selectedUser);
  };

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
          <p className="text-muted-foreground">
            Apenas administradores podem gerenciar permissões de cartões
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Shield className="h-5 w-5" />
          Permissões de Cartões
        </CardTitle>
        <CardDescription>
          Defina quais cartões cada membro da equipe pode visualizar
        </CardDescription>
      </CardHeader>
      <CardContent>
        {teamMembers.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            Nenhum membro na equipe ainda
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Membro</TableHead>
                <TableHead>Cartões Visíveis</TableHead>
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
                          <span className="text-sm">Nenhum</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <Eye className="h-4 w-4 text-green-600" />
                          <span className="text-sm">{permCount} cartão(ões)</span>
                          <div className="flex gap-1 ml-2">
                            {memberPerms.slice(0, 3).map(p => (
                              <Badge key={p.id} variant="secondary" className="text-xs font-mono">
                                ****{p.card_last_digits}
                              </Badge>
                            ))}
                            {permCount > 3 && (
                              <Badge variant="secondary" className="text-xs">
                                +{permCount - 3}
                              </Badge>
                            )}
                          </div>
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openUserDialog(member.user_id)}
                      >
                        <Settings className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}

        {/* Edit Permissions Dialog */}
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CreditCard className="h-5 w-5" />
                Editar Permissões
              </DialogTitle>
            </DialogHeader>
            
            <div className="space-y-4">
              {getSelectedMember() && (
                <div className="flex items-center gap-3 p-3 bg-muted rounded-lg">
                  <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <User className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium">{getSelectedMember()?.full_name || 'Sem nome'}</p>
                    <p className="text-sm text-muted-foreground">{getSelectedMember()?.email}</p>
                  </div>
                </div>
              )}

              <div>
                <p className="text-sm font-medium mb-3">
                  Selecione os cartões que este usuário pode visualizar:
                </p>
                
                {availableCards.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    Nenhum cartão disponível. Sincronize as transações primeiro.
                  </p>
                ) : (
                  <ScrollArea className="h-64 border rounded-lg">
                    <div className="p-3 space-y-2">
                      {availableCards.map((card) => (
                        <label
                          key={card}
                          className="flex items-center justify-between p-3 rounded-lg hover:bg-muted cursor-pointer transition-colors"
                        >
                          <div className="flex items-center gap-3">
                            <CreditCard className="h-4 w-4 text-muted-foreground" />
                            <span className="font-mono">**** {card}</span>
                          </div>
                          <Checkbox
                            checked={pendingChanges[card] || false}
                            onCheckedChange={() => handleToggleCard(card)}
                          />
                        </label>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </div>

              <div className="flex justify-between items-center pt-4 border-t">
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const allChecked: Record<string, boolean> = {};
                      availableCards.forEach(card => { allChecked[card] = true; });
                      setPendingChanges(allChecked);
                    }}
                  >
                    <Check className="h-4 w-4 mr-1" />
                    Todos
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const allUnchecked: Record<string, boolean> = {};
                      availableCards.forEach(card => { allUnchecked[card] = false; });
                      setPendingChanges(allUnchecked);
                    }}
                  >
                    <X className="h-4 w-4 mr-1" />
                    Nenhum
                  </Button>
                </div>
                
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                    Cancelar
                  </Button>
                  <Button onClick={handleSaveChanges} disabled={saving}>
                    {saving ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      <Save className="h-4 w-4 mr-2" />
                    )}
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
