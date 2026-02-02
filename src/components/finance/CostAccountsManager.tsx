import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Wallet, Plus, Pencil, Trash2, Building2 } from 'lucide-react';
import { useCostAccounts, CostAccount } from '@/hooks/useCostAccounts';

const ACCOUNT_COLORS = [
  { value: 'bg-blue-500', label: 'Azul' },
  { value: 'bg-green-500', label: 'Verde' },
  { value: 'bg-purple-500', label: 'Roxo' },
  { value: 'bg-orange-500', label: 'Laranja' },
  { value: 'bg-pink-500', label: 'Rosa' },
  { value: 'bg-cyan-500', label: 'Ciano' },
  { value: 'bg-amber-500', label: 'Âmbar' },
  { value: 'bg-red-500', label: 'Vermelho' },
];

export function CostAccountsManager() {
  const { accounts, addAccount, updateAccount, deleteAccount, loading } = useCostAccounts();
  const [isOpen, setIsOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<CostAccount | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    color: 'bg-blue-500',
    is_active: true,
  });

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      color: 'bg-blue-500',
      is_active: true,
    });
    setEditingAccount(null);
  };

  const openDialog = (account?: CostAccount) => {
    if (account) {
      setEditingAccount(account);
      setFormData({
        name: account.name,
        description: account.description || '',
        color: account.color,
        is_active: account.is_active,
      });
    } else {
      resetForm();
    }
    setIsOpen(true);
  };

  const closeDialog = () => {
    setIsOpen(false);
    resetForm();
  };

  const handleSubmit = async () => {
    if (!formData.name.trim()) return;

    try {
      if (editingAccount) {
        await updateAccount(editingAccount.id, formData);
      } else {
        await addAccount(formData);
      }
      closeDialog();
    } catch (err) {
      // Error handled in hook
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm('Tem certeza que deseja remover esta conta?')) {
      await deleteAccount(id);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Contas
          </CardTitle>
          <Dialog open={isOpen} onOpenChange={(open) => open ? openDialog() : closeDialog()}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="h-4 w-4 mr-2" />
                Nova Conta
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  {editingAccount ? 'Editar Conta' : 'Nova Conta'}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label>Nome da Conta</Label>
                  <Input
                    placeholder="Ex: Marketing, Operações, Pessoal..."
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  />
                </div>

                <div>
                  <Label>Descrição (opcional)</Label>
                  <Input
                    placeholder="Descrição breve da conta"
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  />
                </div>

                <div>
                  <Label>Cor</Label>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {ACCOUNT_COLORS.map((color) => (
                      <button
                        key={color.value}
                        type="button"
                        className={`w-8 h-8 rounded-full ${color.value} ${
                          formData.color === color.value 
                            ? 'ring-2 ring-offset-2 ring-primary' 
                            : ''
                        }`}
                        onClick={() => setFormData({ ...formData, color: color.value })}
                        title={color.label}
                      />
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <Label>Conta ativa</Label>
                  <Switch
                    checked={formData.is_active}
                    onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
                  />
                </div>

                <div className="flex justify-end gap-2 pt-4">
                  <Button variant="outline" onClick={closeDialog}>
                    Cancelar
                  </Button>
                  <Button onClick={handleSubmit} disabled={!formData.name.trim()}>
                    {editingAccount ? 'Salvar' : 'Criar'}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            Carregando...
          </p>
        ) : accounts.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            Nenhuma conta cadastrada
          </p>
        ) : (
          <div className="space-y-2">
            {accounts.map((account) => (
              <div
                key={account.id}
                className="flex items-center justify-between p-3 rounded-lg border bg-card"
              >
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${account.color}`}>
                    <Wallet className="h-4 w-4 text-white" />
                  </div>
                  <div>
                    <p className="font-medium">{account.name}</p>
                    {account.description && (
                      <p className="text-xs text-muted-foreground">
                        {account.description}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {!account.is_active && (
                    <Badge variant="secondary" className="text-xs">
                      Inativa
                    </Badge>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => openDialog(account)}
                  >
                    <Pencil className="h-4 w-4 text-muted-foreground" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDelete(account.id)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-4 pt-4 border-t">
          <p className="text-xs text-muted-foreground">
            💡 Use contas para organizar despesas por área, projeto ou pessoa. 
            Você pode configurar cartões para usar uma conta padrão.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
